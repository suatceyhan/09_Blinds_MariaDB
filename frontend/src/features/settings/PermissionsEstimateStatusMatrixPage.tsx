import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson, putJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'

type CompanyBrief = { id: string; name: string }
type StatusRow = { id: string; name: string; active: boolean; sort_order: number; code?: string | null }
type Cell = { company_id: string; status_id: string; enabled: boolean }

type MatrixOut = {
  companies: CompanyBrief[]
  statuses: StatusRow[]
  cells: Cell[]
}

function cellKey(companyId: string, statusId: string) {
  return `${companyId}\t${statusId}`
}

export function PermissionsEstimateStatusMatrixPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.estimate_status_matrix.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.estimate_status_matrix.edit'))
  const isSuper = Boolean(me?.roles?.includes('superadmin'))

  const [data, setData] = useState<MatrixOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)

  const [newName, setNewName] = useState('')
  const [newSort, setNewSort] = useState('0')
  const [creating, setCreating] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSort, setEditSort] = useState('0')
  const [editSaving, setEditSaving] = useState(false)
  const [pendingToggle, setPendingToggle] = useState<{ id: string; name: string; nextActive: boolean } | null>(null)
  const [toggleSaving, setToggleSaving] = useState(false)

  const load = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const m = await getJson<MatrixOut>('/permissions/estimate-status-matrix')
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
      await putJson<MatrixOut>('/permissions/estimate-status-matrix', { cells: buildPayload() })
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
    const so = Number.parseInt(newSort.trim(), 10)
    if (Number.isNaN(so) || so < -999 || so > 9_999_999) {
      setErr('Sort order must be an integer between -999 and 9999999.')
      return
    }
    setCreating(true)
    setErr(null)
    try {
      await postJson('/permissions/global-estimate-statuses', { name: n, sort_order: so })
      setNewName('')
      setNewSort('0')
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create status')
    } finally {
      setCreating(false)
    }
  }

  function openEdit(st: StatusRow) {
    if (st.code) return
    setErr(null)
    setEditId(st.id)
    setEditName(st.name ?? '')
    setEditSort(String(st.sort_order ?? 0))
  }

  async function saveEdit() {
    if (!editId) return
    const name = editName.trim()
    const so = Number.parseInt(editSort.trim(), 10)
    if (!name) return
    if (Number.isNaN(so) || so < -999 || so > 9_999_999) {
      setErr('Sort order must be an integer between -999 and 9999999.')
      return
    }
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/permissions/global-estimate-statuses/${editId}`, { name, sort_order: so })
      setEditId(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function applyActiveToggle() {
    if (!pendingToggle) return
    setToggleSaving(true)
    setErr(null)
    try {
      await patchJson(`/permissions/global-estimate-statuses/${pendingToggle.id}`, { active: pendingToggle.nextActive })
      setPendingToggle(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setToggleSaving(false)
    }
  }

  const gridStatuses = useMemo(() => (data?.statuses ?? []).filter((s) => s.active), [data])
  const manageStatuses = useMemo(() => {
    const all = data?.statuses ?? []
    return showDeleted ? all : all.filter((s) => s.active)
  }, [data, showDeleted])

  const toggleTitle = pendingToggle?.nextActive ? 'Restore status' : 'Deactivate status'
  const toggleConfirmLabel = pendingToggle?.nextActive ? 'Restore' : 'Deactivate'
  const toggleVariant = pendingToggle?.nextActive ? 'default' : 'danger'
  const toggleDescription = (() => {
    if (!pendingToggle) return ''
    if (pendingToggle.nextActive) return `Restore ${pendingToggle.name}?`
    return `${pendingToggle.name} will be hidden from new estimates and lookups. Existing records keep their label.`
  })()

  if (!me) return null
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">
        You do not have permission to view estimate statuses.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <ClipboardList className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Estimate statuses</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Global estimate statuses (shared across all companies). Rows are companies; columns are statuses.
              Check a cell to allow that company to use that status in estimates and lookups. Built-in workflow
              labels (code column) are seeded once; add custom labels as superadmin.
            </p>
            <p className="mt-2 text-xs text-slate-500">Tip: newly added statuses are not enabled by default.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setConfirmOpen(true)}
              className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save matrix'}
            </button>
          ) : null}
        </div>
      </div>

      {isSuper ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Add custom global status (superadmin)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Creates a global status row. Enable it per company in the grid below.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Status name"
              className="min-w-[12rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
            />
            <label className="flex flex-col gap-0.5 text-xs text-slate-600">
              <span>Sort</span>
              <input
                inputMode="numeric"
                value={newSort}
                onChange={(e) => setNewSort(e.target.value)}
                className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={() => void createGlobal()}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : null}

      {isSuper && data?.statuses?.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Manage global statuses (superadmin)</h2>
              <p className="mt-1 text-xs text-slate-500">
                Built-in workflow rows (code column) are fixed. Custom rows can be edited or deactivated / restored.
              </p>
            </div>
            <ShowDeletedToggle
              checked={showDeleted}
              onChange={setShowDeleted}
              id="estimate-status-matrix-show-deleted"
            />
          </div>

          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Sort</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manageStatuses.map((st) => {
                  const builtIn = Boolean(st.code)
                  return (
                    <tr key={st.id} className={st.active ? 'hover:bg-slate-50/80' : 'bg-slate-50/60 text-slate-500'}>
                      <td className="px-3 py-2 font-medium text-slate-900">{st.name}</td>
                      <td className="px-3 py-2 text-slate-600">{st.code ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{st.sort_order}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            st.active
                              ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'
                              : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700'
                          }
                        >
                          {st.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {builtIn ? (
                          <span className="text-xs text-slate-400">Built-in</span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              title="Edit"
                              onClick={() => openEdit(st)}
                              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {st.active ? (
                              <button
                                type="button"
                                title="Deactivate"
                                onClick={() => setPendingToggle({ id: st.id, name: st.name, nextActive: false })}
                                className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title="Restore"
                                onClick={() => setPendingToggle({ id: st.id, name: st.name, nextActive: true })}
                                className="rounded-lg p-2 text-teal-700 hover:bg-teal-50"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
        {(() => {
          if (loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
          if (!data?.companies.length) return <p className="p-6 text-sm text-slate-500">No companies to show.</p>
          return (
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th className="sticky left-0 z-10 bg-slate-50/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Company
                  </th>
                  {gridStatuses.map((s) => (
                    <th
                      key={s.id}
                      className="min-w-[7rem] px-2 py-2 text-center text-xs font-semibold text-slate-700"
                      title={s.code ? `code: ${s.code}` : undefined}
                    >
                      <span className="line-clamp-2">{s.name}</span>
                      {s.code ? (
                        <span className="mt-0.5 block text-[10px] font-normal uppercase text-slate-400">{s.code}</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.companies.map((co) => (
                  <tr key={co.id} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{co.name}</td>
                    {gridStatuses.map((st) => {
                      const k = cellKey(co.id, st.id)
                      const on = Boolean(enabledMap[k])
                      return (
                        <td key={st.id} className="px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-teal-600"
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
          )
        })()}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Save estimate statuses"
        description="Update which companies may use each global estimate status?"
        confirmLabel="Save"
        pending={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />

      <ConfirmModal
        open={pendingToggle !== null}
        title={toggleTitle}
        description={toggleDescription}
        confirmLabel={toggleConfirmLabel}
        cancelLabel="Cancel"
        variant={toggleVariant}
        pending={toggleSaving}
        onCancel={() => {
          if (!toggleSaving) setPendingToggle(null)
        }}
        onConfirm={() => void applyActiveToggle()}
      />

      {editId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">Edit global estimate status</h2>
            <p className="mt-1 text-xs text-slate-500">Built-in workflow rows cannot be edited here.</p>
            <div className="mt-3 grid gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Sort order</span>
                <input
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editSort}
                  onChange={(e) => setEditSort(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !editSaving && setEditId(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving || !editName.trim()}
                onClick={() => void saveEdit()}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
