import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, ExternalLink } from 'lucide-react'
import { REFRESH_SESSION_EVENT, useAuthSession } from '@/app/authSession'
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput'
import { ADDRESS_FORMAT_HINT } from '@/components/ui/AddressMapLink'
import { companyCountrySelectOptions } from '@/lib/addressCountryOptions'
import { listCompanySubnationals } from '@/lib/companyRegions'
import { getJson, patchJson } from '@/lib/api'
import { mapsLinkForCompany } from '@/lib/googleMaps'
import { isValidCaPostalCode, normalizeCaPostalCode } from '@/lib/caPostalCode'

type CompanyOut = {
  id: string
  name: string
  phone: string | null
  website: string | null
  email: string | null
  address: string | null
  postal_code?: string | null
  country_code?: string | null
  region_code?: string | null
  maps_url: string | null
  tax_rate_percent?: string | number | null
}

export function SettingsCompanyInfoPage() {
  const me = useAuthSession()
  const companyId = useMemo(
    () => me?.active_company_id ?? me?.company_id ?? null,
    [me?.active_company_id, me?.company_id],
  )

  const canView = Boolean(me?.permissions.includes('settings.company_info.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.company_info.edit'))

  const [row, setRow] = useState<CompanyOut | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [regionCode, setRegionCode] = useState('')
  const [taxRatePercent, setTaxRatePercent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const isCa = countryCode.trim().toUpperCase() === 'CA'
  const postalErr = isCa && postalCode.trim() !== '' && !isValidCaPostalCode(postalCode)

  const load = useCallback(async () => {
    if (!companyId || !canView) {
      setRow(null)
      setLoading(false)
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const c = await getJson<CompanyOut>(`/companies/${companyId}`)
      setRow(c)
      setName(c.name)
      setPhone(c.phone ?? '')
      setEmail(c.email ?? '')
      setWebsite(c.website ?? '')
      setAddress(c.address ?? '')
      setPostalCode(c.postal_code ?? '')
      setCountryCode((c.country_code ?? '').trim().toUpperCase())
      setRegionCode((c.region_code ?? '').trim().toUpperCase())
      const tr = c.tax_rate_percent
      setTaxRatePercent(
        tr === null || tr === undefined || tr === '' ? '' : typeof tr === 'number' ? String(tr) : String(tr),
      )
    } catch (e) {
      setRow(null)
      setErr(e instanceof Error ? e.message : 'Could not load company')
    } finally {
      setLoading(false)
    }
  }, [companyId, canView])

  useEffect(() => {
    void load()
  }, [load])

  const countrySelectOptions = useMemo(() => companyCountrySelectOptions(row?.country_code), [row?.country_code])

  const mapsHref = useMemo(() => {
    const addr = address.trim()
    const pc = postalCode.trim()
    const q = [addr, pc].filter(Boolean).join(', ').trim()
    if (!q) return null
    const unchanged =
      addr === (row?.address ?? '').trim() && pc === (row?.postal_code ?? '').trim()
    return mapsLinkForCompany(q, unchanged ? row?.maps_url ?? null : null)
  }, [address, postalCode, row?.address, row?.postal_code, row?.maps_url])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId || !canEdit || !row) return
    if (postalErr) return
    setErr(null)
    setOk(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      const n = name.trim()
      if (n !== row.name) body.name = n
      const ph = phone.trim() || null
      if (ph !== (row.phone ?? null)) body.phone = ph
      const em = email.trim() || null
      if (em !== (row.email ?? null)) body.email = em
      const web = website.trim() || null
      if (web !== (row.website ?? null)) body.website = web
      const adr = address.trim() || null
      if (adr !== (row.address ?? null)) body.address = adr
      const pc = postalCode.trim() || null
      if (pc !== (row.postal_code ?? null)) body.postal_code = pc
      const cc = countryCode.trim().toUpperCase()
      const ccNorm = cc.length === 2 && /^[A-Z]{2}$/.test(cc) ? cc : null
      const prevCc = (row.country_code ?? '').trim().toUpperCase() || null
      const nextCc = ccNorm
      if (nextCc !== prevCc) body.country_code = nextCc
      const prevReg = (row.region_code ?? '').trim().toUpperCase() || null
      let nextReg: string | null = null
      if (nextCc === 'CA' || nextCc === 'US') {
        nextReg = regionCode.trim().toUpperCase() || null
      }
      if (nextReg !== prevReg) body.region_code = nextReg
      const trTrim = taxRatePercent.trim()
      const prevRaw = row.tax_rate_percent
      const prevNum =
        prevRaw === null || prevRaw === undefined || prevRaw === ''
          ? null
          : typeof prevRaw === 'number'
            ? prevRaw
            : Number.parseFloat(String(prevRaw).replace(',', '.'))
      const prevTax = prevNum !== null && !Number.isNaN(prevNum) ? prevNum : null
      let nextTax: number | null = null
      if (trTrim !== '') {
        const p = Number.parseFloat(trTrim.replace(',', '.'))
        if (Number.isNaN(p)) {
          setErr('Enter a valid sales tax percentage, or leave the field empty.')
          return
        }
        if (p < 0 || p > 100) {
          setErr('Sales tax rate must be between 0 and 100.')
          return
        }
        nextTax = p
      }
      const taxEqual =
        (prevTax === null && nextTax === null) ||
        (prevTax !== null && nextTax !== null && Math.abs(prevTax - nextTax) < 1e-6)
      if (!taxEqual) {
        ;(body as Record<string, unknown>).tax_rate_percent = nextTax
      }
      if (Object.keys(body).length === 0) {
        setOk('No changes to save.')
        return
      }
      const updated = await patchJson<CompanyOut>(`/companies/${companyId}`, body)
      setRow(updated)
      setName(updated.name)
      setPhone(updated.phone ?? '')
      setEmail(updated.email ?? '')
      setWebsite(updated.website ?? '')
      setAddress(updated.address ?? '')
      setCountryCode((updated.country_code ?? '').trim().toUpperCase())
      setRegionCode((updated.region_code ?? '').trim().toUpperCase())
      globalThis.dispatchEvent(new Event(REFRESH_SESSION_EVENT))
      const utr = updated.tax_rate_percent
      setTaxRatePercent(
        utr === null || utr === undefined || utr === '' ? '' : typeof utr === 'number' ? String(utr) : String(utr),
      )
      setOk('Company info saved.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Building2 className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Company info</h1>
          <p className="mt-1 text-slate-600">
            Details for your active organization. Used on documents and customer-facing touchpoints where applicable.
          </p>
        </div>
      </div>

      {!canView ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You need permission to view company information.
        </p>
      ) : !companyId ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active company is selected. Use the company switcher in the header, then open this page again.
        </p>
      ) : (
        <>
          {err && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</p>
          )}
          {ok && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {ok}
            </p>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-6">
              <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <h2 className="text-base font-semibold text-slate-900">Contact &amp; location</h2>
                <p className="mt-2 text-sm text-slate-600">Update the fields below and save. Empty optional fields are cleared.</p>

                <div className="mt-4 grid gap-4 sm:grid-cols-1">
                  <label className="block text-sm font-medium text-slate-700">
                    Company name
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Phone
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Website
                    <input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      disabled={!canEdit}
                      placeholder="https://"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Country (address suggestions)
                    <select
                      value={countryCode}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase()
                        setCountryCode(v)
                        if (v !== 'CA' && v !== 'US') setRegionCode('')
                      }}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    >
                      {countrySelectOptions.map((o) => (
                        <option key={o.code || '_any'} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Limits Photon address autocomplete for your team. “Any country” disables the country filter. Canada
                      and the United States can also set a province or state below for tighter, local-first suggestions.
                    </span>
                  </label>
                  {(countryCode === 'CA' || countryCode === 'US') && (
                    <label className="block text-sm font-medium text-slate-700">
                      State / province
                      <select
                        value={regionCode}
                        onChange={(e) => setRegionCode(e.target.value.toUpperCase())}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                      >
                        <option value="">Not specified</option>
                        {listCompanySubnationals(countryCode).map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        When set, address suggestions are biased toward this subdivision (OpenStreetMap / Photon).
                      </span>
                    </label>
                  )}
                  <label className="block text-sm font-medium text-slate-700">
                    Address
                    <div className="mt-1">
                      <AddressAutocompleteInput
                        value={address}
                        onChange={setAddress}
                        disabled={!canEdit}
                        hintId="settings-company-address-hint"
                        inputClassName="text-slate-900 shadow-sm"
                        countryCode={countryCode.trim() || null}
                        regionCode={
                          (countryCode === 'CA' || countryCode === 'US') && regionCode.trim()
                            ? regionCode.trim().toUpperCase()
                            : null
                        }
                      />
                    </div>
                    <span id="settings-company-address-hint" className="mt-1 block text-xs font-normal text-slate-500">
                      {ADDRESS_FORMAT_HINT} After save, the preview link below uses this text (or your stored Maps URL).
                    </span>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Postal code (optional)
                    <input
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      onBlur={() => {
                        if (!isCa) return
                        if (postalCode.trim()) setPostalCode(normalizeCaPostalCode(postalCode))
                      }}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    />
                    {postalErr ? (
                      <span className="mt-1 block text-xs font-normal text-red-700">
                        Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.
                      </span>
                    ) : null}
                  </label>
                  {mapsHref ? (
                    <p className="text-sm">
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-800"
                      >
                        Open address in Maps
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </p>
                  ) : null}
                </div>

                <h3 className="mt-8 text-sm font-semibold text-slate-900">Orders &amp; billing</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Default sales tax rate for the active company. On each order, tax amount is calculated as taxable base ×
                  this rate ÷ 100 and stored on the order.
                </p>
                <label className="mt-4 block text-sm font-medium text-slate-700">
                  Default sales tax (%)
                  <input
                    inputMode="decimal"
                    value={taxRatePercent}
                    onChange={(e) => setTaxRatePercent(e.target.value)}
                    disabled={!canEdit}
                    placeholder="e.g. 8.25 — leave empty if none"
                    className="mt-1 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                  />
                </label>

                {canEdit ? (
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700 disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-slate-500">You can view this page but only company editors can make changes.</p>
                )}
              </section>
            </form>
          )}
        </>
      )}
    </div>
  )
}
