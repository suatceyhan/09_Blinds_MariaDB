import { useEffect, useState } from 'react'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'
import { isReservedSystemRoleName } from '@/lib/systemRoles'

type Role = {
  id: string
  name: string
  description: string | null
  is_protected: boolean
  is_deleted?: boolean
}

export function SettingsRolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [restoreRoleId, setRestoreRoleId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const q = showDeleted ? '/roles?limit=200&include_deleted=true' : '/roles?limit=200'
      const r = await getJson<Role[]>(q)
      setRoles(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [showDeleted])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await postJson<Role>('/roles', {
        name: name.trim(),
        description: description.trim() || null,
        is_protected: false,
      })
      setName('')
      setDescription('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(r: Role) {
    setEditing(r)
    setEditName(r.name)
    setEditDescription(r.description ?? '')
    setError(null)
  }

  function closeEdit() {
    setEditing(null)
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setEditSaving(true)
    setError(null)
    try {
      await patchJson<Role>(`/roles/${editing.id}`, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      })
      closeEdit()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function executeRestore() {
    if (!restoreRoleId) return
    const target = roles.find((r) => r.id === restoreRoleId)
    setRestoreRoleId(null)
    if (!target) return
    setError(null)
    try {
      await patchJson<Role>(`/roles/${target.id}`, { is_deleted: false })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  async function executeDelete() {
    if (!deleteTarget || isReservedSystemRoleName(deleteTarget.name)) {
      setDeleteTarget(null)
      return
    }
    const r = deleteTarget
    setDeleteTarget(null)
    setError(null)
    try {
      await deleteJson(`/roles/${r.id}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const restoreTarget = roles.find((r) => r.id === restoreRoleId)

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ConfirmModal
        open={deleteTarget != null}
        title="Deactivate role?"
        description={
          deleteTarget
            ? `Soft-delete role "${deleteTarget.name}"? It can be restored from the database if needed; assignments stay historical.`
            : ''
        }
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void executeDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmModal
        open={restoreRoleId != null}
        title="Restore role?"
        description={
          restoreTarget
            ? `Activate role "${restoreTarget.name}" again? It will appear in lists and can receive assignments.`
            : ''
        }
        confirmLabel="Restore"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void executeRestore()}
        onCancel={() => setRestoreRoleId(null)}
      />
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Create roles and link permissions on the <strong>Role permissions</strong> page.{' '}
          <strong>superadmin, admin, user</strong> are system roles and cannot be edited or removed.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => void onSaveEdit(e)}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">Edit role</h2>
            <div className="mt-3 space-y-3">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Description</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
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

      <form onSubmit={(e) => void onCreate(e)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-slate-800">New role</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">Name</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. field_worker"
              required
            />
          </label>
          <label className="block text-sm text-slate-700 sm:col-span-2">
            <span className="mb-1 block font-medium">Description (optional)</span>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Existing roles</h2>
          <ShowDeletedToggle
            id="roles-show-deleted"
            checked={showDeleted}
            onChange={setShowDeleted}
            disabled={loading}
          />
        </div>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : roles.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No roles.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {roles.map((r) => {
              const reserved = isReservedSystemRoleName(r.name)
              const inactive = r.is_deleted === true
              return (
                <li
                  key={r.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${
                    inactive ? 'bg-slate-50/90' : ''
                  }`}
                >
                  <div>
                    <span className={`font-medium ${inactive ? 'text-slate-600 line-through' : 'text-slate-900'}`}>
                      {r.name}
                    </span>
                    {inactive ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        Inactive
                      </span>
                    ) : null}
                    {reserved || r.is_protected ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {reserved ? 'system' : 'protected'}
                      </span>
                    ) : null}
                    {r.description ? (
                      <p className={inactive ? 'text-slate-400' : 'text-slate-500'}>{r.description}</p>
                    ) : null}
                  </div>
                  {inactive && !reserved ? (
                    <button
                      type="button"
                      onClick={() => setRestoreRoleId(r.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </button>
                  ) : null}
                  {!inactive && !reserved ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
