import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, User as UserIcon } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson } from '@/lib/api'

type UserRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string
  roles: string[]
  is_deleted: boolean
}

type RoleOption = { id: string; name: string }

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

export function UserEditPage() {
  const { userId } = useParams<{ userId: string }>()
  const nav = useNavigate()
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canEdit = Boolean(me?.permissions.includes('users.directory.edit'))

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [row, setRow] = useState<UserRow | null>(null)
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [roleName, setRoleName] = useState('user')

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await getJson<RoleOption[]>('/roles?limit=200')
        if (!cancelled) setRoleOptions(r.filter((x) => x.name.toLowerCase() !== 'superadmin'))
      } catch {
        if (!cancelled) setRoleOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      setErr('Invalid user')
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const u = await getJson<UserRow>(`/users/${userId}`)
        if (cancelled) return
        setRow(u)
        setEmail(u.email ?? '')
        setFirstName(u.first_name ?? '')
        setLastName(u.last_name ?? '')
        setPhone(u.phone ?? '')
        setPassword('')
        setRoleName(u.roles?.[0] ?? 'user')
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load user')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const canMutateRow = useMemo(() => {
    if (!row) return false
    if (!canEdit) return false
    const rowIsSuperadmin = row.roles.some((r) => r.toLowerCase() === 'superadmin')
    return !rowIsSuperadmin || isSuperadmin
  }, [row, canEdit, isSuperadmin])

  async function onSave() {
    if (!userId || !email.trim() || !firstName.trim() || !lastName.trim() || !phone.trim()) return
    if (!canMutateRow) return
    setSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        default_role_name: roleName.trim() || 'user',
      }
      if (password.trim()) body.password = password.trim()
      await patchJson(`/users/${userId}`, body)
      nav(`/users/${userId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link
        to="/users"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to directory
      </Link>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {err}
        </div>
      ) : null}

      {loading || !row ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            void onSave()
          }}
        >
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <UserIcon className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-slate-900">Edit user</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">User ID</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-slate-700">{row.id}</p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!canMutateRow || saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  title={!canMutateRow ? 'Only a superadmin can change this account.' : undefined}
                >
                  <Save className="h-4 w-4" strokeWidth={2} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="px-5 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Email</span>
                  <input
                    type="email"
                    required
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">New password (optional)</span>
                  <input
                    type="password"
                    minLength={6}
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">First name</span>
                  <input
                    required
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Last name</span>
                  <input
                    required
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Phone</span>
                  <input
                    required
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Role</span>
                  <select
                    disabled={!canMutateRow}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
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
          </div>
        </form>
      )}
    </div>
  )
}

