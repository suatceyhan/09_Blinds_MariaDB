import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, DollarSign, LineChart } from 'lucide-react'
import { getJson } from '@/lib/api'

type FinancialSummary = {
  range_from: string
  range_to: string
  revenue_total: number
  collected_total: number
  balance_total: number
  tax_total: number
  taxable_base_total: number
  expense_total: number
  profit_total: number
  orders_count: number
}

type ARSummary = {
  range_from: string
  range_to: string
  balance_total: number
  positive_balance_orders: number
  top: Array<{ order_id: string; customer_display: string; balance: number }>
}

type Timeseries = {
  range_from: string
  range_to: string
  group: 'daily' | 'weekly'
  points: Array<{ d: string; revenue: number; collected: number }>
}

type Monthly = {
  range_from: string
  range_to: string
  points: Array<{ month: string; revenue: number; expense: number; tax: number; profit: number }>
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (!Number.isFinite(v)) return String(v)
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Preset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'last_30' | 'custom'

function computePreset(p: Preset): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = (() => {
    const d = new Date(today)
    const day = d.getDay() // 0..6 (Sun..Sat)
    const mondayOffset = (day + 6) % 7
    d.setDate(d.getDate() - mondayOffset)
    return d
  })()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)

  if (p === 'today') return { from: isoDate(today), to: isoDate(today) }
  if (p === 'this_week') return { from: isoDate(startOfWeek), to: isoDate(today) }
  if (p === 'this_month') return { from: isoDate(startOfMonth), to: isoDate(today) }
  if (p === 'last_month') return { from: isoDate(startOfLastMonth), to: isoDate(endOfLastMonth) }
  if (p === 'last_30') {
    const from = new Date(today)
    from.setDate(from.getDate() - 29)
    return { from: isoDate(from), to: isoDate(today) }
  }
  return { from: isoDate(today), to: isoDate(today) }
}

