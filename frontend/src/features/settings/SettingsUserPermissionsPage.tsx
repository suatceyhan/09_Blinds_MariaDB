import { useCallback, useEffect, useMemo, useState } from 'react'
import { appPages } from '@/config/appPages'
import { PermissionMatrixTree } from '@/components/permissions/PermissionMatrixTree'
import { buildHierarchy } from '@/utils/buildHierarchy'
import type { PermissionNode } from '@/components/permissions/PermissionMatrixTree'
import { getJson, postJson } from '@/lib/api'
import {
  applyUserPermissionToggle,
  normalizeModuleOverrideRows,
  type PermissionRow,
} from '@/features/settings/userPermissionRowsLogic'

const MIN_SEARCH_LEN = 3
const MAX_SEARCH_RESULTS = 25

type UserRow = { id: string; email: string; first_name: string; last_name: string }
type Assignment = {
  user_id: string
  role_id: string
  user_email: string
  role_name: string
}

export function SettingsUserPermissionsPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [userId, setUserId] = useState('')
  const [roleId, setRoleId] = useState('')
  const [rows, setRows] = useState<PermissionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')

  const permissionTree: PermissionNode[] = useMemo(() => {
    const roots = buildHierarchy(appPages)
    function toNode(n: (typeof roots)[0]): PermissionNode {
      return {
        id: n.id,
        name: n.name,
        permissions: n.permissions,
        children: n.children?.map(toNode),
      }
    }
    return roots.map(toNode)
  }, [])

  const permissionDetailMap = useMemo(() => {
    const m: Record<
      string,
      { role_is_granted: boolean; user_is_granted: boolean; user_override: boolean }
    > = {}
    rows.forEach((r) => {
      m[r.permission_key] = {
        role_is_granted: r.role_is_granted,
        user_is_granted: r.user_is_granted,
        user_override: r.user_override,
      }
    })
    return m
  }, [rows])

  const noopMap = useMemo(() => {
    const x: Record<string, boolean> = {}
    rows.forEach((r) => {
      x[r.permission_key] = r.user_is_granted
    })
    return x
  }, [rows])

  const rolesForSelectedUser = useMemo(() => {
    const ids = new Set(assignments.filter((a) => a.user_id === userId).map((a) => a.role_id))
    const list: { id: string; name: string }[] = []
    ids.forEach((rid) => {
      const a = assignments.find((x) => x.user_id === userId && x.role_id === rid)
      if (a) list.push({ id: rid, name: a.role_name })
    })
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [assignments, userId])

  const searchQuery = userSearch.trim().toLowerCase()
  const searchMatches = useMemo(() => {
    if (searchQuery.length < MIN_SEARCH_LEN) return []
    return users
      .filter(
        (u) =>
          u.email.toLowerCase().includes(searchQuery) ||
          `${u.first_name} ${u.last_name}`.toLowerCase().includes(searchQuery),
      )
      .slice(0, MAX_SEARCH_RESULTS)
  }, [users, searchQuery])

  const selectedUser = useMemo(() => users.find((u) => u.id === userId) ?? null, [users, userId])

  const loadBase = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([
        getJson<UserRow[]>('/users?limit=200'),
        getJson<
          {
            user_id: string
            role_id: string
            user_email: string
            role_name: string
          }[]
        >('/user-roles?limit=500'),
      ])
      setUsers(u)
      setAssignments(
        a.map((row) => ({
          user_id: row.user_id,
          role_id: row.role_id,
          user_email: row.user_email,
          role_name: row.role_name,
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load list')
    }
  }, [])

  useEffect(() => {
    void loadBase()
  }, [loadBase])

  useEffect(() => {
    if (!userId) return
    const options = rolesForSelectedUser
    if (options.length === 0) {
      setRoleId('')
      setRows([])
      return
    }
    setRoleId((prev) => (prev && options.some((o) => o.id === prev) ? prev : options[0].id))
  }, [userId, rolesForSelectedUser])

  useEffect(() => {
    if (!userId || !roleId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const q = new URLSearchParams({ user_id: userId, role_id: roleId })
        const data = await getJson<PermissionRow[]>(`/user-permission-grants/user-role-matrix?${q}`)
        if (!cancelled) setRows(normalizeModuleOverrideRows(appPages, data))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load matrix')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, roleId])

  const handleToggle = (
    permKey: string,
    value: boolean,
    _all?: string[],
    type?: 'is_granted' | 'override',
  ) => {
    setRows((prev) => applyUserPermissionToggle(appPages, prev, permKey, value, type))
  }

  async function handleSave() {
    if (!userId || !roleId) return
    setSaving(true)
    setError(null)
    try {
      const permissions: Record<string, boolean> = {}
      rows.forEach((row) => {
        if (row.user_override) {
          permissions[row.permission_id] = row.user_is_granted
        }
      })
      await postJson('/user-permission-grants/bulk-update', {
        user_id: userId,
        role_id: roleId,
        permissions,
      })
      const q = new URLSearchParams({ user_id: userId, role_id: roleId })
      const data = await getJson<PermissionRow[]>(`/user-permission-grants/user-role-matrix?${q}`)
      setRows(normalizeModuleOverrideRows(appPages, data))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function pickUser(id: string) {
    setUserId(id)
    setError(null)
  }

  function clearSelection() {
    setUserId('')
    setRoleId('')
    setRows([])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">User permissions</h1>
        <p className="mt-1 text-sm text-slate-600">
          Search with at least <strong>{MIN_SEARCH_LEN}</strong> characters and pick a user. The matrix edits{' '}
          <code className="text-xs">user_permissions</code> overrides for the selected user +{' '}
          <strong>role context</strong> below. With <strong>Override</strong> on, User view/edit apply; default is
          both on—turn off to deny even if the role grants (red-tinted switches).
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-slate-800">
          Find user
          <input
            type="search"
            autoComplete="off"
            placeholder={`At least ${MIN_SEARCH_LEN} characters (email or name)`}
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            aria-label="Find user"
          />
        </label>
        {searchQuery.length > 0 && searchQuery.length < MIN_SEARCH_LEN ? (
          <p className="mt-2 text-xs text-slate-500">Enter at least {MIN_SEARCH_LEN} characters to search.</p>
        ) : null}
        {searchQuery.length >= MIN_SEARCH_LEN ? (
          <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-100">
            {searchMatches.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">No matching users.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {searchMatches.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => pickUser(u.id)}
                      className={`flex w-full flex-col items-start px-3 py-2.5 text-left text-sm transition-colors hover:bg-teal-50 ${
                        u.id === userId ? 'bg-teal-50 font-medium text-teal-900' : 'text-slate-800'
                      }`}
                    >
                      <span>{u.email}</span>
                      <span className="text-xs text-slate-500">
                        {u.first_name} {u.last_name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {selectedUser ? (
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <span className="text-slate-500">Selected:</span>{' '}
            <span className="font-medium text-slate-900">{selectedUser.email}</span>
            <span className="text-slate-500">
              {' '}
              ({selectedUser.first_name} {selectedUser.last_name})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rolesForSelectedUser.length > 0 ? (
              <>
                <span className="text-xs font-medium tracking-wide text-slate-500">Role</span>
                {rolesForSelectedUser.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRoleId(r.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      r.id === roleId
                        ? 'border-teal-600 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300'
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </>
            ) : (
              <span className="text-amber-800">No roles assigned to this user.</span>
            )}
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {rolesForSelectedUser.length === 0 && userId ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Assign at least one role on the <strong>User roles</strong> page first.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : roleId && userId ? (
        <>
          <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <PermissionMatrixTree
              nodes={permissionTree}
              permissionMap={noopMap}
              permissionDetailMap={permissionDetailMap}
              onToggle={handleToggle}
              mode="user"
              canEdit
            />
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      ) : null}
    </div>
  )
}
