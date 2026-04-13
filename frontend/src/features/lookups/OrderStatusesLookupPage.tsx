import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListOrdered, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'
import { LookupPageLayout, LookupSearchToolbar } from '@/features/lookups/LookupPageLayout'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type Row = {
  id: string
  name: string
  active: boolean
  sort_order?: number
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
  const canViewMatrix = Boolean(me?.permissions.includes('settings.order_status_matrix.view'))
  const isSuper = Boolean(me?.roles?.includes('superadmin'))

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
  const [editSort, setEditSort] = useState('')
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

  async function refresh() {
    const list = await getJson<Row[]>(`/lookups/order-statuses?${listParams}`)
    setRows(list)
  }

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

  async function onCreate(ev: React.FormEvent) {
    ev.preventDefault()
    if (!isSuper || !name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await postJson('/permissions/global-order-statuses', { name: name.trim() })
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
    setEditSort(String(r.sort_order ?? 0))
  }

  async function onEditSave(ev: React.FormEvent) {
    ev.preventDefault()
    if (!editId || !editName.trim()) return
    const so = Number.parseInt(editSort.trim(), 10)
    if (Number.isNaN(so) || so < 0 || so > 9_999_999) {
      setErr('Sort order must be an integer between 0 and 9999999.')
      return
    }
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/permissions/global-order-statuses/${editId}`, {
        name: editName.trim(),
        sort_order: so,
      })
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
      await patchJson(`/permissions/global-order-statuses/${pending.id}`, {
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
    <>
      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'restore' ? 'Restore order status' : 'Deactivate order status'}
        description={
          pending == null
            ? ''
            : pending.kind === 'deactivate'
              ? `${pending.display} will be hidden from new orders and lookups (matrix can still be edited).`
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

      {showCreate && isSuper ? (
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
            <p className="mt-1 text-xs text-slate-500">
              Creates a global label and enables it for all companies (superadmin). Adjust per company under
              Permissions → Order status matrix.
            </p>
            <label className="mt-3 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
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

      {editId && isSuper ? (
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
                  required
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

      <LookupPageLayout
        icon={ListOrdered}
        wide
        title="Order statuses"
        description={
          <p>
            Global labels enabled for your company. Edit the matrix under{' '}
            {canViewMatrix ? (
              <Link className="font-medium text-teal-700 underline" to="/permissions/order-status-matrix">
                Permissions → Order status matrix
              </Link>
            ) : (
              <span className="font-medium text-slate-700">Permissions → Order status matrix</span>
            )}
            . Superadmin can add or edit global statuses here; everyone else sees the list for their company
            matrix.
          </p>
        }
        headerAside={
          isSuper ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              New status
            </button>
          ) : null
        }
      >
        <LookupSearchToolbar>
          <input
            type="search"
            placeholder="Filter by name…"
            className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:max-w-md"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} />
        </LookupSearchToolbar>

        {err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          {loading ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : (
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Sort</th>
                  <th className="px-4 py-2">Status</th>
                  {isSuper ? <th className="px-4 py-2 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr
                    key={r.id}
                    className={
                      r.active ? 'border-b border-slate-100' : 'border-b border-slate-100 bg-slate-50/60 text-slate-500'
                    }
                  >
                    <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-2 text-slate-600">{r.sort_order ?? 0}</td>
                    <td className="px-4 py-2">
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
                    {isSuper ? (
                      <td className="px-4 py-2 text-right">
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
          {!loading && rows?.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No statuses for your company in the matrix.</p>
          ) : null}
        </div>
      </LookupPageLayout>
    </>
  )
}
