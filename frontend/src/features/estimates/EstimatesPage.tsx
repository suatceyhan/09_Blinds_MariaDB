import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Eye, Pencil, RotateCcw, ShoppingBag, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, postJson, deleteJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'

type CustomerOpt = { id: string; name: string; surname?: string | null; address?: string | null }
type BlindsOpt = { id: string; name: string }
type BlindsLine = { id: string; name: string; window_count?: number | null }
type EstimateRow = {
  id: string
  company_id: string
  customer_id: string
  customer_display: string
  customer_address?: string | null
  blinds_types: BlindsLine[]
  perde_sayisi: number | null
  status?: string | null
  is_deleted?: boolean | null
  scheduled_start_at: string | null
  tarih_saat: string | null
  created_at: string | null
}

type CreateContext = {
  organizer_name: string
  organizer_email: string | null
  guest_options: { email: string; label: string }[]
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** IANA-like zones only; invalid browser values fall back so the API accepts them. */
function coerceTimeZoneForApi(tz: string): string {
  const t = tz.trim()
  if (!t) return 'UTC'
  if (/^[A-Za-z0-9_+\/-]+$/.test(t)) return t
  return 'UTC'
}

const VISIT_TIME_ZONES: string[] = [
  'UTC',
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
]

function displayScheduled(r: EstimateRow): string {
  const raw = r.scheduled_start_at ?? r.tarih_saat
  if (!raw) return '—'
  const dt = new Date(raw)
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleString()
}

function customerLabel(c: CustomerOpt): string {
  const n = `${c.name ?? ''} ${c.surname ?? ''}`.trim()
  return n || c.id
}

function statusPillClasses(status: 'pending' | 'converted' | 'cancelled'): { base: string; active: string } {
  switch (status) {
    case 'pending':
      return { base: 'bg-amber-50 text-amber-900 ring-amber-100', active: 'bg-amber-600 text-white ring-amber-600' }
    case 'converted':
      return { base: 'bg-teal-50 text-teal-900 ring-teal-100', active: 'bg-teal-600 text-white ring-teal-600' }
    case 'cancelled':
      return { base: 'bg-rose-50 text-rose-800 ring-rose-100', active: 'bg-rose-600 text-white ring-rose-600' }
  }
}

function estimateStatusLabel(status: string | null | undefined): string {
  const s = (status ?? 'pending').toLowerCase()
  if (s === 'converted') return 'Converted to order'
  if (s === 'cancelled') return 'Cancelled'
  return 'Pending'
}

function EstimateStatusBadge({ status }: Readonly<{ status: string | null | undefined }>) {
  const s = (status ?? 'pending').toLowerCase()
  const label = estimateStatusLabel(s)
  const cls =
    s === 'converted'
      ? 'bg-emerald-100 text-emerald-900'
      : s === 'cancelled'
        ? 'bg-slate-200 text-slate-800'
        : 'bg-amber-100 text-amber-900'
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
  )
}

