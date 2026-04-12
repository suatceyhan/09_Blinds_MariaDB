import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Eye, FolderKanban, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'

type CustomerOpt = { id: string; name: string; surname?: string | null }

type OrderPrefill = {
  estimate_id: string
  customer_id: string
  customer_display: string
  visit_notes: string | null
  blinds_summary: string | null
  blinds_lines: Array<{ id: string; name: string; window_count?: number | null; category?: string | null }>
  schedule_summary: string | null
  estimate_status: string
  company_tax_rate_percent?: string | number | null
}

type OrderRow = {
  id: string
  company_id: string
  customer_id: string
  customer_display: string
  estimate_id: string | null
  total_amount: string | number | null
  downpayment?: string | number | null
  balance: string | number | null
  tax_amount?: string | number | null
  status_code: string
  status_order_label: string | null
  agreement_date?: string | null
  created_at: string | null
  /** Soft-deleted orders have active false in DB. */
  active?: boolean
}

type OrderDetail = {
  id: string
  customer_id: string
  customer_display: string
  estimate_id: string | null
  total_amount: string | number | null
  downpayment: string | number | null
  balance: string | number | null
  tax_uygulanacak_miktar?: string | number | null
  tax_amount?: string | number | null
  blinds_lines?: Array<{ id: string; name: string; window_count?: number | null; category?: string | null }>
  agree_data: string | null
  agreement_date?: string | null
  order_note?: string | null
  status_code: string
  status_orde_id?: string | null
  status_order_label: string | null
  created_at: string | null
  updated_at?: string | null
  active?: boolean
}

type OrderStatusOpt = { id: string; name: string }

type EditDraft = {
  downpayment: string
  tax_base: string
  agreement_date: string
  order_note: string
  status_orde_id: string
  /** Shown if current id is missing from active lookup (inactive / deleted). */
  status_order_label_fallback: string | null
}

type BlindsLineAttributeRow = {
  kind_id: string
  label: string
  json_key: string
  sort_order: number
  options: { id: string; name: string; sort_order: number }[]
  allowed_option_ids_by_blinds_type: Record<string, string[]>
}

type BlindsOrderOptions = {
  blinds_types: { id: string; name: string }[]
  categories: { id: string; name: string; sort_order: number }[]
  allowed_category_ids_by_blinds_type: Record<string, string[]>
  line_attribute_rows?: BlindsLineAttributeRow[]
}

/** One line in the order blinds grid (category + lifting_system + …). */
type BlindsLineState = {
  id: string
  name: string
  window_count?: number | null
  [key: string]: string | number | null | undefined
}

function lineAttributeRows(opts: BlindsOrderOptions | null): BlindsLineAttributeRow[] {
  if (!opts) return []
  if (opts.line_attribute_rows && opts.line_attribute_rows.length > 0) return opts.line_attribute_rows
  return [
    {
      kind_id: 'product_category',
      label: 'Product category',
      json_key: 'category',
      sort_order: 0,
      options: opts.categories ?? [],
      allowed_option_ids_by_blinds_type: opts.allowed_category_ids_by_blinds_type ?? {},
    },
  ]
}

function allowedIdsForAttributeRow(row: BlindsLineAttributeRow, typeId: string): string[] {
  return row.allowed_option_ids_by_blinds_type[typeId] ?? []
}

function attributeOptionLabel(row: BlindsLineAttributeRow, optionId: string | null | undefined): string {
  if (!optionId) return ''
  const id = String(optionId).trim().toLowerCase()
  const c = row.options.find((x) => x.id === id)
  return c?.name ?? id.toUpperCase()
}

function newBlindsLineForType(id: string, name: string, opts: BlindsOrderOptions | null): BlindsLineState {
  const line: BlindsLineState = {
    id,
    name,
    window_count: null,
    line_note: '',
    line_amount: '',
  }
  for (const row of lineAttributeRows(opts)) {
    const allowed = allowedIdsForAttributeRow(row, id)
    line[row.json_key] = allowed.length ? allowed[0]! : null
  }
  return line
}

