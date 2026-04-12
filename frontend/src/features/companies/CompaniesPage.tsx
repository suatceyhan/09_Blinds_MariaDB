import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { useAuthSession } from '@/app/authSession'
import { deleteJson, getJson, patchJson, postJson, postMultipartJson } from '@/lib/api'
import { mapsLinkForCompany } from '@/lib/googleMaps'

type CompanyOwner = {
  id: string
  email: string
  first_name: string
  last_name: string
}

type CompanyRow = {
  id: string
  name: string
  phone: string | null
  website: string | null
  email: string | null
  address?: string | null
  maps_url?: string | null
  owner_user_id?: string | null
  owner?: CompanyOwner | null
  logo_url?: string | null
  is_deleted?: boolean
}

type UserPickRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  companies?: { id: string; name: string }[]
}

function userPickLabel(u: UserPickRow): string {
  const n = `${u.first_name} ${u.last_name}`.trim()
  return n ? `${n} (${u.email})` : u.email
}

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

export function CompaniesPage() {
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canViewUserDir = Boolean(me?.permissions.includes('users.directory.view'))

  const [rows, setRows] = useState<CompanyRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDeleted, setShowDeleted] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const listPath = useMemo(() => {
    const params = new URLSearchParams()
    if (isSuperadmin && showDeleted) params.set('include_deleted', 'true')
    const q = debouncedSearch.trim()
    if (q) params.set('search', q)
    return params.toString() ? `/companies?${params.toString()}` : '/companies'
  }, [isSuperadmin, showDeleted, debouncedSearch])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')
  const [createLogoFile, setCreateLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const [userPickList, setUserPickList] = useState<UserPickRow[]>([])

  const [editing, setEditing] = useState<CompanyRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editWebsite, setEditWebsite] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editOwnerUserId, setEditOwnerUserId] = useState('')
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null)
  const [restoreId, setRestoreId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!me || !isSuperadmin) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await getJson<UserPickRow[]>('/users?limit=200')
        if (!cancelled) setUserPickList(list)
      } catch {
        if (!cancelled) setUserPickList([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, isSuperadmin])

  const ownerChoicesForEdit = useMemo(() => {
    if (!editing) return userPickList
    const inCo = userPickList.filter((u) =>
      (u.companies ?? []).some((c) => c.id === editing.id),
    )
    return inCo.length > 0 ? inCo : userPickList
  }, [userPickList, editing])

  async function reloadRows() {
    setRows(await getJson<CompanyRow[]>(listPath))
  }

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<CompanyRow[]>(listPath)
        if (!cancelled) {
          setRows(list)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load companies')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, listPath])

  function openEdit(r: CompanyRow) {
    setEditing(r)
    setEditName(r.name)
    setEditPhone(r.phone ?? '')
    setEditEmail(r.email ?? '')
    setEditWebsite(r.website ?? '')
    setEditAddress(r.address ?? '')
    setEditOwnerUserId(r.owner_user_id ?? '')
    setEditLogoFile(null)
    setErr(null)
  }

  function closeEdit() {
    setEditing(null)
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing || !editName.trim()) return
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson<CompanyRow>(`/companies/${editing.id}`, {
        name: editName.trim(),
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        website: editWebsite.trim() || null,
        address: editAddress.trim() || null,
        owner_user_id: editOwnerUserId.trim() ? editOwnerUserId.trim() : null,
      })
      closeEdit()
      await reloadRows()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      const created = await postJson<CompanyRow>('/companies', {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        owner_user_id: ownerUserId.trim() || null,
      })
      if (createLogoFile) {
        const fd = new FormData()
        fd.append('file', createLogoFile)
        await postMultipartJson<CompanyRow>(`/companies/${created.id}/logo`, fd)
      }
      setName('')
      setPhone('')
      setEmail('')
      setWebsite('')
      setAddress('')
      setOwnerUserId('')
      setCreateLogoFile(null)
      await reloadRows()
      setShowCreateForm(false)
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function closeCreateForm() {
    setShowCreateForm(false)
    setCreateLogoFile(null)
  }

  async function uploadEditLogo() {
    if (!editing || !editLogoFile) return
    setLogoBusy(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', editLogoFile)
      const updated = await postMultipartJson<CompanyRow>(`/companies/${editing.id}/logo`, fd)
      setEditing((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev))
      setEditLogoFile(null)
      await reloadRows()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeEditLogo() {
    if (!editing?.logo_url) return
    setLogoBusy(true)
    setErr(null)
    try {
      await deleteJson(`/companies/${editing.id}/logo`)
      setEditing((prev) => (prev ? { ...prev, logo_url: null } : null))
      await reloadRows()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Could not remove logo')
    } finally {
      setLogoBusy(false)
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    setErr(null)
    try {
      await deleteJson(`/companies/${t.id}`)
      await reloadRows()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function executeRestore() {
    if (!restoreId) return
    const id = restoreId
    setRestoreId(null)
    setErr(null)
    try {
      await patchJson<CompanyRow>(`/companies/${id}`, { is_deleted: false })
      await reloadRows()
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Restore failed')
    }
  }

  const restoreTarget = rows?.find((r) => r.id === restoreId)

  if (!me) {
    return (
      <div className="w-full">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <ConfirmModal
        open={deleteTarget != null}
        title="Deactivate company?"
        description={
          deleteTarget
            ? `Soft-delete "${deleteTarget.name}"? It can be restored while "Show deleted" is on.`
            : ''
        }
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void executeDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmModal
        open={restoreId != null}
        title="Restore company?"
        description={
          restoreTarget
            ? `Activate "${restoreTarget.name}" again? It will appear in normal lists.`
            : ''
        }
        confirmLabel="Restore"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={() => void executeRestore()}
        onCancel={() => setRestoreId(null)}
      />

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
            <h2 className="text-sm font-semibold text-slate-900">Edit company</h2>
            <div className="mt-3 grid gap-3">
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Phone</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Email</span>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Website</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editWebsite}
                  onChange={(e) => setEditWebsite(e.target.value)}
                  placeholder="example.com"
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Address</span>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Street, city…"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Kaydettiğinizde Google Maps bağlantısı bu adresten otomatik oluşturulur.
                </span>
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Owner</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editOwnerUserId}
                  onChange={(e) => setEditOwnerUserId(e.target.value)}
                >
                  <option value="">No owner</option>
                  {ownerChoicesForEdit.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userPickLabel(u)}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  Listed users include this company&apos;s members (or all users if none). The user is
                  granted membership if needed.
                </span>
              </label>
              <div className="rounded-lg border border-slate-100 bg-slate-50/90 p-3 sm:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-700">Logo</span>
                {editing.logo_url ? (
                  <img
                    src={editing.logo_url}
                    alt=""
                    className="mb-2 h-16 w-16 rounded-lg bg-white object-contain p-1 ring-1 ring-slate-200"
                  />
                ) : (
                  <p className="mb-2 text-xs text-slate-500">No logo uploaded.</p>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                  className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-teal-600 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white"
                  onChange={(e) => setEditLogoFile(e.target.files?.[0] ?? null)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!editLogoFile || logoBusy}
                    onClick={() => void uploadEditLogo()}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {logoBusy ? 'Uploading…' : 'Upload logo'}
                  </button>
                  <button
                    type="button"
                    disabled={!editing.logo_url || logoBusy}
                    onClick={() => void removeEditLogo()}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove logo
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">PNG, JPEG, WebP veya GIF; en fazla 2MB.</p>
              </div>
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

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Building2 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Companies</h1>
            <p className="mt-1 text-slate-600">
              {isSuperadmin
                ? 'Create and manage organizations. Deleted companies stay in the database until restored.'
                : 'Organizations visible to your account (your assigned company).'}
            </p>
          </div>
        </div>
        {isSuperadmin && !showCreateForm ? (
          <div className="ml-auto flex shrink-0 items-center sm:pt-1">
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Create company
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      {isSuperadmin && showCreateForm ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-800">New company</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Name</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                required
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Phone (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Email (optional)</span>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Website (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="example.com"
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Address (optional)</span>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Street, city…"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Kayıt sonrası Google Maps bağlantısı bu adresten otomatik oluşturulur.
              </span>
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Owner (optional)</span>
              <select
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
              >
                <option value="">No owner</option>
                {userPickList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userPickLabel(u)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                User is added to this company as a member if they were not already.
              </span>
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Logo (optional)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:font-medium file:text-white"
                onChange={(e) => setCreateLogoFile(e.target.files?.[0] ?? null)}
              />
              <span className="mt-1 block text-xs text-slate-500">
                PNG, JPEG, WebP veya GIF; en fazla 2MB. Şirket kaydından hemen sonra yüklenir.
              </span>
            </label>
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
              {saving ? 'Creating…' : 'Create company'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Companies</h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {isSuperadmin ? (
              <ShowDeletedToggle
                id="companies-show-deleted"
                checked={showDeleted}
                onChange={setShowDeleted}
                disabled={loading}
              />
            ) : null}
            <input
              type="search"
              placeholder="Search name, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-[10rem] max-w-[18rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              aria-label="Search companies"
            />
          </div>
        </div>
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[68rem] text-left text-sm [word-break:break-word]">
          <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-14 whitespace-nowrap px-2 py-3 sm:px-4">Logo</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Name</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Email</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Owner</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Address</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Phone</th>
              <th className="whitespace-nowrap px-2 py-3 sm:px-4">Website</th>
              {isSuperadmin ? (
                <th className="whitespace-nowrap px-2 py-3 text-right sm:px-4">Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {loading || rows === null ? (
              <tr>
                <td colSpan={isSuperadmin ? 8 : 7} className="px-4 py-10 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={isSuperadmin ? 8 : 7} className="px-4 py-10 text-center text-slate-500">
                  No companies to show.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const inactive = r.is_deleted === true
                return (
                  <tr
                    key={r.id}
                    className={inactive ? 'bg-slate-50/90' : 'hover:bg-slate-50/80'}
                  >
                    <td className="align-top px-2 py-3 sm:px-4">
                      {r.logo_url ? (
                        <img
                          src={r.logo_url}
                          alt=""
                          className="h-9 w-9 rounded-md bg-white object-contain p-0.5 ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                          —
                        </span>
                      )}
                    </td>
                    <td className="align-top px-2 py-3 sm:px-4">
                      <Link
                        to={`/companies/${r.id}`}
                        className={
                          inactive
                            ? 'font-medium text-slate-600 line-through hover:text-teal-800 hover:underline'
                            : 'font-medium text-teal-700 hover:text-teal-800 hover:underline'
                        }
                      >
                        {r.name}
                      </Link>
                      {inactive ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                          Inactive
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`align-top px-2 py-3 sm:px-4 ${
                        inactive ? 'text-slate-500' : 'text-slate-600'
                      }`}
                    >
                      <span className="block break-words">{r.email ?? '—'}</span>
                    </td>
                    <td
                      className={`align-top px-2 py-3 sm:px-4 ${
                        inactive ? 'text-slate-500' : 'text-slate-600'
                      }`}
                    >
                      {r.owner ? (
                        canViewUserDir ? (
                          <Link
                            to={`/users/${r.owner.id}`}
                            className="inline-block max-w-full break-words font-medium text-teal-700 hover:text-teal-800 hover:underline"
                          >
                            {`${r.owner.first_name} ${r.owner.last_name}`.trim() || r.owner.email}
                          </Link>
                        ) : (
                          <span className="block break-words">
                            {`${r.owner.first_name} ${r.owner.last_name}`.trim() || r.owner.email}
                          </span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`px-2 py-3 align-top sm:px-4 ${inactive ? 'text-slate-500' : 'text-slate-600'}`}>
                      {(() => {
                        const mapHref = mapsLinkForCompany(r.address, r.maps_url)
                        if (r.address && mapHref) {
                          return (
                            <a
                              href={mapHref}
                              target="_blank"
                              rel="noreferrer"
                              className={`line-clamp-3 break-words text-sm font-medium underline-offset-2 hover:underline ${
                                inactive ? 'text-slate-600' : 'text-teal-700 hover:text-teal-800'
                              }`}
                              title="Google Maps’te aç"
                            >
                              {r.address}
                            </a>
                          )
                        }
                        return <span className="line-clamp-3 break-words">{r.address ?? '—'}</span>
                      })()}
                    </td>
                    <td
                      className={`align-top px-2 py-3 sm:px-4 ${
                        inactive ? 'text-slate-500' : 'text-slate-600'
                      }`}
                    >
                      <span className="block whitespace-normal break-words">{r.phone ?? '—'}</span>
                    </td>
                    <td
                      className={`align-top px-2 py-3 sm:px-4 ${
                        inactive ? 'text-slate-500' : 'text-slate-600'
                      }`}
                    >
                      {r.website ? (
                        <a
                          href={
                            r.website.startsWith('http') ? r.website : `https://${r.website}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block max-w-full break-all text-teal-700 underline-offset-2 hover:underline"
                        >
                          {r.website}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    {isSuperadmin ? (
                      <td className="align-top px-2 py-3 sm:px-4">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          {inactive ? (
                            <button
                              type="button"
                              onClick={() => setRestoreId(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(r)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          )}
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
