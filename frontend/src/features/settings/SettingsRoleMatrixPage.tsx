import { useEffect, useMemo, useState } from 'react'
import { appPages } from '@/config/appPages'
import { PermissionMatrixTree } from '@/components/permissions/PermissionMatrixTree'
import type { PermissionNode } from '@/components/permissions/PermissionMatrixTree'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { buildHierarchy } from '@/utils/buildHierarchy'
import { getJson, putJson } from '@/lib/api'
import { applyRoleMatrixToggle } from '@/features/settings/roleMatrixTreeLogic'

type Role = { id: string; name: string; is_protected?: boolean }
type Permission = { id: string; key: string; name: string }

export function SettingsRoleMatrixPage() {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [keyMap, setKeyMap] = useState<Record<string, boolean>>({})
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingRoleSwitch, setPendingRoleSwitch] = useState<string | null>(null)

  const permissionTree = useMemo(() => {
    const roots = buildHierarchy(appPages)
    function toPermissionNode(n: (typeof roots)[0]): PermissionNode {
      return {
        id: n.id,
        name: n.name,
        permissions: n.permissions,
        children: n.children?.map(toPermissionNode),
      }
    }
    return roots.map(toPermissionNode)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [r, p] = await Promise.all([
          getJson<Role[]>('/roles?limit=200'),
          getJson<Permission[]>('/permissions?limit=500'),
        ])
        if (cancelled) return
        setRoles(r)
        setPermissions(p)
        setSelectedRoleId((prev) => {
          if (prev) return prev
          if (r.length === 0) return null
          return (r.find((x) => x.name.toLowerCase() !== 'superadmin') ?? r[0]).id
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedRoleId || permissions.length === 0) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const matrix = await getJson<Record<string, boolean>>(
          `/role-permission-grants/matrix/${selectedRoleId}`,
        )
        const map: Record<string, boolean> = {}
        permissions.forEach((p) => {
          if (p.key) map[p.key] = false
        })
        for (const [permId, granted] of Object.entries(matrix)) {
          const row = permissions.find((p) => p.id === permId)
          if (row?.key) map[row.key] = !!granted
        }
        if (!cancelled) {
          setKeyMap(map)
          setDirty(false)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load matrix')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedRoleId, permissions])

  const handleToggle = (
    permKey: string,
    value: boolean,
    allChildKeys?: string[],
    _type?: 'is_granted' | 'override',
  ) => {
    setKeyMap((prev) =>
      applyRoleMatrixToggle(appPages, prev, permKey, value, allChildKeys, 'is_granted'),
    )
    setDirty(true)
  }

  /** Gör + düz kapatmayı tek state güncellemesinde birleştirir (ardışık setKeyMap eski prev ile çakışmasın). */
  function handleRoleViewRowToggle(
    viewKey: string,
    editKey: string,
    checked: boolean,
    allViewKeys: string[],
    allEditKeys: string[],
  ) {
    setKeyMap((prev) => {
      let next = applyRoleMatrixToggle(appPages, prev, viewKey, checked, allViewKeys, 'is_granted')
      if (!checked) {
        next = applyRoleMatrixToggle(appPages, next, editKey, false, allEditKeys, 'is_granted')
      }
      return next
    })
    setDirty(true)
  }

  async function handleSave() {
    if (!selectedRoleId) return
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, boolean> = {}
      for (const [k, val] of Object.entries(keyMap)) {
        const perm = permissions.find((p) => p.key === k)
        if (perm) payload[perm.id] = val === true
      }
      await putJson(`/role-permission-grants/matrix/${selectedRoleId}`, payload)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleRoleChange(id: string) {
    if (id === selectedRoleId) return
    if (dirty) {
      setPendingRoleSwitch(id)
      return
    }
    setSelectedRoleId(id)
  }

  function confirmSwitchRole() {
    if (pendingRoleSwitch) setSelectedRoleId(pendingRoleSwitch)
    setPendingRoleSwitch(null)
  }

  return (
    <div className="flex min-h-[60vh] flex-col gap-6 lg:flex-row">
      <ConfirmModal
        open={pendingRoleSwitch != null}
        title="Discard unsaved changes?"
        description="You have unsaved permission changes. Switching roles will discard them. Do you want to continue?"
        confirmLabel="Discard and switch"
        cancelLabel="Stay"
        variant="danger"
        onConfirm={confirmSwitchRole}
        onCancel={() => setPendingRoleSwitch(null)}
      />
      <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:w-64">
        <h3 className="mb-3 font-semibold text-slate-900">Roles</h3>
        <ul className="space-y-1">
          {roles.map((role, idx) => (
            <li key={role.id} className={idx % 2 === 1 ? 'rounded bg-slate-50' : ''}>
              <button
                type="button"
                className={`w-full rounded px-3 py-2 text-left text-sm ${
                  role.id === selectedRoleId
                    ? 'bg-teal-50 font-semibold text-teal-900'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
                onClick={() => handleRoleChange(role.id)}
              >
                {role.name}
                {role.is_protected ? (
                  <span className="ml-2 text-xs text-amber-600">(protected)</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">Role permissions (matrix)</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tree and permission keys match the backend. Turning off View removes that module from the menu for
            this role; Edit depends on View.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {!selectedRoleId ? (
          <p className="text-slate-500">Select a role.</p>
        ) : loading ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-100 p-2">
              <PermissionMatrixTree
                nodes={permissionTree}
                permissionMap={keyMap}
                onToggle={handleToggle}
                onRoleViewRowToggle={handleRoleViewRowToggle}
                mode="role"
                canEdit
              />
            </div>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
              className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </main>
    </div>
  )
}
