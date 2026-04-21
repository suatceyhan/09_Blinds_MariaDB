"""
Built-in deposit invoice + contract PDF/HTML presets.

Corporate invoice layout: navy section bars, compact right-aligned totals (wkhtmltopdf-safe tables).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DepositPreset:
    subject: str
    body_html: str


DEFAULT_DEPOSIT_PRESET_KEY = "teal_pro_01"

DEPOSIT_PRESET_LABELS: dict[str, tuple[str, str]] = {
    "teal_pro_01": (
        "Corporate (Navy)",
        "Deposit invoice with navy header bars, line-item row, compact totals block, and formal notes — similar to standard pro-forma / deposit templates.",
    ),
    "classic_invoice_01": (
        "Classic Invoice (Navy)",
        "Classic invoice look (big INVOICE title + lined table) while keeping deposit invoice fields. Shows deposit received and additional payments as description rows.",
    ),
}


def _ph(key: str) -> str:
    return "{{" + key + "}}"


DEPOSIT_CONTRACT_PRESETS: dict[str, DepositPreset] = {
    "teal_pro_01": DepositPreset(
        subject="Deposit invoice & service agreement",
        body_html=r"""
<div class="doc-inv-root avoid-break">

  <table class="doc-top-band" cellspacing="0" cellpadding="0">
    <tr>
      <td class="doc-top-left" valign="top">
        <div class="doc-logo-ph">Logo</div>
        <div class="doc-brand-name">""" + _ph("business_name") + r"""</div>
        <div class="doc-brand-sub">Custom window treatments</div>
      </td>
      <td class="doc-top-right" valign="top" align="right">
        <div class="doc-main-invoice-title">DEPOSIT INVOICE</div>
        <div class="doc-main-invoice-sub">Service agreement — deposit schedule</div>
        <table class="doc-meta-mini" cellspacing="0">
          <tr>
            <td class="doc-meta-mini-k">DATE</td>
            <td class="doc-meta-mini-v mono">""" + _ph("invoice_date") + r"""</td>
          </tr>
          <tr>
            <td class="doc-meta-mini-k">INVOICE NO.</td>
            <td class="doc-meta-mini-v mono">""" + _ph("invoice_number") + r"""</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="doc-pair-grid" cellspacing="0" cellpadding="0">
    <tr>
      <td class="doc-pair-cell" valign="top">
        <div class="doc-sec-hd">FROM</div>
        <div class="doc-sec-bd">
          <div class="doc-line">""" + _ph("business_address") + r"""</div>
          <div class="doc-line"><span class="doc-lab">Phone</span> """ + _ph("business_phone") + r"""</div>
          <div class="doc-line"><span class="doc-lab">Email</span> """ + _ph("business_email") + r"""</div>
        </div>
      </td>
      <td class="doc-pair-cell doc-pair-gap" valign="top">
        <div class="doc-sec-hd">BILL TO</div>
        <div class="doc-sec-bd">
          <div class="doc-line doc-line-strong">""" + _ph("customer_name") + r"""</div>
          <div class="doc-line">""" + _ph("customer_address") + r"""</div>
          <div class="doc-line"><span class="doc-lab">Phone</span> """ + _ph("customer_phone") + r"""</div>
        </div>
      </td>
    </tr>
  </table>

  <div class="doc-sec-full avoid-break">
    <div class="doc-sec-hd">PROJECT &amp; SITE</div>
    <div class="doc-sec-bd doc-sec-bd-tight">
      <table class="doc-inner-kv" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-ik">Installation address</td>
          <td class="doc-iv">""" + _ph("installation_address") + r"""</td>
        </tr>
        <tr>
          <td class="doc-ik">Measurements</td>
          <td class="doc-iv">""" + _ph("measurements") + r"""</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="doc-sec-full avoid-break">
    <table class="doc-desc-table" cellspacing="0" cellpadding="0">
      <tr>
        <td class="doc-desc-hd-l">DESCRIPTION</td>
        <td class="doc-desc-hd-r" align="right">AMOUNT</td>
      </tr>
      <tr>
        <td class="doc-desc-body" valign="top">
          <div class="doc-li-title">""" + _ph("product") + r"""</div>
          <div class="doc-li-note">""" + _ph("description") + r"""</div>
        </td>
        <td class="doc-desc-amt mono" valign="top" align="right">$""" + _ph("total_project_price") + r"""</td>
      </tr>
    </table>
  </div>

  <div class="doc-bottom-split avoid-break">
    <div class="doc-notes-col">
      <div class="doc-sec-hd doc-sec-hd-sm">NOTES &amp; TERMS</div>
      <div class="doc-notes-body">
        <ol class="doc-ol-tight">
          <li>Deposit is required before materials are ordered or production begins.</li>
          <li>After fabrication starts, the deposit is non-refundable.</li>
          <li>Balance due as agreed — typically at completion / installation.</li>
          <li>Approved changes may affect price and schedule.</li>
        </ol>
        <div class="doc-auth-note">By signing below, the customer accepts the scope and deposit above.</div>
        <table class="doc-sig-grid" cellspacing="0" cellpadding="0">
          <tr>
            <td class="doc-sig-cell">
              <div class="doc-sig-cap">Customer name</div>
              <div class="doc-sig-line">&nbsp;</div>
            </td>
            <td class="doc-sig-cell doc-sig-padl">
              <div class="doc-sig-cap">Date</div>
              <div class="doc-sig-line">&nbsp;</div>
            </td>
          </tr>
        </table>
        <div class="doc-sig-cap" style="margin-top:14px;">Signature</div>
        <div class="doc-sig-line doc-sig-wide">&nbsp;</div>
      </div>
    </div>
    <div class="doc-totals-wrap">
      <div class="doc-sec-hd doc-sec-hd-sm">SUMMARY</div>
      <table class="doc-totals-box" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-tl">Total project price</td>
          <td class="doc-tv mono">$""" + _ph("total_project_price") + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Deposit due</td>
          <td class="doc-tv mono">$""" + _ph("deposit_required") + r"""</td>
        </tr>
        <tr class="doc-totals-grand">
          <td class="doc-tl">Balance after deposit</td>
          <td class="doc-tv mono">$""" + _ph("balance_remaining") + r"""</td>
        </tr>
      </table>
      <div class="doc-pay-subhd">Deposit payment</div>
      <table class="doc-totals-box doc-totals-lite" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-tl">Amount received</td>
          <td class="doc-tv mono">$""" + _ph("deposit_paid") + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Method</td>
          <td class="doc-tv">""" + _ph("payment_method") + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Payment date</td>
          <td class="doc-tv">""" + _ph("payment_date") + r"""</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="doc-footer-thanks">Thank you for your business</div>

</div>
""".strip(),
    ),
    "classic_invoice_01": DepositPreset(
        subject="Deposit invoice & service agreement",
        body_html=r"""
<div class="inv2-root avoid-break">

  <table class="inv2-title-row" cellspacing="0" cellpadding="0">
    <tr>
      <td class="inv2-title-cell" valign="top"><div class="inv2-title">INVOICE</div></td>
      <td class="inv2-no-cell" valign="bottom" align="right">
        <div class="inv2-no"><span class="inv2-no-k">No:</span> <span class="mono">""" + _ph("invoice_number") + r"""</span></div>
      </td>
    </tr>
  </table>

  <table class="inv2-pairs" cellspacing="0" cellpadding="0">
    <tr>
      <td class="inv2-pair" valign="top">
        <div class="inv2-pair-hd">BILL TO:</div>
        <div class="inv2-pair-bd">
          <div class="inv2-line inv2-strong">""" + _ph("customer_name") + r"""</div>
          <div class="inv2-line">""" + _ph("customer_address") + r"""</div>
          <div class="inv2-line">""" + _ph("customer_phone") + r"""</div>
        </div>
      </td>
      <td class="inv2-pair" valign="top">
        <div class="inv2-pair-hd">FROM:</div>
        <div class="inv2-pair-bd">
          <div class="inv2-line inv2-strong">""" + _ph("business_name") + r"""</div>
          <div class="inv2-line">""" + _ph("business_address") + r"""</div>
          <div class="inv2-line">""" + _ph("business_email") + r"""</div>
        </div>
      </td>
    </tr>
  </table>

  <div class="inv2-date"><span class="inv2-date-k">Date:</span> """ + _ph("invoice_date") + r"""</div>

  <table class="inv2-items" cellspacing="0" cellpadding="0">
    <tr>
      <td class="inv2-hd inv2-col-desc">DESCRIPTION</td>
      <td class="inv2-hd inv2-col-unit" align="right">UNIT PRICE</td>
      <td class="inv2-hd inv2-col-qty" align="center">QTY</td>
      <td class="inv2-hd inv2-col-total" align="right">TOTAL</td>
    </tr>
    <tr>
      <td class="inv2-td inv2-col-desc">
        <div class="inv2-item-title">""" + _ph("product") + r"""</div>
        <div class="inv2-item-note">""" + _ph("description") + r"""</div>
      </td>
      <td class="inv2-td inv2-col-unit mono" align="right">$""" + _ph("total_project_price") + r"""</td>
      <td class="inv2-td inv2-col-qty" align="center">1</td>
      <td class="inv2-td inv2-col-total inv2-amt mono" align="right">$""" + _ph("total_project_price") + r"""</td>
    </tr>
    <tr>
      <td class="inv2-td inv2-col-desc">Deposit received</td>
      <td class="inv2-td inv2-col-unit mono" align="right">-$""" + _ph("deposit_paid") + r"""</td>
      <td class="inv2-td inv2-col-qty" align="center">1</td>
      <td class="inv2-td inv2-col-total inv2-amt mono" align="right">-$""" + _ph("deposit_paid") + r"""</td>
    </tr>
    <tr>
      <td class="inv2-td inv2-col-desc">Additional payments received <span class="inv2-muted">(""" + _ph("extra_payments_count") + r""")</span></td>
      <td class="inv2-td inv2-col-unit mono" align="right">-$""" + _ph("extra_payments_total") + r"""</td>
      <td class="inv2-td inv2-col-qty" align="center">1</td>
      <td class="inv2-td inv2-col-total inv2-amt mono" align="right">-$""" + _ph("extra_payments_total") + r"""</td>
    </tr>
  </table>

  <table class="inv2-bottom" cellspacing="0" cellpadding="0">
    <tr>
      <td class="inv2-pay" valign="top">
        <div class="inv2-pay-hd">PAYMENT METHODS</div>
        <div class="inv2-pay-row"><span class="inv2-pay-k">Method:</span> """ + _ph("payment_method") + r"""</div>
        <div class="inv2-pay-row"><span class="inv2-pay-k">Payment date:</span> """ + _ph("payment_date") + r"""</div>
        <div class="inv2-pay-row"><span class="inv2-pay-k">Email:</span> """ + _ph("business_email") + r"""</div>
      </td>
      <td class="inv2-totals" valign="top" align="right">
        <table class="inv2-totals-box" cellspacing="0" cellpadding="0">
          <tr>
            <td class="inv2-tk">SUBTOTAL</td>
            <td class="inv2-tv mono" align="right">$""" + _ph("total_project_price") + r"""</td>
          </tr>
          <tr>
            <td class="inv2-tk">PAYMENTS</td>
            <td class="inv2-tv mono" align="right">-$""" + _ph("payments_received_total") + r"""</td>
          </tr>
          <tr class="inv2-t-grand">
            <td class="inv2-tk">AMOUNT DUE</td>
            <td class="inv2-tv mono" align="right">$""" + _ph("balance_remaining") + r"""</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="inv2-thanks">Thank You!</div>
</div>
""".strip(),
    ),
}


