import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Mail, Phone, Shield, User } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson } from '@/lib/api'

type UserRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string
  company_id: string | null
  company_name: string | null
  companies?: { id: string; name: string }[]
  is_deleted: boolean
  roles: string[]
}

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

export function UserViewPage() {
  const { userId } = useParams<{ userId: string }>()
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canViewCompanies = Boolean(me?.permissions.includes('companies.view'))
  const canEditUserDir = Boolean(me?.permissions.includes('users.directory.edit'))

  const [row, setRow] = useState<UserRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      setErr('Invalid user')
      return
    }
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const u = await getJson<UserRow>(`/users/${userId}`)
        if (!c) {
          setRow(u)
          setErr(null)
        }
      } catch (e) {
        if (!c) {
          setRow(null)
          setErr(e instanceof Error ? e.message : 'Could not load user')
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [userId])

  const fullName = row ? `${row.first_name} ${row.last_name}`.trim() : ''

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link
        to="/users"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to directory
      </Link>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {err}
        </div>
      ) : row ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-100 to-teal-50 text-teal-700 shadow-sm ring-1 ring-teal-100">
                  <User className="h-7 w-7" strokeWidth={1.75} />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{fullName}</h1>
                  <p className="mt-0.5 text-sm text-slate-500">User profile</p>
                </div>
              </div>
              {row.is_deleted ? (
                <span className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Inactive account
                </span>
              ) : (
                <span className="mt-3 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                  Active
                </span>
              )}
            </div>
            {canEditUserDir && userId ? (
              <Link
                to={`/users/${encodeURIComponent(userId)}/edit`}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Edit
              </Link>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                Email
              </div>
              <p className="mt-2 break-all text-sm font-medium text-slate-900">{row.email}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                Phone
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">{row.phone}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Building2 className="h-3.5 w-3.5" strokeWidth={2} />
                Organization
              </div>
              <div className="mt-2">
                {(row.companies?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {row.companies!.map((c) =>
                      canViewCompanies ? (
                        <Link
                          key={c.id}
                          to={`/companies/${c.id}`}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-200/90 hover:text-slate-950"
                        >
                          <Building2 className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
                          {c.name}
                        </Link>
                      ) : (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                        >
                          <Building2 className="h-3.5 w-3.5 opacity-70" strokeWidth={2} />
                          {c.name}
                        </span>
                      ),
                    )}
                  </div>
                ) : row.company_id && row.company_name && canViewCompanies ? (
                  <Link
                    to={`/companies/${row.company_id}`}
                    className="text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                  >
                    {row.company_name}
                  </Link>
                ) : row.company_name ? (
                  <p className="text-sm font-medium text-slate-900">{row.company_name}</p>
                ) : (
                  <p className="text-sm text-slate-500">No company linked</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                Roles
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.roles.length === 0 ? (
                  <span className="text-sm text-slate-500">—</span>
                ) : (
                  row.roles.map((role) => (
                    <span
                      key={role}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
                    >
                      {role}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {isSuperadmin ? (
            <p className="text-xs text-slate-400">
              User ID: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">{row.id}</code>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
