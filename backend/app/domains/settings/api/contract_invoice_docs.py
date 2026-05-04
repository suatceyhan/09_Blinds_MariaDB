"""
Contract / invoice printable documents.

PDFs are rendered server-side (HTML → wkhtmltopdf). Deposit templates can be chosen from built-in presets.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from html import escape
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.authorization import is_effective_superadmin
from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.settings.deposit_contract_presets import (
    DEPOSIT_CONTRACT_PRESETS,
    DEPOSIT_PRESET_LABELS,
    FINAL_INVOICE_DEFAULT_HTML,
    default_deposit_preset,
    deposit_preset_keys_in_order,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/settings/contract-invoice", tags=["Settings — contract / invoice"])

TEMPLATE_KINDS: tuple[str, str] = ("deposit_contract", "final_invoice")

_PRESET_KEY_COLUMN_CACHE_KEY = "cdt_has_preset_key_column"


def _company_document_templates_has_preset_key(db: Session) -> bool:
    """True if migration DB/34 added preset_key; avoids crashes before ALTER TABLE."""
    cached = db.info.get(_PRESET_KEY_COLUMN_CACHE_KEY)
    if cached is not None:
        return bool(cached)
    exists = db.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = DATABASE()
                AND table_name = 'company_document_templates'
                AND column_name = 'preset_key'
            )
            """
        )
    ).scalar()
    db.info[_PRESET_KEY_COLUMN_CACHE_KEY] = bool(exists)
    return bool(exists)


def seed_default_contract_invoice_templates_for_company(db: Session, company_id: UUID) -> None:
    """Insert built-in deposit + final invoice rows for a new company when missing (Settings shows saved templates).

    Controlled by ``bootstrap_seed_company_contract_invoice_templates``. Does not commit.
    """
    if not settings.bootstrap_seed_company_contract_invoice_templates:
        return
    cid = str(company_id)
    rows = db.execute(
        text(
            """
            SELECT kind FROM company_document_templates
            WHERE company_id = :cid AND is_deleted IS NOT TRUE
            """
        ),
        {"cid": cid},
    ).fetchall()
    kinds = {str(r[0]) for r in rows}
    has_pk = _company_document_templates_has_preset_key(db)

    if "deposit_contract" not in kinds:
        if has_pk:
            db.execute(
                text(
                    """
                    INSERT IGNORE INTO company_document_templates
                      (company_id, kind, subject, body_html, preset_key, created_at, updated_at, is_deleted)
                    VALUES (:cid, 'deposit_contract', '', '', :pk, NOW(), NOW(), FALSE)
                    """
                ),
                {"cid": cid, "pk": default_deposit_preset()[0]},
            )
        else:
            _k, preset = default_deposit_preset()
            db.execute(
                text(
                    """
                    INSERT IGNORE INTO company_document_templates
                      (company_id, kind, subject, body_html, created_at, updated_at, is_deleted)
                    VALUES (:cid, 'deposit_contract', :subj, :html, NOW(), NOW(), FALSE)
                    """
                ),
                {"cid": cid, "subj": preset.subject, "html": preset.body_html},
            )

    if "final_invoice" not in kinds:
        if has_pk:
            db.execute(
                text(
                    """
                    INSERT IGNORE INTO company_document_templates
                      (company_id, kind, subject, body_html, preset_key, created_at, updated_at, is_deleted)
                    VALUES (:cid, 'final_invoice', :subj, :html, NULL, NOW(), NOW(), FALSE)
                    """
                ),
                {"cid": cid, "subj": "Final invoice", "html": FINAL_INVOICE_DEFAULT_HTML},
            )
        else:
            db.execute(
                text(
                    """
                    INSERT IGNORE INTO company_document_templates
                      (company_id, kind, subject, body_html, created_at, updated_at, is_deleted)
                    VALUES (:cid, 'final_invoice', :subj, :html, NOW(), NOW(), FALSE)
                    """
                ),
                {"cid": cid, "subj": "Final invoice", "html": FINAL_INVOICE_DEFAULT_HTML},
            )


class TemplateOut(BaseModel):
    kind: str
    subject: str
    body_html: str
    preset_key: str | None = None
    legacy_custom: bool = False


class TemplateIn(BaseModel):
    subject: str = Field(default="", max_length=300)
    body_html: str = Field(default="", max_length=200_000)
    preset_key: str | None = Field(default=None, max_length=64)


class PresetCatalogItem(BaseModel):
    kind: str
    key: str
    name: str
    description: str
    body_html: str


