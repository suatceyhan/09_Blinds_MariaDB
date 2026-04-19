"""
Built-in deposit invoice + contract PDF/HTML presets.

Keys are stable IDs stored per company in company_document_templates.preset_key.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DepositPreset:
    subject: str
    body_html: str


DEFAULT_DEPOSIT_PRESET_KEY = "teal_pro_01"

# Title + short line for catalog cards (settings UI).
DEPOSIT_PRESET_LABELS: dict[str, tuple[str, str]] = {
    "teal_pro_01": (
        "Professional (Teal)",
        "Structured invoice header, business / customer panels, pricing summary, compact terms, and signature block.",
    ),
}


DEPOSIT_CONTRACT_PRESETS: dict[str, DepositPreset] = {
    "teal_pro_01": DepositPreset(
        subject="Invoice & Service Agreement",
        body_html=r"""
<div class="doc-accent doc-card avoid-break">
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="vertical-align:top;padding-right:12px;">
        <div class="doc-badge">Deposit invoice · Service agreement</div>
        <div class="doc-h1">Invoice &amp; Service Agreement</div>
        <div class="small" style="margin-top:4px;">Custom window treatments — measurements and pricing as listed below.</div>
      </td>
      <td style="vertical-align:top;text-align:right;white-space:nowrap;width:160px;">
        <div class="doc-meta">Invoice number</div>
        <div class="mono" style="font-size:15px;font-weight:600;margin-top:2px;">{{invoice_number}}</div>
        <div class="doc-meta" style="margin-top:10px;">Date</div>
        <div class="mono">{{invoice_date}}</div>
      </td>
    </tr>
  </table>
</div>

<div class="grid avoid-break">
  <div class="doc-card">
    <h2>Business</h2>
    <div class="row"><div class="k">Name</div><div class="v">{{business_name}}</div></div>
    <div class="row"><div class="k">Address</div><div class="v">{{business_address}}</div></div>
    <div class="row"><div class="k">Phone</div><div class="v">{{business_phone}}</div></div>
    <div class="row"><div class="k">Email</div><div class="v">{{business_email}}</div></div>
  </div>
  <div class="doc-card">
    <h2>Bill to</h2>
    <div class="row"><div class="k">Customer</div><div class="v">{{customer_name}}</div></div>
    <div class="row"><div class="k">Address</div><div class="v">{{customer_address}}</div></div>
    <div class="row"><div class="k">Phone</div><div class="v">{{customer_phone}}</div></div>
  </div>
</div>

<div class="doc-card avoid-break">
  <h2>Project</h2>
  <div class="row"><div class="k">Product</div><div class="v inline">{{product}}</div></div>
  <div class="row"><div class="k">Scope / notes</div><div class="v">{{description}}</div></div>
  <div class="row"><div class="k">Measurements</div><div class="v">{{measurements}}</div></div>
  <div class="row"><div class="k">Installation address</div><div class="v">{{installation_address}}</div></div>
</div>

<div class="doc-card avoid-break">
  <h2>Pricing</h2>
  <table class="doc-price-table">
    <tr>
      <td>Total project price</td>
      <td class="mono">${{total_project_price}}</td>
    </tr>
    <tr>
      <td>Deposit required</td>
      <td class="mono">${{deposit_required}}</td>
    </tr>
    <tr>
      <td>Balance remaining</td>
      <td class="mono">${{balance_remaining}}</td>
    </tr>
  </table>
</div>

<div class="doc-card avoid-break">
  <h2>Terms</h2>
  <div class="doc-terms">
    <div style="margin-bottom:6px;">· A deposit is required before production begins.</div>
    <div style="margin-bottom:6px;">· Once production has started, the deposit is non-refundable.</div>
    <div style="margin-bottom:6px;">· Estimated completion depends on materials and schedule — final payment is due on completion / installation unless otherwise agreed.</div>
    <div>· Changes after approval may affect price and lead time.</div>
  </div>
</div>

<div class="doc-card avoid-break">
  <h2>Agreement</h2>
  <div class="small" style="margin-bottom:10px;line-height:1.45;">
    By proceeding, the customer confirms the details above (including measurements where provided) and authorizes work to begin subject to the deposit below.
  </div>
  <table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <tr>
      <td style="width:50%;padding-right:10px;vertical-align:bottom;">
        <div class="row"><div class="k">Customer name</div><div class="v"></div></div>
      </td>
      <td style="width:50%;padding-left:10px;vertical-align:bottom;">
        <div class="row"><div class="k">Date</div><div class="v"></div></div>
      </td>
    </tr>
  </table>
  <div class="row" style="margin-top:12px;"><div class="k">Signature</div><div class="v"></div></div>
</div>

<div class="rule"></div>

<div class="doc-card avoid-break">
  <h2>Deposit payment status</h2>
  <div class="row"><div class="k">Deposit paid</div><div class="v mono">${{deposit_paid}}</div></div>
  <div class="row"><div class="k">Payment method</div><div class="v">{{payment_method}}</div></div>
  <div class="row"><div class="k">Payment date</div><div class="v">{{payment_date}}</div></div>
</div>
""".strip(),
    ),
}


def deposit_preset_keys_in_order() -> tuple[str, ...]:
    """Stable ordering for catalog / UI."""
    return tuple(DEPOSIT_CONTRACT_PRESETS.keys())


def default_deposit_preset() -> tuple[str, DepositPreset]:
    k = DEFAULT_DEPOSIT_PRESET_KEY
    return k, DEPOSIT_CONTRACT_PRESETS[k]
