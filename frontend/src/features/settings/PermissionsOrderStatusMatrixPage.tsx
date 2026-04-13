import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListOrdered } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, postJson, putJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type CompanyBrief = { id: string; name: string }
type StatusRow = { id: string; name: string; active: boolean; sort_order: number }
type Cell = { company_id: string; status_id: string; enabled: boolean }

type MatrixOut = {
  companies: CompanyBrief[]
  statuses: StatusRow[]
  cells: Cell[]
}

function cellKey(companyId: string, statusId: string) {
  return `${companyId}\t${statusId}`
}

export function PermissionsOrderStatusMatrixPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.order_status_matrix.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.order_status_matrix.edit'))
  const isSuper = Boolean(me?.roles?.includes('superadmin'))

  const [data, setData] = useState<MatrixOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const m = await getJson<MatrixOut>('/permissions/order-status-matrix')
      setData(m)
      const next: Record<string, boolean> = {}
      for (const c of m.cells) {
        next[cellKey(c.company_id, c.status_id)] = c.enabled
      }
      setEnabledMap(next)
      setDirty(false)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Could not load matrix')
    } finally {
      setLoading(false)
    }
  }, [me, canView])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback(
    (companyId: string, statusId: string) => {
      if (!canEdit) return
      const k = cellKey(companyId, statusId)
      setEnabledMap((prev) => ({ ...prev, [k]: !prev[k] }))
      setDirty(true)
    },
    [canEdit],
  )

  const buildPayload = useCallback((): Cell[] => {
    if (!data) return []
    const out: Cell[] = []
    for (const co of data.companies) {
      for (const st of data.statuses) {
        const k = cellKey(co.id, st.id)
        out.push({
          company_id: co.id,
          status_id: st.id,
          enabled: Boolean(enabledMap[k]),
        })
      }
    }
    return out
  }, [data, enabledMap])

  async function save() {
    if (!data || !canEdit) return
    setSaving(true)
    setSaveErr(null)
    try {
      await putJson<MatrixOut>('/permissions/order-status-matrix', { cells: buildPayload() })
      setDirty(false)
      await load()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
      setConfirmOpen(false)
    }
  }

  async function createGlobal() {
    const n = newName.trim()
    if (!n || !isSuper) return
    setCreating(true)
    setErr(null)
    try {
      await postJson('/permissions/global-order-statuses', { name: n })
      setNewName('')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create status')
    } finally {
      setCreating(false)
    }
  }

  const statusCols = useMemo(() => data?.statuses ?? [], [data])

  if (!me) return null
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">
        You do not have permission to view the order status matrix.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <ListOrdered className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Order status matrix</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Global order statuses (shared across all companies). Rows are companies; columns are statuses.
              Check a cell to allow that company to use that status in orders and lookups. Add custom labels as
              superadmin.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Day-to-day list views still use{' '}
              <Link className="text-violet-700 underline" to="/lookups/order-statuses">
                Lookups → Order statuses
              </Link>{' '}
              (filtered by this matrix).
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save matrix'}
          </button>
        ) : null}
      </div>

      {isSuper ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Add custom global status (superadmin)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Creates a global row and enables it for all companies; turn off per company in the grid below.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Status name"
              className="min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={() => void createGlobal()}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}
      {saveErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{saveErr}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : !data?.companies.length ? (
          <p className="p-6 text-sm text-slate-500">No companies to show.</p>
        ) : (
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90">
                <th className="sticky left-0 z-10 bg-slate-50/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Company
                </th>
                {statusCols.map((s) => (
                  <th
                    key={s.id}
                    className="min-w-[7rem] px-2 py-2 text-center text-xs font-semibold text-slate-700"
                  >
                    <span className="line-clamp-2">{s.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.companies.map((co) => (
                <tr key={co.id} className="border-b border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{co.name}</td>
                  {statusCols.map((st) => {
                    const k = cellKey(co.id, st.id)
                    const on = Boolean(enabledMap[k])
                    return (
                      <td key={st.id} className="px-1 py-1 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-violet-600"
                          checked={on}
                          disabled={!canEdit}
                          onChange={() => toggle(co.id, st.id)}
                          aria-label={`${co.name} — ${st.name}`}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Save order status matrix"
        description="Update which companies may use each global order status?"
        confirmLabel="Save"
        pending={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </div>
  )
}
