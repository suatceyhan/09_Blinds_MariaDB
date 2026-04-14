import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput'
import { ADDRESS_FORMAT_HINT, AddressMapLink } from '@/components/ui/AddressMapLink'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useAuthSession } from '@/app/authSession'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'
import { isValidCaPostalCode, normalizeCaPostalCode } from '@/lib/caPostalCode'

type CustomerRow = {
  id: string
  company_id: string
  name: string
  surname?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  postal_code?: string | null
  active: boolean
}

type PendingConfirm =
  | { kind: 'deactivate'; id: string; display: string }
  | { kind: 'restore'; id: string; display: string }

function displayName(r: CustomerRow): string {
  const n = `${r.name ?? ''} ${r.surname ?? ''}`.trim()
  return n || r.id
}

function ShowInactiveToggle(
  props: Readonly<{
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
  }>,
) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-slate-600">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>Show inactive</span>
    </label>
  )
}

export function CustomersPage() {
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('customers.edit'))

  const [rows, setRows] = useState<CustomerRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editName, setEditName] = useState('')
  const [editSurname, setEditSurname] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editPostalCode, setEditPostalCode] = useState('')

  const isCa = ((me?.active_company_country_code ?? '').trim().toUpperCase() || '') === 'CA'
  const postalErr = isCa && postalCode.trim() !== '' && !isValidCaPostalCode(postalCode)
  const editPostalErr = isCa && editPostalCode.trim() !== '' && !isValidCaPostalCode(editPostalCode)

  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [confirmPending, setConfirmPending] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showInactive) p.set('include_inactive', 'true')
    return p.toString()
  }, [debouncedSearch, showInactive])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<CustomerRow[]>(`/customers?${listParams}`)
        if (!cancelled) setRows(list)
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load customers')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, listParams])

  async function refresh() {
    const list = await getJson<CustomerRow[]>(`/customers?${listParams}`)
    setRows(list)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !name.trim()) return
    if (postalErr) return
    setSaving(true)
    setErr(null)
    try {
      await postJson('/customers', {
        name: name.trim(),
        surname: surname.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        postal_code: postalCode.trim() || null,
      })
      setName('')
      setSurname('')
      setPhone('')
      setEmail('')
      setAddress('')
      setPostalCode('')
      setShowCreate(false)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(r: CustomerRow) {
    setEditId(r.id)
    setEditName(r.name ?? '')
    setEditSurname(r.surname ?? '')
    setEditPhone(r.phone ?? '')
    setEditEmail(r.email ?? '')
    setEditAddress('')
    setEditPostalCode('')
  }

  async function onEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editId || !editName.trim()) return
    if (editPostalErr) return
    setEditSaving(true)
    setErr(null)
    try {
      await patchJson(`/customers/${editId}`, {
        name: editName.trim(),
        surname: editSurname.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        address: editAddress.trim() || null,
        postal_code: editPostalCode.trim() || null,
      })
      setEditId(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function executePending() {
    if (!pending) return
    setConfirmPending(true)
    setErr(null)
    try {
      if (pending.kind === 'deactivate') {
        await deleteJson(`/customers/${pending.id}`)
      } else {
        await postJson(`/customers/${pending.id}/restore`, {})
      }
      setPending(null)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setConfirmPending(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="w-full max-w-none space-y-6">
      <ConfirmModal
        open={pending !== null}
        title={pending?.kind === 'restore' ? 'Restore customer' : 'Deactivate customer'}
        description={
          pending == null
            ? ''
            : pending.kind === 'deactivate'
              ? `${pending.display} will be marked inactive (kept for history). Deactivation is blocked if this customer still has active orders or open estimates (New / Pending).`
              : `Restore ${pending.display}?`
        }
        confirmLabel={pending?.kind === 'restore' ? 'Restore' : 'Deactivate'}
        cancelLabel="Cancel"
        variant={pending?.kind === 'deactivate' ? 'danger' : 'default'}
        pending={confirmPending}
        onConfirm={() => void executePending()}
        onCancel={() => {
          if (!confirmPending) setPending(null)
        }}
      />

      {editId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={(e) => void onEditSave(e)}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">Edit customer</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Name</span>
                <input
                  required
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                <span className="mb-1 block font-medium">Surname</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editSurname}
                  onChange={(e) => setEditSurname(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Phone</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Email</span>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Address</span>
                <AddressAutocompleteInput
                  value={editAddress}
                  onChange={setEditAddress}
                  hintId="customers-edit-address-hint"
                  countryCode={me?.active_company_country_code ?? null}
                  regionCode={me?.active_company_region_code ?? null}
                />
                <span id="customers-edit-address-hint" className="mt-1 block text-xs text-slate-500">
                  {ADDRESS_FORMAT_HINT}
                </span>
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                <span className="mb-1 block font-medium">Postal code (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={editPostalCode}
                  onChange={(e) => setEditPostalCode(e.target.value)}
                  onBlur={() => {
                    if (!isCa) return
                    if (editPostalCode.trim()) setEditPostalCode(normalizeCaPostalCode(editPostalCode))
                  }}
                />
                {editPostalErr ? (
                  <span className="mt-1 block text-xs text-red-700">Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.</span>
                ) : null}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditId(null)}
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
            <UserRound className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Customers</h1>
            <p className="mt-1 text-slate-600">Customers are scoped to your active company.</p>
          </div>
        </div>
        {canEdit && !showCreate ? (
          <div className="ml-auto flex shrink-0 items-center sm:pt-1">
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              Create customer
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {err}
        </p>
      ) : null}

      {canEdit && showCreate ? (
        <form onSubmit={(e) => void onCreate(e)} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">New customer</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Name</span>
              <input
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Surname</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Phone</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Email</span>
              <input
                type="email"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Address</span>
              <AddressAutocompleteInput
                value={address}
                onChange={setAddress}
                hintId="customers-new-address-hint"
                countryCode={me?.active_company_country_code ?? null}
                regionCode={me?.active_company_region_code ?? null}
              />
              <span id="customers-new-address-hint" className="mt-1 block text-xs text-slate-500">
                {ADDRESS_FORMAT_HINT}
              </span>
            </label>
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Postal code (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                onBlur={() => {
                  if (!isCa) return
                  if (postalCode.trim()) setPostalCode(normalizeCaPostalCode(postalCode))
                }}
              />
              {postalErr ? (
                <span className="mt-1 block text-xs text-red-700">Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.</span>
              ) : null}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">Directory</h2>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <ShowInactiveToggle checked={showInactive} onChange={setShowInactive} disabled={loading} />
            <input
              type="search"
              placeholder="Search name, phone, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-[10rem] max-w-[18rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              aria-label="Search customers"
            />
          </div>
        </div>
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[68rem] text-left text-sm [word-break:break-word]">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Customer</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Phone</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Email</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Address</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Status</th>
                {canEdit ? <th className="whitespace-nowrap px-2 py-3 text-right sm:px-4">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading || rows === null ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-4 py-10 text-center text-slate-500">
                    No customers found.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={!r.active ? 'bg-slate-50/90' : 'hover:bg-slate-50/80'}>
                    <td className="px-2 py-3 sm:px-4">
                      <Link
                        to={`/customers/${r.id}`}
                        className={
                          !r.active
                            ? 'font-medium text-slate-500 line-through hover:text-teal-800 hover:underline'
                            : 'font-medium text-teal-700 hover:text-teal-800 hover:underline'
                        }
                      >
                        {displayName(r)}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">{r.phone || '—'}</td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">{r.email || '—'}</td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">
                      <AddressMapLink address={r.address} muted={!r.active} />
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      {r.active ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          Inactive
                        </span>
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-2 py-3 text-right sm:px-4">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          {r.active ? (
                            <button
                              type="button"
                              onClick={() => setPending({ kind: 'deactivate', id: r.id, display: displayName(r) })}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
                              title="Deactivate"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPending({ kind: 'restore', id: r.id, display: displayName(r) })}
                              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                              title="Restore"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Restore
                            </button>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