def deposit_preset_keys_in_order() -> tuple[str, ...]:
    return tuple(DEPOSIT_CONTRACT_PRESETS.keys())


def default_deposit_preset() -> tuple[str, DepositPreset]:
    k = DEFAULT_DEPOSIT_PRESET_KEY
    return k, DEPOSIT_CONTRACT_PRESETS[k]


# Default final invoice: same Corporate (Navy) chrome as `teal_pro_01`, copy adjusted for completion / balance.
FINAL_INVOICE_DEFAULT_HTML = (
    r"""
<div class="doc-inv-root avoid-break">

  <table class="doc-top-band" cellspacing="0" cellpadding="0">
    <tr>
      <td class="doc-top-left" valign="top">
        <div class="doc-logo-ph">Logo</div>
        <div class="doc-brand-name">"""
    + _ph("business_name")
    + r"""</div>
        <div class="doc-brand-sub">Custom window treatments</div>
      </td>
      <td class="doc-top-right" valign="top" align="right">
        <div class="doc-main-invoice-title">FINAL INVOICE</div>
        <div class="doc-main-invoice-sub">Project completion — final account</div>
        <table class="doc-meta-mini" cellspacing="0">
          <tr>
            <td class="doc-meta-mini-k">DATE</td>
            <td class="doc-meta-mini-v mono">"""
    + _ph("invoice_date")
    + r"""</td>
          </tr>
          <tr>
            <td class="doc-meta-mini-k">INVOICE NO.</td>
            <td class="doc-meta-mini-v mono">"""
    + _ph("invoice_number")
    + r"""</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <table class="doc-pair-grid" cellspacing="0" cellpadding="0">
    <tr>
      <td class="doc-pair-cell" valign="top">
        <div class="doc-sec-hd">FROM</div>
        <div class="doc-sec-bd">
          <div class="doc-line">"""
    + _ph("business_address")
    + r"""</div>
          <div class="doc-line"><span class="doc-lab">Phone</span> """
    + _ph("business_phone")
    + r"""</div>
          <div class="doc-line"><span class="doc-lab">Email</span> """
    + _ph("business_email")
    + r"""</div>
        </div>
      </td>
      <td class="doc-pair-cell doc-pair-gap" valign="top">
        <div class="doc-sec-hd">BILL TO</div>
        <div class="doc-sec-bd">
          <div class="doc-line doc-line-strong">"""
    + _ph("customer_name")
    + r"""</div>
          <div class="doc-line">"""
    + _ph("customer_address")
    + r"""</div>
          <div class="doc-line"><span class="doc-lab">Phone</span> """
    + _ph("customer_phone")
    + r"""</div>
        </div>
      </td>
    </tr>
  </table>

  <div class="doc-sec-full avoid-break">
    <div class="doc-sec-hd">PROJECT &amp; SITE</div>
    <div class="doc-sec-bd doc-sec-bd-tight">
      <table class="doc-inner-kv" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-ik">Installation address</td>
          <td class="doc-iv">"""
    + _ph("installation_address")
    + r"""</td>
        </tr>
        <tr>
          <td class="doc-ik">Measurements</td>
          <td class="doc-iv">"""
    + _ph("measurements")
    + r"""</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="doc-sec-full avoid-break">
    <table class="doc-desc-table" cellspacing="0" cellpadding="0">
      <tr>
        <td class="doc-desc-hd-l">DESCRIPTION</td>
        <td class="doc-desc-hd-r" align="right">AMOUNT</td>
      </tr>
      <tr>
        <td class="doc-desc-body" valign="top">
          <div class="doc-li-title">"""
    + _ph("product")
    + r"""</div>
          <div class="doc-li-note">"""
    + _ph("description")
    + r"""</div>
        </td>
        <td class="doc-desc-amt mono" valign="top" align="right">$"""
    + _ph("total_project_price")
    + r"""</td>
      </tr>
    </table>
  </div>

  <div class="doc-bottom-split avoid-break">
    <div class="doc-notes-col">
      <div class="doc-sec-hd doc-sec-hd-sm">NOTES</div>
      <div class="doc-notes-body">
        <ol class="doc-ol-tight">
          <li>This document reflects the completed project total and remaining balance after all posted payments.</li>
          <li>If a balance remains, payment is due as agreed — thank you for choosing us.</li>
        </ol>
        <table class="doc-sig-grid" cellspacing="0" cellpadding="0">
          <tr>
            <td class="doc-sig-cell">
              <div class="doc-sig-cap">Customer name</div>
              <div class="doc-sig-line">&nbsp;</div>
            </td>
            <td class="doc-sig-cell doc-sig-padl">
              <div class="doc-sig-cap">Date</div>
              <div class="doc-sig-line">&nbsp;</div>
            </td>
          </tr>
        </table>
        <div class="doc-sig-cap" style="margin-top:14px;">Signature</div>
        <div class="doc-sig-line doc-sig-wide">&nbsp;</div>
      </div>
    </div>
    <div class="doc-totals-wrap">
      <div class="doc-sec-hd doc-sec-hd-sm">ACCOUNT SUMMARY</div>
      <table class="doc-totals-box" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-tl">Total project price</td>
          <td class="doc-tv mono">$"""
    + _ph("total_project_price")
    + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Payments received <span style="font-size:9px;color:#64748b;">(incl. deposit &amp; extras)</span></td>
          <td class="doc-tv mono">$"""
    + _ph("payments_received_total")
    + r"""</td>
        </tr>
        <tr class="doc-totals-grand">
          <td class="doc-tl">Balance due</td>
          <td class="doc-tv mono">$"""
    + _ph("balance_due")
    + r"""</td>
        </tr>
      </table>
      <div class="doc-pay-subhd">Detail</div>
      <table class="doc-totals-box doc-totals-lite" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-tl">Deposit paid</td>
          <td class="doc-tv mono">$"""
    + _ph("deposit_paid")
    + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Additional payments <span style="font-size:9px;color:#64748b;">("""
    + _ph("extra_payments_count")
    + r""")</span></td>
          <td class="doc-tv mono">$"""
    + _ph("extra_payments_total")
    + r"""</td>
        </tr>
      </table>
      <div class="doc-pay-subhd">Status</div>
      <table class="doc-totals-box doc-totals-lite" cellspacing="0" cellpadding="0">
        <tr>
          <td class="doc-tl">Account status</td>
          <td class="doc-tv mono">"""
    + _ph("status")
    + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Method</td>
          <td class="doc-tv">"""
    + _ph("payment_method")
    + r"""</td>
        </tr>
        <tr>
          <td class="doc-tl">Payment date</td>
          <td class="doc-tv">"""
    + _ph("payment_date")
    + r"""</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="doc-footer-thanks">Thank you for your business</div>

</div>
"""
).strip()
