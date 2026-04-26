import { type ReactNode, useRef } from 'react'
import { Camera, FileSpreadsheet, Trash2, Upload } from 'lucide-react'
import { postMultipartJson } from '@/lib/api'
import { snapWallToQuarterMinutes } from '@/lib/visitSchedule'

export type CustomerOpt = { id: string; name: string; surname?: string | null }

export type OrderPrefill = {
  estimate_id: string
  customer_id?: string | null
  customer_display: string
  visit_notes: string | null
  blinds_summary: string | null
  blinds_lines: Array<{ id: string; name: string; window_count?: number | null; category?: string | null }>
  schedule_summary: string | null
  estimate_status: string | null
  company_tax_rate_percent?: string | number | null
}

export type OrderRow = {
  id: string
  company_id: string
  customer_id: string
  customer_display: string
  estimate_id: string | null
  total_amount: string | number | null
  downpayment?: string | number | null
  final_payment?: string | number | null
  balance: string | number | null
  tax_amount?: string | number | null
  expense_total?: string | number | null
  status_code: string
  status_orde_id?: string | null
  status_order_label: string | null
  agreement_date?: string | null
  created_at: string | null
  installation_scheduled_start_at?: string | null
  /** Soft-deleted orders have active false in DB. */
  active?: boolean
}

export type OrderAttachmentRow = {
  id: string
  kind: string
  filename: string
  url: string
  created_at: string
}

export type PendingOrderAttachment = { key: string; file: File; kind: 'photo' | 'excel' }

/** Roll-up totals for anchor order + line-item additions (detail summary card). */
export type OrderFinancialTotals = {
  subtotal_ex_tax?: string | number | null
  tax_amount?: string | number | null
  taxable_base?: string | number | null
  downpayment?: string | number | null
  paid_total?: string | number | null
  balance?: string | number | null
}

export type OrderLineItemAdditionRow = {
  order_id: string
  created_at?: string | null
  subtotal_ex_tax?: string | number | null
  tax_amount?: string | number | null
  taxable_base?: string | number | null
  downpayment?: string | number | null
  paid_total?: string | number | null
  balance?: string | number | null
  status_order_label?: string | null
}

export type PaymentEntry = { id: string; order_id?: string | null; amount: string | number; paid_at: string }

export type OrderDetail = {
  id: string
  customer_id: string
  customer_display: string
  estimate_id: string | null
  lead_source?: 'referral' | 'advertising' | null
  estimate_status?: string | null
  total_amount: string | number | null
  downpayment: string | number | null
  /** Cumulative payments after the down payment; balance subtracts this. */
  final_payment?: string | number | null
  balance: string | number | null
  tax_uygulanacak_miktar?: string | number | null
  tax_amount?: string | number | null
  /** When set, this row is a child order; open the anchor job for additions. */
  parent_order_id?: string | null
  financial_totals?: OrderFinancialTotals | null
  has_line_item_additions?: boolean
  line_item_additions?: OrderLineItemAdditionRow[]
  blinds_lines?: Array<{ id: string; name: string; window_count?: number | null; category?: string | null }>
  agree_data: string | null
  agreement_date?: string | null
  order_note?: string | null
  status_code: string
  status_orde_id?: string | null
  status_order_label: string | null
  installation_scheduled_start_at?: string | null
  installation_scheduled_end_at?: string | null
  created_at: string | null
  updated_at?: string | null
  active?: boolean
  /** Down payment (`id` downpayment) + recorded Pay rows; chronological from API. */
  payment_entries?: Array<{ id: string; order_id?: string | null; amount: string | number; paid_at: string }>
  expense_total?: string | number | null
  profit?: string | number | null
  expense_entries?: Array<{
    id: string
    amount: string | number
    note?: string | null
    spent_at?: string | null
    created_at?: string | null
  }>
  attachments?: OrderAttachmentRow[]
  /** Per-blinds-line photos: key = blinds_type_id, value = list of photo attachments. */
  line_photos?: Record<string, OrderAttachmentRow[]>
}

export type OrderStatusOpt = { id: string; name: string; sort_order?: number }

export function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `YYYY-MM-DDTHH:mm` wall for VisitStartQuarterPicker from API ISO. */
export function installationWallFromIso(iso: string | null | undefined): string {
  const local = isoToDatetimeLocalValue(iso)
  return local ? snapWallToQuarterMinutes(local) : ''
}

