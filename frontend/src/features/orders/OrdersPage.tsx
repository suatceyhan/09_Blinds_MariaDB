import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Camera,
  Eye,
  FileSpreadsheet,
  FolderKanban,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { deleteJson, getJson, patchJson, postJson, postMultipartJson } from '@/lib/api'

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
  final_payment?: string | number | null
  balance: string | number | null
  tax_amount?: string | number | null
  status_code: string
  status_order_label: string | null
  agreement_date?: string | null
  created_at: string | null
  /** Soft-deleted orders have active false in DB. */
  active?: boolean
}

type OrderAttachmentRow = {
  id: string
  kind: string
  filename: string
  url: string
  created_at: string
}

type PendingOrderAttachment = { key: string; file: File; kind: 'photo' | 'excel' }

type OrderDetail = {
  id: string
  customer_id: string
  customer_display: string
  estimate_id: string | null
  total_amount: string | number | null
  downpayment: string | number | null
  /** Cumulative payments after the down payment; balance subtracts this. */
  final_payment?: string | number | null
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
  /** Down payment (`id` downpayment) + recorded Pay rows; chronological from API. */
  payment_entries?: Array<{ id: string; amount: string | number; paid_at: string }>
  attachments?: OrderAttachmentRow[]
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
      label: 'Category',
      json_key: 'category',
      sort_order: 0,
      options: opts.categories ?? [],
      allowed_option_ids_by_blinds_type: opts.allowed_category_ids_by_blinds_type ?? {},
    },
  ]
}

function attributeColumnHeaderLabel(row: BlindsLineAttributeRow): string {
  if (row.kind_id === 'product_category' || row.label === 'Product category') return 'Category'
  return row.label
}

function isCategoryAttributeRow(row: BlindsLineAttributeRow): boolean {
  return row.kind_id === 'product_category' || row.json_key === 'category'
}

/** Width in `ch` from header + longest option label (capped). */
function categoryColumnWidthCh(row: BlindsLineAttributeRow): number {
  const h = attributeColumnHeaderLabel(row)
  let m = h.length
  for (const o of row.options) m = Math.max(m, o.name.length)
  return Math.min(Math.max(m + 1, 8), 20)
}

/** Up to 6 integer digits and 2 decimal places (e.g. 999999.99). */
function sanitizeLineAmountInput(raw: string): string {
  const s = raw.replace(/[^\d.]/g, '')
  if (!s) return ''
  const dot = s.indexOf('.')
  if (dot === -1) return s.slice(0, 6)
  const intPart = s.slice(0, dot).replace(/\./g, '').slice(0, 6)
  const decPart = s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return `${intPart}.${decPart}`
}

