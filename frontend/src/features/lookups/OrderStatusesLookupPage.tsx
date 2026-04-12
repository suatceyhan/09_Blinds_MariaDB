import { useEffect, useMemo, useState } from 'react'
import { ListOrdered, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'

type Row = {
  id: string
  company_id: string
  name: string
  active: boolean
}

type PendingConfirm =
  | { kind: 'deactivate'; id: string; display: string }
  | { kind: 'restore'; id: string; display: string }

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
  const canEdit = Boolean(me?.permissions.includes('lookups.edit'))

  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
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

  async function refresh() {
    const list = await getJson<Row[]>(`/lookups/order-statuses?${listParams}`)
    setRows(list)
  }

  async function onCreate(ev: React.FormEvent) {
    ev.preventDefault()
    if (!canEdit || !name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await postJson('/lookups/order-statuses', { name: name.trim() })
      setName('')
      setShowCreate(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(r: Row) {
    setEditId(r.id)
    setEditName(r.name ?? '')
  }

  async function onEditSave(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editId || !editName.trim()) return
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/lookups/order-statuses/${editId}`, { name: editName.trim() })
      setEditId(null)
      await refresh()
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
      await patchJson(`/lookups/order-statuses/${pending.id}`, {
        active: pending.kind === 'restore',
      })
      setPending(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setConfirmPending(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'restore' ? 'Restore order status' : 'Deactivate order status'}
        description={
          pending == null
            ? ''
            : pending.kind === 'deactivate'
              ? `${pending.display} will be marked inactive (kept for existing orders).`
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
            <h2 className="text-sm font-semibold text-slate-900">Edit order status</h2>
            <div className="mt-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
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

      {showCreate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => void onCreate(e)}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">New order status</h2>
            <div className="mt-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !saving && setShowCreate(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <ListOrdered className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Order statuses</h1>
            <p className="mt-1 text-sm text-slate-600">
              Order workflow labels (status_order). Inactive labels remain in the database for existing orders.
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            New status
          </button>
        ) : null}
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
        ) : !rows?.length ? (
          <p className="p-6 text-sm text-slate-500">No rows match your filters.</p>
        ) : (
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                {canEdit ? <th className="px-4 py-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={r.active ? 'hover:bg-slate-50/80' : 'bg-slate-50/60 text-slate-500 hover:bg-slate-50'}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
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
                      <div className="flex justify-end gap-1">
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
  )
}