export function datetimeLocalToIso(local: string): string | null {
  const t = local.trim()
  if (!t) return null
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function isReadyForInstallationStatus(statusId: string, statuses: OrderStatusOpt[]): boolean {
  const s = statuses.find((x) => x.id === statusId)
  const n = (s?.name ?? '').toLowerCase()
  return n.includes('ready') && n.includes('install')
}

export type EditDraft = {
  downpayment: string
  tax_base: string
  agreement_date: string
  order_note: string
  status_orde_id: string
  /** Shown if current id is missing from active lookup (inactive / deleted). */
  status_order_label_fallback: string | null
}

export type BlindsLineAttributeRow = {
  kind_id: string
  label: string
  json_key: string
  sort_order: number
  options: { id: string; name: string; sort_order: number }[]
  allowed_option_ids_by_blinds_type: Record<string, string[]>
}

export type BlindsOrderOptions = {
  blinds_types: { id: string; name: string }[]
  categories: { id: string; name: string; sort_order: number }[]
  allowed_category_ids_by_blinds_type: Record<string, string[]>
  line_attribute_rows?: BlindsLineAttributeRow[]
}

/** One line in the order blinds grid (category + lifting_system + …). */
export type BlindsLineState = {
  id: string
  name: string
  window_count?: number | null
  [key: string]: string | number | null | undefined
}

export function lineAttributeRows(opts: BlindsOrderOptions | null): BlindsLineAttributeRow[] {
  if (!opts) return []
  if (opts.line_attribute_rows && opts.line_attribute_rows.length > 0) return opts.line_attribute_rows
  return [
    {
      kind_id: 'product_category',
      label: 'Category',
      json_key: 'category',
      sort_order: 0,
      options: opts.categories ?? [],
      allowed_option_ids_by_blinds_type: opts.allowed_category_ids_by_blinds_type ?? {},
    },
  ]
}

export function attributeColumnHeaderLabel(row: BlindsLineAttributeRow): string {
  if (row.kind_id === 'product_category' || row.label === 'Product category') return 'Category'
  return row.label
}

export function isCategoryAttributeRow(row: BlindsLineAttributeRow): boolean {
  return row.kind_id === 'product_category' || row.json_key === 'category'
}

/** Width in `ch` from header + longest option label (capped). */
export function categoryColumnWidthCh(row: BlindsLineAttributeRow): number {
  const h = attributeColumnHeaderLabel(row)
  let m = h.length
  for (const o of row.options) {
    const len = typeof o?.name === 'string' ? o.name.length : 0
    m = Math.max(m, len)
  }
  return Math.min(Math.max(m + 1, 8), 20)
}

/** Up to 6 integer digits and 2 decimal places (e.g. 999999.99). */
export function sanitizeLineAmountInput(raw: string): string {
  const s = raw.replace(/[^\d.]/g, '')
  if (!s) return ''
  const dot = s.indexOf('.')
  if (dot === -1) return s.slice(0, 6)
  const intPart = s.slice(0, dot).replace(/\./g, '').slice(0, 6)
  const decPart = s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return `${intPart}.${decPart}`
}

export function normalizeWindowCountFromApi(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.trunc(raw)
      : Number.parseInt(String(raw).trim(), 10)
  if (Number.isNaN(n) || n < 1) return null
  if (n > 99) return 99
  return n
}

export function allowedIdsForAttributeRow(row: BlindsLineAttributeRow, typeId: string): string[] {
  return row.allowed_option_ids_by_blinds_type[typeId] ?? []
}

export function attributeOptionLabel(row: BlindsLineAttributeRow, optionId: string | null | undefined): string {
  if (!optionId) return ''
  const id = String(optionId).trim().toLowerCase()
  const c = row.options.find((x) => x.id === id)
  return c?.name ?? id.toUpperCase()
}

export function newBlindsLineForType(id: string, name: string, opts: BlindsOrderOptions | null): BlindsLineState {
  const line: BlindsLineState = {
    id,
    name,
    window_count: null,
    line_note: '',
    line_amount: '',
  }
  for (const row of lineAttributeRows(opts)) {
    const allowed = allowedIdsForAttributeRow(row, id)
    line[row.json_key] = allowed.length ? String(allowed[0]).trim().toLowerCase() : null
  }
  return line
}

/** Prefill / API lines may omit category; select must match an allowed option id. */
export function hydrateBlindsLinesDefaults(
  lines: BlindsLineState[],
  opts: BlindsOrderOptions | null,
): BlindsLineState[] {
  if (!opts) return lines
  return lines.map((line) => {
    const next: BlindsLineState = { ...line }
    for (const row of lineAttributeRows(opts)) {
      const allowed = allowedIdsForAttributeRow(row, line.id)
      // If the matrix has no allowed options for this type, clear any stale value
      // so the backend validator doesn't reject the payload.
      if (!allowed.length) {
        next[row.json_key] = null
        continue
      }
      const allowedLc = new Set(allowed.map((a) => a.toLowerCase()))
      const raw = next[row.json_key]
      const cur = raw != null && String(raw).trim() ? String(raw).trim().toLowerCase() : ''
      if (!cur || !allowedLc.has(cur)) {
        next[row.json_key] = String(allowed[0]).trim().toLowerCase()
      }
    }
    return next
  })
}

export function todayDateInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function normalizeBlindsLineFromApi(raw: Record<string, unknown>): BlindsLineState {
  const lineAmountRaw =
    raw.line_amount != null && raw.line_amount !== '' ? sanitizeLineAmountInput(String(raw.line_amount)) : ''
  const lineAmountParsed = lineAmountRaw ? parseOptionalDecimal(lineAmountRaw) : null
  const line: BlindsLineState = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    window_count: normalizeWindowCountFromApi(raw.window_count),
    line_note: raw.line_note != null ? String(raw.line_note) : '',
    line_amount: lineAmountParsed !== null && lineAmountParsed !== 0 ? lineAmountRaw : '',
  }
  for (const [k, v] of Object.entries(raw)) {
    if (
      k === 'id' ||
      k === 'name' ||
      k === 'window_count' ||
      k === 'line_note' ||
      k === 'line_amount'
    )
      continue
    if (v == null || v === '') {
      line[k] = null
      continue
    }
    line[k] = String(v).trim().toLowerCase() || null
  }
  return line
}

