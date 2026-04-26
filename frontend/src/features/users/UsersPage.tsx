import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  Eye,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
  Unlink,
  User as UserIcon,
} from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { useAuthSession } from '@/app/authSession'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'

type UserRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string
  company_id: string | null
  company_name: string | null
  /** Tüm aktif şirket üyelikleri (UserCompanyMembership). */
  companies?: { id: string; name: string }[]
  is_deleted: boolean
  roles: string[]
}

type CompanyOption = { id: string; name: string }
type RoleOption = { id: string; name: string }

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

function rowHasSuperadminRole(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === 'superadmin')
}

function rowDisplayLabel(r: UserRow): string {
  const n = `${r.first_name} ${r.last_name}`.trim()
  return n || r.email
}

type PendingUserConfirm =
  | { kind: 'deactivate'; id: string; display: string }
  | { kind: 'restore'; id: string; display: string }

type PendingUnlinkCompany = {
  userId: string
  userDisplay: string
  companyId: string
  companyName: string
}

export function UsersPage() {
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canEdit = Boolean(me?.permissions.includes('users.directory.edit'))
  const canViewCompanies = Boolean(me?.permissions.includes('companies.view'))

  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDeleted, setShowDeleted] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([])
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [defaultRoleName, setDefaultRoleName] = useState('user')
  const [createCompanyId, setCreateCompanyId] = useState('')
  const [saving, setSaving] = useState(false)
  /** Tarayıcı giriş otomatik doldurmasını engellemek için ilk odaklanmaya kadar readOnly. */
  const [createEmailLocked, setCreateEmailLocked] = useState(true)
  const [createPasswordLocked, setCreatePasswordLocked] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [linkUserId, setLinkUserId] = useState<string | null>(null)
  const [linkCompanyId, setLinkCompanyId] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)

  const [editUserId, setEditUserId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editRoleName, setEditRoleName] = useState('user')
  const [editSaving, setEditSaving] = useState(false)
  const [editEmailLocked, setEditEmailLocked] = useState(true)
  const [editPasswordLocked, setEditPasswordLocked] = useState(true)

  const [pendingUserConfirm, setPendingUserConfirm] = useState<PendingUserConfirm | null>(null)
  const [confirmUserActionPending, setConfirmUserActionPending] = useState(false)

  const [pendingUnlink, setPendingUnlink] = useState<PendingUnlinkCompany | null>(null)
  const [unlinkConfirmPending, setUnlinkConfirmPending] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (roleFilter.trim()) p.set('role', roleFilter.trim())
    if (isSuperadmin && companyFilter) p.set('company_id', companyFilter)
    if (isSuperadmin && showDeleted) p.set('include_deleted', 'true')
    return p.toString()
  }, [debouncedSearch, roleFilter, companyFilter, isSuperadmin, showDeleted])

  useEffect(() => {
    if (!me) return
    let c = false
    ;(async () => {
      if (!isSuperadmin) return
      try {
        const cos = await getJson<CompanyOption[]>('/companies')
        if (!c) setCompanyOptions(cos)
      } catch {
        if (!c) setCompanyOptions([])
      }
    })()
    return () => {
      c = true
    }
  }, [me, isSuperadmin])

  useEffect(() => {
    if (!me) return
    let c = false
    ;(async () => {
      try {
        const r = await getJson<RoleOption[]>('/roles?limit=200')
        if (!c) {
          setRoleOptions(r.filter((x) => x.name.toLowerCase() !== 'superadmin'))
        }
      } catch {
        if (!c) setRoleOptions([])
      }
    })()
    return () => {
      c = true
    }
  }, [me])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<UserRow[]>(`/users?${listParams}`)
        if (!cancelled) {
          setRows(list)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load users')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, listParams])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !email.trim() || !password || !firstName.trim() || !lastName.trim() || !phone.trim()) {
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        default_role_name: defaultRoleName.trim() || 'user',
      }
      if (isSuperadmin && createCompanyId) body.company_id = createCompanyId
      await postJson('/users', body)
      setEmail('')
      setPassword('')
      setFirstName('')
      setLastName('')
      setPhone('')
      setCreateCompanyId('')
      setCreateEmailLocked(true)
      setCreatePasswordLocked(true)
      const list = await getJson<UserRow[]>(`/users?${listParams}`)
      setRows(list)
      setShowCreateForm(false)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function closeCreateForm() {
    setShowCreateForm(false)
  }

  async function onEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editUserId || !editEmail.trim() || !editFirstName.trim() || !editLastName.trim() || !editPhone.trim()) {
      return
    }
    setEditSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        email: editEmail.trim(),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
        phone: editPhone.trim(),
        default_role_name: editRoleName.trim() || 'user',
      }
      if (editPassword.trim()) body.password = editPassword.trim()
      await patchJson<UserRow>(`/users/${editUserId}`, body)
      setEditUserId(null)
      setEditPassword('')
      const list = await getJson<UserRow[]>(`/users?${listParams}`)
      setRows(list)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function executePendingUserConfirm() {
    if (!pendingUserConfirm) return
    setConfirmUserActionPending(true)
    setErr(null)
    try {
      if (pendingUserConfirm.kind === 'deactivate') {
        await deleteJson(`/users/${pendingUserConfirm.id}`)
      } else {
        await postJson(`/users/${pendingUserConfirm.id}/restore`, {})
      }
      setPendingUserConfirm(null)
      const list = await getJson<UserRow[]>(`/users?${listParams}`)
      setRows(list)
    } catch (err) {
      setErr(
        err instanceof Error
          ? err.message
          : pendingUserConfirm.kind === 'deactivate'
            ? 'Deactivate failed'
            : 'Restore failed',
      )
    } finally {
      setConfirmUserActionPending(false)
    }
  }

  async function onLinkCompany(e: React.FormEvent) {
    e.preventDefault()
    if (!linkUserId || !linkCompanyId) return
    setLinkSaving(true)
    setErr(null)
    try {
      await postJson(`/users/${linkUserId}/companies`, { company_id: linkCompanyId })
      setLinkUserId(null)
      setLinkCompanyId('')
      const list = await getJson<UserRow[]>(`/users?${listParams}`)
      setRows(list)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Could not link company')
    } finally {
      setLinkSaving(false)
    }
  }

  function sessionTenantCompanyId(): string | null {
    const id = me?.active_company_id ?? me?.company_id ?? null
    return id != null && String(id).length > 0 ? String(id) : null
  }

  function canUnlinkCompanyMembership(
    r: UserRow,
    companyId: string,
    canMutateRow: boolean,
  ): boolean {
    if (!canEdit || !canMutateRow || r.is_deleted) return false
    if (isSuperadmin) return true
    const sc = sessionTenantCompanyId()
    return sc != null && String(companyId) === sc
  }

  async function executeUnlinkCompany() {
    if (!pendingUnlink) return
    setUnlinkConfirmPending(true)
    setErr(null)
    try {
      await deleteJson(`/users/${pendingUnlink.userId}/companies/${pendingUnlink.companyId}`)
      setPendingUnlink(null)
      const list = await getJson<UserRow[]>(`/users?${listParams}`)
      setRows(list)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Could not remove company membership')
    } finally {
      setUnlinkConfirmPending(false)
    }
  }

  if (!me) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ConfirmModal
        open={pendingUserConfirm !== null}
        title={
          pendingUserConfirm?.kind === 'restore' ? 'Restore user' : 'Deactivate user'
        }
        description={
          pendingUserConfirm == null
            ? ''
            : pendingUserConfirm.kind === 'deactivate'
              ? `${pendingUserConfirm.display} will not be able to sign in until an administrator restores the account.`
              : `Restore access for ${pendingUserConfirm.display}? They will be able to sign in again.`
        }
        confirmLabel={pendingUserConfirm?.kind === 'restore' ? 'Restore' : 'Deactivate'}
        cancelLabel="Cancel"
        variant={pendingUserConfirm?.kind === 'deactivate' ? 'danger' : 'default'}
        pending={confirmUserActionPending}
        onConfirm={() => void executePendingUserConfirm()}
        onCancel={() => {
          if (!confirmUserActionPending) setPendingUserConfirm(null)
        }}
      />

      <ConfirmModal
        open={pendingUnlink !== null}
        title="Remove company membership"
        description={
          pendingUnlink == null
            ? ''
            : `Remove “${pendingUnlink.companyName}” from ${pendingUnlink.userDisplay}? They lose access to that organization until linked again.`
        }
        confirmLabel="Remove membership"
        cancelLabel="Cancel"
        variant="danger"
        pending={unlinkConfirmPending}
        onConfirm={() => void executeUnlinkCompany()}
        onCancel={() => {
          if (!unlinkConfirmPending) setPendingUnlink(null)
        }}
      />

      {editUserId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            autoComplete="off"
            onSubmit={(e) => void onEditSave(e)}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-900">Edit user</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Leave password empty to keep the current one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditUserId(null)
                  setEditPassword('')
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Email</span>
                <input
                  type="email"
                  name="edit_user_email"
                  required
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editEmail}
                  readOnly={editEmailLocked}
                  onFocus={() => setEditEmailLocked(false)}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">New password (optional)</span>
                <input
                  type="password"
                  name="edit_user_password"
                  minLength={6}
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editPassword}
                  readOnly={editPasswordLocked}
                  onFocus={() => setEditPasswordLocked(false)}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">First name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Last name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Phone</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Role</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                >
                  {roleOptions.map((r) => (
                    <option key={r.id} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setEditUserId(null)
                  setEditPassword('')
                }}
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

      {linkUserId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => void onLinkCompany(e)}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">Link user to company</h2>
            <p className="mt-1 text-xs text-slate-600">Adds organization membership (superadmin: any company).</p>
            <label className="mt-3 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Company</span>
              <select
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={linkCompanyId}
                onChange={(e) => setLinkCompanyId(e.target.value)}
              >
                <option value="">Select…</option>
                {companyOptions.map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setLinkUserId(null)
                  setLinkCompanyId('')
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={linkSaving}
                className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {linkSaving ? 'Saving…' : 'Link'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <UserIcon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Users</h1>
            <p className="mt-1 text-slate-600">
              {isSuperadmin
                ? 'All accounts. Company filter limits rows to members of that organization.'
                : 'Users linked to your active company. New users are created in that company automatically.'}
            </p>
          </div>
        </div>
        {canEdit && !showCreateForm ? (
          <div className="ml-auto flex shrink-0 items-center sm:pt-1">
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Create user
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p>
      ) : null}

      {canEdit && showCreateForm ? (
        <form
          autoComplete="off"
          onSubmit={(e) => void onCreate(e)}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-800">New user</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Email</span>
              <input
                type="email"
                name="new_user_email"
                required
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={email}
                readOnly={createEmailLocked}
                onFocus={() => setCreateEmailLocked(false)}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Password</span>
              <input
                type="password"
                name="new_user_password"
                required
                minLength={6}
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={password}
                readOnly={createPasswordLocked}
                onFocus={() => setCreatePasswordLocked(false)}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">First name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Last name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Phone</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Role</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={defaultRoleName}
                onChange={(e) => setDefaultRoleName(e.target.value)}
              >
                {roleOptions.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {isSuperadmin ? (
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Company (optional)</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={createCompanyId}
                  onChange={(e) => setCreateCompanyId(e.target.value)}
                >
                  <option value="">No company yet</option>
                  {companyOptions.map((co) => (
                    <option key={co.id} value={co.id}>
                      {co.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={closeCreateForm}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Directory</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isSuperadmin ? (
              <ShowDeletedToggle
                id="users-show-deleted"
                checked={showDeleted}
                onChange={setShowDeleted}
                disabled={loading}
              />
            ) : null}
            {isSuperadmin ? (
              <select
                className="max-w-[10rem] rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                aria-label="Filter by company"
              >
                <option value="">All companies</option>
                {companyOptions.map((co) => (
                  <option key={co.id} value={co.id}>
                    {co.name}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="search"
              placeholder="Search name, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-[8rem] max-w-[14rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              aria-label="Search users"
            />
            <input
              type="search"
              placeholder="Role contains…"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="min-w-[6rem] max-w-[10rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              aria-label="Filter by role name"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Roles</th>
                {canEdit ? (
                  <th className="min-w-[13rem] whitespace-nowrap px-4 py-3 text-right sm:px-4">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading || rows === null ? (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-4 py-10 text-center text-slate-500">
                    No users found.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const canMutateRow =
                    canEdit && (!rowHasSuperadminRole(r.roles) || isSuperadmin)
                  return (
                  <tr
                    key={r.id}
                    className={r.is_deleted ? 'bg-slate-50/90' : 'hover:bg-slate-50/80'}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/users/${r.id}`}
                        className={
                          r.is_deleted
                            ? 'font-medium text-slate-500 line-through hover:text-slate-800 hover:underline'
                            : 'font-semibold text-slate-900 hover:text-slate-950 hover:underline'
                        }
                      >
                        {r.first_name} {r.last_name}
                      </Link>
                      {r.is_deleted ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                          Inactive
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.email}</td>
                    <td className="px-4 py-3 text-slate-600">{r.phone}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="flex flex-wrap gap-1">
                        {(r.companies?.length ?? 0) > 0
                          ? r.companies!.map((c) => {
                              const showUnlink = canUnlinkCompanyMembership(r, c.id, canMutateRow)
                              return (
                                <span
                                  key={c.id}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2 pr-1 text-xs font-medium text-slate-700"
                                >
                                  <Building2 className="h-3 w-3 shrink-0 opacity-60" strokeWidth={2} />
                                  {canViewCompanies ? (
                                    <Link
                                      to={`/companies/${c.id}`}
                                      className="min-w-0 truncate font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                                    >
                                      {c.name}
                                    </Link>
                                  ) : (
                                    <span className="min-w-0 truncate">{c.name}</span>
                                  )}
                                  {showUnlink ? (
                                    <button
                                      type="button"
                                      title="Remove membership"
                                      onClick={() =>
                                        setPendingUnlink({
                                          userId: r.id,
                                          userDisplay: rowDisplayLabel(r),
                                          companyId: c.id,
                                          companyName: c.name,
                                        })
                                      }
                                      className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200/90 hover:text-red-700"
                                      aria-label={`Unlink ${c.name}`}
                                    >
                                      <Unlink className="h-3 w-3" strokeWidth={2} />
                                    </button>
                                  ) : null}
                                </span>
                              )
                            })
                          : r.company_name
                            ? (
                                <span className="inline-flex items-center gap-1">
                                  <Building2 className="h-3.5 w-3.5 opacity-60" strokeWidth={2} />
                                  {canViewCompanies && r.company_id ? (
                                    <Link
                                      to={`/companies/${r.company_id}`}
                                      className="font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                                    >
                                      {r.company_name}
                                    </Link>
                                  ) : (
                                    r.company_name
                                  )}
                                  {r.company_id &&
                                  canUnlinkCompanyMembership(r, r.company_id, canMutateRow) ? (
                                    <button
                                      type="button"
                                      title="Remove membership"
                                      onClick={() =>
                                        setPendingUnlink({
                                          userId: r.id,
                                          userDisplay: rowDisplayLabel(r),
                                          companyId: r.company_id!,
                                          companyName: r.company_name!,
                                        })
                                      }
                                      className="ml-0.5 shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200/90 hover:text-red-700"
                                      aria-label={`Unlink ${r.company_name}`}
                                    >
                                      <Unlink className="h-3.5 w-3.5" strokeWidth={2} />
                                    </button>
                                  ) : null}
                                </span>
                              )
                            : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {r.roles.map((role) => (
                          <span
                            key={role}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                          >
                            {role}
                          </span>
                        ))}
                      </span>
                    </td>
                    {canEdit ? (
                      <td className="align-top px-4 py-3 text-right sm:px-4">
                        <div className="flex flex-col items-end gap-1 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-x-2">
                          <Link
                            to={`/users/${r.id}`}
                            className="inline-flex rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                            title="View user"
                            aria-label="View user"
                          >
                            <Eye className="h-4 w-4" strokeWidth={2} />
                          </Link>
                          {canMutateRow ? (
                            <Link
                              to={`/users/${encodeURIComponent(r.id)}/edit`}
                              className="inline-flex rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                              title="Edit user"
                              aria-label="Edit user"
                            >
                              <Pencil className="h-4 w-4" strokeWidth={2} />
                            </Link>
                          ) : null}
                          {canMutateRow && !r.is_deleted && r.id !== me.id ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingUserConfirm({
                                  kind: 'deactivate',
                                  id: r.id,
                                  display: rowDisplayLabel(r),
                                })
                              }
                              className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                              title="Deactivate user"
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          ) : null}
                          {canMutateRow && isSuperadmin && showDeleted && r.is_deleted ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingUserConfirm({
                                  kind: 'restore',
                                  id: r.id,
                                  display: rowDisplayLabel(r),
                                })
                              }
                              className="rounded-lg border border-teal-200 p-1.5 text-teal-800 hover:bg-teal-50"
                              title="Restore user"
                            >
                              <RotateCcw className="h-4 w-4" strokeWidth={2} />
                            </button>
                          ) : null}
                          {isSuperadmin && canMutateRow ? (
                            <button
                              type="button"
                              onClick={() => {
                                setLinkUserId(r.id)
                                setLinkCompanyId('')
                              }}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                              title="Link company"
                              aria-label="Link company"
                            >
                              <Link2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          ) : null}
                          {!canMutateRow ? (
                            <span
                              className="text-xs text-slate-400"
                              title="Only a superadmin can change this account"
                            >
                              —
                            </span>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
