"""
Contract / invoice printable documents.

PDFs are rendered server-side (HTML → wkhtmltopdf). Deposit templates can be chosen from built-in presets.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from html import escape
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.authorization import is_effective_superadmin
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.settings.deposit_contract_presets import (
    DEPOSIT_CONTRACT_PRESETS,
    DEPOSIT_PRESET_LABELS,
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
              WHERE table_catalog = current_database()
                AND table_name = 'company_document_templates'
                AND column_name = 'preset_key'
            )
            """
        )
    ).scalar()
    db.info[_PRESET_KEY_COLUMN_CACHE_KEY] = bool(exists)
    return bool(exists)


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
      :root {{ --ink:#0f172a; --muted:#475569; --line:#cbd5e1; }}
      * {{ box-sizing: border-box; }}
      body {{ margin: 0; padding: 0; color: var(--ink); font: 12px/1.25 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; }}
      .page {{ max-width: 820px; margin: 0 auto; }}
      h1 {{ margin: 0 0 6px; font-size: 20px; letter-spacing: 0.2px; }}
      h2 {{ margin: 22px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }}
      .rule {{ border-top: 1px solid var(--line); margin: 14px 0; }}
      .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }}
      .row {{ display: grid; grid-template-columns: 160px 1fr; gap: 10px; padding: 2px 0; }}
      .k {{ color: var(--muted); }}
      .v {{ min-height: 18px; border-bottom: 1px solid var(--line); padding-bottom: 2px; }}
      .v.inline {{ border-bottom: none; padding-bottom: 0; }}
      .mono {{ font-variant-numeric: tabular-nums; }}
      .small {{ font-size: 12px; color: var(--muted); }}
      .avoid-break {{ break-inside: avoid; page-break-inside: avoid; }}
      .doc-card {{ border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; background: #f8fafc; }}
      .doc-accent {{ border-left: 4px solid #0d9488; padding-left: 14px; background: #f8fafc; border-radius: 10px; }}
      .doc-badge {{ font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #0f766e; text-transform: uppercase; }}
      .doc-h1 {{ margin: 8px 0 4px; font-size: 21px; letter-spacing: -0.02em; }}
      .doc-meta {{ font-size: 11px; color: var(--muted); }}
      .doc-price-table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }}
      .doc-price-table td {{ padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }}
      .doc-price-table td:last-child {{ text-align: right; font-variant-numeric: tabular-nums; }}
      .doc-price-table tr:last-child td {{ border-bottom: none; font-weight: 600; }}
      .doc-terms {{ font-size: 11px; color: var(--muted); line-height: 1.45; }}
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
              o.id::text AS order_id,
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
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": company_id, "oid": order_id},
    ).mappings().first()
    return dict(row) if row else None


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
        body_html="""
<h1>FINAL INVOICE</h1>
<div class="small">Final payment summary</div>
<div class="rule"></div>
<div class="grid">
  <div>
    <h2>Business</h2>
    <div class="row"><div class="k">Business Name</div><div class="v">{{business_name}}</div></div>
    <div class="row"><div class="k">Address</div><div class="v">{{business_address}}</div></div>
    <div class="row"><div class="k">Phone</div><div class="v">{{business_phone}}</div></div>
    <div class="row"><div class="k">Email</div><div class="v">{{business_email}}</div></div>
  </div>
  <div>
    <h2>Invoice</h2>
    <div class="row"><div class="k">Invoice Number</div><div class="v mono">{{invoice_number}}</div></div>
    <div class="row"><div class="k">Date</div><div class="v">{{invoice_date}}</div></div>
  </div>
</div>
<div class="rule"></div>
<h2>Customer</h2>
<div class="row"><div class="k">Customer Name</div><div class="v">{{customer_name}}</div></div>
<div class="row"><div class="k">Address</div><div class="v">{{customer_address}}</div></div>
<div class="rule"></div>
<h2>Project details</h2>
<div class="row"><div class="k">Product</div><div class="v inline">{{product}}</div></div>
<div class="row"><div class="k">Description</div><div class="v">{{description}}</div></div>
<div class="rule"></div>
<h2>Pricing summary</h2>
<div class="row"><div class="k">Total Project Price</div><div class="v mono">${{total_project_price}}</div></div>
<div class="row"><div class="k">Deposit Paid</div><div class="v mono">${{deposit_paid}}</div></div>
<div class="row"><div class="k">Balance Due</div><div class="v mono">${{balance_due}}</div></div>
<div class="rule"></div>
<h2>Payment terms</h2>
<div class="small">
  <div>- Final payment is due upon completion.</div>
  <div>- Thank you for your business!</div>
</div>
<div class="rule"></div>
<h2>Payment status</h2>
<div class="row"><div class="k">Balance Paid</div><div class="v mono">${{balance_paid}}</div></div>
<div class="row"><div class="k">Payment Method</div><div class="v">{{payment_method}}</div></div>
<div class="row"><div class="k">Date</div><div class="v">{{payment_date}}</div></div>
<div class="row"><div class="k">Status</div><div class="v inline mono">{{status}}</div></div>
""".strip(),
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
            WHERE company_id = CAST(:cid AS uuid) AND kind = :k AND is_deleted IS NOT TRUE
            LIMIT 1
            """
        if has_pk
        else """
            SELECT subject, body_html
            FROM company_document_templates
            WHERE company_id = CAST(:cid AS uuid) AND kind = :k AND is_deleted IS NOT TRUE
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
                VALUES (CAST(:cid AS uuid), :k, :subj, :html, NULL, NOW(), NOW(), FALSE)
                ON CONFLICT (company_id, kind) DO UPDATE
                  SET subject = EXCLUDED.subject,
                      body_html = EXCLUDED.body_html,
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
                VALUES (CAST(:cid AS uuid), :k, :subj, :html, NOW(), NOW(), FALSE)
                ON CONFLICT (company_id, kind) DO UPDATE
                  SET subject = EXCLUDED.subject,
                      body_html = EXCLUDED.body_html,
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
            VALUES (CAST(:cid AS uuid), 'deposit_contract', '', '', :pk, NOW(), NOW(), FALSE)
            ON CONFLICT (company_id, kind) DO UPDATE
              SET subject = '',
                  body_html = '',
                  preset_key = EXCLUDED.preset_key,
                  updated_at = NOW(),
                  is_deleted = FALSE
            """
        ),
        {"cid": company_id, "pk": preset_key},
    )
    db.commit()


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
    subj = tpl.subject.strip() or _default_template(kind).subject

    safe = {k: escape(v or "") for k, v in data.items()}
    body = tpl.body_html
    for k, v in safe.items():
        body = body.replace(f"{{{{{k}}}}}", v)
    return subj, _html_page(page_title, body)


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
    if not cid and not is_effective_superadmin(current_user):
        raise HTTPException(status_code=403, detail="No active company.")
    if not cid:
        raise HTTPException(status_code=400, detail="Select a company first.")
    return [_load_template(db, str(cid), k) for k in TEMPLATE_KINDS]


@router.get("/presets", response_model=list[PresetCatalogItem])
def list_preset_catalog(
    kind: Annotated[str, Query(min_length=1)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.view"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(current_user):
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


@router.put("/templates/{kind}", status_code=204)
def save_template(
    kind: str,
    body: TemplateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.contract_invoice.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid and not is_effective_superadmin(current_user):
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
    if not cid and not is_effective_superadmin(current_user):
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
    if not cid and not is_effective_superadmin(current_user):
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
            "total_project_price": _fmt_money(total),
            "deposit_paid": _fmt_money(down),
            "balance_due": _fmt_money(bal),
            "balance_paid": _fmt_money(total - down),
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

