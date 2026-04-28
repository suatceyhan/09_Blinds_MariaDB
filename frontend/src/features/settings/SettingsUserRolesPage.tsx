import { useEffect, useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { deleteJson, getJson, postJson } from '@/lib/api'

type Role = { id: string; name: string }
type UserRow = { id: string; email: string; first_name: string; last_name: string }
type Assignment = {
  id: string
  user_id: string
  role_id: string
  user_email: string
  role_name: string
  created_at: string
  is_deleted: boolean
  /** false for SUPER_ADMIN_EMAIL + superadmin row from bootstrap */
  removable?: boolean
}

export function SettingsUserRolesPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [restoreId, setRestoreId] = useState<string | null>(null)

  const renderRowAction = (a: Assignment) => {
    const inactive = a.is_deleted
    if (inactive) {
      return (
        <button
          type="button"
          onClick={() => setRestoreId(a.id)}
          className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </button>
      )
    }
    if (a.removable === false) {
      return (
        <span className="text-xs font-medium text-slate-400" title="Protected bootstrap assignment">
          Protected
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setRemoveId(a.id)}
        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
      >
        Remove
      </button>
    )
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const assignUrl = showDeleted
        ? '/user-roles?limit=500&include_deleted=true'
        : '/user-roles?limit=500'
      const [a, u, r] = await Promise.all([
        getJson<Assignment[]>(assignUrl),
        getJson<UserRow[]>('/users?limit=200'),
        getJson<Role[]>('/roles?limit=200'),
      ])
      setAssignments(a)
      setUsers(u)
      // Superadmin is a bootstrap/system role; do not allow manual assignment from UI.
      setRoles(r.filter((x) => x.name.toLowerCase() !== 'superadmin'))
      if (!userId && u.length > 0) setUserId(u[0].id)
      if (!roleId && r.length > 0) {
        const pick = r.find((x) => x.name.toLowerCase() !== 'superadmin') ?? r[0]
        setRoleId(pick.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [showDeleted])

  const filteredAssignments = useMemo(() => {
    const q = assignmentSearch.trim().toLowerCase()
    if (!q) return assignments
    return assignments.filter(
      (a) =>
        a.user_email.toLowerCase().includes(q) || a.role_name.toLowerCase().includes(q),
    )
  }, [assignments, assignmentSearch])

  async function onAssign(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!userId || !roleId) return
    setSaving(true)
    setError(null)
    try {
      await postJson('/user-roles', { user_id: userId, role_id: roleId })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed')
    } finally {
      setSaving(false)
    }
  }

  async function executeRestore() {
    if (!restoreId) return
    const target = assignments.find((a) => a.id === restoreId)
    setRestoreId(null)
    if (!target) return
    setError(null)
    try {
      await postJson('/user-roles', { user_id: target.user_id, role_id: target.role_id })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  async function executeRemove() {
    if (!removeId) return
    const id = removeId
    setRemoveId(null)
    setError(null)
    try {
      await deleteJson(`/user-roles/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    }
  }

  const removeAssignment = assignments.find((a) => a.id === removeId)
  const restoreAssignment = assignments.find((a) => a.id === restoreId)

  if (loading && assignments.length === 0 && users.length === 0) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ConfirmModal
        open={removeId != null}
        title="Remove role assignment?"
        description={
          removeAssignment
            ? `Remove ${removeAssignment.role_name} from ${removeAssignment.user_email}? This uses soft delete and can be reassigned later.`
            : 'Remove this role assignment?'
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void executeRemove()}
        onCancel={() => setRemoveId(null)}
      />
      <ConfirmModal
        open={restoreId != null}
        title="Restore role assignment?"
        description={
          restoreAssignment
            ? `Restore ${restoreAssignment.role_name} for ${restoreAssignment.user_email}? The assignment will be active again.`
            : 'Restore this role assignment?'
        }
        confirmLabel="Restore"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void executeRestore()}
        onCancel={() => setRestoreId(null)}
      />
      <div>
        <h1 className="text-xl font-semibold text-slate-900">User roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Assign additional roles to users. They can switch active role from the header.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={(e) => void onAssign(e)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-medium text-slate-800">New assignment</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">User</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.first_name} {u.last_name})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-700">
            <span className="mb-1 block font-medium">Role</span>
            <select
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={saving || !userId || !roleId}
          className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? 'Assigning…' : 'Assign role'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Assignments</h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ShowDeletedToggle
              id="assignments-show-deleted"
              checked={showDeleted}
              onChange={setShowDeleted}
              disabled={loading}
            />
            <input
              type="search"
              placeholder="Email or role name…"
              value={assignmentSearch}
              onChange={(e) => setAssignmentSearch(e.target.value)}
              className="min-w-[10rem] max-w-[18rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              aria-label="Search assignments"
            />
          </div>
        </div>
        {filteredAssignments.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            {assignments.length === 0 ? 'No assignments yet.' : 'No matching assignments.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredAssignments.map((a) => {
              const inactive = a.is_deleted
              return (
                <li
                  key={a.id}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${
                    inactive ? 'bg-slate-50/90' : ''
                  }`}
                >
                  <div>
                    <span className={`font-medium ${inactive ? 'text-slate-600' : 'text-slate-900'}`}>
                      {a.user_email}
                    </span>
                    <span className="text-slate-400"> → </span>
                    <span className={inactive ? 'text-slate-500' : 'text-teal-800'}>{a.role_name}</span>
                    {inactive ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  {renderRowAction(a)}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
