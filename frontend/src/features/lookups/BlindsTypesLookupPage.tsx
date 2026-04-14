import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layers, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'

type Row = {
  id: string
  company_id: string
  name: string
  aciklama: string | null
  active: boolean
}

type PendingConfirm =
  | { kind: 'deactivate'; id: string; display: string }
  | { kind: 'restore'; id: string; display: string }

function normalizeDescription(raw: string): string | null {
  const s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  return s || null
}

function descriptionForInput(raw: string | null): string {
  if (!raw) return ''
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
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
  const [creating, setCreating] = useState(false)

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAciklama, setEditAciklama] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)

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

  const manageRows = useMemo(() => {
    const all = rows ?? []
    return showInactive ? all : all.filter((r) => r.active)
  }, [rows, showInactive])

  async function onCreateInline() {
    if (!canEdit || !newName.trim()) return
    setCreating(true)
    setErr(null)
    try {
      await postJson('/lookups/blinds-types', {
        name: newName.trim(),
        aciklama: normalizeDescription(newAciklama),
      })
      setNewName('')
      setNewAciklama('')
      await loadRows()
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
  }

  async function onEditSave(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editId || !editName.trim()) return
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/lookups/blinds-types/${editId}`, {
        name: editName.trim(),
        aciklama: normalizeDescription(editAciklama),
      })
      setEditId(null)
      await loadRows()
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
      await patchJson(`/lookups/blinds-types/${pending.id}`, {
        active: pending.kind === 'restore',
      })
      setPending(null)
      await loadRows()
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
              ? `${pending.display} will be hidden from new estimates but kept in the database.`
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Description</span>
                <textarea
                  rows={5}
                  className="min-h-24 w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editAciklama}
                  onChange={(e) => setEditAciklama(e.target.value)}
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
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Layers className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Blinds types</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Catalog lines for estimates and orders for your <span className="font-medium text-slate-800">active company</span>.
              Names and descriptions are not shared globally—each tenant maintains its own list (unlike order statuses or product
              categories).
            </p>
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Add blinds type</h2>
          <p className="mt-1 text-xs text-slate-500">Creates a row for the active company.</p>
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
                rows={3}
                value={newAciklama}
                onChange={(e) => setNewAciklama(e.target.value)}
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
            <p className="mt-1 text-xs text-slate-500">Edit name and description, or deactivate / restore.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Filter by name or description…"
              className="min-w-[10rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} />
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
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Description</th>
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
                              onClick={() =>
                                setPending({ kind: 'deactivate', id: r.id, display: r.name })
                              }
                              className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Restore"
                              onClick={() =>
                                setPending({ kind: 'restore', id: r.id, display: r.name })
                              }
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

      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
        <h2 className="text-sm font-semibold text-slate-900">Why there is no company matrix here</h2>
        <p className="mt-2 leading-relaxed">
          Order statuses and product categories use a <span className="font-medium text-slate-800">global catalog</span> plus a
          per-company enablement matrix. Blinds types are stored <span className="font-medium text-slate-800">per company</span>{' '}
          with their own IDs, so the same layout would need a different data model. Switch the company in the header to edit
          another tenant&apos;s types; use <span className="font-medium text-slate-800">Settings → Blinds line matrices</span> to
          connect categories and extra line options to each type.
        </p>
      </div>
    </div>
  )
}
