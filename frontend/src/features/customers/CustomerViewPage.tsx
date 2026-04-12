import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, UserRound } from 'lucide-react'
import { getJson } from '@/lib/api'

type CustomerOut = {
  id: string
  company_id: string
  name: string
  surname?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  active: boolean
  estimates: Array<{
    id: string
    tarih_saat?: string | null
    scheduled_start_at?: string | null
    blinds_summary?: string | null
    status?: string | null
    status_label?: string | null
  }>
  orders: Array<{
    id: string
    created_at?: string | null
    status_code?: string | null
    status_orde_id?: string | null
    total_amount?: number | null
    balance?: number | null
  }>
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function CustomerViewPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const [row, setRow] = useState<CustomerOut | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!customerId) {
      setLoading(false)
      setErr('Invalid customer')
      return
    }
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await getJson<CustomerOut>(`/customers/${customerId}`)
        if (!c) setRow(r)
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : 'Could not load customer')
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [customerId])

  const fullName = row ? `${row.name ?? ''} ${row.surname ?? ''}`.trim() : ''

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <Link
        to="/customers"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-800"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to customers
      </Link>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {err}
        </div>
      ) : row ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 text-teal-700 shadow-sm ring-1 ring-teal-100">
                  <UserRound className="h-7 w-7" strokeWidth={1.75} />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{fullName || row.id}</h1>
                  <p className="mt-0.5 text-sm text-slate-500">Customer profile</p>
                </div>
              </div>
              {row.active ? (
                <span className="mt-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                  Active
                </span>
              ) : (
                <span className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Inactive
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                Email
              </div>
              <p className="mt-2 break-all text-sm font-medium text-slate-900">{row.email || '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                Phone
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">{row.phone || '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Address</div>
              <p className="mt-2 text-sm text-slate-700">{row.address || '—'}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Estimates</p>
              <p className="mt-1 text-xs text-slate-500">Most recent first</p>
              <div className="mt-4 space-y-2">
                {row.estimates.length === 0 ? (
                  <div className="text-sm text-slate-500">No estimates yet.</div>
                ) : (
                  row.estimates.slice(0, 20).map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {e.blinds_summary?.trim() ? e.blinds_summary : 'Estimate visit'}
                          </p>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            {e.status_label?.trim() || '—'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{fmtDate(e.scheduled_start_at ?? e.tarih_saat ?? null)}</p>
                      </div>
                      <Link
                        to={`/estimates/${e.id}`}
                        className="shrink-0 text-xs font-medium text-teal-700 hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-900">Orders</p>
              <p className="mt-1 text-xs text-slate-500">Most recent first</p>
              <div className="mt-4 space-y-2">
                {row.orders.length === 0 ? (
                  <div className="text-sm text-slate-500">No orders yet.</div>
                ) : (
                  row.orders.slice(0, 20).map((o) => (
                    <div key={o.id} className="rounded-xl border border-slate-200/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-900">Order {o.id}</p>
                        <p className="text-xs text-slate-600">{fmtDate(o.created_at ?? null)}</p>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                        <span>Status: {o.status_code || o.status_orde_id || '—'}</span>
                        <span>Total: {o.total_amount ?? '—'}</span>
                        <span>Balance: {o.balance ?? '—'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

