import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListOrdered } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson } from '@/lib/api'

type Row = {
  id: string
  name: string
  active: boolean
  sort_order?: number
}

function ShowInactiveToggle(props: Readonly<{ checked: boolean; onChange: (v: boolean) => void }>) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>Show inactive</span>
    </label>
  )
}

export function OrderStatusesLookupPage() {
  const me = useAuthSession()
  const canViewMatrix = Boolean(me?.permissions.includes('settings.order_status_matrix.view'))

  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '300')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showInactive) p.set('include_inactive', 'true')
    return p.toString()
  }, [debouncedSearch, showInactive])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<Row[]>(`/lookups/order-statuses?${listParams}`)
        if (!cancelled) setRows(list)
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load order statuses')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, listParams])

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <ListOrdered className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Order statuses</h1>
            <p className="mt-1 text-sm text-slate-600">
              Global labels enabled for your company. Edit the matrix under{' '}
              {canViewMatrix ? (
                <Link className="font-medium text-teal-700 underline" to="/permissions/order-status-matrix">
                  Permissions → Order status matrix
                </Link>
              ) : (
                <span className="font-medium text-slate-700">Permissions → Order status matrix</span>
              )}
              . Superadmin adds custom global statuses there.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Filter by name…"
          className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:max-w-md"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} />
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Sort</th>
                <th className="px-4 py-2">Active</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-2 text-slate-600">{r.sort_order ?? 0}</td>
                  <td className="px-4 py-2 text-slate-600">{r.active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rows?.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No statuses for your company in the matrix.</p>
        ) : null}
      </div>
    </div>
  )
}
