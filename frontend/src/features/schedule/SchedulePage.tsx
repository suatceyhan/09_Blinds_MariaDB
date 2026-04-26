import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson } from '@/lib/api'
import { fmtDisplayDateTime, type OrderRow } from '@/features/orders/ordersShared'
import type { EstimateRow } from '@/features/estimates/EstimatesPage'

type ScheduleView = 'day' | 'week' | 'month' | 'agenda'

type ScheduleEvent = {
  id: string
  kind: 'estimate' | 'installation'
  startAtIso: string
  title: string
  subtitle: string
  href: string
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addLocalDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

function addLocalMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1)
}

function clampRangeForView(view: ScheduleView, anchor: Date): { start: Date; end: Date } {
  const a = startOfLocalDay(anchor)
  if (view === 'day') return { start: a, end: addLocalDays(a, 1) }
  if (view === 'week') {
    const dow = a.getDay() // 0 Sun
    const mondayOffset = (dow + 6) % 7
    const start = addLocalDays(a, -mondayOffset)
    return { start, end: addLocalDays(start, 7) }
  }
  if (view === 'agenda') return { start: a, end: addLocalDays(a, 30) }
  // month
  const start = new Date(a.getFullYear(), a.getMonth(), 1)
  const end = new Date(a.getFullYear(), a.getMonth() + 1, 1)
  return { start, end }
}

