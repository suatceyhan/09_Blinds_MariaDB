import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BarChart3 } from 'lucide-react'
import { getJson } from '@/lib/api'

type FinancialOrderRow = {
  order_id: string
  d: string
  customer_display: string
  revenue: number
  collected: number
  balance: number
  tax: number
  expense: number
  profit: number
}

type FinancialOrdersOut = {
  range_from: string
  range_to: string
  only_positive_balance: boolean
  orders: FinancialOrderRow[]
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

function monthRange(monthIso: string): { from: string; to: string } | null {
  const m = (monthIso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return null
  const dt = new Date(`${m}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  const start = new Date(dt.getFullYear(), dt.getMonth(), 1)
  const end = new Date(dt.getFullYear(), dt.getMonth() + 1, 0)
  return { from: isoDate(start), to: isoDate(end) }
}

export function FinancialOrdersListPage() {
  const [sp] = useSearchParams()
  const kind = (sp.get('kind') || '').trim().toLowerCase()
  const from = (sp.get('from') || '').trim()
  const to = (sp.get('to') || '').trim()
  const month = (sp.get('month') || '').trim()

  const resolved = useMemo(() => {
    if (month) {
      const r = monthRange(month)
      if (r) return { from: r.from, to: r.to }
    }
    return { from, to }
  }, [from, to, month])

  const onlyPositive = kind === 'ar'

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (resolved.from) p.set('from_date', resolved.from)
    if (resolved.to) p.set('to_date', resolved.to)
    if (onlyPositive) p.set('only_positive_balance', 'true')
    return p.toString()
  }, [resolved.from, resolved.to, onlyPositive])

  const [data, setData] = useState<FinancialOrdersOut | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const d = await getJson<FinancialOrdersOut>(`/reports/financial/orders?${qs}`)
        if (!c) setData(d)
      } catch (e) {
        if (!c) {
          setErr(e instanceof Error ? e.message : 'Could not load orders')
          setData(null)
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [qs])

  let title = 'Financial orders'
  if (kind === 'ar') title = 'A/R balance — order list'
  else if (month) title = `Monthly details — ${month}`

  const totals = useMemo(() => {
    const orders = data?.orders ?? []
    return orders.reduce(
      (acc, o) => ({
        revenue: acc.revenue + (Number(o.revenue) || 0),
        collected: acc.collected + (Number(o.collected) || 0),
        balance: acc.balance + (Number(o.balance) || 0),
        tax: acc.tax + (Number(o.tax) || 0),
        expense: acc.expense + (Number(o.expense) || 0),
        profit: acc.profit + (Number(o.profit) || 0),
      }),
      { revenue: 0, collected: 0, balance: 0, tax: 0, expense: 0, profit: 0 },
    )
  }, [data])

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <Link to="/reports/financial" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to financial reports
      </Link>

      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-br from-indigo-50/90 via-white to-white px-5 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <BarChart3 className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-slate-900">{title}</p>
              <p className="mt-1 text-xs text-slate-600">
                {data ? (
                  <>
                    Range <span className="font-semibold text-slate-800">{data.range_from}</span> →{' '}
                    <span className="font-semibold text-slate-800">{data.range_to}</span>
                    {onlyPositive ? ' · only positive balances' : null}
                  </>
                ) : (
                  ' '
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-5 sm:px-6">
          {err ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Revenue</th>
                  <th className="px-3 py-2">Collected</th>
                  <th className="px-3 py-2">Balance</th>
                  <th className="px-3 py-2">Tax</th>
                  <th className="px-3 py-2">Expenses</th>
                  <th className="px-3 py-2">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(() => {
                  if (loading) {
                    return (
                      <tr>
                        <td className="px-3 py-6 text-slate-500" colSpan={9}>
                          Loading…
                        </td>
                      </tr>
                    )
                  }
                  if ((data?.orders ?? []).length === 0) {
                    return (
                      <tr>
                        <td className="px-3 py-6 text-slate-500" colSpan={9}>
                          No orders in this range.
                        </td>
                      </tr>
                    )
                  }
                  return (data?.orders ?? []).map((o) => (
                    <tr key={o.order_id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-800">{o.d}</td>
                      <td className="px-3 py-2 text-slate-800">{o.customer_display}</td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/orders?viewOrder=${encodeURIComponent(o.order_id)}`}
                          className="font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                        >
                          {o.order_id}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(o.revenue)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(o.collected)}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(o.balance)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(o.tax)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(o.expense)}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-700">{fmtMoney(o.profit)}</td>
                    </tr>
                  ))
                })()}
              </tbody>
              {!loading && (data?.orders ?? []).length > 0 ? (
                <tfoot className="border-t border-slate-200 bg-slate-50/60">
                  <tr>
                    <td className="px-3 py-2 font-semibold text-slate-900" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.revenue)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.collected)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.balance)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.expense)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-slate-900">{fmtMoney(totals.profit)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

