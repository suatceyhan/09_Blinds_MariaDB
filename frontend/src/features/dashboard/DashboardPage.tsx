import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CalendarDays, Clock, Database, Sparkles } from 'lucide-react'
import { getJson } from '@/lib/api'

type Health = { status?: string }

type DashboardSummary = {
  today_estimates: Array<{
    id: string
    customer_id: string
    customer_display?: string | null
    blinds_summary?: string | null
    scheduled_start_at?: string | null
    tarih_saat?: string | null
  }>
  week_estimate_count: number
  order_age_buckets: Array<{ label: string; count: number }>
  ready_waiting: Array<{
    id: string
    customer_id: string
    status_code?: string | null
    ready_at?: string | null
    created_at: string
    waiting_days: number
  }>
  open_orders_count: number
  balance_due_total: number
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

function estimateTime(e: DashboardSummary['today_estimates'][number]): string {
  return fmtDateTime(e.scheduled_start_at ?? e.tarih_saat ?? null)
}

function StatValue(props: Readonly<{ err: string | null; loading: boolean; children: React.ReactNode }>) {
  if (props.err) return <span className="text-red-600">{props.err}</span>
  if (props.loading) return <span className="text-slate-400">Loading…</span>
  return <>{props.children}</>
}

function ApiHealthValue(props: Readonly<{ err: string | null; health: Health | null }>) {
  if (props.err) return <span className="text-red-600">{props.err}</span>
  if (!props.health) return <span className="text-slate-400">Checking…</span>
  return (
    <span className="font-medium text-emerald-700">
      Running ({props.health.status ?? 'ok'})
    </span>
  )
}

export function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [sum, setSum] = useState<DashboardSummary | null>(null)
  const [sumErr, setSumErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const h = await getJson<Health>('/health')
        if (!cancelled) {
          setHealth(h)
          setHealthErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null)
          setHealthErr(e instanceof Error ? e.message : 'API unavailable')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const readyTop = useMemo(() => (sum?.ready_waiting ?? []).slice(0, 8), [sum])
  const upcomingTop = useMemo(() => (sum?.upcoming_installations ?? []).slice(0, 8), [sum])
  const isLoadingSummary = !sum && !sumErr

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-600">
          Today’s estimates, order aging, and ready-to-install waiting time at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">API</p>
              <p className="text-xs text-slate-500">FastAPI · /health</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <ApiHealthValue err={healthErr} health={health} />
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Open orders</p>
              <p className="text-xs text-slate-500">Active jobs</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <StatValue err={sumErr} loading={isLoadingSummary}>
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {sum?.open_orders_count ?? 0}
              </span>
            </StatValue>
          </p>
        </div>

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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">This week</p>
              <p className="text-xs text-slate-500">Estimates scheduled</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <StatValue err={sumErr} loading={isLoadingSummary}>
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {sum?.week_estimate_count ?? 0}
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
              <p className="text-sm font-medium text-slate-900">Today</p>
              <p className="text-xs text-slate-500">Estimates</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <StatValue err={sumErr} loading={isLoadingSummary}>
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {sum?.today_estimates.length ?? 0}
              </span>
            </StatValue>
          </p>
        </div>

        <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/50 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-teal-900">Widgets</p>
              <p className="text-xs text-teal-700/80">Modern status snapshots</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-teal-900/90">
            Estimates, aging, and ready-to-install queues are now live.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm lg:col-span-2">
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

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {(sum?.order_age_buckets ?? []).map((b) => (
              <div key={b.label} className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3">
                <p className="text-xs font-medium text-slate-600">{b.label}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{b.count}</p>
              </div>
            ))}
            {isLoadingSummary ? <div className="sm:col-span-4 text-sm text-slate-400">Loading…</div> : null}
            {sumErr ? <div className="sm:col-span-4 text-sm text-red-600">{sumErr}</div> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-900">Ready → waiting installation</p>
          <p className="mt-1 text-xs text-slate-500">Top items by waiting days</p>

          <div className="mt-4 space-y-2">
            {sumErr ? <div className="text-sm text-red-600">{sumErr}</div> : null}
          {isLoadingSummary ? <div className="text-sm text-slate-400">Loading…</div> : null}
            {sum && readyTop.length === 0 ? (
              <div className="text-sm text-slate-500">No ready orders waiting.</div>
            ) : null}
            {readyTop.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">Order {r.id}</p>
                  <p className="truncate text-xs text-slate-500">Customer {r.customer_id}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">{r.waiting_days}d</p>
                  <p className="text-xs text-slate-500">{fmtDateTime(r.ready_at ?? r.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

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
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {r.customer_display?.trim() ? r.customer_display : `Customer ${r.customer_id}`}
                  </p>
                  <p className="truncate text-xs text-slate-500">Order {r.id}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm text-slate-700">{fmtDateTime(r.installation_scheduled_start_at ?? null)}</p>
                  <Link to={`/orders?viewOrder=${r.id}`} className="text-xs font-medium text-teal-700 hover:underline">
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-slate-900">Today’s estimates</p>
        <p className="mt-1 text-xs text-slate-500">Scheduled from app (or legacy tarih_saat fallback)</p>

        <div className="mt-4 space-y-2">
          {sumErr ? <div className="text-sm text-red-600">{sumErr}</div> : null}
          {isLoadingSummary ? <div className="text-sm text-slate-400">Loading…</div> : null}
          {sum?.today_estimates.length === 0 ? (
            <div className="text-sm text-slate-500">No estimates scheduled for today.</div>
          ) : null}
          {(sum?.today_estimates ?? []).slice(0, 12).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">
                  {e.customer_display?.trim() ? e.customer_display : 'Customer'}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {e.blinds_summary?.trim() ? e.blinds_summary : '—'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm text-slate-700">{estimateTime(e)}</p>
                <Link
                  to={`/estimates/${e.id}`}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
