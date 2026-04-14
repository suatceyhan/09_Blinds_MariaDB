import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson, putJson } from '@/lib/api'

type Row = {
  id: string
  name: string
  aciklama: string | null
  active: boolean
  sort_order: number
}

type CompanyBrief = { id: string; name: string }
type TypeCol = { id: string; name: string; active: boolean; sort_order: number }
type MatrixCell = { company_id: string; status_id: string; enabled: boolean }

type MatrixOut = {
  companies: CompanyBrief[]
  types: TypeCol[]
  cells: MatrixCell[]
}

type PendingConfirm =
  | { kind: 'deactivate'; id: string; display: string }
  | { kind: 'restore'; id: string; display: string }

function cellKey(companyId: string, typeId: string) {
  return `${companyId}\t${typeId}`
}

function normalizeDescription(raw: string): string | null {
  const s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  return s || null
}

function descriptionForInput(raw: string | null): string {
  if (!raw) return ''
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function BlindsTypesLookupPage() {
  const me = useAuthSession()
  const canView = Boolean(
    me?.permissions.includes('lookups.blinds_types.view') || me?.permissions.includes('lookups.view'),
  )
  const canEdit = Boolean(
    me?.permissions.includes('lookups.blinds_types.edit') || me?.permissions.includes('lookups.edit'),
  )

  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [newName, setNewName] = useState('')
  const [newAciklama, setNewAciklama] = useState('')
  const [newSort, setNewSort] = useState('0')
  const [creating, setCreating] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAciklama, setEditAciklama] = useState('')
  const [editSortOrder, setEditSortOrder] = useState('0')
  const [editSaving, setEditSaving] = useState(false)

  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)

  const [matrixData, setMatrixData] = useState<MatrixOut | null>(null)
  const [matrixLoading, setMatrixLoading] = useState(true)
  const [matrixErr, setMatrixErr] = useState<string | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [matrixDirty, setMatrixDirty] = useState(false)
  const [matrixSaving, setMatrixSaving] = useState(false)
  const [matrixSaveErr, setMatrixSaveErr] = useState<string | null>(null)
  const [matrixConfirmOpen, setMatrixConfirmOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '300')
    p.set('catalog_scope', canEdit ? 'global' : 'tenant')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showInactive) p.set('include_inactive', 'true')
    return p.toString()
  }, [debouncedSearch, showInactive, canEdit])

  const loadRows = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const list = await getJson<Row[]>(`/lookups/blinds-types?${listParams}`)
      setRows(list)
    } catch (e) {
      setRows(null)
      setErr(e instanceof Error ? e.message : 'Could not load blinds types')
    } finally {
      setLoading(false)
    }
  }, [me, canView, listParams])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const loadMatrix = useCallback(async () => {
    if (!me || !canView) return
    setMatrixLoading(true)
    setMatrixErr(null)
    try {
      const m = await getJson<MatrixOut>('/permissions/blinds-type-matrix')
      setMatrixData(m)
      const next: Record<string, boolean> = {}
      for (const c of m.cells) {
        next[cellKey(c.company_id, c.status_id)] = c.enabled
      }
      setEnabledMap(next)
      setMatrixDirty(false)
    } catch (e) {
      setMatrixData(null)
      setMatrixErr(e instanceof Error ? e.message : 'Could not load company matrix')
    } finally {
      setMatrixLoading(false)
    }
  }, [me, canView])

  useEffect(() => {
    void loadMatrix()
  }, [loadMatrix])

  const gridTypes = useMemo(() => (matrixData?.types ?? []).filter((t) => t.active), [matrixData])
  const manageRows = useMemo(() => {
    const all = rows ?? []
    return showInactive ? all : all.filter((r) => r.active)
  }, [rows, showInactive])

  const matrixToggle = useCallback(
    (companyId: string, typeId: string) => {
      if (!canEdit) return
      const k = cellKey(companyId, typeId)
      setEnabledMap((prev) => ({ ...prev, [k]: !prev[k] }))
      setMatrixDirty(true)
    },
    [canEdit],
  )

  const buildMatrixPayload = useCallback((): MatrixCell[] => {
    if (!matrixData) return []
    const out: MatrixCell[] = []
    for (const co of matrixData.companies) {
      for (const typ of gridTypes) {
        const k = cellKey(co.id, typ.id)
        out.push({
          company_id: co.id,
          status_id: typ.id,
          enabled: Boolean(enabledMap[k]),
        })
      }
    }
    return out
  }, [matrixData, enabledMap, gridTypes])

  async function saveMatrix() {
    if (!matrixData || !canEdit) return
    setMatrixSaving(true)
    setMatrixSaveErr(null)
    try {
      await putJson<MatrixOut>('/permissions/blinds-type-matrix', { cells: buildMatrixPayload() })
      setMatrixConfirmOpen(false)
      await loadMatrix()
      await loadRows()
    } catch (e) {
      setMatrixSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setMatrixSaving(false)
    }
  }

  async function onCreateInline() {
    const n = newName.trim()
    if (!n || !canEdit) return
    const so = Number.parseInt(newSort, 10)
    setCreating(true)
    setErr(null)
    try {
      await postJson('/lookups/blinds-types', {
        name: n,
        aciklama: normalizeDescription(newAciklama),
        sort_order: Number.isNaN(so) ? undefined : so,
      })
      setNewName('')
      setNewAciklama('')
      setNewSort('0')
      await loadRows()
      await loadMatrix()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  function openEdit(r: Row) {
    setEditId(r.id)
    setEditName(r.name ?? '')
    setEditAciklama(descriptionForInput(r.aciklama))
    setEditSortOrder(String(r.sort_order ?? 0))
  }

  async function onEditSave(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editId || !editName.trim()) return
    const so = Number.parseInt(editSortOrder, 10)
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/lookups/blinds-types/${encodeURIComponent(editId)}`, {
        name: editName.trim(),
        aciklama: normalizeDescription(editAciklama),
        sort_order: Number.isNaN(so) ? 0 : so,
      })
      setEditId(null)
      await loadRows()
      await loadMatrix()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function executePending() {
    if (!pending) return
    setConfirmPending(true)
    setErr(null)
    try {
      await patchJson(`/lookups/blinds-types/${encodeURIComponent(pending.id)}`, {
        active: pending.kind === 'restore',
      })
      setPending(null)
      await loadRows()
      await loadMatrix()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setConfirmPending(false)
    }
  }

  if (!me) return null
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">
        You do not have permission to view blinds types.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-6 px-4 py-6">
      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'restore' ? 'Restore blinds type' : 'Deactivate blinds type'}
        description={
          pending == null
            ? ''
            : pending.kind === 'deactivate'
              ? `${pending.display} will be hidden from new estimates and orders but kept in the database.`
              : `Restore ${pending.display}?`
        }
        confirmLabel={pending?.kind === 'restore' ? 'Restore' : 'Deactivate'}
        cancelLabel="Cancel"
        variant={pending?.kind === 'deactivate' ? 'danger' : 'default'}
        pending={confirmPending}
        onConfirm={() => void executePending()}
        onCancel={() => {
          if (!confirmPending) setPending(null)
        }}
      />

      <ConfirmModal
        open={matrixConfirmOpen}
        title="Save blinds type matrix"
        description="Update which companies may use each global blinds type?"
        confirmLabel="Save"
        pending={matrixSaving}
        onCancel={() => setMatrixConfirmOpen(false)}
        onConfirm={() => void saveMatrix()}
      />

      {editId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => void onEditSave(e)}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">Edit blinds type</h2>
            <div className="mt-3 grid gap-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Description</span>
                <textarea
                  rows={4}
                  className="min-h-24 w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  value={editAciklama}
                  onChange={(e) => setEditAciklama(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Sort order</span>
                <input
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  value={editSortOrder}
                  onChange={(e) => setEditSortOrder(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditId(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <Layers className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Blinds types</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Global lines shared across companies. Manage names, descriptions, and sort order above; use the matrix
              below to enable each type per company. Rows are companies and columns are blinds types. Which product
              categories apply to each type is still under Settings → Blinds line matrices.
            </p>
            <p className="mt-2 text-xs text-slate-500">Tip: newly added types are inserted into every company matrix.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <button
              type="button"
              disabled={!matrixDirty || matrixSaving}
              onClick={() => setMatrixConfirmOpen(true)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {matrixSaving ? 'Saving…' : 'Save matrix'}
            </button>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Add blinds type</h2>
          <p className="mt-1 text-xs text-slate-500">Creates a global row and enables it for all companies.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Name</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Type name"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Description (optional)</span>
              <textarea
                rows={2}
                value={newAciklama}
                onChange={(e) => setNewAciklama(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Sort order</span>
              <input
                inputMode="numeric"
                value={newSort}
                onChange={(e) => setNewSort(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-3">
            <button
              type="button"
              disabled={creating || !newName.trim()}
              onClick={() => void onCreateInline()}
              className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Manage blinds types</h2>
            <p className="mt-1 text-xs text-slate-500">Edit name, description, and sort order, or deactivate / restore.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Filter by name or description…"
              className="min-w-[10rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ShowDeletedToggle checked={showInactive} onChange={setShowInactive} id="blinds-types-show-inactive" />
          </div>
        </div>

        {err ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
        ) : null}

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : !manageRows.length ? (
            <p className="p-6 text-sm text-slate-500">No types match your filters.</p>
          ) : (
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Sort</th>
                  <th className="px-4 py-3">Status</th>
                  {canEdit ? <th className="px-4 py-3 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manageRows.map((r) => (
                  <tr
                    key={r.id}
                    className={r.active ? 'hover:bg-slate-50/80' : 'bg-slate-50/60 text-slate-500 hover:bg-slate-50'}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                    <td className="max-w-md min-w-[10rem] whitespace-pre-wrap break-words px-4 py-3 align-top text-slate-600">
                      {r.aciklama == null ? '—' : descriptionForInput(r.aciklama)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.sort_order}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          r.active
                            ? 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'
                            : 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700'
                        }
                      >
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => openEdit(r)}
                            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {r.active ? (
                            <button
                              type="button"
                              title="Deactivate"
                              onClick={() => setPending({ kind: 'deactivate', id: r.id, display: r.name })}
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Restore"
                              onClick={() => setPending({ kind: 'restore', id: r.id, display: r.name })}
                              className="rounded-lg p-2 text-teal-700 hover:bg-teal-50"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {matrixSaveErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{matrixSaveErr}</div>
      ) : null}
      {matrixErr ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{matrixErr}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {(() => {
          if (matrixLoading) return <p className="p-6 text-sm text-slate-500">Loading matrix…</p>
          if (!matrixData?.companies.length) return <p className="p-6 text-sm text-slate-500">No companies to show.</p>
          if (!gridTypes.length) return <p className="p-6 text-sm text-slate-500">No active types for columns.</p>
          return (
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th className="sticky left-0 z-10 bg-slate-50/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Company
                  </th>
                  {gridTypes.map((t) => (
                    <th
                      key={t.id}
                      className="min-w-[7rem] px-2 py-2 text-center text-xs font-semibold text-slate-700"
                      title={t.id}
                    >
                      <span className="line-clamp-2">{t.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixData.companies.map((co) => (
                  <tr key={co.id} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{co.name}</td>
                    {gridTypes.map((typ) => {
                      const k = cellKey(co.id, typ.id)
                      const on = Boolean(enabledMap[k])
                      return (
                        <td key={typ.id} className="px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-violet-600"
                            checked={on}
                            disabled={!canEdit}
                            onChange={() => matrixToggle(co.id, typ.id)}
                            aria-label={`${co.name} — ${typ.name}`}
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
    </div>
  )
}
