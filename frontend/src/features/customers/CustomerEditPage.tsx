import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, UserRound } from 'lucide-react'
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput'
import { ADDRESS_FORMAT_HINT } from '@/components/ui/AddressMapLink'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson } from '@/lib/api'
import { isValidCaPostalCode, normalizeCaPostalCode } from '@/lib/caPostalCode'

type CustomerOut = {
  id: string
  name: string
  surname?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  postal_code?: string | null
  active: boolean
}

export function CustomerEditPage() {
  const { customerId } = useParams<{ customerId: string }>()
  const nav = useNavigate()
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('customers.edit'))
  const isCa = ((me?.active_company_country_code ?? '').trim().toUpperCase() || '') === 'CA'

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [row, setRow] = useState<CustomerOut | null>(null)
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [active, setActive] = useState(true)

  const postalErr = useMemo(
    () => isCa && postalCode.trim() !== '' && !isValidCaPostalCode(postalCode),
    [isCa, postalCode],
  )

  useEffect(() => {
    if (!customerId) {
      setLoading(false)
      setErr('Invalid customer')
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await getJson<CustomerOut>(`/customers/${customerId}`)
        if (cancelled) return
        setRow(r)
        setName(r.name ?? '')
        setSurname(r.surname ?? '')
        setPhone(r.phone ?? '')
        setEmail(r.email ?? '')
        setAddress(r.address ?? '')
        setPostalCode(r.postal_code ?? '')
        setActive(Boolean(r.active))
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load customer')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [customerId])

  async function onSave() {
    if (!customerId || !name.trim()) return
    if (!canEdit) return
    if (postalErr) return
    setSaving(true)
    setErr(null)
    try {
      await patchJson(`/customers/${customerId}`, {
        name: name.trim(),
        surname: surname.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        postal_code: postalCode.trim() || null,
        active,
      })
      nav(`/customers/${customerId}`)
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
        to="/customers"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        Back to customers
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
                    <UserRound className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-slate-900">Edit customer</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Customer ID</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-slate-700">{row.id}</p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={!canEdit || saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" strokeWidth={2} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div className="px-5 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Name</span>
                  <input
                    required
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Surname</span>
                  <input
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Phone</span>
                  <input
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Email</span>
                  <input
                    type="email"
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Address</span>
                  <AddressAutocompleteInput
                    value={address}
                    onChange={setAddress}
                    hintId="customer-edit-address-hint"
                    countryCode={me?.active_company_country_code ?? null}
                    regionCode={me?.active_company_region_code ?? null}
                    disabled={!canEdit}
                  />
                  <span id="customer-edit-address-hint" className="mt-1 block text-xs text-slate-500">
                    {ADDRESS_FORMAT_HINT}
                  </span>
                </label>
                <label className="block text-sm text-slate-700 sm:col-span-2">
                  <span className="mb-1 block font-medium">Postal code (optional)</span>
                  <input
                    disabled={!canEdit}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    onBlur={() => {
                      if (!isCa) return
                      if (postalCode.trim()) setPostalCode(normalizeCaPostalCode(postalCode))
                    }}
                  />
                  {postalErr ? (
                    <span className="mt-1 block text-xs text-red-700">
                      Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.
                    </span>
                  ) : null}
                </label>

                <label className="sm:col-span-2">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Status</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      checked={active}
                      disabled={!canEdit}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <span className="text-sm font-semibold text-slate-900">
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

