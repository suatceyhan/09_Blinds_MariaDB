import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Clock, Database } from 'lucide-react'
import { getJson } from '@/lib/api'

type DashboardSummary = {
  week_estimate_count: number
  week_order_count: number
  new_estimates_count: number
  pending_estimates_count: number
  upcoming_estimates: Array<{
    id: string
    customer_id: string
    customer_display?: string | null
    blinds_summary?: string | null
    scheduled_start_at?: string | null
    tarih_saat?: string | null
  }>
  order_age_buckets: Array<{ label: string; count: number }>
  open_orders_count: number
  balance_due_total: number
  ready_install_with_date_count: number
  ready_install_missing_date_count: number
  estimate_conversion_last_3_months: Array<{
    month: string
    converted_count: number
    total_count: number
    percent: number
  }>
  customer_sources_last_3_months: Array<{
    month: string
    advertising_count: number
    referral_count: number
    total_count: number
  }>
  upcoming_installations: Array<{
    id: string
    customer_id: string
    customer_display?: string | null
    installation_scheduled_start_at?: string | null
  }>
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (!Number.isFinite(v)) return String(v)
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatValue(props: Readonly<{ err: string | null; loading: boolean; children: React.ReactNode }>) {
  if (props.err) return <span className="text-red-600">{props.err}</span>
  if (props.loading) return <span className="text-slate-400">Loading…</span>
  return <>{props.children}</>
}

function fmtMonthLabel(v: string): string {
  const d = new Date(`${v}-01T00:00:00`)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString(undefined, { month: 'short', year: 'numeric' })
}

function fmtPercent(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(0)}%`
}

function EstimateToOrderWidget(props: Readonly<{ sum: DashboardSummary | null; err: string | null; loading: boolean }>) {
  const { sum, err, loading } = props
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">Estimate → Order</p>
          <p className="text-xs text-slate-500">Last 3 months</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
        {loading ? <div className="text-sm text-slate-400">Loading…</div> : null}
        {!loading && !err && (sum?.estimate_conversion_last_3_months?.length ?? 0) === 0 ? (
          <div className="text-sm text-slate-500">No estimate data.</div>
        ) : null}
        {(sum?.estimate_conversion_last_3_months ?? []).map((r) => (
          <div
            key={r.month}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-700">{r.month}</div>
              <div className="text-[11px] text-slate-500">
                {r.converted_count} / {r.total_count} converted
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-slate-900">{r.percent.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CustomerSourcesWidget(props: Readonly<{ sum: DashboardSummary | null; err: string | null; loading: boolean }>) {
  const { sum, err, loading } = props
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">Customer sources</p>
          <p className="text-xs text-slate-500">Last 3 months (estimates)</p>
        </div>
      </div>

      <div className="mt-4">
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
        {loading ? <div className="text-sm text-slate-400">Loading…</div> : null}
        {!loading && !err && (sum?.customer_sources_last_3_months?.length ?? 0) === 0 ? (
          <div className="text-sm text-slate-500">No estimate data.</div>
        ) : null}

        {!loading && !err ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200/70">
            <div className="grid grid-cols-3 bg-slate-50/60 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Month</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Advertising</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Referral</div>
            </div>
            {(sum?.customer_sources_last_3_months ?? []).map((r, idx) => {
              const total = r.total_count || 0
              const advPct = total > 0 ? (r.advertising_count / total) * 100 : 0
              const refPct = total > 0 ? (r.referral_count / total) * 100 : 0
              return (
                <div
                  key={r.month}
                  className={[
                    'grid grid-cols-3 px-3 py-2',
                    idx === 0 ? '' : 'border-t border-slate-200/70',
                    'bg-white',
                  ].join(' ')}
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate text-xs font-semibold text-slate-700">{fmtMonthLabel(r.month)}</div>
                  </div>

                  <div className="min-w-0 pr-2">
                    <div className="text-xs font-semibold tabular-nums text-slate-900">{r.advertising_count}</div>
                    <div className="text-[11px] text-slate-500">{fmtPercent(advPct)}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-semibold tabular-nums text-slate-900">{r.referral_count}</div>
                    <div className="text-[11px] text-slate-500">{fmtPercent(refPct)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const [sum, setSum] = useState<DashboardSummary | null>(null)
  const [sumErr, setSumErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getJson<DashboardSummary>('/dashboard/summary')
        if (!cancelled) {
          setSum(s)
          setSumErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setSum(null)
          setSumErr(e instanceof Error ? e.message : 'Dashboard unavailable')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const upcomingTop = useMemo(() => (sum?.upcoming_installations ?? []).slice(0, 8), [sum])
  const upcomingEstTop = useMemo(() => (sum?.upcoming_estimates ?? []).slice(0, 8), [sum])
  const isLoadingSummary = !sum && !sumErr

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-600">
          Orders, installations, and key totals at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Balance due</p>
              <p className="text-xs text-slate-500">Across active orders</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <StatValue err={sumErr} loading={isLoadingSummary}>
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {fmtMoney(sum?.balance_due_total ?? 0)}
              </span>
            </StatValue>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Estimates</p>
              <p className="text-xs text-slate-500">New + Pending</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              to="/estimates?status=new"
              className="rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              title="View New estimates"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">New</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                <StatValue err={sumErr} loading={isLoadingSummary}>
                  {sum?.new_estimates_count ?? 0}
                </StatValue>
              </div>
            </Link>
            <Link
              to="/estimates?status=pending"
              className="rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              title="View Pending estimates"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pending</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                <StatValue err={sumErr} loading={isLoadingSummary}>
                  {sum?.pending_estimates_count ?? 0}
                </StatValue>
              </div>
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Orders</p>
              <p className="text-xs text-slate-500">Ready for installation</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link
              to="/orders?ready_install=with_date"
              className="rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              title="View ready-for-installation orders with installation date"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">With date</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                <StatValue err={sumErr} loading={isLoadingSummary}>
                  {sum?.ready_install_with_date_count ?? 0}
                </StatValue>
              </div>
            </Link>
            <Link
              to="/orders?ready_install=missing_date"
              className="rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
              title="View ready-for-installation orders missing installation date"
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Missing date</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                <StatValue err={sumErr} loading={isLoadingSummary}>
                  {sum?.ready_install_missing_date_count ?? 0}
                </StatValue>
              </div>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Order aging</p>
                <p className="text-xs text-slate-500">How long since order creation</p>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(sum?.order_age_buckets ?? []).map((b) => (
              <Link
                key={b.label}
                to={`/orders?age_bucket=${encodeURIComponent(b.label)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 px-3 py-2"
                title={`View orders created ${b.label}`}
              >
                <p className="text-xs font-medium text-slate-600">{b.label}</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">{b.count}</p>
              </Link>
            ))}
            {isLoadingSummary ? <div className="text-sm text-slate-400">Loading…</div> : null}
            {sumErr ? <div className="text-sm text-red-600">{sumErr}</div> : null}
          </div>
        </div>

        <EstimateToOrderWidget sum={sum} err={sumErr} loading={isLoadingSummary} />
        <CustomerSourcesWidget sum={sum} err={sumErr} loading={isLoadingSummary} />

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-3">
          <p className="text-sm font-medium text-slate-900">Upcoming installations</p>
          <p className="mt-1 text-xs text-slate-500">Next 7 days (scheduled)</p>

          <div className="mt-4 space-y-2">
            {sumErr ? <div className="text-sm text-red-600">{sumErr}</div> : null}
            {isLoadingSummary ? <div className="text-sm text-slate-400">Loading…</div> : null}
            {sum && upcomingTop.length === 0 ? (
              <div className="text-sm text-slate-500">No installations scheduled.</div>
            ) : null}
            {upcomingTop.map((r) => (
              <Link
                key={r.id}
                to={`/orders?viewOrder=${encodeURIComponent(r.id)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
                title="Open order"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {r.customer_display?.trim() ? r.customer_display : `Customer ${r.customer_id}`}
                  </p>
                  <p className="truncate text-xs text-slate-500">Order {r.id}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-slate-700">{fmtDateTime(r.installation_scheduled_start_at ?? null)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-3">
          <p className="text-sm font-medium text-slate-900">Upcoming estimates</p>
          <p className="mt-1 text-xs text-slate-500">Next scheduled visits</p>

          <div className="mt-4 space-y-2">
            {sumErr ? <div className="text-sm text-red-600">{sumErr}</div> : null}
            {isLoadingSummary ? <div className="text-sm text-slate-400">Loading…</div> : null}
            {sum && upcomingEstTop.length === 0 ? (
              <div className="text-sm text-slate-500">No upcoming estimates scheduled.</div>
            ) : null}
            {upcomingEstTop.map((e) => (
              <Link
                key={e.id}
                to={`/estimates/${encodeURIComponent(e.id)}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-200"
                title="Open estimate"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {e.customer_display?.trim() ? e.customer_display : `Customer ${e.customer_id}`}
                  </p>
                  <p className="truncate text-xs text-slate-500">{e.blinds_summary?.trim() ? e.blinds_summary : '—'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-slate-700">{fmtDateTime(e.scheduled_start_at ?? e.tarih_saat ?? null)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
