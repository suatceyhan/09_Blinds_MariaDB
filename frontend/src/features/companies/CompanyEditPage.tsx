import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Save } from 'lucide-react'
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput'
import { ADDRESS_FORMAT_HINT } from '@/components/ui/AddressMapLink'
import { companyCountrySelectOptions } from '@/lib/addressCountryOptions'
import { listCompanySubnationals } from '@/lib/companyRegions'
import { useAuthSession } from '@/app/authSession'
import { deleteJson, getJson, patchJson, postMultipartJson } from '@/lib/api'
import { isValidCaPostalCode, normalizeCaPostalCode } from '@/lib/caPostalCode'
import { resizePhotoForUpload } from '@/lib/imageResize'

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

type UserPickRow = {
  id: string
  email: string
  first_name: string
  last_name: string
  companies?: { id: string; name: string }[]
}

function isSuperadminRoles(roles: string[] | undefined): boolean {
  return roles?.some((r) => r.toLowerCase() === 'superadmin') ?? false
}

function userPickLabel(u: UserPickRow): string {
  const n = `${u.first_name} ${u.last_name}`.trim()
  return n ? `${n} (${u.email})` : u.email
}

export function CompanyEditPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const nav = useNavigate()
  const me = useAuthSession()
  const isSuperadmin = useMemo(() => isSuperadminRoles(me?.roles), [me?.roles])
  const canEdit = isSuperadmin

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [row, setRow] = useState<CompanyRow | null>(null)
  const [userPickList, setUserPickList] = useState<UserPickRow[]>([])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [regionCode, setRegionCode] = useState('')
  const [ownerUserId, setOwnerUserId] = useState('')

  const [editLogoFile, setEditLogoFile] = useState<File | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  const postalErr = useMemo(() => {
    return countryCode.trim().toUpperCase() === 'CA' && postalCode.trim() !== '' && !isValidCaPostalCode(postalCode)
  }, [countryCode, postalCode])

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

  useEffect(() => {
    if (!companyId) {
      setLoading(false)
      setErr('Invalid company')
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await getJson<CompanyRow>(`/companies/${companyId}`)
        if (cancelled) return
        setRow(r)
        setName(r.name ?? '')
        setPhone(r.phone ?? '')
        setEmail(r.email ?? '')
        setWebsite(r.website ?? '')
        setAddress(r.address ?? '')
        setPostalCode(r.postal_code ?? '')
        setCountryCode((r.country_code ?? '').trim().toUpperCase())
        setRegionCode((r.region_code ?? '').trim().toUpperCase())
        setOwnerUserId(r.owner_user_id ?? '')
        setEditLogoFile(null)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load company')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const ownerChoices = useMemo(() => {
    if (!row) return userPickList
    const inCo = userPickList.filter((u) => (u.companies ?? []).some((c) => c.id === row.id))
    return inCo.length > 0 ? inCo : userPickList
  }, [userPickList, row])

  const uploadLogo = useCallback(async () => {
    if (!companyId || !editLogoFile) return
    setLogoBusy(true)
    setErr(null)
    try {
      const resized = await resizePhotoForUpload(editLogoFile, {
        maxDimension: 512,
        outputType: 'image/webp',
        quality: 0.84,
        maxBytes: 2 * 1024 * 1024,
      })
      const fd = new FormData()
      fd.append('file', resized)
      const updated = await postMultipartJson<CompanyRow>(`/companies/${companyId}/logo`, fd)
      setRow((prev) => (prev ? { ...prev, logo_url: updated.logo_url ?? prev.logo_url } : prev))
      setEditLogoFile(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Logo upload failed')
    } finally {
      setLogoBusy(false)
    }
  }, [companyId, editLogoFile])

  const removeLogo = useCallback(async () => {
    if (!companyId || !row?.logo_url) return
    setLogoBusy(true)
    setErr(null)
    try {
      await deleteJson(`/companies/${companyId}/logo`)
      setRow((prev) => (prev ? { ...prev, logo_url: null } : prev))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove logo')
    } finally {
      setLogoBusy(false)
    }
  }, [companyId, row?.logo_url])

  async function onSave() {
    if (!companyId || !name.trim()) return
    if (!canEdit) return
    if (postalErr) return
    setSaving(true)
    setErr(null)
    try {
      const cc = countryCode.trim() ? countryCode.trim().toUpperCase() : null
      let region: string | null = null
      if (cc === 'CA' || cc === 'US') {
        region = regionCode.trim() ? regionCode.trim().toUpperCase() : null
      }
      await patchJson(`/companies/${companyId}`, {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        website: website.trim() || null,
        address: address.trim() || null,
        postal_code: postalCode.trim() || null,
        country_code: cc,
        region_code: region,
        owner_user_id: ownerUserId.trim() ? ownerUserId.trim() : null,
      })
      nav(`/companies/${companyId}`)
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
        to="/companies"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to companies
      </Link>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {err}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You don&apos;t have permission to edit companies.
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
            <div className="border-b border-slate-100 bg-gradient-to-br from-violet-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                    <Building2 className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-slate-900">Edit company</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Company ID</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-slate-700">{row.id}</p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" strokeWidth={2} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="px-5 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Name</span>
                  <input
                    required
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Phone</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Email</span>
                  <input
                    type="email"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Website</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="example.com"
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Country (address suggestions)</span>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={countryCode}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase()
                      setCountryCode(v)
                      if (v !== 'CA' && v !== 'US') setRegionCode('')
                    }}
                  >
                    {companyCountrySelectOptions(row.country_code).map((o) => (
                      <option key={o.code || '_any'} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    Photon search is limited to this country when set. “Any country” shows worldwide results. For Canada or
                    the United States, set state/province for local-first suggestions.
                  </span>
                </label>
                {(countryCode === 'CA' || countryCode === 'US') && (
                  <label className="block text-sm text-slate-700 sm:col-span-2">
                    <span className="mb-1 block font-medium">State / province</span>
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                      value={regionCode}
                      onChange={(e) => setRegionCode(e.target.value.toUpperCase())}
                    >
                      <option value="">Not specified</option>
                      {listCompanySubnationals(countryCode).map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Address</span>
                  <AddressAutocompleteInput
                    value={address}
                    onChange={setAddress}
                    hintId="company-edit-address-hint"
                    countryCode={countryCode.trim() || null}
                    regionCode={
                      (countryCode === 'CA' || countryCode === 'US') && regionCode.trim()
                        ? regionCode.trim().toUpperCase()
                        : null
                    }
                  />
                  <span id="company-edit-address-hint" className="mt-1 block text-xs text-slate-500">
                    {ADDRESS_FORMAT_HINT} After save, a Google Maps link can be derived from this line.
                  </span>
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Postal code (optional)</span>
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    onBlur={() => {
                      if (countryCode.trim().toUpperCase() !== 'CA') return
                      if (postalCode.trim()) setPostalCode(normalizeCaPostalCode(postalCode))
                    }}
                  />
                  {postalErr ? (
                    <span className="mt-1 block text-xs text-red-700">
                      Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.
                    </span>
                  ) : null}
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Owner</span>
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                  >
                    <option value="">No owner</option>
                    {ownerChoices.map((u) => (
                      <option key={u.id} value={u.id}>
                        {userPickLabel(u)}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    Listed users include this company&apos;s members (or all users if none). The user is granted membership
                    if needed.
                  </span>
                </label>

                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 sm:col-span-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Logo</p>
                      <p className="mt-0.5 text-xs text-slate-500">PNG, JPEG, WebP or GIF. Max 2MB.</p>
                    </div>
                    {row.logo_url ? (
                      <img
                        src={row.logo_url}
                        alt=""
                        className="h-14 w-14 rounded-xl bg-white object-contain p-1 ring-1 ring-slate-200"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-400 ring-1 ring-slate-200">
                        —
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-violet-700 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white"
                      onChange={(e) => setEditLogoFile(e.target.files?.[0] ?? null)}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!editLogoFile || logoBusy}
                        onClick={() => void uploadLogo()}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {logoBusy ? 'Uploading…' : 'Upload logo'}
                      </button>
                      <button
                        type="button"
                        disabled={!row.logo_url || logoBusy}
                        onClick={() => void removeLogo()}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Remove logo
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