function TypesAndWindowsCell({ lines }: Readonly<{ lines: BlindsLine[] }>) {
  if (!lines?.length) return <span className="text-slate-500">—</span>
  return (
    <ul className="max-w-md list-none space-y-0.5 text-slate-800">
      {lines.map((b) => (
        <li key={b.id} className="text-sm">
          <span className="font-medium">{b.name}</span>
          {b.window_count != null ? (
            <span className="text-slate-600"> — {b.window_count} windows</span>
          ) : (
            <span className="text-slate-400"> — —</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function EstimatesPage() {
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('estimates.edit'))
  const canCreateOrder = Boolean(me?.permissions.includes('orders.edit'))

  const [rows, setRows] = useState<EstimateRow[] | null>(null)
  const [customers, setCustomers] = useState<CustomerOpt[] | null>(null)
  const [blindsTypes, setBlindsTypes] = useState<BlindsOpt[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [scheduleFilter] = useState<'all' | 'upcoming' | 'past'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'converted' | 'cancelled'>('pending')
  const [showDeleted, setShowDeleted] = useState(false)
  const [filterCustomerId] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<EstimateRow | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<EstimateRow | null>(null)
  const [restorePending, setRestorePending] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createContextLoading, setCreateContextLoading] = useState(false)
  const [createContext, setCreateContext] = useState<CreateContext | null>(null)
  const [modalErr, setModalErr] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [selectedBlindsIds, setSelectedBlindsIds] = useState<string[]>([])
  const [windowCountByBlindsId, setWindowCountByBlindsId] = useState<Record<string, string>>({})
  const [scheduledLocal, setScheduledLocal] = useState(() => toDatetimeLocalValue(new Date()))
  const [visitTimeZone, setVisitTimeZone] = useState(() => coerceTimeZoneForApi(defaultTimeZone()))
  const [guestEmail, setGuestEmail] = useState('')
  const [visitNotes, setVisitNotes] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (scheduleFilter !== 'all') p.set('schedule_filter', scheduleFilter)
    if (statusFilter !== 'all') p.set('status_filter', statusFilter)
    if (showDeleted) p.set('include_deleted', 'true')
    if (filterCustomerId.trim()) p.set('customer_id', filterCustomerId.trim())
    return p.toString()
  }, [debouncedSearch, scheduleFilter, statusFilter, showDeleted, filterCustomerId])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadErr(null)
      try {
        const [list, custList, btList] = await Promise.all([
          getJson<EstimateRow[]>(`/estimates?${listParams}`),
          getJson<CustomerOpt[]>(`/customers?limit=300`),
          getJson<BlindsOpt[]>(`/estimates/lookup/blinds-types`),
        ])
        if (!cancelled) {
          setRows(list)
          setCustomers(custList)
          setBlindsTypes(btList)
        }
      } catch (e) {
        if (!cancelled) {
          setRows(null)
          setLoadErr(e instanceof Error ? e.message : 'Could not load estimates')
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
    const list = await getJson<EstimateRow[]>(`/estimates?${listParams}`)
    setRows(list)
  }

  function toggleBlinds(id: string) {
    setSelectedBlindsIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  useEffect(() => {
    setWindowCountByBlindsId((w) => {
      const next: Record<string, string> = {}
      for (const id of selectedBlindsIds) {
        next[id] = w[id] ?? ''
      }
      return next
    })
  }, [selectedBlindsIds])

  function setWindowInputFor(blindsId: string, value: string) {
    setWindowCountByBlindsId((w) => ({ ...w, [blindsId]: value }))
  }

  async function openCreate() {
    setScheduledLocal(toDatetimeLocalValue(new Date()))
    setVisitTimeZone(coerceTimeZoneForApi(defaultTimeZone()))
    setGuestEmail('')
    setVisitNotes('')
    setCustomerId('')
    setSelectedBlindsIds([])
    setWindowCountByBlindsId({})
    setModalErr(null)
    setCreateContext(null)
    setShowCreate(true)
    setCreateContextLoading(true)
    try {
      const ctx = await getJson<CreateContext>('/estimates/lookup/create-context')
      setCreateContext(ctx)
    } catch {
      setCreateContext(null)
      setModalErr('Could not load company details for organizer and guests.')
    } finally {
      setCreateContextLoading(false)
    }
  }

  const selectedCustomer = useMemo(
    () => (customers ?? []).find((c) => c.id === customerId),
    [customers, customerId],
  )
  const customerAddressView = (selectedCustomer?.address ?? '').trim() || '—'

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !customerId || selectedBlindsIds.length < 1 || !scheduledLocal.trim()) return
    const wall = scheduledLocal.trim()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) {
      setModalErr('Invalid date and time format.')
      return
    }
    const tz = coerceTimeZoneForApi(visitTimeZone.trim())

    const vaddr = (selectedCustomer?.address ?? '').trim()
    const orgName = createContext?.organizer_name?.trim() || undefined
    const orgEmail = createContext?.organizer_email?.trim() || undefined

    const blinds_lines: { blinds_id: string; window_count: number | null }[] = []
    for (const bid of selectedBlindsIds) {
      const raw = (windowCountByBlindsId[bid] ?? '').trim()
      if (raw === '') {
        blinds_lines.push({ blinds_id: bid, window_count: null })
        continue
      }
      const n = Number.parseInt(raw, 10)
      if (Number.isNaN(n) || n < 1) {
        setModalErr('Window counts must be positive integers or left empty.')
        return
      }
      blinds_lines.push({ blinds_id: bid, window_count: n })
    }

    const guestList = guestEmail.trim() ? [guestEmail.trim()] : []

    setSaving(true)
    setModalErr(null)
    try {
      await postJson('/estimates', {
        customer_id: customerId,
        blinds_lines,
        scheduled_wall: wall,
        visit_time_zone: tz,
        ...(vaddr ? { visit_address: vaddr } : {}),
        visit_notes: visitNotes.trim() || undefined,
        ...(orgName ? { visit_organizer_name: orgName } : {}),
        ...(orgEmail ? { visit_organizer_email: orgEmail } : {}),
        ...(guestList.length ? { visit_guest_emails: guestList } : {}),
      })
      setShowCreate(false)
      await refresh()
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return
    setDeletePending(true)
    setLoadErr(null)
    try {
      await deleteJson(`/estimates/${deleteTarget.id}`)
      setDeleteTarget(null)
      await refresh()
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeletePending(false)
    }
  }

  async function confirmRestore() {
    if (!restoreTarget || restorePending) return
    setRestorePending(true)
    setLoadErr(null)
    try {
      await postJson(`/estimates/${restoreTarget.id}/restore`, {})
      setRestoreTarget(null)
      await refresh()
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestorePending(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="w-full max-w-none space-y-6">
      <ConfirmModal
        open={deleteTarget !== null}
        title="Remove this estimate?"
        description={
          deleteTarget
            ? `Remove the estimate for ${deleteTarget.customer_display || deleteTarget.id} from the list? The record is soft-deleted and kept for audit.`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !deletePending && setDeleteTarget(null)}
      />

      <ConfirmModal
        open={restoreTarget !== null}
        title="Restore this estimate?"
        description={
          restoreTarget
            ? `Put the estimate for ${restoreTarget.customer_display || restoreTarget.id} back on the active list?`
            : ''
        }
        confirmLabel="Restore"
        pending={restorePending}
        onConfirm={() => void confirmRestore()}
        onCancel={() => !restorePending && setRestoreTarget(null)}
      />

      {showCreate ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="estimate-create-title"
        >
          <form
            onSubmit={(e) => void onCreate(e)}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
              <h2 id="estimate-create-title" className="text-base font-semibold text-slate-900">
                New estimate
              </h2>
              <button
                type="button"
                disabled={saving}
                className="rounded px-2 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                onClick={() => !saving && setShowCreate(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="mt-3 space-y-2.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
                  Customer
                  <select
                    required
                    className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {(customers ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {customerLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-slate-700">
                  Time zone
                  <select
                    required
                    className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={visitTimeZone}
                    onChange={(e) => setVisitTimeZone(e.target.value)}
                  >
                    {!VISIT_TIME_ZONES.includes(visitTimeZone) ? (
                      <option value={visitTimeZone}>{visitTimeZone}</option>
                    ) : null}
                    {VISIT_TIME_ZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-slate-700">
                  Visit start
                  <input
                    required
                    type="datetime-local"
                    className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={scheduledLocal}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                  />
                </label>
              </div>

              <div className="space-y-1 rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                <div>
                  <span className="font-medium text-slate-700">Address</span>
                  <span className="ml-1">{customerAddressView}</span>
                </div>
                <div>
                  <span className="font-medium text-slate-700">Organizer</span>
                  <span className="ml-1">
                    {createContextLoading
                      ? '…'
                      : createContext
                        ? `${createContext.organizer_name}${
                            createContext.organizer_email ? ` · ${createContext.organizer_email}` : ''
                          }`
                        : '—'}
                  </span>
                </div>
                <label className="block pt-0.5">
                  <span className="font-medium text-slate-700">Guest</span>
                  <select
                    className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={guestEmail}
                    onChange={(e) => setGuestEmail(e.target.value)}
                    disabled={createContextLoading || !createContext}
                  >
                    <option value="">None</option>
                    {(createContext?.guest_options ?? []).map((g) => (
                      <option key={g.email.toLowerCase()} value={g.email}>
                        {g.label} ({g.email})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset className="rounded-md border border-slate-200 p-2">
                <legend className="px-1 text-xs font-medium text-slate-800">Blinds types</legend>
                <div className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {(blindsTypes ?? []).map((b) => {
                    const checked = selectedBlindsIds.includes(b.id)
                    return (
                      <div
                        key={b.id}
                        className={`flex flex-wrap items-center gap-1 rounded border px-1.5 py-1 text-xs ${
                          checked ? 'border-teal-200 bg-teal-50/50' : 'border-transparent'
                        }`}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-slate-800">
                          <input
                            type="checkbox"
                            className="h-3 w-3 shrink-0 rounded border-slate-300 text-teal-600"
                            checked={checked}
                            onChange={() => toggleBlinds(b.id)}
                          />
                          <span className="truncate font-medium">{b.name}</span>
                        </label>
                        {checked ? (
                          <input
                            type="number"
                            min={1}
                            placeholder="Win"
                            title="Windows"
                            className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs outline-none focus:border-teal-500"
                            value={windowCountByBlindsId[b.id] ?? ''}
                            onChange={(ev) => setWindowInputFor(b.id, ev.target.value)}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                {selectedBlindsIds.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-700">Choose at least one type.</p>
                ) : null}
              </fieldset>

              <label className="block text-xs font-medium text-slate-700">
                Notes
                <textarea
                  rows={2}
                  className="mt-0.5 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  value={visitNotes}
                  onChange={(e) => setVisitNotes(e.target.value)}
                  placeholder="Optional — shown in calendar description"
                />
              </label>
            </div>

            {modalErr ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                {modalErr}
              </div>
            ) : null}

            {customers?.length === 0 ? (
              <p className="mt-2 text-[11px] text-amber-700">Add a customer first.</p>
            ) : null}
            {blindsTypes?.length === 0 ? (
              <p className="mt-2 text-[11px] text-amber-700">Add blinds types under Lookups.</p>
            ) : null}

            <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => !saving && setShowCreate(false)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  saving ||
                  !customerId ||
                  selectedBlindsIds.length < 1 ||
                  customers?.length === 0 ||
                  blindsTypes?.length === 0
                }
                className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <CalendarDays className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Estimates</h1>
            <p className="mt-1 text-sm text-slate-600">
              Scheduled visits; window counts are stored per blinds type and shown in this list.
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => void openCreate()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            New estimate
          </button>
        ) : null}
      </div>

      {loadErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadErr}</div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-slate-800">Estimates</h2>
            <input
              type="search"
              placeholder="Customer, address, blinds type…"
              className="h-8 min-w-[12rem] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:max-w-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search estimates"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => setStatusFilter('all')}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                } ${loading ? 'opacity-60' : ''}`}
                title="All statuses"
              >
                All
              </button>
              {(['pending', 'converted', 'cancelled'] as const).map((st) => {
                const selected = statusFilter === st
                const c = statusPillClasses(st)
                const label = st === 'pending' ? 'Pending' : st === 'converted' ? 'Converted' : 'Cancelled'
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={loading}
                    onClick={() => setStatusFilter(st)}
                    className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                      selected ? c.active : c.base
                    } ${selected ? '' : 'hover:brightness-[0.98]'} ${loading ? 'opacity-60' : ''}`}
                    aria-pressed={selected}
                    title={label}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="ml-auto flex items-center">
              <ShowDeletedToggle
                id="show-deleted-estimates"
                checked={showDeleted}
                onChange={setShowDeleted}
                disabled={loading}
              />
            </div>
          </div>
        </div>
        <div className="w-full overflow-x-auto overscroll-x-contain">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : !rows?.length ? (
          <p className="p-6 text-sm text-slate-500">No estimates match the current filters.</p>
        ) : (
          <table className="w-full min-w-[960px] text-left text-sm [word-break:break-word]">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-3 sm:px-4">Customer</th>
                <th className="px-2 py-3 sm:px-4">Address</th>
                <th className="px-2 py-3 sm:px-4">Types &amp; windows</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Status</th>
                <th className="px-2 py-3 sm:px-4">Scheduled</th>
                {canEdit ? <th className="w-44 px-2 py-3 text-right sm:px-4">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`hover:bg-slate-50/80 ${r.is_deleted ? 'bg-slate-50/90 opacity-80' : ''}`.trim()}
                >
                  <td className="align-top px-2 py-3 text-slate-800 sm:px-4">
                    <Link
                      to={`/customers/${r.customer_id}`}
                      className="text-teal-700 hover:underline"
                    >
                      {r.customer_display || r.customer_id}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] align-top px-2 py-3 text-slate-600 sm:px-4">
                    {r.customer_address?.trim() ? (
                      <span className="line-clamp-3 text-sm">{r.customer_address}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="align-top px-2 py-3 sm:px-4">
                    <TypesAndWindowsCell lines={r.blinds_types} />
                  </td>
                  <td className="align-top px-2 py-3 sm:px-4">
                    <EstimateStatusBadge status={r.status} />
                    {r.is_deleted ? (
                      <span className="mt-1 block text-[11px] font-medium text-slate-500">Deleted</span>
                    ) : null}
                  </td>
                  <td className="align-top px-2 py-3 text-slate-600 sm:px-4">{displayScheduled(r)}</td>
                  {canEdit ? (
                    <td className="align-top px-2 py-3 text-right sm:px-4">
                      <div className="flex justify-end gap-1">
                        {r.is_deleted ? (
                          <>
                            <Link
                              to={`/estimates/${r.id}`}
                              className="inline-flex rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-teal-700"
                              title="View"
                              aria-label="View estimate"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                            <button
                              type="button"
                              className="inline-flex rounded-md p-1.5 text-slate-600 hover:bg-teal-50 hover:text-teal-800"
                              title="Restore"
                              aria-label="Restore estimate"
                              onClick={() => setRestoreTarget(r)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            {(r.status ?? 'pending').toLowerCase() === 'pending' && canCreateOrder ? (
                              <Link
                                to={`/orders?fromEstimate=${encodeURIComponent(r.id)}`}
                                className="inline-flex rounded-md p-1.5 text-slate-600 hover:bg-violet-50 hover:text-violet-800"
                                title="Make order"
                                aria-label="Make order from estimate"
                              >
                                <ShoppingBag className="h-4 w-4" />
                              </Link>
                            ) : null}
                            <Link
                              to={`/estimates/${r.id}/edit`}
                              className="inline-flex rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-teal-700"
                              title="Edit"
                              aria-label="Edit estimate"
                            >
                              <Pencil className="h-4 w-4" />
                            </Link>
                            <button
                              type="button"
                              className="inline-flex rounded-md p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-700"
                              title="Remove"
                              aria-label="Remove estimate"
                              onClick={() => setDeleteTarget(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      </div>
    </div>
  )
}
