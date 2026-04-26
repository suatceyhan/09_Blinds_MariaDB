import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Users } from 'lucide-react'
import { getJson } from '@/lib/api'

type MonthlySources = {
  range_from: string
  range_to: string
  points: Array<{ month: string; referral: number; advertising: number; unknown: number }>
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Preset = 'this_year' | 'last_12' | 'custom'

function computePreset(p: Preset): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (p === 'this_year') return { from: isoDate(new Date(today.getFullYear(), 0, 1)), to: isoDate(today) }
  const startOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const from = new Date(startOfThisMonth)
  from.setMonth(from.getMonth() - 11)
  return { from: isoDate(from), to: isoDate(today) }
}

function sumRow(p: { referral: number; advertising: number; unknown: number }): number {
  return (p.referral || 0) + (p.advertising || 0) + (p.unknown || 0)
}

export function CustomerSourcesReportPage() {
  const [preset, setPreset] = useState<Preset>('last_12')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => {
    if (preset !== 'custom') return computePreset(preset)
    const fallback = computePreset('last_12')
    return { from: customFrom.trim() || fallback.from, to: customTo.trim() || fallback.to }
  }, [preset, customFrom, customTo])

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    p.set('from_date', range.from)
    p.set('to_date', range.to)
    return p.toString()
  }, [range.from, range.to])

  const [est, setEst] = useState<MonthlySources | null>(null)
  const [ord, setOrd] = useState<MonthlySources | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const [a, b] = await Promise.all([
          getJson<MonthlySources>(`/reports/customer-sources/estimates-monthly?${qs}`),
          getJson<MonthlySources>(`/reports/customer-sources/orders-monthly?${qs}`),
        ])
        if (!c) {
          setEst(a)
          setOrd(b)
        }
      } catch (e) {
        if (!c) {
          setErr(e instanceof Error ? e.message : 'Could not load customer sources report')
          setEst(null)
          setOrd(null)
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
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Customer sources</h1>
            <p className="mt-1 text-sm text-slate-600">Monthly unique customers by source (Referral vs Advertising).</p>
          </div>
        </div>

        <div className="w-full max-w-none rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm lg:max-w-[44rem]">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem]">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Range</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    ['last_12', 'Last 12 months'],
                    ['this_year', 'This year'],
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
              <div className="ml-auto text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{range.from}</span>
                <span className="mx-2 text-slate-400">→</span>
                <span className="font-semibold text-slate-800">{range.to}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {err ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <SourcesTable title="Estimates" subtitle="Unique prospects/customers from created estimates" loading={loading} data={est} />
      <SourcesTable title="Orders" subtitle="Unique customers from active orders (by agreement/created date)" loading={loading} data={ord} />
    </div>
  )
}

function SourcesTable({
  title,
  subtitle,
  loading,
  data,
}: Readonly<{
  title: string
  subtitle: string
  loading: boolean
  data: MonthlySources | null
}>) {
  const total = useMemo(() => {
    const pts = data?.points ?? []
    return pts.reduce(
      (acc, p) => ({ referral: acc.referral + p.referral, advertising: acc.advertising + p.advertising, unknown: acc.unknown + p.unknown }),
      { referral: 0, advertising: 0, unknown: 0 },
    )
  }, [data])

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Users className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        {!loading ? (
          <div className="text-right text-xs text-slate-600">
            <div className="font-semibold text-slate-900">Total: {sumRow(total).toLocaleString()}</div>
            <div className="mt-0.5">
              Referral {total.referral.toLocaleString()} · Advertising {total.advertising.toLocaleString()} · Unknown {total.unknown.toLocaleString()}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Month</th>
              <th className="px-3 py-2">Referral</th>
              <th className="px-3 py-2">Advertising</th>
              <th className="px-3 py-2">Unknown</th>
              <th className="px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : (data?.points ?? []).length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-slate-500" colSpan={5}>
                  No data in this range.
                </td>
              </tr>
            ) : (
              (data?.points ?? []).map((p) => (
                <tr key={p.month} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-800">{p.month}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{p.referral.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{p.advertising.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{p.unknown.toLocaleString()}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{sumRow(p).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

