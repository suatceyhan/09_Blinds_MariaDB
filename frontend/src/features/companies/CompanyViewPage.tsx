import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Globe, Mail, MapPin, Phone, User } from 'lucide-react'
import { AddressMapLink } from '@/components/ui/AddressMapLink'
import { useAuthSession } from '@/app/authSession'
import { getJson } from '@/lib/api'

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

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
  postal_code?: string | null
  country_code?: string | null
  region_code?: string | null
  maps_url?: string | null
  owner_user_id?: string | null
  owner?: CompanyOwner | null
  logo_url?: string | null
  is_deleted?: boolean
}

export function CompanyViewPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canEditCompany = isSuperadmin
  const [row, setRow] = useState<CompanyRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) {
      setLoading(false)
      setErr('Invalid company')
      return
    }
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const co = await getJson<CompanyRow>(`/companies/${companyId}`)
        if (!c) {
          setRow(co)
          setErr(null)
        }
      } catch (e) {
        if (!c) {
          setRow(null)
          setErr(e instanceof Error ? e.message : 'Could not load company')
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [companyId])

  const websiteHref =
    row?.website && row.website.startsWith('http') ? row.website : row?.website ? `https://${row.website}` : null

  const canViewUserDir = Boolean(me?.permissions.includes('users.directory.view'))

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <Link
        to="/companies"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to companies
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
            <div className="flex flex-wrap items-center gap-3">
              {row.logo_url ? (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                  <img src={row.logo_url} alt="" className="h-full w-full object-contain p-1" />
                </div>
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-violet-50 text-violet-700 shadow-sm ring-1 ring-violet-100">
                  <Building2 className="h-7 w-7" strokeWidth={1.75} />
                </div>
              )}
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{row.name}</h1>
                <p className="mt-0.5 text-sm text-slate-500">Company profile</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {row.is_deleted ? (
                <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Inactive
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                  Active
                </span>
              )}
              {canEditCompany && companyId ? (
                <Link
                  to={`/companies?edit=${encodeURIComponent(companyId)}`}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-50"
                >
                  Edit
                </Link>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <User className="h-3.5 w-3.5" strokeWidth={2} />
                Owner
              </div>
              <div className="mt-2">
                {row.owner ? (
                  <>
                    {canViewUserDir ? (
                      <Link
                        to={`/users/${row.owner.id}`}
                        className="text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                      >
                        {`${row.owner.first_name} ${row.owner.last_name}`.trim() || row.owner.email}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-slate-900">
                        {`${row.owner.first_name} ${row.owner.last_name}`.trim() || row.owner.email}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">{row.owner.email}</p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                Address
              </div>
              <div className="mt-2 space-y-1">
                {row.country_code?.trim() ? (
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Address search country: {row.country_code.trim().toUpperCase()}
                    {row.region_code?.trim()
                      ? ` — state/province: ${row.region_code.trim().toUpperCase()}`
                      : ''}
                  </p>
                ) : null}
                <div className="inline-flex max-w-full items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                  <AddressMapLink address={row.address} mapsUrl={row.maps_url} lineClamp={false} />
                </div>
                {row.postal_code?.trim() ? (
                  <p className="text-xs font-medium text-slate-600">Postal code: {row.postal_code.trim()}</p>
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:col-span-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Mail className="h-3.5 w-3.5" strokeWidth={2} />
                Email
              </div>
              <p className="mt-2 break-all text-sm font-medium text-slate-900">{row.email ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Phone className="h-3.5 w-3.5" strokeWidth={2} />
                Phone
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">{row.phone ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <Globe className="h-3.5 w-3.5" strokeWidth={2} />
                Website
              </div>
              <div className="mt-2">
                {websiteHref ? (
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                  >
                    {row.website}
                  </a>
                ) : (
                  <p className="text-sm text-slate-500">—</p>
                )}
              </div>
            </div>
          </div>

          {isSuperadmin ? (
            <p className="text-xs text-slate-400">
              Company ID:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-600">{row.id}</code>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