export function blindsLineToPayload(b: BlindsLineState, opts: BlindsOrderOptions | null): Record<string, unknown> {
  const rows = lineAttributeRows(opts)
  const wcRaw = b.window_count
  let window_count: number | null = null
  if (wcRaw != null && typeof wcRaw === 'number' && Number.isFinite(wcRaw)) {
    const w = Math.trunc(wcRaw)
    if (w >= 1 && w <= 99) window_count = w
  }
  const o: Record<string, unknown> = {
    id: b.id,
    name: b.name,
    window_count,
  }
  for (const r of rows) {
    const v = b[r.json_key]
    o[r.json_key] =
      v != null && String(v).trim() ? String(v).trim().toLowerCase() : null
  }
  const n = String(b.line_note ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  o.line_note = n ? n.slice(0, 2000) : null
  const la = parseOptionalDecimal(String(b.line_amount ?? ''))
  o.line_amount = la !== null ? la : 0
  return o
}

export function blindsLineSummarySuffix(b: BlindsLineState, opts: BlindsOrderOptions | null): string {
  const parts: string[] = []
  for (const row of lineAttributeRows(opts)) {
    const v = b[row.json_key]
    if (v != null && String(v).trim()) {
      parts.push(attributeOptionLabel(row, String(v)))
    }
  }
  const la = parseOptionalDecimal(String(b.line_amount ?? ''))
  if (la !== null && la !== 0) {
    parts.push(
      la.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    )
  }
  const noteStr = String(b.line_note ?? '').trim()
  if (noteStr) {
    parts.push(noteStr.slice(0, 80) + (noteStr.length > 80 ? '…' : ''))
  }
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

export function statusColorClasses(name: string): { base: string; active: string } {
  const n = (name || '').trim().toLowerCase()
  if (n.includes('new')) return { base: 'bg-sky-50 text-sky-800 ring-sky-100', active: 'bg-sky-600 text-white ring-sky-600' }
  if (n.includes('production')) return { base: 'bg-violet-50 text-violet-800 ring-violet-100', active: 'bg-violet-600 text-white ring-violet-600' }
  if (n.includes('ready')) return { base: 'bg-amber-50 text-amber-900 ring-amber-100', active: 'bg-amber-600 text-white ring-amber-600' }
  if (n.includes('install')) return { base: 'bg-indigo-50 text-indigo-800 ring-indigo-100', active: 'bg-indigo-600 text-white ring-indigo-600' }
  if (n.includes('done') || n.includes('final') || n.includes('paid')) return { base: 'bg-emerald-50 text-emerald-900 ring-emerald-100', active: 'bg-emerald-600 text-white ring-emerald-600' }
  if (n.includes('cancel')) return { base: 'bg-rose-50 text-rose-800 ring-rose-100', active: 'bg-rose-600 text-white ring-rose-600' }
  if (n.includes('estimate')) return { base: 'bg-teal-50 text-teal-900 ring-teal-100', active: 'bg-teal-600 text-white ring-teal-600' }
  return { base: 'bg-slate-50 text-slate-800 ring-slate-200', active: 'bg-slate-800 text-white ring-slate-800' }
}

/** Semantic bucket for workflow (matches filter chip heuristics on display name). */
export type OrderStatusWorkflowBucket = 'new' | 'production' | 'rfi' | 'done' | 'cancel' | 'other'

export function orderStatusWorkflowBucketFromName(name: string): OrderStatusWorkflowBucket {
  const n = (name || '').trim().toLowerCase()
  if (n.includes('cancel')) return 'cancel'
  if (n.includes('done')) return 'done'
  if (n.includes('ready') && n.includes('install')) return 'rfi'
  if (n.includes('production')) return 'production'
  if (n.includes('new')) return 'new'
  return 'other'
}

export function pickOrderStatusForBucket(statuses: OrderStatusOpt[], bucket: OrderStatusWorkflowBucket): OrderStatusOpt | null {
  const matches = statuses.filter((s) => orderStatusWorkflowBucketFromName(s.name) === bucket)
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0]
}

export type OrderAdvanceAction =
  | {
      kind: 'patch'
      status_orde_id: string
      nextLabel: string
      title: string
      stage: 'to_production' | 'to_rfi'
    }
  | { kind: 'done_info'; stage: 'done_review' }

export type OrderAdvanceStage = 'to_production' | 'to_rfi' | 'done_review'

export const orderAdvanceTextButtonClass: Record<OrderAdvanceStage, string> = {
  to_production:
    'border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-400 hover:bg-amber-100 focus-visible:outline-amber-500 disabled:border-amber-200 disabled:bg-amber-50/80 disabled:text-amber-800 disabled:opacity-60 disabled:shadow-none disabled:hover:bg-amber-50/80',
  to_rfi:
    'border-violet-300 bg-violet-50 text-violet-950 hover:border-violet-400 hover:bg-violet-100 focus-visible:outline-violet-500 disabled:border-violet-200 disabled:bg-violet-50/80 disabled:text-violet-800 disabled:opacity-60 disabled:shadow-none disabled:hover:bg-violet-50/80',
  done_review:
    'border-sky-300 bg-sky-50 text-sky-950 hover:border-sky-400 hover:bg-sky-100 focus-visible:outline-sky-500 disabled:border-sky-200 disabled:bg-sky-50/80 disabled:text-sky-800 disabled:opacity-60 disabled:shadow-none disabled:hover:bg-sky-50/80',
}

export function orderAdvanceStage(act: OrderAdvanceAction): OrderAdvanceStage {
  return act.kind === 'patch' ? act.stage : 'done_review'
}

export function orderAdvanceButtonLabel(act: OrderAdvanceAction): string {
  if (act.kind === 'done_info') return 'Balance review'
  return `Next: ${act.nextLabel}`
}

export function resolveOrderAdvanceAction(row: OrderRow, statuses: OrderStatusOpt[] | null): OrderAdvanceAction | null {
  if (!statuses?.length || row.active === false) return null
  const sid = row.status_orde_id?.trim() ?? ''
  const cur =
    (sid ? statuses.find((s) => s.id === sid) : null) ??
    statuses.find((s) => s.name.trim().toLowerCase() === (row.status_order_label ?? '').trim().toLowerCase())
  const curName = (cur?.name ?? row.status_order_label ?? '').trim()
  const bucket = orderStatusWorkflowBucketFromName(curName)
  if (bucket === 'cancel' || bucket === 'done' || bucket === 'other') return null

  if (bucket === 'new') {
    const next = pickOrderStatusForBucket(statuses, 'production')
    if (!next) return null
    return {
      kind: 'patch',
      status_orde_id: next.id,
      nextLabel: next.name,
      title: `Set status to ${next.name}`,
      stage: 'to_production',
    }
  }
  if (bucket === 'production') {
    const next = pickOrderStatusForBucket(statuses, 'rfi')
    if (!next) return null
    return {
      kind: 'patch',
      status_orde_id: next.id,
      nextLabel: next.name,
      title: `Set status to ${next.name}`,
      stage: 'to_rfi',
    }
  }
  if (bucket === 'rfi') {
    return { kind: 'done_info', stage: 'done_review' }
  }
  return null
}

export function OrderStatusBadge(props: { label: string | null | undefined }) {
  const text = (props.label ?? '').trim() || '—'
  const c = statusColorClasses(text === '—' ? '' : text)
  return (
    <span
      className={`inline-flex max-w-full rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${c.base}`}
      title={text}
    >
      {text}
    </span>
  )
}

export function OrderInfoModal(props: {
  open: boolean
  title: string
  description: string
  onClose: () => void
}) {
  if (!props.open) return null
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">{props.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{props.description}</p>
        <div className="mt-6 flex flex-wrap justify-end">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export function customerLabel(c: CustomerOpt): string {
  const n = `${c.name ?? ''} ${c.surname ?? ''}`.trim()
  return n || c.id
}

export function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Money input display helper (empty stays empty; always groups + 2 decimals). */
export function formatMoneyInputValue(raw: string): string {
  const n = parseOptionalDecimal(raw)
  if (n == null) return raw
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Second financial row: paid (down + recorded payments), balance due, tax. */
export function OrderFinancialSecondRow(props: {
  paidDisplay: string
  balance: string | number | null | undefined
  tax: string | number | null | undefined
  belowBalance?: ReactNode
}) {
  const { paidDisplay, balance, tax, belowBalance } = props
  const b = parseMoneyAmount(balance) ?? null
  const fullyPaid = b !== null && Math.abs(b) <= 0.005
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="block min-w-0 text-sm text-slate-700">
        <span className="mb-1 block font-medium">Paid</span>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
          {paidDisplay}
        </p>
      </div>
      <div className="block min-w-0 text-sm text-slate-700">
        <span
          className={`mb-1 block font-medium ${
            fullyPaid ? 'text-rose-800/90' : 'text-teal-800/80'
          }`}
        >
          Balance due
        </span>
        <p
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            fullyPaid
              ? 'border border-rose-200 bg-rose-50/80 text-rose-900'
              : 'border border-teal-100 bg-teal-50/50 text-teal-900'
          }`}
        >
          {fmtMoney(balance)}
        </p>
        {belowBalance ? <div className="mt-2">{belowBalance}</div> : null}
      </div>
      <div className="block min-w-0 text-sm text-slate-700">
        <span className="mb-1 block font-medium">Tax</span>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
          {fmtMoney(tax)}
        </p>
      </div>
    </div>
  )
}

export function parseMoneyAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v)
  return Number.isNaN(n) ? null : n
}

/** Subtotal + tax (matches how balance includes tax). */
export function fmtTotalIncludingTax(
  total: string | number | null | undefined,
  tax: string | number | null | undefined,
): string {
  const a = parseMoneyAmount(total)
  const b = parseMoneyAmount(tax)
  if (a === null && b === null) return '—'
  const sum = (a ?? 0) + (b ?? 0)
  return sum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Consistent short date for table + detail (avoids raw ISO in one column and locale in another). */
export function fmtDisplayDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  const s = iso.trim()
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (ymd) {
    const y = Number(ymd[1])
    const m = Number(ymd[2]) - 1
    const day = Number(ymd[3])
    const d = new Date(y, m, day)
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDisplayDateTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return iso.trim()
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function startOfLocalCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Parse API date or ISO timestamp to local calendar date (midnight). */
export function parseLocalCalendarDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null
  const s = raw.trim()
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (ymd) {
    const y = Number(ymd[1])
    const m = Number(ymd[2]) - 1
    const day = Number(ymd[3])
    return new Date(y, m, day)
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return startOfLocalCalendarDay(d)
}

/** Whole calendar days from the given local day through today (0 if same day). */
export function fmtWholeCalendarDaysElapsedSince(raw: string | null | undefined): string {
  const from = parseLocalCalendarDate(raw)
  if (!from) return '—'
  const today = startOfLocalCalendarDay(new Date())
  const n = Math.round((today.getTime() - startOfLocalCalendarDay(from).getTime()) / 86400000)
  return String(Math.max(0, n))
}

export function statusCodeLabel(code: string): string {
  const map: Record<string, string> = {
    order_created: 'Order created',
    deposit_paid: 'Deposit paid',
    in_production: 'In production',
    ready_for_install: 'Ready for install',
    install_scheduled: 'Install scheduled',
    installed: 'Installed',
    final_paid: 'Final paid',
    cancelled: 'Cancelled',
  }
  return map[code] ?? code.replaceAll('_', ' ')
}

export function parseOptionalDecimal(raw: string): number | null {
  const t = raw.trim().replaceAll(' ', '')
  if (!t) return null
  // Accept common formats:
  // - "6549.75"
  // - "6,549.75" (thousands comma)
  // - "6549,75" (decimal comma)
  let norm = t
  if (norm.includes(',') && norm.includes('.')) {
    // Assume comma is thousands separator.
    norm = norm.replaceAll(',', '')
  } else if (norm.includes(',') && !norm.includes('.')) {
    // Assume comma is decimal separator.
    norm = norm.replace(',', '.')
  }
  const n = Number.parseFloat(norm)
  if (Number.isNaN(n)) return null
  return n
}

export function safeRound2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Orders table: paid = down payment + cumulative post-down payments (`final_payment`). */
export function orderListPaidDisplay(r: OrderRow): string {
  const down = parseMoneyAmount(r.downpayment) ?? 0
  const extra = parseMoneyAmount(r.final_payment) ?? 0
  return fmtMoney(safeRound2(down + extra))
}

/** List row highlight: Done status or zero balance (kept in sync on the server). */
export function orderListRowDoneSyncedHighlight(r: OrderRow): boolean {
  if (r.active === false) return false
  if (orderStatusWorkflowBucketFromName((r.status_order_label ?? '').trim()) === 'done') return true
  const b = parseMoneyAmount(r.balance)
  return b !== null && Math.abs(b) <= 0.005
}

export function sumBlindsLineAmounts(lines: BlindsLineState[]): number {
  let s = 0
  for (const b of lines) {
    const n = parseOptionalDecimal(String(b.line_amount ?? ''))
    if (n !== null) s += n
  }
  return safeRound2(s)
}

export function parseTaxRatePercent(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

/** Transposed grid: one row per blinds type; Qty, category attrs, amount, line note last (lifting/cassette elsewhere). */
export function BlindsTypesGrid(props: {
  blindsTypes: { id: string; name: string }[]
  blindsOrderOptions: BlindsOrderOptions | null
  lines: BlindsLineState[]
  toggleType: (typeId: string) => void
  setCount: (typeId: string, value: string) => void
  setLineField: (typeId: string, jsonKey: string, value: string) => void
  setLineNote: (typeId: string, value: string) => void
  setLineAmount: (typeId: string, value: string) => void
  keyPrefix?: string
  renderLinePhotoCell?: (typeId: string, checked: boolean) => ReactNode
}) {
  const {
    blindsTypes: bt,
    blindsOrderOptions,
    lines,
    toggleType,
    setCount,
    setLineField,
    setLineNote,
    setLineAmount,
    keyPrefix = '',
    renderLinePhotoCell,
  } = props
  const attrRows = lineAttributeRows(blindsOrderOptions)

  if (!bt.length) {
    return <p className="mt-2 text-sm text-slate-500">No blinds types configured.</p>
  }

  return (
    <div className="mt-2 min-w-0 space-y-1">
      <div className="min-w-0 overflow-x-hidden rounded-md border border-slate-200/80 bg-white/80">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th
                scope="col"
                className="min-w-[6rem] max-w-[10rem] bg-slate-50 px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
              >
                Blinds type
              </th>
              <th
                scope="col"
                className="w-[4.25rem] min-w-[4rem] max-w-[4.75rem] px-0.5 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600"
              >
                Qty
              </th>
              {attrRows.map((attrRow) => {
                const cat = isCategoryAttributeRow(attrRow)
                const wch = cat ? categoryColumnWidthCh(attrRow) : null
                const style =
                  cat && wch != null
                    ? ({ width: `${wch}ch`, minWidth: `${wch}ch`, maxWidth: `${wch}ch` } as const)
                    : undefined
                return (
                  <th
                    key={`${keyPrefix}-h-${attrRow.kind_id}`}
                    scope="col"
                    style={style}
                    className={`px-0.5 py-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-600 ${
                      cat ? '' : 'min-w-[4rem] max-w-[6.5rem]'
                    }`}
                  >
                    <span className="line-clamp-2">{attributeColumnHeaderLabel(attrRow)}</span>
                  </th>
                )
              })}
              <th
                scope="col"
                className="w-[5.25rem] min-w-[4.75rem] max-w-[5.75rem] px-0.5 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600"
              >
                Amount
              </th>
              <th
                scope="col"
                className="min-w-[9rem] px-1 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
              >
                Line note
              </th>
              {renderLinePhotoCell ? (
                <th
                  scope="col"
                  className="w-[6.5rem] min-w-[6.5rem] px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                >
                  Photo
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bt.map((b) => {
              const checked = lines.some((x) => x.id === b.id)
              const cur = lines.find((x) => x.id === b.id)
              return (
                <tr key={`${keyPrefix}-row-${b.id}`} className="group hover:bg-slate-50/80">
                  <td className="min-w-[6rem] max-w-[10rem] bg-white px-1.5 py-1.5 group-hover:bg-slate-50/80">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                        checked={checked}
                        onChange={() => toggleType(b.id)}
                      />
                      <span className="min-w-0 break-words font-semibold text-slate-800" title={b.name}>
                        {b.name}
                      </span>
                    </label>
                  </td>
                  <td className="w-[4.25rem] min-w-[4rem] max-w-[4.75rem] px-0.5 py-1 align-middle">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      disabled={!checked}
                      placeholder="—"
                      title={checked ? 'Quantity 1–99 (use arrows or type)' : 'Select type first'}
                      aria-label={`Quantity for ${b.name}`}
                      className="w-full min-w-0 rounded-md border border-slate-200 px-0.5 py-1.5 text-center text-xs tabular-nums outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400 [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:opacity-100"
                      value={cur?.window_count != null ? cur.window_count : ''}
                      onChange={(ev) => setCount(b.id, ev.target.value)}
                    />
                  </td>
                  {attrRows.map((attrRow) => {
                    const opts = allowedIdsForAttributeRow(attrRow, b.id).filter(
                      (oid): oid is string => typeof oid === 'string' && oid.trim() !== '',
                    )
                    const cat = isCategoryAttributeRow(attrRow)
                    const wch = cat ? categoryColumnWidthCh(attrRow) : null
                    const style =
                      cat && wch != null
                        ? ({ width: `${wch}ch`, minWidth: `${wch}ch`, maxWidth: `${wch}ch` } as const)
                        : undefined
                    const sel = cur ? String(cur[attrRow.json_key] ?? '') : ''
                    if (!opts.length) {
                      return (
                        <td
                          key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`}
                          style={style}
                          className={`px-0.5 py-1 text-center align-middle text-slate-300 ${
                            cat ? '' : 'min-w-[4rem] max-w-[6.5rem]'
                          }`}
                          title={`${attributeColumnHeaderLabel(attrRow)} not used for ${b.name}`}
                        >
                          —
                        </td>
                      )
                    }
                    // No line row yet: avoid <select value=""> with no matching <option> (React runtime error).
                    if (!checked) {
                      return (
                        <td
                          key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`}
                          style={style}
                          className={`px-0.5 py-1 text-center align-middle text-slate-300 ${
                            cat ? '' : 'min-w-[4rem] max-w-[6.5rem]'
                          }`}
                          title="Select type first"
                        >
                          —
                        </td>
                      )
                    }
                    const selTrim = sel.trim().toLowerCase()
                    const matchedOpt = opts.find((o) => String(o).toLowerCase() === selTrim)
                    const selectValue = matchedOpt ?? opts[0]
                    const selectLabel = attributeOptionLabel(attrRow, selectValue)

                    return (
                      <td
                        key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`}
                        style={style}
                        className={`px-0.5 py-1 align-middle ${cat ? '' : 'min-w-[4rem] max-w-[6.5rem]'}`}
                      >
                        <select
                          value={selectValue}
                          onChange={(e) => setLineField(b.id, attrRow.json_key, e.target.value)}
                          title={`${attributeColumnHeaderLabel(attrRow)}: ${selectLabel || '—'}`}
                          aria-label={`${attributeColumnHeaderLabel(attrRow)} for ${b.name}`}
                          className="h-8 w-full min-w-0 max-w-full truncate rounded-md border border-slate-200 bg-white px-0.5 text-center text-xs outline-none focus:border-teal-500"
                        >
                          {opts.map((oid) => (
                            <option key={oid} value={oid}>
                              {attributeOptionLabel(attrRow, oid)}
                            </option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                  <td className="w-[5.25rem] min-w-[4.75rem] max-w-[5.75rem] px-0.5 py-1 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={9}
                      disabled={!checked}
                      placeholder="0.00"
                      title={checked ? 'Amount (up to 6 digits before decimal)' : 'Select type first'}
                      aria-label={`Amount for ${b.name}`}
                      className="w-full min-w-0 rounded-md border border-slate-200 px-0.5 py-1.5 text-center text-xs tabular-nums outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                      value={String(cur?.line_amount ?? '')}
                      onChange={(e) => setLineAmount(b.id, e.target.value)}
                    />
                  </td>
                  <td className="min-w-[9rem] px-1 py-1 align-top">
                    <textarea
                      disabled={!checked}
                      rows={2}
                      maxLength={2000}
                      placeholder="Optional…"
                      title={checked ? 'Note for this line' : 'Select type first'}
                      aria-label={`Line note for ${b.name}`}
                      className="w-full min-w-[8rem] resize-y rounded-md border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                      value={String(cur?.line_note ?? '')}
                      onChange={(e) => setLineNote(b.id, e.target.value)}
                    />
                  </td>
                  {renderLinePhotoCell ? (
                    <td className="w-[6.5rem] min-w-[6.5rem] px-1 py-1 align-top">
                      {renderLinePhotoCell(b.id, checked)}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function OrderAttachmentsBlock(props: {
  blockId: string
  orderId: string | null
  serverFiles: OrderAttachmentRow[]
  pendingFiles: PendingOrderAttachment[]
  onPendingChange: (files: PendingOrderAttachment[]) => void
  canEdit: boolean
  uploadBusy: boolean
  setUploadBusy: (v: boolean) => void
  onAfterServerMutation: () => Promise<void>
  setErr: (msg: string | null) => void
  onRequestDeleteAttachment: (attachmentId: string) => void
}) {
  const {
    blockId,
    orderId,
    serverFiles,
    pendingFiles,
    onPendingChange,
    canEdit,
    uploadBusy,
    setUploadBusy,
    onAfterServerMutation,
    setErr,
    onRequestDeleteAttachment,
  } = props
  const capRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const excelRef = useRef<HTMLInputElement>(null)

  async function handleChosenFile(file: File | null | undefined, kind: 'photo' | 'excel') {
    if (!file) return
    if (!orderId) {
      onPendingChange([
        ...pendingFiles,
        { key: globalThis.crypto?.randomUUID?.() ?? String(Date.now()), file, kind },
      ])
      return
    }
    setUploadBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('kind', kind)
      fd.append('file', file)
      await postMultipartJson<OrderDetail>(`/orders/${orderId}/attachments`, fd)
      await onAfterServerMutation()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Upload failed')
    } finally {
      setUploadBusy(false)
    }
  }

  const showList = serverFiles.length > 0 || pendingFiles.length > 0
  const showToolbar = canEdit

  if (!showList && !showToolbar) return null

  return (
    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attachments</h3>
      {!orderId && canEdit ? (
        <p className="mt-1 text-xs text-slate-500">
          Files you add here will upload after the order is created.
        </p>
      ) : null}
      {showToolbar ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            ref={capRef}
            id={`${blockId}-cam`}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploadBusy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void handleChosenFile(f, 'photo')
            }}
          />
          <input
            ref={photoRef}
            id={`${blockId}-photo`}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploadBusy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void handleChosenFile(f, 'photo')
            }}
          />
          <input
            ref={excelRef}
            id={`${blockId}-excel`}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            disabled={uploadBusy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void handleChosenFile(f, 'excel')
            }}
          />
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => capRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Camera className="h-3.5 w-3.5" strokeWidth={2} />
            Take photo
          </button>
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => photoRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            Upload photo
          </button>
          <button
            type="button"
            disabled={uploadBusy}
            onClick={() => excelRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={2} />
            Upload Excel
          </button>
        </div>
      ) : null}
      {pendingFiles.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {pendingFiles.map((p) => (
            <li key={p.key} className="flex items-center justify-between gap-2 rounded border border-dashed border-slate-200 px-2 py-1">
              <span className="min-w-0 truncate">
                {p.kind === 'excel' ? 'Excel' : 'Photo'}: {p.file.name}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50"
                  title="Remove"
                  onClick={() => onPendingChange(pendingFiles.filter((x) => x.key !== p.key))}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {serverFiles.length > 0 ? (
        <ul className="mt-2 divide-y divide-slate-100">
          {serverFiles.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                >
                  {a.filename}
                </a>
                <span className="ml-2 text-xs text-slate-500">
                  {a.kind === 'excel' ? 'Spreadsheet' : 'Photo'} · {fmtDisplayDateTime(a.created_at)}
                </span>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  title="Remove attachment"
                  className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                  onClick={() => onRequestDeleteAttachment(a.id)}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