function normalizeBlindsLineFromApi(raw: Record<string, unknown>): BlindsLineState {
  const line: BlindsLineState = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    window_count: (raw.window_count as number | null | undefined) ?? null,
    line_note: raw.line_note != null ? String(raw.line_note) : '',
    line_amount:
      raw.line_amount != null && raw.line_amount !== '' ? String(raw.line_amount) : '',
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

function blindsLineToPayload(b: BlindsLineState, opts: BlindsOrderOptions | null): Record<string, unknown> {
  const rows = lineAttributeRows(opts)
  const o: Record<string, unknown> = {
    id: b.id,
    name: b.name,
    window_count: b.window_count ?? null,
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

function blindsLineSummarySuffix(b: BlindsLineState, opts: BlindsOrderOptions | null): string {
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

function statusColorClasses(name: string): { base: string; active: string } {
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

function customerLabel(c: CustomerOpt): string {
  const n = `${c.name ?? ''} ${c.surname ?? ''}`.trim()
  return n || c.id
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function AmountsCard(props: {
  subtotal: string | number | null | undefined
  tax: string | number | null | undefined
  downpayment: string | number | null | undefined
  balance: string | number | null | undefined
  taxableBase?: string | number | null | undefined
}) {
  const { subtotal, tax, downpayment, balance, taxableBase } = props
  return (
    <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amounts</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <dt className="text-xs font-medium text-slate-500">Subtotal</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{fmtMoney(subtotal)}</dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <dt className="text-xs font-medium text-slate-500">Tax</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{fmtMoney(tax)}</dd>
          {taxableBase !== undefined ? (
            <div className="mt-1 text-[11px] text-slate-500">Taxable base: {fmtMoney(taxableBase)}</div>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
          <dt className="text-xs font-medium text-slate-500">Total (incl. tax)</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{fmtTotalIncludingTax(subtotal, tax)}</dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
          <dt className="text-xs font-medium text-slate-500">Down payment</dt>
          <dd className="mt-1 text-base font-semibold text-slate-900">{fmtMoney(downpayment)}</dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-teal-50/40 px-3 py-2">
          <dt className="text-xs font-medium text-teal-800/80">Balance due</dt>
          <dd className="mt-1 text-lg font-semibold text-teal-900">{fmtMoney(balance)}</dd>
        </div>
      </dl>
    </section>
  )
}

function parseMoneyAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v)
  return Number.isNaN(n) ? null : n
}

/** Subtotal + tax (matches how balance includes tax). */
function fmtTotalIncludingTax(
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
function fmtDisplayDate(iso: string | null | undefined): string {
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

function statusCodeLabel(code: string): string {
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

function parseOptionalDecimal(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number.parseFloat(t.replace(',', '.'))
  if (Number.isNaN(n)) return null
  return n
}

function safeRound2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function sumBlindsLineAmounts(lines: BlindsLineState[]): number {
  let s = 0
  for (const b of lines) {
    const n = parseOptionalDecimal(String(b.line_amount ?? ''))
    if (n !== null) s += n
  }
  return safeRound2(s)
}

function parseTaxRatePercent(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

/** Transposed grid: one row per blinds type; Qty, category, line note & amount (lifting/cassette elsewhere). */
function BlindsTypesGrid(props: {
  blindsTypes: { id: string; name: string }[]
  blindsOrderOptions: BlindsOrderOptions | null
  lines: BlindsLineState[]
  toggleType: (typeId: string) => void
  setCount: (typeId: string, value: string) => void
  setLineField: (typeId: string, jsonKey: string, value: string) => void
  setLineNote: (typeId: string, value: string) => void
  setLineAmount: (typeId: string, value: string) => void
  keyPrefix?: string
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
  } = props
  const attrRows = lineAttributeRows(blindsOrderOptions)

  if (!bt.length) {
    return <p className="mt-2 text-sm text-slate-500">No blinds types configured.</p>
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th
              scope="col"
              className="sticky left-0 z-20 min-w-[9rem] bg-slate-50 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            >
              Blinds type
            </th>
            <th
              scope="col"
              className="min-w-[4.5rem] px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            >
              Qty
            </th>
            {attrRows.map((attrRow) => (
              <th
                key={`${keyPrefix}-h-${attrRow.kind_id}`}
                scope="col"
                className="min-w-[6.5rem] max-w-[11rem] px-1 py-2 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-600"
              >
                {attrRow.label}
              </th>
            ))}
            <th
              scope="col"
              className="min-w-[10rem] px-1 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            >
              Line note
            </th>
            <th
              scope="col"
              className="min-w-[5.5rem] px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-600"
            >
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {bt.map((b) => {
            const checked = lines.some((x) => x.id === b.id)
            const cur = lines.find((x) => x.id === b.id)
            return (
              <tr key={`${keyPrefix}-row-${b.id}`} className="group hover:bg-slate-50/80">
                <td className="sticky left-0 z-10 min-w-[9rem] bg-white px-2 py-1.5 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-slate-50/80">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                      checked={checked}
                      onChange={() => toggleType(b.id)}
                    />
                    <span className="font-semibold text-slate-800">{b.name}</span>
                  </label>
                </td>
                <td className="px-1 py-1 align-middle">
                  <input
                    type="number"
                    min={1}
                    disabled={!checked}
                    placeholder="Qty"
                    title={checked ? 'Quantity' : 'Select type first'}
                    aria-label={`Quantity for ${b.name}`}
                    className="w-full min-w-0 rounded-md border border-slate-200 px-1 py-1.5 text-center text-xs outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                    value={cur?.window_count ?? ''}
                    onChange={(ev) => setCount(b.id, ev.target.value)}
                  />
                </td>
                {attrRows.map((attrRow) => {
                  const opts = allowedIdsForAttributeRow(attrRow, b.id)
                  if (!opts.length) {
                    return (
                      <td
                        key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`}
                        className="px-1 py-1 text-center align-middle text-slate-300"
                        title={`${attrRow.label} not used for ${b.name}`}
                      >
                        —
                      </td>
                    )
                  }
                  return (
                    <td key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`} className="px-1 py-1 align-middle">
                      <select
                        disabled={!checked}
                        value={String(cur?.[attrRow.json_key] ?? '')}
                        onChange={(e) => setLineField(b.id, attrRow.json_key, e.target.value)}
                        title={checked ? attrRow.label : 'Select type first'}
                        aria-label={`${attrRow.label} for ${b.name}`}
                        className="h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-1 text-center text-xs outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
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
                <td className="px-1 py-1 align-top">
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
                <td className="px-1 py-1 align-middle">
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={!checked}
                    placeholder="0.00"
                    title={checked ? 'Amount for this line' : 'Select type first'}
                    aria-label={`Amount for ${b.name}`}
                    className="w-full min-w-[4.5rem] rounded-md border border-slate-200 px-1 py-1.5 text-center text-xs outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                    value={String(cur?.line_amount ?? '')}
                    onChange={(e) => setLineAmount(b.id, e.target.value)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function OrdersPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('orders.view'))
  const canEdit = Boolean(me?.permissions.includes('orders.edit'))
  const canViewCompanies = Boolean(me?.permissions.includes('companies.view'))
  const sessionCompanyId = me?.active_company_id ?? me?.company_id ?? null
  const [searchParams, setSearchParams] = useSearchParams()

  const [rows, setRows] = useState<OrderRow[] | null>(null)
  const [customers, setCustomers] = useState<CustomerOpt[] | null>(null)
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
  const blindsTypes = blindsOrderOptions?.blinds_types ?? null
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [linkedEstimateId, setLinkedEstimateId] = useState<string | null>(null)
  const [blindsLines, setBlindsLines] = useState<BlindsLineState[]>([])
  const [taxBaseAmount, setTaxBaseAmount] = useState('')
  const [downpayment, setDownpayment] = useState('')
  const [agreementDate, setAgreementDate] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [companyTaxRatePercent, setCompanyTaxRatePercent] = useState<number | null>(null)

  const [viewOrderId, setViewOrderId] = useState<string | null>(null)
  const [viewOrder, setViewOrder] = useState<OrderDetail | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)

  const [editOrderId, setEditOrderId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editCustomerId, setEditCustomerId] = useState('')
  const [editEstimateId, setEditEstimateId] = useState<string | null>(null)
  const [editBlindsLines, setEditBlindsLines] = useState<BlindsLineState[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOpt[] | null>(null)

  const fromEstimateQ = useMemo(() => searchParams.get('fromEstimate')?.trim() ?? '', [searchParams])

  const lineSubtotalParsed = useMemo(() => sumBlindsLineAmounts(blindsLines), [blindsLines])
  const taxBaseParsed = useMemo(() => parseOptionalDecimal(taxBaseAmount), [taxBaseAmount])
  const dpParsed = useMemo(() => parseOptionalDecimal(downpayment), [downpayment])

  const computedTaxAmount = useMemo(() => {
    if (companyTaxRatePercent == null || taxBaseParsed == null) return null
    if (companyTaxRatePercent <= 0 || taxBaseParsed <= 0) return safeRound2(0)
    return safeRound2((taxBaseParsed * companyTaxRatePercent) / 100)
  }, [companyTaxRatePercent, taxBaseParsed])

  const computedBalance = useMemo(() => {
    if (dpParsed == null) return null
    const taxPart = computedTaxAmount ?? 0
    return safeRound2(lineSubtotalParsed - dpParsed + taxPart)
  }, [lineSubtotalParsed, dpParsed, computedTaxAmount])

  const editLineSubtotalParsed = useMemo(
    () => sumBlindsLineAmounts(editBlindsLines),
    [editBlindsLines],
  )
  const editTaxBaseParsed = useMemo(
    () => (editDraft ? parseOptionalDecimal(editDraft.tax_base) : null),
    [editDraft],
  )
  const editDpParsed = useMemo(
    () => (editDraft ? parseOptionalDecimal(editDraft.downpayment) : null),
    [editDraft],
  )
  const editComputedTaxAmount = useMemo(() => {
    if (!editDraft || companyTaxRatePercent == null || editTaxBaseParsed == null) return null
    if (companyTaxRatePercent <= 0 || editTaxBaseParsed <= 0) return safeRound2(0)
    return safeRound2((editTaxBaseParsed * companyTaxRatePercent) / 100)
  }, [editDraft, companyTaxRatePercent, editTaxBaseParsed])

  const editComputedBalance = useMemo(() => {
    if (!editDraft || editDpParsed == null) return null
    const taxPart = editComputedTaxAmount ?? 0
    return safeRound2(editLineSubtotalParsed - editDpParsed + taxPart)
  }, [editDraft, editDpParsed, editLineSubtotalParsed, editComputedTaxAmount])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const [filterStatusOrderId, setFilterStatusOrderId] = useState('')

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showDeleted) p.set('include_deleted', 'true')
    if (filterStatusOrderId.trim()) p.set('status_orde_id', filterStatusOrderId.trim())
    return p.toString()
  }, [debouncedSearch, showDeleted, filterStatusOrderId])

  async function reloadList() {
    const list = await getJson<OrderRow[]>(`/orders?${listParams}`)
    setRows(list)
  }

  async function saveOrderEdit() {
    if (!editOrderId || !editDraft || !canEdit) return
    if (!editDraft.status_orde_id.trim()) {
      setErr('Select an order status.')
      return
    }
    if (editBlindsLines.length === 0) {
      setErr('Choose at least one blinds type.')
      return
    }
    if (!editEstimateId && !editCustomerId.trim()) {
      setErr('Select a customer.')
      return
    }
    const oid = editOrderId
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/orders/${oid}`, {
        ...(editEstimateId ? {} : { customer_id: editCustomerId.trim() }),
        downpayment: parseOptionalDecimal(editDraft.downpayment),
        tax_uygulanacak_miktar: parseOptionalDecimal(editDraft.tax_base),
        agreement_date: editDraft.agreement_date.trim() || null,
        order_note: (() => {
          const n = editDraft.order_note.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
          return n ? n.slice(0, 4000) : null
        })(),
        status_orde_id: editDraft.status_orde_id.trim(),
        blinds_lines: editBlindsLines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
      })
      setEditOrderId(null)
      setEditDraft(null)
      setEditCustomerId('')
      setEditEstimateId(null)
      setEditBlindsLines([])
      await reloadList()
      if (viewOrderId === oid) {
        const d = await getJson<OrderDetail>(`/orders/${oid}`)
        setViewOrder(d)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save order')
    } finally {
      setEditSaving(false)
    }
  }

  async function runDeleteOrder() {
    if (!deleteOrderId || !canEdit) return
    const oid = deleteOrderId
    const curView = viewOrderId
    const curEdit = editOrderId
    setDeletePending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${oid}`)
      setDeleteOrderId(null)
      await reloadList()
      if (curView === oid) {
        setViewOrderId(null)
        setViewOrder(null)
      }
      if (curEdit === oid) {
        setEditOrderId(null)
        setEditDraft(null)
        setEditCustomerId('')
        setEditEstimateId(null)
        setEditBlindsLines([])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete order')
    } finally {
      setDeletePending(false)
    }
  }

  async function restoreDeletedOrder(orderId: string) {
    if (!canEdit) return
    setErr(null)
    try {
      await postJson(`/orders/${orderId}/restore`, {})
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not restore order')
    }
  }

  useEffect(() => {
    if (!viewOrderId || !canView) {
      setViewOrder(null)
      setViewLoading(false)
      return
    }
    let c = false
    setViewLoading(true)
    ;(async () => {
      try {
        const d = await getJson<OrderDetail>(`/orders/${viewOrderId}`)
        if (!c) setViewOrder(d)
      } catch {
        if (!c) setViewOrder(null)
      } finally {
        if (!c) setViewLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [viewOrderId, canView])

  useEffect(() => {
    if (!editOrderId || !canEdit) {
      setEditDraft(null)
      setEditCustomerId('')
      setEditEstimateId(null)
      setEditBlindsLines([])
      setEditLoading(false)
      return
    }
    let c = false
    setEditLoading(true)
    ;(async () => {
      try {
        const d = await getJson<OrderDetail>(`/orders/${editOrderId}`)
        if (!c) {
          setEditCustomerId(d.customer_id)
          setEditEstimateId(d.estimate_id)
          setEditBlindsLines(
            d.blinds_lines?.length
              ? d.blinds_lines.map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>))
              : [],
          )
          setEditDraft({
            downpayment: d.downpayment != null ? String(d.downpayment) : '',
            tax_base: d.tax_uygulanacak_miktar != null ? String(d.tax_uygulanacak_miktar) : '',
            agreement_date: (d.agreement_date ?? '').toString().trim().slice(0, 10),
            order_note: d.order_note ?? '',
            status_orde_id: d.status_orde_id?.trim() ?? '',
            status_order_label_fallback: d.status_order_label?.trim() ?? null,
          })
        }
      } catch {
        if (!c) {
          setEditDraft(null)
          setEditCustomerId('')
          setEditEstimateId(null)
          setEditBlindsLines([])
        }
      } finally {
        if (!c) setEditLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [editOrderId, canEdit])

  useEffect(() => {
    if (!me || !canView) return
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<OrderRow[]>(`/orders?${listParams}`)
        if (!c) setRows(list)
      } catch (e) {
        if (!c) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load orders')
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [me, canView, listParams])

  useEffect(() => {
    if (!me || !canView) return
    let c = false
    ;(async () => {
      try {
        const [custList, opts, st] = await Promise.all([
          getJson<CustomerOpt[]>(`/customers?limit=300`),
          getJson<BlindsOrderOptions>(`/orders/lookup/blinds-order-options`),
          getJson<OrderStatusOpt[]>(`/orders/lookup/order-statuses`).catch(() => [] as OrderStatusOpt[]),
        ])
        if (!c) {
          setCustomers(custList)
          setBlindsOrderOptions(opts)
          setOrderStatuses(st)
        }
      } catch {
        if (!c) {
          setCustomers([])
          setBlindsOrderOptions(null)
        }
      }
    })()
    return () => {
      c = true
    }
  }, [me, canView])

  useEffect(() => {
    if (!me || !canViewCompanies || !sessionCompanyId) {
      setCompanyTaxRatePercent(null)
      return
    }
    let c = false
    ;(async () => {
      try {
        const co = await getJson<{ tax_rate_percent?: string | number | null }>(
          `/companies/${sessionCompanyId}`,
        )
        if (!c) setCompanyTaxRatePercent(parseTaxRatePercent(co.tax_rate_percent))
      } catch {
        if (!c) setCompanyTaxRatePercent(null)
      }
    })()
    return () => {
      c = true
    }
  }, [me, canViewCompanies, sessionCompanyId])

  useEffect(() => {
    if (!me || !fromEstimateQ || !canView) return
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        const p = await getJson<OrderPrefill>(`/orders/prefill-from-estimate/${fromEstimateQ}`)
        if (cancelled) return
        if (p.estimate_status !== 'pending') {
          setErr(
            p.estimate_status === 'converted'
              ? 'This estimate is already converted. Find the order in the list below.'
              : 'Only pending estimates can be turned into an order.',
          )
          setSearchParams({}, { replace: true })
          return
        }
        setCustomerId(p.customer_id)
        setLinkedEstimateId(fromEstimateQ)
        setBlindsLines(
          (p.blinds_lines ?? []).map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>)),
        )
        setOrderNote(p.visit_notes?.trim() ? p.visit_notes : '')
        const pr = parseTaxRatePercent(p.company_tax_rate_percent)
        if (pr !== null) setCompanyTaxRatePercent(pr)
        setShowCreateForm(true)
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Could not load estimate for this order')
        }
      } finally {
        if (!cancelled) setSearchParams({}, { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canView, fromEstimateQ, setSearchParams, blindsOrderOptions])

  function resetCreateForm() {
    setCustomerId('')
    setLinkedEstimateId(null)
    setBlindsLines([])
    setTaxBaseAmount('')
    setDownpayment('')
    setAgreementDate('')
    setOrderNote('')
  }

  function toggleBlinds(id: string) {
    setBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = (blindsTypes ?? []).find((x) => x.id === id)
      const name = bt?.name ?? id
      return [...prev, newBlindsLineForType(id, name, blindsOrderOptions)]
    })
  }

  function setBlindsCount(id: string, v: string) {
    const t = v.trim()
    const next = t === '' ? null : Number.parseInt(t, 10)
    setBlindsLines((prev) =>
      prev.map((x) => (x.id === id ? { ...x, window_count: Number.isNaN(next as any) ? x.window_count : next } : x)),
    )
  }

  function setBlindsLineField(id: string, jsonKey: string, value: string) {
    const v = value.trim() ? value.trim().toLowerCase() : null
    setBlindsLines((prev) =>
      prev.map((x) => (x.id === id ? { ...x, [jsonKey]: v } : x)),
    )
  }

  function setBlindsLineNote(id: string, value: string) {
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function setBlindsLineAmount(id: string, value: string) {
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: value } : x)))
  }

  function editToggleBlinds(id: string) {
    setEditBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = (blindsTypes ?? []).find((x) => x.id === id)
      const name = bt?.name ?? id
      return [...prev, newBlindsLineForType(id, name, blindsOrderOptions)]
    })
  }

  function editSetBlindsCount(id: string, v: string) {
    const t = v.trim()
    const next = t === '' ? null : Number.parseInt(t, 10)
    setEditBlindsLines((prev) =>
      prev.map((x) => (x.id === id ? { ...x, window_count: Number.isNaN(next as any) ? x.window_count : next } : x)),
    )
  }

  function editSetBlindsLineField(id: string, jsonKey: string, value: string) {
    const v = value.trim() ? value.trim().toLowerCase() : null
    setEditBlindsLines((prev) =>
      prev.map((x) => (x.id === id ? { ...x, [jsonKey]: v } : x)),
    )
  }

  function editSetBlindsLineNote(id: string, value: string) {
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function editSetBlindsLineAmount(id: string, value: string) {
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: value } : x)))
  }

  function openNewOrder() {
    resetCreateForm()
    setShowCreateForm(true)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !customerId.trim()) return
    const taxBase = taxBaseParsed
    const dp = dpParsed
    setSaving(true)
    setErr(null)
    try {
      await postJson<OrderRow>('/orders', {
        customer_id: customerId.trim(),
        ...(linkedEstimateId ? { estimate_id: linkedEstimateId } : {}),
        ...(taxBase !== null ? { tax_uygulanacak_miktar: taxBase } : {}),
        ...(dp !== null ? { downpayment: dp } : {}),
        ...(agreementDate.trim() ? { agreement_date: agreementDate.trim() } : {}),
        ...(orderNote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
          ? { order_note: orderNote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, 4000) }
          : {}),
        blinds_lines: blindsLines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
      })
      setShowCreateForm(false)
      resetCreateForm()
      await reloadList()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) {
    return (
      <div className="w-full">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="w-full max-w-none space-y-4">
        <p className="text-sm text-slate-600">You do not have permission to view orders.</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <FolderKanban className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Orders</h1>
            <p className="mt-1 text-slate-600">
              Create orders here or start from an estimate using Make order on the Estimates page. Linking an
              estimate marks it as converted automatically.
            </p>
          </div>
        </div>
        {canEdit && !showCreateForm ? (
          <div className="ml-auto flex shrink-0 items-center sm:pt-1">
            <button
              type="button"
              onClick={() => openNewOrder()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              New order
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p>
      ) : null}

      {canEdit && showCreateForm ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-800">New order</h2>
          {linkedEstimateId ? (
            <p className="mt-2 rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2 text-xs text-teal-900">
              From estimate{' '}
              <Link className="font-semibold underline" to={`/estimates/${linkedEstimateId}`}>
                {linkedEstimateId}
              </Link>
              . Customer is fixed to match the estimate.
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Customer</span>
              <select
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                value={customerId}
                disabled={Boolean(linkedEstimateId)}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select…</option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {customerLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Blinds types &amp; quantities
              </legend>
              <BlindsTypesGrid
                blindsTypes={blindsTypes ?? []}
                blindsOrderOptions={blindsOrderOptions}
                lines={blindsLines}
                toggleType={toggleBlinds}
                setCount={setBlindsCount}
                setLineField={setBlindsLineField}
                setLineNote={setBlindsLineNote}
                setLineAmount={setBlindsLineAmount}
              />
              <label className="mt-3 block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Order note</span>
                <textarea
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder="Optional note for this order…"
                  className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
              </label>
              {blindsLines.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
              ) : null}
            </fieldset>
            <div className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Total amount</span>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {lineSubtotalParsed.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-xs font-normal text-slate-500">(sum of line amounts)</span>
              </p>
            </div>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Down payment</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={downpayment}
                onChange={(e) => setDownpayment(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Taxable base</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={taxBaseAmount}
                onChange={(e) => setTaxBaseAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <div className="sm:col-span-2">
              <AmountsCard
                subtotal={lineSubtotalParsed}
                tax={computedTaxAmount}
                taxableBase={taxBaseParsed}
                downpayment={dpParsed}
                balance={computedBalance}
              />
            </div>

            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Agreement date (optional)</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={agreementDate}
                onChange={(e) => setAgreementDate(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setShowCreateForm(false)
                resetCreateForm()
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !customerId.trim()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create order'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-slate-800">All orders</h2>

            <input
              type="search"
              placeholder="Search id, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:max-w-[18rem]"
              aria-label="Search orders"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => setFilterStatusOrderId('')}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  filterStatusOrderId.trim() === ''
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                } ${loading ? 'opacity-60' : ''}`}
                title="All statuses"
              >
                All
              </button>
              {(orderStatuses ?? []).map((s) => {
                const selected = filterStatusOrderId === s.id
                const c = statusColorClasses(s.name)
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setFilterStatusOrderId(s.id)}
                    className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                      selected ? c.active : c.base
                    } ${selected ? '' : 'hover:brightness-[0.98]'} ${loading ? 'opacity-60' : ''}`}
                    title={s.name}
                    aria-pressed={selected}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <ShowDeletedToggle
                id="show-deleted-orders"
                checked={showDeleted}
                onChange={setShowDeleted}
                disabled={loading}
              />
            </div>
          </div>
        </div>
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[52rem] text-left text-sm [word-break:break-word]">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Customer</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Status</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Agreement date</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4" title="Order subtotal plus tax">
                  Total
                </th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Tax</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Down payment</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Balance</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Created</th>
                <th className="whitespace-nowrap px-2 py-3 text-right sm:px-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading || rows === null ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-500">
                    No orders yet. Use New order or Make order from an estimate.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-50/80 ${r.active === false ? 'bg-slate-50/90 opacity-80' : ''}`.trim()}
                  >
                    <td className="px-2 py-3 sm:px-4">
                      <Link
                        to={`/customers/${r.customer_id}`}
                        className="font-medium text-teal-700 hover:underline"
                      >
                        {r.customer_display || r.customer_id}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-slate-800 sm:px-4">
                      <span className="block">{r.status_order_label?.trim() || '—'}</span>
                      {r.active === false ? (
                        <span className="mt-1 block text-[11px] font-medium text-slate-500">Deleted</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">{fmtDisplayDate(r.agreement_date)}</td>
                    <td className="px-2 py-3 font-medium sm:px-4">
                      {fmtTotalIncludingTax(r.total_amount, r.tax_amount)}
                    </td>
                    <td className="px-2 py-3 sm:px-4">{fmtMoney(r.tax_amount)}</td>
                    <td className="px-2 py-3 sm:px-4">{fmtMoney(r.downpayment)}</td>
                    <td className="px-2 py-3 sm:px-4">{fmtMoney(r.balance)}</td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">{fmtDisplayDate(r.created_at)}</td>
                    <td className="px-2 py-3 text-right sm:px-4">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <button
                          type="button"
                          title="View details"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                          onClick={() => setViewOrderId(r.id)}
                        >
                          <Eye className="h-4 w-4" strokeWidth={2} />
                        </button>
                        {canEdit && r.active === false ? (
                          <button
                            type="button"
                            title="Restore order"
                            className="rounded-lg border border-teal-200 p-1.5 text-teal-800 hover:bg-teal-50"
                            onClick={() => void restoreDeletedOrder(r.id)}
                          >
                            <RotateCcw className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                        {canEdit && r.active !== false ? (
                          <button
                            type="button"
                            title="Edit order"
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                            onClick={() => setEditOrderId(r.id)}
                          >
                            <Pencil className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                        {canEdit && r.active !== false ? (
                          <button
                            type="button"
                            title="Delete order"
                            className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteOrderId(r.id)}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewOrderId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-label="Close dialog"
            onClick={() => {
              setViewOrderId(null)
              setViewOrder(null)
            }}
          />
          <div className="relative max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-800/90">Order detail</p>
                <h2 className="font-mono text-xl font-semibold tracking-tight text-slate-900">{viewOrderId}</h2>
                {viewOrder && !viewLoading ? (
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Status:</span>{' '}
                    {viewOrder.status_order_label?.trim() || statusCodeLabel(viewOrder.status_code)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200/80 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50"
                title="Close"
                onClick={() => {
                  setViewOrderId(null)
                  setViewOrder(null)
                }}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="max-h-[calc(92vh-5.5rem)] overflow-y-auto px-5 py-5 sm:px-6">
              {viewLoading ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : !viewOrder ? (
                <p className="text-sm text-red-700">Could not load this order.</p>
              ) : (
                <div className="space-y-5 text-sm text-slate-800">
                  {viewOrder.active === false ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                      This order is soft-deleted (inactive). You can review the details below; editing is disabled.
                    </p>
                  ) : null}
                  <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer &amp; links</h3>
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-slate-500">Customer</span>
                        <Link
                          to={`/customers/${viewOrder.customer_id}`}
                          className="font-semibold text-teal-700 hover:underline"
                          onClick={() => {
                            setViewOrderId(null)
                            setViewOrder(null)
                          }}
                        >
                          {viewOrder.customer_display || viewOrder.customer_id}
                        </Link>
                      </div>
                      {viewOrder.estimate_id ? (
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-slate-500">Estimate</span>
                          <Link
                            to={`/estimates/${viewOrder.estimate_id}`}
                            className="font-mono font-medium text-teal-700 hover:underline"
                            onClick={() => {
                              setViewOrderId(null)
                              setViewOrder(null)
                            }}
                          >
                            {viewOrder.estimate_id}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <AmountsCard
                    subtotal={viewOrder.total_amount}
                    tax={viewOrder.tax_amount}
                    taxableBase={viewOrder.tax_uygulanacak_miktar}
                    downpayment={viewOrder.downpayment}
                    balance={viewOrder.balance}
                  />

                  <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</h3>
                    <dl className="mt-2 space-y-1 text-slate-700">
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Agreement</dt>
                        <dd>{fmtDisplayDate(viewOrder.agreement_date)}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-slate-500">Created</dt>
                        <dd>{fmtDisplayDate(viewOrder.created_at)}</dd>
                      </div>
                    </dl>
                  </section>

                  {viewOrder.blinds_lines && viewOrder.blinds_lines.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blinds</h3>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {viewOrder.blinds_lines.map((b) => (
                          <li
                            key={b.id}
                            className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900 ring-1 ring-teal-100"
                          >
                            {b.name}
                            {b.window_count != null ? ` · ${b.window_count}` : ''}
                            {blindsLineSummarySuffix(
                              normalizeBlindsLineFromApi(b as Record<string, unknown>),
                              blindsOrderOptions,
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {viewOrder.order_note?.trim() ? (
                    <section className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Note</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{viewOrder.order_note.trim()}</p>
                    </section>
                  ) : null}

                  {viewOrder.agree_data?.trim() ? (
                    <section className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Production notes</h3>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200/80 bg-white p-3 text-xs leading-relaxed text-slate-800">
                        {viewOrder.agree_data.trim()}
                      </pre>
                    </section>
                  ) : null}

                  {canEdit && viewOrder.active !== false ? (
                    <div className="flex justify-end border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
                        onClick={() => {
                          const oid = viewOrderId
                          setViewOrderId(null)
                          setViewOrder(null)
                          setEditOrderId(oid)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit order
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editOrderId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]"
            aria-label="Close editor"
            onClick={() => {
              if (!editSaving) {
                setEditOrderId(null)
                setEditDraft(null)
                setEditCustomerId('')
                setEditEstimateId(null)
                setEditBlindsLines([])
              }
            }}
          />
          <div className="relative max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Edit order</h2>
              <button
                type="button"
                disabled={editSaving}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                title="Close"
                onClick={() => {
                  setEditOrderId(null)
                  setEditDraft(null)
                  setEditCustomerId('')
                  setEditEstimateId(null)
                  setEditBlindsLines([])
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(92vh-4rem)] overflow-y-auto px-5 py-4">
              {editLoading || !editDraft ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void saveOrderEdit()
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {editEstimateId ? (
                      <p className="rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2 text-xs text-teal-900 sm:col-span-2">
                        Linked to estimate{' '}
                        <Link className="font-semibold underline" to={`/estimates/${editEstimateId}`}>
                          {editEstimateId}
                        </Link>
                        . Customer matches the estimate and cannot be changed here.
                      </p>
                    ) : null}
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Customer</span>
                      <select
                        required={!editEstimateId}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                        value={editCustomerId}
                        disabled={Boolean(editEstimateId)}
                        onChange={(e) => setEditCustomerId(e.target.value)}
                      >
                        <option value="">Select…</option>
                        {(customers ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {customerLabel(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Status</span>
                      <span className="mb-1 block text-xs text-slate-500">
                        Order statuses from Lookups (same labels as the orders table).
                      </span>
                      <select
                        required
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        value={editDraft.status_orde_id}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, status_orde_id: e.target.value } : d))
                        }
                      >
                        <option value="">Select status…</option>
                        {editDraft.status_orde_id &&
                        !(orderStatuses ?? []).some((s) => s.id === editDraft.status_orde_id) ? (
                          <option value={editDraft.status_orde_id}>
                            {editDraft.status_order_label_fallback ?? 'Current status'} (not in active list)
                          </option>
                        ) : null}
                        {(orderStatuses ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Blinds types &amp; quantities
                      </legend>
                      <BlindsTypesGrid
                        blindsTypes={blindsTypes ?? []}
                        blindsOrderOptions={blindsOrderOptions}
                        lines={editBlindsLines}
                        toggleType={editToggleBlinds}
                        setCount={editSetBlindsCount}
                        setLineField={editSetBlindsLineField}
                        setLineNote={editSetBlindsLineNote}
                        setLineAmount={editSetBlindsLineAmount}
                        keyPrefix="edit"
                      />
                      <label className="mt-3 block text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Order note</span>
                        <textarea
                          value={editDraft.order_note}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, order_note: e.target.value } : d))
                          }
                          rows={2}
                          maxLength={4000}
                          placeholder="Optional note for this order…"
                          className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        />
                      </label>
                      {editBlindsLines.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
                      ) : null}
                    </fieldset>
                    <div className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Total amount</span>
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                        {editLineSubtotalParsed.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-xs font-normal text-slate-500">(sum of line amounts)</span>
                      </p>
                    </div>
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Down payment</span>
                      <input
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                        value={editDraft.downpayment}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, downpayment: e.target.value } : d))
                        }
                        placeholder="0.00"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Taxable base</span>
                      <input
                        inputMode="decimal"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                        value={editDraft.tax_base}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, tax_base: e.target.value } : d))}
                        placeholder="0.00"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <AmountsCard
                        subtotal={editLineSubtotalParsed}
                        tax={editComputedTaxAmount}
                        taxableBase={editTaxBaseParsed}
                        downpayment={editDpParsed}
                        balance={editComputedBalance}
                      />
                    </div>
                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Agreement date (optional)</span>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        value={editDraft.agreement_date}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, agreement_date: e.target.value } : d))
                        }
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={editSaving}
                      className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => {
                        setEditOrderId(null)
                        setEditDraft(null)
                        setEditCustomerId('')
                        setEditEstimateId(null)
                        setEditBlindsLines([])
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={
                        editSaving ||
                        !editDraft.status_orde_id.trim() ||
                        editBlindsLines.length === 0 ||
                        (!editEstimateId && !editCustomerId.trim())
                      }
                      className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deleteOrderId !== null}
        title="Delete this order?"
        description="The order will be hidden from the default list (soft delete). You can restore it later from Show deleted."
        confirmLabel="Delete order"
        cancelLabel="Keep order"
        variant="danger"
        pending={deletePending}
        onConfirm={() => void runDeleteOrder()}
        onCancel={() => !deletePending && setDeleteOrderId(null)}
      />
    </div>
  )
}