# Same sample values as Settings UI — used only for HTML preview (matches PDF CSS via _html_page).
DEPOSIT_PREVIEW_SAMPLE: dict[str, str] = {
    "business_name": "Acme Blinds Inc.",
    "business_address": "123 Main St, Toronto, ON M5J 2N1",
    "business_phone": "(416) 555-0100",
    "business_email": "jobs@acmeblinds.example",
    "customer_name": "John Doe",
    "customer_address": "88 King St, Toronto, ON",
    "customer_phone": "(647) 555-7788",
    "invoice_number": "INV-EST-abc12345",
    "invoice_date": "Apr 18, 2026",
    "product": "Custom Zebra Blinds",
    "description": "Living room — 3× windows, blackout fabric",
    "measurements": "Per field measure sheet",
    "installation_address": "88 King St, Toronto, ON",
    "total_project_price": "3,834.00",
    "deposit_required": "1,917.00",
    "balance_remaining": "1,917.00",
    "deposit_paid": "1,917.00",
    "extra_payments_total": "250.00",
    "extra_payments_count": "2 payments",
    "payments_received_total": "2,167.00",
    "payment_method": "E-transfer",
    "payment_date": "Apr 18, 2026",
}

# Final invoice preview: same keys as live PDF data; extends deposit samples with balance fields.
FINAL_INVOICE_PREVIEW_SAMPLE: dict[str, str] = {
    **DEPOSIT_PREVIEW_SAMPLE,
    "invoice_number": "INV-ORD-abc12345",
    "balance_due": "0.00",
    "balance_paid": "3,834.00",
    "status": "PAID",
}


class FinalInvoicePreviewIn(BaseModel):
    body_html: str = Field(default="", max_length=200_000)


def _fmt_money(v: Any) -> str:
    if v is None:
        return ""
    try:
        d = Decimal(str(v)).quantize(Decimal("0.01"))
    except Exception:
        return str(v)
    return f"{d:,.2f}"


def _safe_str(v: Any) -> str:
    return ("" if v is None else str(v)).strip()