function normalizeWindowCountFromApi(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.trunc(raw)
      : Number.parseInt(String(raw).trim(), 10)
  if (Number.isNaN(n) || n < 1) return null
  if (n > 99) return 99
  return n
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
    window_count: normalizeWindowCountFromApi(raw.window_count),
    line_note: raw.line_note != null ? String(raw.line_note) : '',
    line_amount:
      raw.line_amount != null && raw.line_amount !== ''
        ? sanitizeLineAmountInput(String(raw.line_amount))
        : '',
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

/** Second financial row: paid (down + recorded payments), balance due, tax. */
function OrderFinancialSecondRow(props: {
  paidDisplay: string
  balance: string | number | null | undefined
  tax: string | number | null | undefined
  belowBalance?: ReactNode
}) {
  const { paidDisplay, balance, tax, belowBalance } = props
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="block min-w-0 text-sm text-slate-700">
        <span className="mb-1 block font-medium">Paid</span>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
          {paidDisplay}
        </p>
      </div>
      <div className="block min-w-0 text-sm text-slate-700">
        <span className="mb-1 block font-medium text-teal-800/80">Balance due</span>
        <p className="rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2 text-sm font-semibold text-teal-900">
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

function fmtDisplayDateTime(iso: string | null | undefined): string {
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

/** Orders table: paid = down payment + cumulative post-down payments (`final_payment`). */
function orderListPaidDisplay(r: OrderRow): string {
  const down = parseMoneyAmount(r.downpayment) ?? 0
  const extra = parseMoneyAmount(r.final_payment) ?? 0
  return fmtMoney(safeRound2(down + extra))
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

/** Transposed grid: one row per blinds type; Qty, category attrs, amount, line note last (lifting/cassette elsewhere). */
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
    <div className="mt-2 min-w-0 space-y-1">
      <p className="text-[11px] leading-snug text-slate-500">
        If the table is wider than the form, scroll horizontally inside this shaded area — line notes and long
        labels stay reachable.
      </p>
      <div className="min-w-0 overflow-x-auto rounded-md border border-slate-200/80 bg-white/80">
        <table className="w-full min-w-[26rem] border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th
                scope="col"
                className="sticky left-0 z-20 min-w-[6rem] max-w-[8.5rem] bg-slate-50 px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-600"
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bt.map((b) => {
              const checked = lines.some((x) => x.id === b.id)
              const cur = lines.find((x) => x.id === b.id)
              return (
                <tr key={`${keyPrefix}-row-${b.id}`} className="group hover:bg-slate-50/80">
                  <td className="sticky left-0 z-10 min-w-[6rem] max-w-[8.5rem] bg-white px-1.5 py-1.5 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-slate-50/80">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                        checked={checked}
                        onChange={() => toggleType(b.id)}
                      />
                      <span className="min-w-0 truncate font-semibold text-slate-800" title={b.name}>
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
                    const opts = allowedIdsForAttributeRow(attrRow, b.id)
                    const cat = isCategoryAttributeRow(attrRow)
                    const wch = cat ? categoryColumnWidthCh(attrRow) : null
                    const style =
                      cat && wch != null
                        ? ({ width: `${wch}ch`, minWidth: `${wch}ch`, maxWidth: `${wch}ch` } as const)
                        : undefined
                    const sel = cur ? String(cur[attrRow.json_key] ?? '') : ''
                    const selLabel = sel ? attributeOptionLabel(attrRow, sel) : ''
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
                    return (
                      <td
                        key={`${keyPrefix}-${b.id}-${attrRow.kind_id}`}
                        style={style}
                        className={`px-0.5 py-1 align-middle ${cat ? '' : 'min-w-[4rem] max-w-[6.5rem]'}`}
                      >
                        <select
                          disabled={!checked}
                          value={sel}
                          onChange={(e) => setLineField(b.id, attrRow.json_key, e.target.value)}
                          title={
                            checked
                              ? `${attributeColumnHeaderLabel(attrRow)}: ${selLabel || '—'}`
                              : 'Select type first'
                          }
                          aria-label={`${attributeColumnHeaderLabel(attrRow)} for ${b.name}`}
                          className="h-8 w-full min-w-0 max-w-full truncate rounded-md border border-slate-200 bg-white px-0.5 text-center text-xs outline-none focus:border-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OrderAttachmentsBlock(props: {
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
                  className="font-medium text-teal-700 hover:underline"
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
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [paymentPending, setPaymentPending] = useState(false)
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [restoreOrderId, setRestoreOrderId] = useState<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)
  const [deletePaymentEntryId, setDeletePaymentEntryId] = useState<string | null>(null)
  const [deletePaymentPending, setDeletePaymentPending] = useState(false)
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<{
    orderId: string
    id: string
  } | null>(null)
  const [deleteAttachmentPending, setDeleteAttachmentPending] = useState(false)

  const [createPendingAttachments, setCreatePendingAttachments] = useState<PendingOrderAttachment[]>([])
  const [editAttachments, setEditAttachments] = useState<OrderAttachmentRow[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)

  const [editOrderId, setEditOrderId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editCustomerId, setEditCustomerId] = useState('')
  const [editEstimateId, setEditEstimateId] = useState<string | null>(null)
  const [editBlindsLines, setEditBlindsLines] = useState<BlindsLineState[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editExtraPaid, setEditExtraPaid] = useState(0)
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

  const computedTotalInclTax = useMemo(
    () => safeRound2(lineSubtotalParsed + (computedTaxAmount ?? 0)),
    [lineSubtotalParsed, computedTaxAmount],
  )
  const computedPaid = useMemo(() => safeRound2(dpParsed ?? 0), [dpParsed])
  const computedBalance = useMemo(
    () => safeRound2(computedTotalInclTax - computedPaid),
    [computedTotalInclTax, computedPaid],
  )

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

  const editTotalInclTax = useMemo(() => {
    if (!editDraft) return 0
    return safeRound2(editLineSubtotalParsed + (editComputedTaxAmount ?? 0))
  }, [editDraft, editLineSubtotalParsed, editComputedTaxAmount])
  const editPaidTotal = useMemo(() => {
    if (!editDraft) return 0
    return safeRound2((editDpParsed ?? 0) + editExtraPaid)
  }, [editDraft, editDpParsed, editExtraPaid])
  const editComputedBalance = useMemo(() => {
    if (!editDraft) return null
    return safeRound2(editTotalInclTax - editPaidTotal)
  }, [editDraft, editTotalInclTax, editPaidTotal])

  const viewPaidFormatted = useMemo(() => {
    if (!viewOrder) return '—'
    const down = parseMoneyAmount(viewOrder.downpayment) ?? 0
    const extra = parseMoneyAmount(viewOrder.final_payment) ?? 0
    return fmtMoney(safeRound2(down + extra))
  }, [viewOrder])

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
      setEditExtraPaid(0)
      setEditAttachments([])
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
        closeOrderView()
      }
      if (curEdit === oid) {
        setEditOrderId(null)
        setEditDraft(null)
        setEditCustomerId('')
        setEditEstimateId(null)
        setEditBlindsLines([])
        setEditExtraPaid(0)
        setEditAttachments([])
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete order')
    } finally {
      setDeletePending(false)
    }
  }

  async function runRestoreOrder() {
    if (!restoreOrderId || !canEdit) return
    const oid = restoreOrderId
    setRestorePending(true)
    setErr(null)
    try {
      await postJson(`/orders/${oid}/restore`, {})
      setRestoreOrderId(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not restore order')
    } finally {
      setRestorePending(false)
    }
  }

  async function submitRecordPayment() {
    if (!viewOrderId || !canEdit) return
    const amt = parseOptionalDecimal(paymentAmountInput.trim())
    if (amt == null || amt <= 0) {
      setErr('Enter a valid payment amount.')
      return
    }
    const oid = viewOrderId
    setPaymentPending(true)
    setErr(null)
    try {
      await postJson<OrderDetail>(`/orders/${oid}/record-payment`, { amount: amt })
      const d = await getJson<OrderDetail>(`/orders/${oid}`)
      setViewOrder(d)
      setPaymentModalOpen(false)
      setPaymentAmountInput('')
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setPaymentPending(false)
    }
  }

  async function runDeletePaymentEntry() {
    if (!deletePaymentEntryId || !viewOrderId || !canEdit) return
    const oid = viewOrderId
    const eid = deletePaymentEntryId
    setDeletePaymentPending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${oid}/payment-entries/${eid}`)
      const d = await getJson<OrderDetail>(`/orders/${oid}`)
      setViewOrder(d)
      setDeletePaymentEntryId(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove payment')
    } finally {
      setDeletePaymentPending(false)
    }
  }

  async function runDeleteAttachment() {
    if (!deleteAttachmentTarget || !canEdit) return
    const { orderId, id } = deleteAttachmentTarget
    setDeleteAttachmentPending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${orderId}/attachments/${id}`)
      if (viewOrderId === orderId) {
        const d = await getJson<OrderDetail>(`/orders/${orderId}`)
        setViewOrder(d)
      }
      if (editOrderId === orderId) {
        const d = await getJson<OrderDetail>(`/orders/${orderId}`)
        setEditAttachments(d.attachments ?? [])
      }
      setDeleteAttachmentTarget(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove attachment')
    } finally {
      setDeleteAttachmentPending(false)
    }
  }

  const closeOrderView = () => {
    setViewOrderId(null)
    setViewOrder(null)
    setPaymentModalOpen(false)
    setPaymentAmountInput('')
  }

  useEffect(() => {
    if (!paymentModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !paymentPending) {
        setPaymentModalOpen(false)
        setPaymentAmountInput('')
      }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [paymentModalOpen, paymentPending])

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
      setEditExtraPaid(0)
      setEditAttachments([])
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
          setEditExtraPaid(safeRound2(parseMoneyAmount(d.final_payment) ?? 0))
          setEditAttachments(d.attachments ?? [])
        }
      } catch {
        if (!c) {
          setEditDraft(null)
          setEditCustomerId('')
          setEditEstimateId(null)
          setEditBlindsLines([])
          setEditExtraPaid(0)
          setEditAttachments([])
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
    setCreatePendingAttachments([])
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
    if (t === '') {
      setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: null } : x)))
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)))
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
    const next = sanitizeLineAmountInput(value)
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
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
    if (t === '') {
      setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: null } : x)))
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)))
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
    const next = sanitizeLineAmountInput(value)
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
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
    const pendingAtt = [...createPendingAttachments]
    try {
      const created = await postJson<OrderDetail>('/orders', {
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
      for (const p of pendingAtt) {
        const fd = new FormData()
        fd.append('kind', p.kind)
        fd.append('file', p.file)
        await postMultipartJson(`/orders/${created.id}/attachments`, fd)
      }
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
            <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
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
              {blindsLines.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
              ) : null}
            </fieldset>
            <label className="block w-full min-w-0 text-sm text-slate-700 sm:col-span-2">
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
            <div className="space-y-3 sm:col-span-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Total (incl. tax)</span>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                    {fmtTotalIncludingTax(lineSubtotalParsed, computedTaxAmount)}
                  </p>
                </div>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Down payment</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={downpayment}
                    onChange={(e) => setDownpayment(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Taxable base</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={taxBaseAmount}
                    onChange={(e) => setTaxBaseAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
              <OrderFinancialSecondRow
                paidDisplay={fmtMoney(computedPaid)}
                balance={computedBalance}
                tax={computedTaxAmount}
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
            <div className="sm:col-span-2">
              <OrderAttachmentsBlock
                blockId="new-order-att"
                orderId={null}
                serverFiles={[]}
                pendingFiles={createPendingAttachments}
                onPendingChange={setCreatePendingAttachments}
                canEdit={canEdit}
                uploadBusy={attachmentUploadBusy || saving}
                setUploadBusy={setAttachmentUploadBusy}
                onAfterServerMutation={async () => {}}
                setErr={setErr}
                onRequestDeleteAttachment={() => {}}
              />
            </div>
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
                <th className="whitespace-nowrap px-2 py-3 sm:px-4" title="Down payment plus recorded payments">
                  Paid
                </th>
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
                    <td className="px-2 py-3 sm:px-4">{orderListPaidDisplay(r)}</td>
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
                            onClick={() => setRestoreOrderId(r.id)}
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
            onClick={closeOrderView}
          />
          <div className="relative max-h-[92vh] w-full min-w-0 max-w-2xl overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white shadow-2xl sm:rounded-2xl">
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
                onClick={closeOrderView}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="max-h-[calc(92vh-5.5rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-5 sm:px-6">
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
                          onClick={closeOrderView}
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
                            onClick={closeOrderView}
                          >
                            {viewOrder.estimate_id}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="block min-w-0 text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Total (incl. tax)</span>
                        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                          {fmtTotalIncludingTax(viewOrder.total_amount, viewOrder.tax_amount)}
                        </p>
                      </div>
                      <div className="block min-w-0 text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Down payment</span>
                        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                          {fmtMoney(viewOrder.downpayment)}
                        </p>
                      </div>
                      <div className="block min-w-0 text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Taxable base</span>
                        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                          {fmtMoney(viewOrder.tax_uygulanacak_miktar)}
                        </p>
                      </div>
                    </div>
                    <OrderFinancialSecondRow
                      paidDisplay={viewPaidFormatted}
                      balance={viewOrder.balance}
                      tax={viewOrder.tax_amount}
                      belowBalance={
                        canEdit && viewOrder.active !== false ? (
                          <button
                            type="button"
                            className="w-full rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm font-medium text-teal-800 shadow-sm hover:bg-teal-50 disabled:opacity-50"
                            onClick={() => {
                              setPaymentAmountInput('')
                              setPaymentModalOpen(true)
                            }}
                          >
                            Payment
                          </button>
                        ) : undefined
                      }
                    />
                  </div>

                  {viewOrder.payment_entries && viewOrder.payment_entries.length > 0 ? (
                    <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Recorded payments
                      </h3>
                      <ul className="mt-2 divide-y divide-slate-100">
                        {viewOrder.payment_entries.map((p) => (
                          <li
                            key={p.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-medium tabular-nums text-slate-900">{fmtMoney(p.amount)}</span>
                              {p.id === 'downpayment' ? (
                                <span className="ml-2 text-xs font-normal text-slate-500">Down payment</span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-slate-500">{fmtDisplayDateTime(p.paid_at)}</span>
                              {canEdit && viewOrder.active !== false && p.id !== 'downpayment' ? (
                                <button
                                  type="button"
                                  title="Remove payment"
                                  className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                                  onClick={() => setDeletePaymentEntryId(p.id)}
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

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

                  {viewOrderId ? (
                    <OrderAttachmentsBlock
                      blockId="view-order-att"
                      orderId={viewOrderId}
                      serverFiles={viewOrder.attachments ?? []}
                      pendingFiles={[]}
                      onPendingChange={() => {}}
                      canEdit={canEdit && viewOrder.active !== false}
                      uploadBusy={attachmentUploadBusy}
                      setUploadBusy={setAttachmentUploadBusy}
                      onAfterServerMutation={async () => {
                        const d = await getJson<OrderDetail>(`/orders/${viewOrderId}`)
                        setViewOrder(d)
                      }}
                      setErr={setErr}
                      onRequestDeleteAttachment={(id) =>
                        setDeleteAttachmentTarget({ orderId: viewOrderId, id })
                      }
                    />
                  ) : null}

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
                          closeOrderView()
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
                setEditExtraPaid(0)
                setEditAttachments([])
              }
            }}
          />
          <div className="relative max-h-[92vh] w-full min-w-0 max-w-2xl overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
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
                  setEditExtraPaid(0)
                  setEditAttachments([])
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(92vh-4rem)] min-w-0 overflow-x-hidden overflow-y-auto px-5 py-4">
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
                    <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
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
                      {editBlindsLines.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
                      ) : null}
                    </fieldset>
                    <label className="block w-full min-w-0 text-sm text-slate-700 sm:col-span-2">
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
                    <div className="space-y-3 sm:col-span-2">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="block min-w-0 text-sm text-slate-700">
                          <span className="mb-1 block font-medium">Total (incl. tax)</span>
                          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                            {fmtTotalIncludingTax(editLineSubtotalParsed, editComputedTaxAmount)}
                          </p>
                        </div>
                        <label className="block min-w-0 text-sm text-slate-700">
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
                        <label className="block min-w-0 text-sm text-slate-700">
                          <span className="mb-1 block font-medium">Taxable base</span>
                          <input
                            inputMode="decimal"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                            value={editDraft.tax_base}
                            onChange={(e) =>
                              setEditDraft((d) => (d ? { ...d, tax_base: e.target.value } : d))
                            }
                            placeholder="0.00"
                          />
                        </label>
                      </div>
                      <OrderFinancialSecondRow
                        paidDisplay={fmtMoney(editPaidTotal)}
                        balance={editComputedBalance}
                        tax={editComputedTaxAmount}
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
                    {editOrderId ? (
                      <div className="sm:col-span-2">
                        <OrderAttachmentsBlock
                          blockId="edit-order-att"
                          orderId={editOrderId}
                          serverFiles={editAttachments}
                          pendingFiles={[]}
                          onPendingChange={() => {}}
                          canEdit={canEdit}
                          uploadBusy={attachmentUploadBusy || editSaving}
                          setUploadBusy={setAttachmentUploadBusy}
                          onAfterServerMutation={async () => {
                            const d = await getJson<OrderDetail>(`/orders/${editOrderId}`)
                            setEditAttachments(d.attachments ?? [])
                          }}
                          setErr={setErr}
                          onRequestDeleteAttachment={(id) =>
                            setDeleteAttachmentTarget({ orderId: editOrderId, id })
                          }
                        />
                      </div>
                    ) : null}
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
                        setEditExtraPaid(0)
                        setEditAttachments([])
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

      {paymentModalOpen && viewOrderId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (!paymentPending && e.target === e.currentTarget) {
              setPaymentModalOpen(false)
              setPaymentAmountInput('')
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-modal-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="payment-modal-title" className="text-lg font-semibold text-slate-900">
              Record payment
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter the amount to record. It cannot exceed the current balance due.
            </p>
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Amount</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
                placeholder="0.00"
                disabled={paymentPending}
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={paymentPending}
                onClick={() => {
                  setPaymentModalOpen(false)
                  setPaymentAmountInput('')
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paymentPending}
                onClick={() => void submitRecordPayment()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paymentPending ? 'Saving…' : 'Pay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deletePaymentEntryId !== null}
        title="Remove this payment?"
        description="This payment line will be removed and the order balance will be recalculated. You cannot restore it from the app."
        confirmLabel="Remove payment"
        cancelLabel="Cancel"
        variant="danger"
        pending={deletePaymentPending}
        onConfirm={() => void runDeletePaymentEntry()}
        onCancel={() => !deletePaymentPending && setDeletePaymentEntryId(null)}
      />

      <ConfirmModal
        open={deleteAttachmentTarget !== null}
        title="Remove this file?"
        description="The attachment will no longer appear on this order."
        confirmLabel="Remove file"
        cancelLabel="Cancel"
        variant="danger"
        pending={deleteAttachmentPending}
        onConfirm={() => void runDeleteAttachment()}
        onCancel={() => !deleteAttachmentPending && setDeleteAttachmentTarget(null)}
      />

      <ConfirmModal
        open={restoreOrderId !== null}
        title="Restore this order?"
        description="The order will show in the default list again as active."
        confirmLabel="Restore order"
        cancelLabel="Cancel"
        pending={restorePending}
        onConfirm={() => void runRestoreOrder()}
        onCancel={() => !restorePending && setRestoreOrderId(null)}
      />

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