export function FinancialReportsPage() {
  const [preset, setPreset] = useState<Preset>('last_30')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [group, setGroup] = useState<'daily' | 'weekly'>('daily')

  const range = useMemo(() => {
    if (preset !== 'custom') return computePreset(preset)
    const fallback = computePreset('last_30')
    return { from: customFrom.trim() || fallback.from, to: customTo.trim() || fallback.to }
  }, [preset, customFrom, customTo])

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    p.set('from_date', range.from)
    p.set('to_date', range.to)
    p.set('group', group)
    return p.toString()
  }, [range.from, range.to, group])

  const [sum, setSum] = useState<FinancialSummary | null>(null)
  const [ar, setAr] = useState<ARSummary | null>(null)
  const [ts, setTs] = useState<Timeseries | null>(null)
  const [monthly, setMonthly] = useState<Monthly | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const [a, b, t, m] = await Promise.all([
          getJson<FinancialSummary>(`/reports/financial/summary?${qs}`),
          getJson<ARSummary>(`/reports/financial/ar?${qs}`),
          getJson<Timeseries>(`/reports/financial/timeseries?${qs}`),
          getJson<Monthly>(`/reports/financial/monthly?${qs}`),
        ])
        if (!c) {
          setSum(a)
          setAr(b)
          setTs(t)
          setMonthly(m)
        }
      } catch (e) {
        if (!c) {
          setErr(e instanceof Error ? e.message : 'Could not load reports')
          setSum(null)
          setAr(null)
          setTs(null)
          setMonthly(null)
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [qs])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <BarChart3 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Financial reports</h1>
            <p className="mt-1 text-sm text-slate-600">Revenue, collected cash, A/R, profit, tax, and trends.</p>
          </div>
        </div>

        <div className="w-full max-w-none rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm lg:max-w-[44rem]">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Range</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    ['last_30', 'Last 30 days'],
                    ['this_month', 'This month'],
                    ['last_month', 'Last month'],
                    ['this_week', 'This week'],
                    ['today', 'Today'],
                    ['custom', 'Custom'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                      preset === id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                    }`}
                    aria-pressed={preset === id}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {preset === 'custom' ? (
              <div className="flex flex-wrap gap-2">
                <label className="block">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">From</div>
                  <input
                    type="date"
                    className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label className="block">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">To</div>
                  <input
                    type="date"
                    className="mt-1 h-9 rounded-lg border border-slate-200 px-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="ml-auto flex items-center gap-2 text-xs text-slate-600">
                <CalendarDays className="h-4 w-4 text-slate-400" strokeWidth={2} />
                <span className="font-semibold text-slate-800">{range.from}</span>
                <span className="text-slate-400">→</span>
                <span className="font-semibold text-slate-800">{range.to}</span>
              </div>
            )}

            <div className="ml-auto flex items-end gap-2">
              <label className="block">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Trend</div>
                <select
                  className="mt-1 h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={group}
                  onChange={(e) => setGroup(e.target.value === 'weekly' ? 'weekly' : 'daily')}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>

      {err ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard icon={DollarSign} title="Revenue" subtitle="Total (incl. tax)" loading={loading} value={fmtMoney(sum?.revenue_total ?? 0)} />
        <MetricCard icon={DollarSign} title="Collected" subtitle="Down + payments" loading={loading} value={fmtMoney(sum?.collected_total ?? 0)} />
        <MetricCard icon={DollarSign} title="A/R balance" subtitle="Outstanding" loading={loading} value={fmtMoney(ar?.balance_total ?? 0)} />
        <MetricCard icon={DollarSign} title="Profit" subtitle="Revenue − expenses" loading={loading} value={fmtMoney(sum?.profit_total ?? 0)} />
        <MetricCard icon={DollarSign} title="Tax" subtitle="Tax amount total" loading={loading} value={fmtMoney(sum?.tax_total ?? 0)} />
        <MetricCard icon={DollarSign} title="Taxable base" subtitle="Tax base total" loading={loading} value={fmtMoney(sum?.taxable_base_total ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <LineChart className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Trend</p>
              <p className="text-xs text-slate-500">Revenue vs collected ({group})</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-3 py-6 text-slate-500" colSpan={3}>
                      Loading…
                    </td>
                  </tr>
                ) : (
                  (ts?.points ?? []).slice(-24).map((p) => (
                    <tr key={p.d} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-800">{p.d}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.revenue)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.collected)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {!loading && (ts?.points ?? []).length > 24 ? (
              <p className="mt-2 text-[11px] text-slate-500">Showing the last 24 points in the selected range.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900">Top outstanding balances</p>
              <p className="mt-1 text-xs text-slate-500">
                {loading ? '—' : `${ar?.positive_balance_orders ?? 0} orders with positive balance`}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
            {!loading && (ar?.top ?? []).length === 0 ? <p className="text-sm text-slate-500">No balances due.</p> : null}
            {(ar?.top ?? []).map((r) => (
              <div
                key={r.order_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{r.customer_display}</div>
                  <div className="text-[11px] text-slate-500">Order {r.order_id}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(r.balance)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 text-slate-700">
            <DollarSign className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">Monthly breakdown</p>
            <p className="text-xs text-slate-500">Revenue, expenses, tax, and profit grouped by month.</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Revenue</th>
                <th className="px-3 py-2">Expenses</th>
                <th className="px-3 py-2">Tax</th>
                <th className="px-3 py-2">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : (monthly?.points ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={5}>
                    No data in this range.
                  </td>
                </tr>
              ) : (
                (monthly?.points ?? []).map((p) => (
                  <tr key={p.month} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800">{p.month}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.expense)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.tax)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(p.profit)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MetricCard(props: Readonly<{
  icon: typeof DollarSign
  title: string
  subtitle: string
  value: string
  loading: boolean
}>) {
  const Icon = props.icon
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-700">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">{props.title}</p>
          <p className="text-xs text-slate-500">{props.subtitle}</p>
        </div>
      </div>
      <div className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        {props.loading ? <span className="text-slate-400">Loading…</span> : props.value}
      </div>
    </div>
  )
}