def _html_page(title: str, body: str) -> str:
    # Simple, print-friendly layout.
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <style>
      @page {{ size: Letter; margin: 18mm 14mm; }}
      /* Literal colors: wkhtmltopdf’s Qt WebKit often does not support CSS variables — var() drops backgrounds. */
      * {{ box-sizing: border-box; }}
      body {{ margin: 0; padding: 0; color: #0f172a; font: 12px/1.25 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }}
      .page {{ max-width: 820px; margin: 0 auto; }}
      h1 {{ margin: 0 0 6px; font-size: 20px; letter-spacing: 0.2px; }}
      h2 {{ margin: 22px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }}
      .rule {{ border-top: 1px solid #cbd5e1; margin: 14px 0; }}
      /* wkhtmltopdf uses Qt WebKit: CSS Grid is unreliable — use floats for PDF parity with browser preview. */
      .grid {{ width: 100%; overflow: hidden; }}
      .grid > * {{ float: left; width: 49%; margin-right: 2%; box-sizing: border-box; }}
      .grid > *:nth-child(2n) {{ margin-right: 0; }}
      .grid:after {{ content: ""; display: block; clear: both; }}
      .row {{ overflow: hidden; padding: 3px 0; zoom: 1; }}
      .row .k {{ float: left; width: 158px; padding-right: 10px; color: #475569; }}
      .row .v {{ margin-left: 168px; min-height: 18px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }}
      .row .v.inline {{ border-bottom: none; padding-bottom: 0; }}
      .mono {{ font-variant-numeric: tabular-nums; }}
      .small {{ font-size: 12px; color: #475569; }}
      .avoid-break {{ break-inside: avoid; page-break-inside: avoid; }}
      .doc-card {{ border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px 16px; background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
      .doc-accent {{ border-left: 4px solid #0d9488; padding-left: 14px; background: #f8fafc; border-radius: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
      .doc-badge {{ font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #0f766e; text-transform: uppercase; }}
      .doc-h1 {{ margin: 8px 0 4px; font-size: 21px; letter-spacing: -0.02em; }}
      .doc-meta {{ font-size: 11px; color: #475569; }}
      .doc-inv-no {{ font-size: 15px; font-weight: 600; margin-top: 3px; }}
      .doc-sub {{ margin: 8px 0 0; max-width: 42rem; }}
      .doc-header-wrap {{
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 18px 18px 16px;
        margin-bottom: 14px;
        border-left: 4px solid #0d9488;
        background: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .doc-card-pad {{ padding: 16px 18px; }}
      .doc-h2-rule {{
        margin: 0 0 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #cbd5e1;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #475569;
      }}
      .doc-sheet {{ width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px; table-layout: auto; }}
      .doc-sheet-lbl {{
        white-space: nowrap;
        vertical-align: baseline;
        padding: 9px 10px 9px 0;
        color: #475569;
        font-weight: 500;
      }}
      .doc-sheet-lead {{ vertical-align: baseline; padding: 0 8px; width: 100%; }}
      .doc-lead-fill {{
        display: block;
        border-bottom: 1px dotted #94a3b8;
        margin: 0 2px 5px 2px;
        line-height: 0;
        font-size: 0;
        height: 1px;
        overflow: visible;
      }}
      .doc-sheet-amt {{
        white-space: nowrap;
        text-align: right;
        vertical-align: baseline;
        padding: 9px 0 9px 14px;
        font-variant-numeric: tabular-nums;
      }}
      .doc-sheet-strong {{ font-weight: 600; }}
      .doc-ol {{ margin: 0; padding-left: 18px; color: #0f172a; line-height: 1.55; font-size: 11px; }}
      .doc-ol li {{ margin: 0 0 6px; }}
      .sig-k {{ font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; }}
      .sig-line {{ border-bottom: 1px solid #cbd5e1; min-height: 28px; padding-top: 6px; }}
      .sig-block {{ margin-top: 18px; border-bottom: 1px solid #cbd5e1; min-height: 36px; padding-top: 6px; }}
      .doc-price-table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }}
      .doc-price-table td {{ padding: 8px 10px; border-bottom: 1px solid #cbd5e1; vertical-align: top; }}
      .doc-price-table td:last-child {{ text-align: right; font-variant-numeric: tabular-nums; }}
      .doc-price-table tr:last-child td {{ border-bottom: none; font-weight: 600; }}
      .doc-terms {{ font-size: 11px; color: #475569; line-height: 1.45; }}

      /* —— Corporate deposit preset (teal_pro_01 “Corporate Navy”) —— */
      .doc-inv-root {{ font-size: 11px; }}
      .doc-top-band {{ width: 100%; margin-bottom: 14px; border-bottom: 2px solid #1e3a8f; padding-bottom: 12px; }}
      .doc-top-left {{ width: 52%; padding-right: 12px; vertical-align: top; }}
      .doc-top-right {{ width: 48%; padding-left: 12px; vertical-align: top; text-align: right; }}
      .doc-meta-mini {{
        display: inline-block;
        text-align: left;
        vertical-align: top;
        border-collapse: collapse;
        font-size: 10px;
      }}
      .doc-logo-ph {{
        font-size: 9px; color: #94a3b8; border: 1px dashed #cbd5e1; display: inline-block;
        padding: 7px 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em;
      }}
      .doc-brand-name {{ font-size: 16px; font-weight: 700; letter-spacing: -0.02em; color: #1e3a8f; }}
      .doc-brand-sub {{ font-size: 10px; color: #475569; margin-top: 4px; }}
      .doc-main-invoice-title {{
        font-size: 21px; font-weight: 800; letter-spacing: 0.05em; color: #1e3a8f; line-height: 1.15;
      }}
      .doc-main-invoice-sub {{ font-size: 10px; color: #475569; margin: 6px 0 12px; }}
      .doc-meta-mini-k {{
        text-align: left; padding: 5px 12px 5px 0; color: #475569; font-weight: 600;
        border-bottom: 1px solid #cbd5e1; white-space: nowrap;
      }}
      .doc-meta-mini-v {{ text-align: right; padding: 5px 0 5px 12px; border-bottom: 1px solid #cbd5e1; }}
      .doc-pair-grid {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; table-layout: fixed; }}
      .doc-pair-cell {{ width: 50%; vertical-align: top; }}
      .doc-pair-gap {{ padding-left: 10px; }}
      .doc-sec-hd {{
        background: #1e3a8f; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
        padding: 7px 10px; text-transform: uppercase;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }}
      .doc-sec-hd-sm {{ font-size: 9px; padding: 6px 8px; }}
      .doc-sec-bd {{
        border: 1px solid #cbd5e1; border-top: none; padding: 10px 12px; background: #fff; min-height: 72px;
      }}
      .doc-sec-bd-tight {{ padding: 8px 10px; min-height: 0; }}
      .doc-line {{ margin: 0 0 5px; line-height: 1.45; font-size: 11px; }}
      .doc-line-strong {{ font-weight: 600; font-size: 12px; }}
      .doc-lab {{ color: #475569; font-size: 10px; margin-right: 6px; }}
      .doc-sec-full {{ margin-bottom: 14px; }}
      .doc-inner-kv {{ width: 100%; font-size: 11px; }}
      .doc-ik {{ color: #475569; padding: 4px 12px 4px 0; vertical-align: top; width: 34%; white-space: nowrap; }}
      .doc-iv {{ padding: 4px 0; vertical-align: top; }}
      .doc-desc-table {{ width: 100%; border-collapse: collapse; border: 1px solid #1e293b; }}
      .doc-desc-hd-l {{
        background: #1e3a8f; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
        padding: 8px 10px; width: 75%;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }}
      .doc-desc-hd-r {{
        background: #1e3a8f; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
        padding: 8px 10px; width: 25%;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }}
      .doc-desc-body {{ border-right: 1px solid #cbd5e1; padding: 12px 10px; vertical-align: top; }}
      .doc-desc-amt {{ padding: 12px 10px; font-size: 12px; font-weight: 600; }}
      .doc-li-title {{ font-weight: 700; font-size: 12px; margin-bottom: 6px; }}
      .doc-li-note {{ font-size: 10px; color: #475569; line-height: 1.45; }}
      .doc-bottom-split {{ width: 100%; overflow: hidden; margin-top: 14px; }}
      .doc-notes-col {{ float: left; width: 58%; padding-right: 12px; box-sizing: border-box; }}
      .doc-totals-wrap {{ float: right; width: 40%; max-width: 300px; box-sizing: border-box; }}
      .doc-notes-body {{
        border: 1px solid #cbd5e1; border-top: none; padding: 10px 12px 14px; background: #fff; min-height: 180px;
      }}
      .doc-ol-tight {{ margin: 0; padding-left: 16px; font-size: 10px; line-height: 1.5; color: #0f172a; }}
      .doc-ol-tight li {{ margin-bottom: 5px; }}
      .doc-auth-note {{ font-size: 10px; color: #475569; margin: 12px 0 14px; line-height: 1.45; }}
      .doc-totals-box {{ width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 11px; margin-bottom: 10px; }}
      .doc-totals-box td {{ padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }}
      .doc-totals-box tr:last-child td {{ border-bottom: none; }}
      .doc-tl {{ color: #475569; font-weight: 500; }}
      .doc-tv {{ text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }}
      .doc-totals-grand td {{
        background: #1e3a8f; color: #fff; font-weight: 700; border-bottom: none;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }}
      .doc-totals-grand .doc-tl {{ color: #fff; }}
      .doc-totals-grand .doc-tv {{ color: #fff; }}
      .doc-totals-lite .doc-tl {{ font-size: 10px; }}
      .doc-pay-subhd {{
        font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: #1e3a8f;
        margin: 12px 0 6px; text-transform: uppercase;
      }}
      .doc-sig-grid {{ width: 100%; margin-top: 8px; }}
      .doc-sig-cell {{ width: 50%; vertical-align: bottom; padding-right: 8px; }}
      .doc-sig-padl {{ padding-left: 8px; padding-right: 0; }}
      .doc-sig-cap {{ font-size: 9px; color: #475569; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }}
      .doc-sig-line {{ border-bottom: 1px solid #0f172a; min-height: 22px; }}
      .doc-sig-wide {{ margin-top: 4px; }}
      .doc-footer-thanks {{
        clear: both; text-align: center; font-size: 11px; font-weight: 600; letter-spacing: 0.14em;
        color: #1e3a8f; text-transform: uppercase; padding: 22px 8px 6px; margin-top: 10px; border-top: 1px solid #cbd5e1;
      }}
      .doc-bottom-split:after {{ content: ""; display: block; clear: both; }}

      /* —— Classic invoice preset (classic_invoice_01 “Classic Invoice Navy”) —— */
      .inv2-root {{ font-size: 11px; }}
      .inv2-title-row {{ width: 100%; border-collapse: collapse; margin: 10px 0 16px; }}
      .inv2-title-cell {{ width: 68%; }}
      .inv2-no-cell {{ width: 32%; text-align: right; }}
      .inv2-title {{
        font-family: Georgia, "Times New Roman", Times, serif;
        font-size: 44px;
        letter-spacing: 0.16em;
        margin: 0;
        color: #0f172a;
      }}
      .inv2-no {{ font-size: 12px; margin-bottom: 8px; }}
      .inv2-no-k {{ color: #475569; font-weight: 700; margin-right: 6px; }}
      .inv2-muted {{ color: #475569; font-size: 10px; }}
      .inv2-pairs {{ width: 100%; border-collapse: collapse; margin-bottom: 12px; }}
      .inv2-pair {{ width: 50%; vertical-align: top; }}
      .inv2-pair-hd {{ font-weight: 700; letter-spacing: 0.08em; color: #475569; font-size: 10px; margin-bottom: 6px; }}
      .inv2-pair-bd {{ padding-right: 10px; }}
      .inv2-line {{ margin: 0 0 4px; }}
      .inv2-strong {{ font-weight: 600; }}
      .inv2-date {{ margin: 6px 0 10px; color: #0f172a; }}
      .inv2-date-k {{ color: #475569; font-weight: 700; margin-right: 6px; }}
      .inv2-items {{
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #1e293b;
        margin: 8px 0 14px;
      }}
      .inv2-hd {{
        background: #1e3a8f;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 8px 10px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .inv2-col-desc {{ width: 56%; }}
      .inv2-col-unit {{ width: 16%; }}
      .inv2-col-qty {{ width: 10%; }}
      .inv2-col-total {{ width: 18%; }}
      .inv2-td {{ padding: 10px; border-top: 2px solid #1e293b; vertical-align: top; }}
      .inv2-amt {{ white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }}
      .inv2-item-title {{ font-weight: 700; margin-bottom: 4px; }}
      .inv2-item-note {{ font-size: 10px; color: #475569; line-height: 1.45; }}
      .inv2-bottom {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
      .inv2-pay {{ width: 58%; padding-right: 16px; }}
      .inv2-pay-hd {{ font-weight: 800; letter-spacing: 0.06em; color: #475569; font-size: 11px; margin-bottom: 8px; }}
      .inv2-pay-row {{ margin: 0 0 6px; font-size: 10px; color: #0f172a; }}
      .inv2-pay-k {{ color: #475569; font-weight: 700; margin-right: 6px; }}
      .inv2-totals {{ width: 42%; }}
      .inv2-totals-box {{ width: 100%; border-collapse: collapse; }}
      .inv2-totals-box td {{ padding: 4px 8px; font-size: 10px; }}
      .inv2-tk {{ color: #475569; font-weight: 800; letter-spacing: 0.06em; }}
      .inv2-tv {{
        background: #1e3a8f;
        color: #fff;
        font-weight: 800;
        white-space: nowrap;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .inv2-t-grand .inv2-tk {{ color: #0f172a; }}
      .inv2-thanks {{
        text-align: center;
        margin-top: 30px;
        font-family: "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive;
        font-size: 56px;
        color: #1e3a8f;
        font-weight: 500;
      }}

      @media print {{
        .page {{ max-width: none; margin: 0; }}
      }}
    </style>
  </head>
  <body>
    <div class="page">
      {body}
    </div>
  </body>
</html>
"""


def _fetch_order_doc_context(db: Session, company_id: str, order_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              o.id AS order_id,
              o.agreement_date,
              o.created_at,
              o.total_amount,
              o.tax_amount,
              o.downpayment,
              o.final_payment,
              o.balance,
              o.installation_scheduled_start_at,
              c.name AS customer_first_name,
              COALESCE(c.surname,'') AS customer_last_name,
              c.address AS customer_address,
              c.phone AS customer_phone,
              co.name AS company_name,
              co.address AS company_address,
              co.phone AS company_phone,
              co.email AS company_email
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            JOIN companies co ON co.id = o.company_id
            WHERE o.company_id = :cid AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": company_id, "oid": order_id},
    ).mappings().first()
    return dict(row) if row else None


def _fetch_order_extra_payments_summary(db: Session, company_id: str, order_id: str) -> tuple[Decimal, int]:
    """Return (sum_of_order_payment_entries, count). Excludes downpayment; excludes soft-deleted rows."""
    row = db.execute(
        text(
            """
            SELECT
              COALESCE(SUM(amount), 0) AS total,
              COUNT(1) AS cnt
            FROM order_payment_entries
            WHERE company_id = :cid AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": company_id, "oid": order_id},
    ).mappings().first()
    if not row:
        return Decimal("0.00"), 0
    q = Decimal("0.01")
    try:
        total = Decimal(str(row.get("total") or 0)).quantize(q)
    except Exception:
        total = Decimal("0.00")
    try:
        cnt = int(row.get("cnt") or 0)
    except Exception:
        cnt = 0
    return total, max(cnt, 0)


def _invoice_number_for_order(order_id: str) -> str:
    return f"INV-{order_id}"


def _default_deposit_template_out() -> TemplateOut:
    key, preset = default_deposit_preset()
    return TemplateOut(
        kind="deposit_contract",
        subject=preset.subject,
        body_html=preset.body_html,
        preset_key=key,
        legacy_custom=False,
    )


def _default_template(kind: str) -> TemplateOut:
    if kind == "deposit_contract":
        return _default_deposit_template_out()
    return TemplateOut(
        kind=kind,
        subject="Final invoice",
        body_html=FINAL_INVOICE_DEFAULT_HTML,
        preset_key=None,
        legacy_custom=False,
    )


def _load_template(db: Session, company_id: str, kind: str) -> TemplateOut:
    if kind not in TEMPLATE_KINDS:
        raise HTTPException(status_code=400, detail="Invalid template kind.")
    has_pk = _company_document_templates_has_preset_key(db)
    sql = (
        """
            SELECT subject, body_html, preset_key
            FROM company_document_templates
            WHERE company_id = :cid AND kind = :k AND is_deleted IS NOT TRUE
            LIMIT 1
            """
        if has_pk
        else """
            SELECT subject, body_html
            FROM company_document_templates
            WHERE company_id = :cid AND kind = :k AND is_deleted IS NOT TRUE
            LIMIT 1
            """
    )
    row = db.execute(text(sql), {"cid": company_id, "k": kind}).mappings().first()
    if not row:
        return _default_template(kind)

    subj_db = str(row.get("subject") or "").strip()
    body_db = str(row.get("body_html") or "").strip()
    pk_row = str(row.get("preset_key") or "").strip() if has_pk else ""

    if kind == "deposit_contract":
        if pk_row and pk_row in DEPOSIT_CONTRACT_PRESETS:
            preset = DEPOSIT_CONTRACT_PRESETS[pk_row]
            return TemplateOut(
                kind=kind,
                subject=preset.subject,
                body_html=preset.body_html,
                preset_key=pk_row,
                legacy_custom=False,
            )
        if body_db:
            return TemplateOut(
                kind=kind,
                subject=subj_db,
                body_html=body_db,
                preset_key=None,
                legacy_custom=True,
            )
        return _default_deposit_template_out()

    if body_db or subj_db:
        return TemplateOut(
            kind=kind,
            subject=subj_db,
            body_html=body_db,
            preset_key=None,
            legacy_custom=False,
        )
    return _default_template(kind)


def _upsert_legacy_template(db: Session, company_id: str, kind: str, payload: TemplateIn) -> None:
    if kind not in TEMPLATE_KINDS:
        raise HTTPException(status_code=400, detail="Invalid template kind.")
    has_pk = _company_document_templates_has_preset_key(db)
    if has_pk:
        db.execute(
            text(
                """
                INSERT INTO company_document_templates
                  (company_id, kind, subject, body_html, preset_key, created_at, updated_at, is_deleted)
                VALUES (:cid, :k, :subj, :html, NULL, NOW(), NOW(), FALSE)
                ON DUPLICATE KEY UPDATE
                  subject = VALUES(subject),
                  body_html = VALUES(body_html),
                  preset_key = NULL,
                  updated_at = NOW(),
                  is_deleted = FALSE
                """
            ),
            {"cid": company_id, "k": kind, "subj": payload.subject.strip(), "html": payload.body_html},
        )
    else:
        db.execute(
            text(
                """
                INSERT INTO company_document_templates
                  (company_id, kind, subject, body_html, created_at, updated_at, is_deleted)
                VALUES (:cid, :k, :subj, :html, NOW(), NOW(), FALSE)
                ON DUPLICATE KEY UPDATE
                  subject = VALUES(subject),
                  body_html = VALUES(body_html),
                  updated_at = NOW(),
                  is_deleted = FALSE
                """
            ),
            {"cid": company_id, "k": kind, "subj": payload.subject.strip(), "html": payload.body_html},
        )
    db.commit()


def _upsert_deposit_preset(db: Session, company_id: str, preset_key: str) -> None:
    if not _company_document_templates_has_preset_key(db):
        raise HTTPException(
            status_code=503,
            detail=(
                "Database migration required: run SQL from DB/34_company_document_templates_preset_key.sql "
                "(adds column preset_key to company_document_templates)."
            ),
        )
    db.execute(
        text(
            """
            INSERT INTO company_document_templates
              (company_id, kind, subject, body_html, preset_key, created_at, updated_at, is_deleted)
            VALUES (:cid, 'deposit_contract', '', '', :pk, NOW(), NOW(), FALSE)
            ON DUPLICATE KEY UPDATE
              subject = '',
              body_html = '',
              preset_key = VALUES(preset_key),
              updated_at = NOW(),
              is_deleted = FALSE
            """
        ),
        {"cid": company_id, "pk": preset_key},
    )
    db.commit()


def _render_html_from_template(
    tpl: TemplateOut,
    kind: str,
    data: dict[str, str],
    page_title: str,
) -> tuple[str, str]:
    """Apply escaped placeholder data and wrap with _html_page."""
    subj = tpl.subject.strip() or _default_template(kind).subject
    safe = {k: escape(v or "") for k, v in data.items()}
    body = tpl.body_html
    for k, v in safe.items():
        body = body.replace(f"{{{{{k}}}}}", v)
    return subj, _html_page(page_title, body)


def _deposit_template_for_preview(db: Session, company_id: str, preset_key_param: str | None) -> TemplateOut:
    """Use explicit preset when picking an unsaved card in Settings; otherwise saved company template."""
    pk = (preset_key_param or "").strip()
    if pk and pk in DEPOSIT_CONTRACT_PRESETS:
        preset = DEPOSIT_CONTRACT_PRESETS[pk]
        return TemplateOut(
            kind="deposit_contract",
            subject=preset.subject,
            body_html=preset.body_html,
            preset_key=pk,
            legacy_custom=False,
        )
    return _load_template(db, company_id, "deposit_contract")


def render_contract_invoice_html(
    *,
    db: Session,
    company_id: str,
    kind: str,
    data: dict[str, str],
    page_title: str,
) -> tuple[str, str]:
    """Return (subject, full_html_page)."""
    tpl = _load_template(db, company_id, kind)
    return _render_html_from_template(tpl, kind, data, page_title)


def render_contract_invoice_pdf(
    *,
    db: Session,
    company_id: str,
    kind: str,
    data: dict[str, str],
    page_title: str,
) -> tuple[str, bytes]:
    from app.utils.pdf import html_to_pdf_bytes

    subject, html = render_contract_invoice_html(
        db=db, company_id=company_id, kind=kind, data=data, page_title=page_title
    )
    return subject, html_to_pdf_bytes(html=html)


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    return [_load_template(db, str(cid), k) for k in TEMPLATE_KINDS]


@router.get("/presets", response_model=list[PresetCatalogItem])
def list_preset_catalog(
    kind: Annotated[str, Query(min_length=1)],
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    if kind.strip() != "deposit_contract":
        raise HTTPException(status_code=400, detail="Unsupported preset kind.")
    out: list[PresetCatalogItem] = []
    for key in deposit_preset_keys_in_order():
        meta = DEPOSIT_PRESET_LABELS.get(key, ("Preset", ""))
        preset = DEPOSIT_CONTRACT_PRESETS[key]
        out.append(
            PresetCatalogItem(
                kind="deposit_contract",
                key=key,
                name=meta[0],
                description=meta[1],
                body_html=preset.body_html,
            )
        )
    return out


@router.get("/preview/deposit-contract", response_class=HTMLResponse)
def preview_deposit_contract_html(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
    preset_key: Annotated[str | None, Query()] = None,
):
    """Exact same HTML/CSS as PDF generation (`_html_page`), with fixed sample placeholder values."""
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    tpl = _deposit_template_for_preview(db, str(cid), preset_key)
    _, html = _render_html_from_template(
        tpl,
        "deposit_contract",
        DEPOSIT_PREVIEW_SAMPLE,
        "Invoice & Service Agreement",
    )
    return HTMLResponse(content=html)


@router.post("/preview/final-invoice", response_class=HTMLResponse)
def preview_final_invoice_html(
    payload: FinalInvoicePreviewIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    """Same HTML/CSS stack as PDF; body comes from draft `body_html` or company template / default preset."""
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")

    draft = payload.body_html.strip()
    if draft:
        tpl = TemplateOut(kind="final_invoice", subject="", body_html=draft, preset_key=None, legacy_custom=False)
    else:
        tpl = _load_template(db, str(cid), "final_invoice")
    _, html = _render_html_from_template(
        tpl,
        "final_invoice",
        FINAL_INVOICE_PREVIEW_SAMPLE,
        "Final invoice",
    )
    return HTMLResponse(content=html)


@router.put("/templates/{kind}", status_code=204)
def save_template(
    kind: str,
    body: TemplateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    k = kind.strip()
    if k not in TEMPLATE_KINDS:
        raise HTTPException(status_code=400, detail="Invalid template kind.")
    pk = (body.preset_key or "").strip()
    if pk:
        if k != "deposit_contract":
            raise HTTPException(status_code=400, detail="Presets are only supported for deposit_contract.")
        if pk not in DEPOSIT_CONTRACT_PRESETS:
            raise HTTPException(status_code=400, detail="Unknown preset.")
        _upsert_deposit_preset(db, str(cid), pk)
        return None
    _upsert_legacy_template(db, str(cid), k, body)
    return None


@router.get("/orders/{order_id}/deposit-contract")
def deposit_invoice_contract(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    oid = order_id.strip()
    ctx = _fetch_order_doc_context(db, str(cid), oid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Order not found.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _invoice_number_for_order(oid)
    cust_name = f"{_safe_str(ctx.get('customer_first_name'))} {_safe_str(ctx.get('customer_last_name'))}".strip()
    total = (Decimal(str(ctx.get("total_amount") or 0)) + Decimal(str(ctx.get("tax_amount") or 0))).quantize(
        Decimal("0.01")
    )
    down = Decimal(str(ctx.get("downpayment") or 0)).quantize(Decimal("0.01"))
    bal = Decimal(str(ctx.get("balance") or 0)).quantize(Decimal("0.01"))
    extra_total, extra_cnt = _fetch_order_extra_payments_summary(db, str(cid), oid)
    received_total = (down + extra_total).quantize(Decimal("0.01"))

    _subject, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="deposit_contract",
        page_title="Invoice & Service Agreement",
        data={
            "business_name": _safe_str(ctx.get("company_name")),
            "business_address": _safe_str(ctx.get("company_address")),
            "business_phone": _safe_str(ctx.get("company_phone")),
            "business_email": _safe_str(ctx.get("company_email")),
            "customer_name": cust_name,
            "customer_address": _safe_str(ctx.get("customer_address")),
            "customer_phone": _safe_str(ctx.get("customer_phone")),
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": _safe_str(ctx.get("customer_address")),
            "total_project_price": _fmt_money(total),
            "deposit_required": _fmt_money(down),
            "balance_remaining": _fmt_money(bal),
            "deposit_paid": _fmt_money(down),
            "extra_payments_total": _fmt_money(extra_total),
            "extra_payments_count": f"{extra_cnt} payment" + ("s" if extra_cnt != 1 else ""),
            "payments_received_total": _fmt_money(received_total),
            "payment_method": "",
            "payment_date": "",
        },
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="deposit-invoice-contract-{oid}.pdf"'},
    )


@router.get("/orders/{order_id}/final-invoice")
def final_invoice(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    oid = order_id.strip()
    ctx = _fetch_order_doc_context(db, str(cid), oid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Order not found.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _invoice_number_for_order(oid)
    cust_name = f"{_safe_str(ctx.get('customer_first_name'))} {_safe_str(ctx.get('customer_last_name'))}".strip()
    total = (Decimal(str(ctx.get("total_amount") or 0)) + Decimal(str(ctx.get("tax_amount") or 0))).quantize(
        Decimal("0.01")
    )
    down = Decimal(str(ctx.get("downpayment") or 0)).quantize(Decimal("0.01"))
    bal = Decimal(str(ctx.get("balance") or 0)).quantize(Decimal("0.01"))
    paid = abs(bal) <= Decimal("0.01")
    extra_total, extra_cnt = _fetch_order_extra_payments_summary(db, str(cid), oid)
    received_total = (down + extra_total).quantize(Decimal("0.01"))
    paid_to_date = (total - bal).quantize(Decimal("0.01"))

    _subject, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="final_invoice",
        page_title="Final invoice",
        data={
            "business_name": _safe_str(ctx.get("company_name")),
            "business_address": _safe_str(ctx.get("company_address")),
            "business_phone": _safe_str(ctx.get("company_phone")),
            "business_email": _safe_str(ctx.get("company_email")),
            "customer_name": cust_name,
            "customer_address": _safe_str(ctx.get("customer_address")),
            "customer_phone": _safe_str(ctx.get("customer_phone")),
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": _safe_str(ctx.get("customer_address")),
            "total_project_price": _fmt_money(total),
            "deposit_paid": _fmt_money(down),
            "balance_due": _fmt_money(bal),
            "balance_paid": _fmt_money(paid_to_date),
            "extra_payments_total": _fmt_money(extra_total),
            "extra_payments_count": f"{extra_cnt} payment" + ("s" if extra_cnt != 1 else ""),
            "payments_received_total": _fmt_money(received_total),
            "payment_method": "",
            "payment_date": "",
            "status": "PAID" if paid else "DUE",
        },
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="final-invoice-{oid}.pdf"'},
    )