function fmtRangeTitle(view: ScheduleView, anchor: Date): string {
  const a = startOfLocalDay(anchor)
  if (view === 'day') {
    return a.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
  }
  if (view === 'week') {
    const { start, end } = clampRangeForView('week', a)
    const endPrev = addLocalDays(end, -1)
    const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const right = endPrev.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${left} – ${right}`
  }
  if (view === 'agenda') {
    const { start, end } = clampRangeForView('agenda', a)
    const endPrev = addLocalDays(end, -1)
    const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const right = endPrev.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${left} – ${right}`
  }
  return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function viewStep(view: ScheduleView): 'day' | 'week' | 'month' {
  if (view === 'month') return 'month'
  if (view === 'week') return 'week'
  return 'day'
}

function shiftAnchor(anchor: Date, view: ScheduleView, dir: -1 | 1): Date {
  const a = startOfLocalDay(anchor)
  const step = viewStep(view)
  if (step === 'month') return addLocalMonths(a, dir)
  if (step === 'week') return addLocalDays(a, dir * 7)
  return addLocalDays(a, dir)
}

function eventTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function minutesSinceStartOfLocalDay(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours() * 60 + d.getMinutes()
}

function ymdKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const EVENT_DEFAULT_DURATION_MINUTES = 60
const PX_PER_HOUR = 56

export function SchedulePage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('schedule.view'))

  const [view, setView] = useState<ScheduleView>('month')
  const [anchor, setAnchor] = useState<Date>(() => startOfLocalDay(new Date()))
  const range = useMemo(() => clampRangeForView(view, anchor), [view, anchor])

  const [estimateRows, setEstimateRows] = useState<EstimateRow[] | null>(null)
  const [orderRows, setOrderRows] = useState<OrderRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!me || !canView) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const [ests, ords] = await Promise.all([
          getJson<EstimateRow[]>('/estimates?limit=500&schedule_filter=all'),
          getJson<OrderRow[]>('/orders?limit=500'),
        ])
        if (cancelled) return
        setEstimateRows(ests)
        setOrderRows(ords)
      } catch (e) {
        if (!cancelled) {
          setEstimateRows([])
          setOrderRows([])
          setErr(e instanceof Error ? e.message : 'Could not load schedule')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canView])

  const events = useMemo((): ScheduleEvent[] => {
    const out: ScheduleEvent[] = []
    const startMs = range.start.getTime()
    const endMs = range.end.getTime()

    for (const r of estimateRows ?? []) {
      const iso = String(r.scheduled_start_at ?? r.tarih_saat ?? '').trim()
      if (!iso) continue
      const t = new Date(iso).getTime()
      if (!Number.isFinite(t) || t < startMs || t >= endMs) continue
      out.push({
        id: r.id,
        kind: 'estimate',
        startAtIso: iso,
        title: r.customer_display?.trim() ? r.customer_display : 'Estimate',
        subtitle: 'Estimate visit',
        href: `/estimates/${encodeURIComponent(r.id)}`,
      })
    }

    for (const r of orderRows ?? []) {
      const iso = String(r.installation_scheduled_start_at ?? '').trim()
      if (!iso) continue
      const t = new Date(iso).getTime()
      if (!Number.isFinite(t) || t < startMs || t >= endMs) continue
      out.push({
        id: r.id,
        kind: 'installation',
        startAtIso: iso,
        title: r.customer_display?.trim() ? r.customer_display : 'Installation',
        subtitle: 'Installation',
        href: `/orders?viewOrder=${encodeURIComponent(r.id)}`,
      })
    }

    return out.sort((a, b) => a.startAtIso.localeCompare(b.startAtIso))
  }, [estimateRows, orderRows, range.end, range.start])

  const eventsByDayKey = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {}
    for (const e of events) {
      const d = new Date(e.startAtIso)
      if (Number.isNaN(d.getTime())) continue
      const key = ymdKey(d)
      if (!map[key]) map[key] = []
      map[key].push(e)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.startAtIso.localeCompare(b.startAtIso))
    }
    return map
  }, [events])

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>
  if (!canView) return <p className="text-sm text-slate-600">You do not have permission to view schedule.</p>

  const viewBtn = (id: ScheduleView, label: string) => {
    const active = view === id
    const cls = active
      ? 'bg-slate-900 text-white ring-slate-900'
      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
    return (
      <button
        type="button"
        onClick={() => setView(id)}
        className={[
          'h-9 rounded-full px-3 text-xs font-semibold ring-1 transition',
          cls,
        ].join(' ')}
        aria-pressed={active}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="w-full max-w-none space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <CalendarDays className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Schedule</h1>
            <p className="mt-1 text-slate-600">Estimates and installations in one calendar view.</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:pt-1">
          <div className="mr-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-teal-900">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-500" aria-hidden></span>
              Estimate
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-indigo-900">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" aria-hidden></span>
              Installation
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            {viewBtn('day', 'Day')}
            {viewBtn('week', 'Week')}
            {viewBtn('month', 'Month')}
            {viewBtn('agenda', 'Schedule')}
          </div>
        </div>
      </div>

      {err ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p> : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
              title="Previous"
              onClick={() => setAnchor((d) => shiftAnchor(d, view, -1))}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50"
              title="Next"
              onClick={() => setAnchor((d) => shiftAnchor(d, view, 1))}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setAnchor(startOfLocalDay(new Date()))}
            >
              Today
            </button>
          </div>
          <div className="text-sm font-semibold text-slate-900">{fmtRangeTitle(view, anchor)}</div>
          <div className="text-xs text-slate-500">
            {(() => {
              if (loading) return 'Loading…'
              const label = events.length === 1 ? 'item' : 'items'
              return `${events.length} ${label}`
            })()}
          </div>
        </div>

        {view === 'month' ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            {(() => {
              const first = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
              const dow = first.getDay()
              const mondayOffset = (dow + 6) % 7
              const gridStart = addLocalDays(first, -mondayOffset)
              const days: Date[] = []
              for (let i = 0; i < 42; i++) days.push(addLocalDays(gridStart, i))
              const month = range.start.getMonth()
              return (
                <div className="grid grid-cols-7">
                  {days.map((d) => {
                    const inMonth = d.getMonth() === month
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                    const dayEvents = eventsByDayKey[key] ?? []
                    return (
                      <div
                        key={key}
                        className={[
                          'min-h-[7.5rem] border-b border-r border-slate-200 p-2 align-top',
                          inMonth ? 'bg-white' : 'bg-slate-50/40 text-slate-500',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-700">{d.getDate()}</div>
                        </div>
                        <div className="mt-1 space-y-1">
                          {dayEvents.slice(0, 3).map((e) => (
                            <Link
                              key={`${e.kind}:${e.id}:${e.startAtIso}`}
                              to={e.href}
                              title={`${e.subtitle} · ${fmtDisplayDateTime(e.startAtIso)}`}
                              className={[
                                'block truncate rounded-md px-2 py-1 text-[11px] font-semibold ring-1',
                                e.kind === 'installation'
                                  ? 'bg-indigo-50 text-indigo-900 ring-indigo-100 hover:bg-indigo-100'
                                  : 'bg-teal-50 text-teal-900 ring-teal-100 hover:bg-teal-100',
                              ].join(' ')}
                            >
                              <span className="mr-1 font-bold">{eventTimeLabel(e.startAtIso)}</span>
                              {e.title}
                            </Link>
                          ))}
                          {dayEvents.length > 3 ? (
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-slate-600 hover:underline"
                              onClick={() => {
                                setView('day')
                                setAnchor(startOfLocalDay(d))
                              }}
                            >
                              +{dayEvents.length - 3} more
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        ) : null}

        {view === 'week' || view === 'day' ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            {(() => {
              const days =
                view === 'day' ? [range.start] : Array.from({ length: 7 }, (_, i) => addLocalDays(range.start, i))
              const columns = days.length
              const gridTemplateColumns = `4.5rem repeat(${columns}, minmax(0, 1fr))`
              const hours = Array.from({ length: 24 }, (_, i) => i)
              const totalHeight = 24 * PX_PER_HOUR

              return (
                <div className="w-full overflow-x-auto overscroll-x-contain">
                  <div className="min-w-[46rem] bg-white">
                    <div
                      className="grid border-b border-slate-200 bg-slate-50"
                      style={{ gridTemplateColumns }}
                    >
                      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        GMT
                      </div>
                      {days.map((d) => {
                        const key = ymdKey(d)
                        const count = (eventsByDayKey[key] ?? []).length
                        return (
                          <div key={key} className="px-3 py-2">
                            <div className="text-xs font-semibold text-slate-900">
                              {d.toLocaleDateString(undefined, { weekday: 'short' })}
                              <span className="ml-2 text-slate-500">
                                {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">{count ? `${count} item(s)` : '—'}</div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="relative" style={{ height: totalHeight }}>
                      {/* Hour rows */}
                      <div
                        className="grid"
                        style={{ gridTemplateColumns }}
                      >
                        <div className="border-r border-slate-200" />
                        {days.map((d) => (
                          <div key={ymdKey(d)} className="border-r border-slate-200" />
                        ))}
                      </div>

                      {hours.map((h) => (
                        <div
                          key={h}
                          className="absolute left-0 right-0 border-t border-slate-100"
                          style={{ top: h * PX_PER_HOUR }}
                        >
                          <div
                            className="grid"
                            style={{ gridTemplateColumns }}
                          >
                            <div className="border-r border-slate-200 px-2 py-1 text-right text-[10px] font-semibold text-slate-500">
                              {new Date(2000, 1, 1, h, 0, 0).toLocaleTimeString(undefined, {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                            {days.map((d) => (
                              <div key={ymdKey(d)} className="border-r border-slate-200" />
                            ))}
                          </div>
                        </div>
                      ))}

                      {/* Events overlay */}
                      <div
                        className="absolute inset-0 grid"
                        style={{ gridTemplateColumns }}
                      >
                        <div className="border-r border-slate-200" />
                        {days.map((d) => {
                          const key = ymdKey(d)
                          const dayEvents = eventsByDayKey[key] ?? []
                          return (
                            <div key={key} className="relative border-r border-slate-200">
                              {dayEvents.map((e) => {
                                const mins = minutesSinceStartOfLocalDay(e.startAtIso)
                                if (mins == null) return null
                                const top = (mins / 60) * PX_PER_HOUR
                                const height = (EVENT_DEFAULT_DURATION_MINUTES / 60) * PX_PER_HOUR
                                const base =
                                  e.kind === 'installation'
                                    ? 'border-indigo-200 bg-indigo-50 text-indigo-950'
                                    : 'border-teal-200 bg-teal-50 text-teal-950'
                                const hover =
                                  e.kind === 'installation' ? 'hover:bg-indigo-100' : 'hover:bg-teal-100'
                                return (
                                  <Link
                                    key={`${e.kind}:${e.id}:${e.startAtIso}`}
                                    to={e.href}
                                    title={`${e.subtitle} · ${fmtDisplayDateTime(e.startAtIso)}`}
                                    className={[
                                      'absolute left-1 right-1 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm',
                                      base,
                                      hover,
                                    ].join(' ')}
                                    style={{ top, height: Math.max(24, height) }}
                                  >
                                    <div className="truncate">
                                      <span className="mr-1 font-extrabold tabular-nums">
                                        {eventTimeLabel(e.startAtIso)}
                                      </span>
                                      {e.title}
                                    </div>
                                    <div className="truncate text-[10px] font-medium opacity-80">{e.subtitle}</div>
                                  </Link>
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        ) : null}

        {view === 'agenda' ? (
          <div className="mt-4">
            {events.length ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {events.map((e) => (
                  <li
                    key={`${e.kind}:${e.id}:${e.startAtIso}`}
                    className={[
                      'flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm transition-colors',
                      e.kind === 'installation'
                        ? 'border-l-4 border-indigo-500 bg-indigo-50 hover:bg-indigo-100/70'
                        : 'border-l-4 border-teal-500 bg-teal-50 hover:bg-teal-100/70',
                    ].join(' ')}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold tabular-nums text-slate-900">{fmtDisplayDateTime(e.startAtIso)}</span>
                      <span className="ml-2 text-slate-900">{e.title}</span>
                      <span className="ml-2 text-xs text-slate-500">{e.subtitle}</span>
                    </div>
                    <span
                      className={[
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1',
                        e.kind === 'installation'
                          ? 'bg-indigo-50 text-indigo-900 ring-indigo-100'
                          : 'bg-teal-50 text-teal-900 ring-teal-100',
                      ].join(' ')}
                      title={e.kind === 'installation' ? 'Installation' : 'Estimate visit'}
                    >
                      {e.kind === 'installation' ? 'Install' : 'Estimate'}
                    </span>
                    <Link
                      to={e.href}
                      className="text-xs font-semibold text-teal-700 hover:underline"
                    >
                      View
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No scheduled items in this range.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

