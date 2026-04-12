import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Check, Eye, Pencil, RotateCcw, ShoppingBag, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, postJson, deleteJson } from '@/lib/api'
import {
  defaultVisitScheduleParts,
  isValidScheduledWall,
  joinScheduledWall,
  snapWallToQuarterMinutes,
} from '@/lib/visitSchedule'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { VisitStartQuarterPicker } from '@/components/ui/VisitStartQuarterPicker'
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
  status_label?: string | null
  status_esti_id?: string | null
  is_deleted?: boolean | null
  scheduled_start_at: string | null
  tarih_saat: string | null
  created_at: string | null
}

type EstimateStatusFilterOpt = { id: string; name: string; sort_order?: number; code?: string | null }

type CreateContext = {
  organizer_name: string
  organizer_email: string | null
  guest_options: { email: string; label: string }[]
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

function statusPillClassesForCode(
  code: string | null | undefined,
): { base: string; active: string } {
  const w = (code ?? '').toLowerCase()
  switch (w) {
    case 'pending':
      return { base: 'bg-amber-50 text-amber-900 ring-amber-100', active: 'bg-amber-600 text-white ring-amber-600' }
    case 'converted':
      return { base: 'bg-teal-50 text-teal-900 ring-teal-100', active: 'bg-teal-600 text-white ring-teal-600' }
    case 'cancelled':
      return { base: 'bg-rose-50 text-rose-800 ring-rose-100', active: 'bg-rose-600 text-white ring-rose-600' }
    default:
      return { base: 'bg-violet-50 text-violet-900 ring-violet-100', active: 'bg-violet-700 text-white ring-violet-700' }
  }
}

/** Same heuristics as the orders list status chips (substring on display name). */
function orderListStyleStatusPillClasses(name: string): { base: string; active: string } {
  const n = (name || '').trim().toLowerCase()
  if (n.includes('new')) return { base: 'bg-sky-50 text-sky-800 ring-sky-100', active: 'bg-sky-600 text-white ring-sky-600' }
  if (n.includes('production')) return { base: 'bg-violet-50 text-violet-800 ring-violet-100', active: 'bg-violet-600 text-white ring-violet-600' }
  if (n.includes('ready')) return { base: 'bg-amber-50 text-amber-900 ring-amber-100', active: 'bg-amber-600 text-white ring-amber-600' }
  if (n.includes('install')) return { base: 'bg-indigo-50 text-indigo-800 ring-indigo-100', active: 'bg-indigo-600 text-white ring-indigo-600' }
  if (n.includes('done') || n.includes('final') || n.includes('paid'))
    return { base: 'bg-emerald-50 text-emerald-900 ring-emerald-100', active: 'bg-emerald-600 text-white ring-emerald-600' }
  if (n.includes('cancel')) return { base: 'bg-rose-50 text-rose-800 ring-rose-100', active: 'bg-rose-600 text-white ring-rose-600' }
  if (n.includes('estimate')) return { base: 'bg-teal-50 text-teal-900 ring-teal-100', active: 'bg-teal-600 text-white ring-teal-600' }
  return { base: 'bg-slate-50 text-slate-800 ring-slate-200', active: 'bg-slate-800 text-white ring-slate-800' }
}

type EstimateStatusKind = 'pending' | 'converted' | 'cancelled' | 'new' | 'fallback'

/**
 * One semantic bucket for filter chips and row badges (code, API status, and label hints).
 */
function resolveEstimateStatusKind(
  name: string,
  code: string | null | undefined,
  apiStatus: string | null | undefined,
): EstimateStatusKind {
  const c = (code ?? '').toLowerCase()
  if (c === 'pending') return 'pending'
  if (c === 'converted') return 'converted'
  if (c === 'cancelled') return 'cancelled'
  const n = (name || '').trim().toLowerCase()
  const s = (apiStatus ?? '').trim().toLowerCase()
  if (s === 'pending' || (n.includes('pending') && !n.includes('convert'))) return 'pending'
  if (s === 'converted' || n.includes('convert')) return 'converted'
  if (s === 'cancelled' || n.includes('cancel')) return 'cancelled'
  if (n.includes('new')) return 'new'
  return 'fallback'
}

const ESTIMATE_KIND_BADGE: Record<EstimateStatusKind, string> = {
  pending: 'bg-amber-50 text-amber-900',
  converted: 'bg-teal-50 text-teal-900',
  cancelled: 'bg-rose-50 text-rose-800',
  new: 'bg-sky-50 text-sky-800',
  fallback: '',
}

function estimateFilterChipClasses(
  name: string,
  code: string | null | undefined,
): { base: string; active: string } {
  const kind = resolveEstimateStatusKind(name, code, null)
  if (kind === 'pending' || kind === 'converted' || kind === 'cancelled') {
    return statusPillClassesForCode(kind)
  }
  if (kind === 'new') {
    return { base: 'bg-sky-50 text-sky-800 ring-sky-100', active: 'bg-sky-600 text-white ring-sky-600' }
  }
  return orderListStyleStatusPillClasses(name)
}

function estimateStatusLabel(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase()
  if (s === 'converted') return 'Converted to order'
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'pending') return 'Pending'
  return 'Status'
}

function estimateRowStatusBadgeClasses(
  status: string | null | undefined,
  label: string | null | undefined,
): string {
  const name = (label ?? '').trim()
  const kind = resolveEstimateStatusKind(name, null, status)
  if (kind !== 'fallback') return ESTIMATE_KIND_BADGE[kind]
  const { base } = orderListStyleStatusPillClasses(name)
  return base.replace(/\s+ring-\S+/g, '').trim()
}

function EstimateStatusBadge({
  status,
  label,
}: Readonly<{ status: string | null | undefined; label?: string | null }>) {
  const labelText = (label?.trim() || estimateStatusLabel(status)).trim()
  const cls = estimateRowStatusBadgeClasses(status, label)
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{labelText}</span>
  )
}

function TypesAndWindowsCell({ lines }: Readonly<{ lines: BlindsLine[] }>) {
  if (!lines?.length) return <span className="text-slate-500">—</span>
  return (
    <ul className="max-w-md list-none space-y-0.5 text-slate-800">
      {lines.map((b) => (
        <li key={b.id} className="flex items-start gap-1.5 text-sm">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" strokeWidth={2.5} aria-hidden />
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
  const [filterStatusEstiId, setFilterStatusEstiId] = useState('')
  const [estimateStatusOpts, setEstimateStatusOpts] = useState<EstimateStatusFilterOpt[] | null>(null)
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
  const [windowCountByBlindsId, setWindowCountByBlindsId] = useState<Record<string, string>>({})
  const [blindsLineSelected, setBlindsLineSelected] = useState<Record<string, boolean>>({})
  const [visitWallDraft, setVisitWallDraft] = useState('')
  const [visitTimeZone, setVisitTimeZone] = useState(() => coerceTimeZoneForApi(defaultTimeZone()))
  const [guestEmails, setGuestEmails] = useState<string[]>([])
  const [visitNotes, setVisitNotes] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    ;(async () => {
      try {
        const st = await getJson<EstimateStatusFilterOpt[]>(`/estimates/lookup/estimate-statuses`)
        if (!cancelled) setEstimateStatusOpts(st ?? [])
      } catch {
        if (!cancelled) setEstimateStatusOpts([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me])

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (scheduleFilter !== 'all') p.set('schedule_filter', scheduleFilter)
    if (filterStatusEstiId.trim()) p.set('status_esti_id', filterStatusEstiId.trim())
    if (showDeleted) p.set('include_deleted', 'true')
    if (filterCustomerId.trim()) p.set('customer_id', filterCustomerId.trim())
    return p.toString()
  }, [debouncedSearch, scheduleFilter, filterStatusEstiId, showDeleted, filterCustomerId])

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

  useEffect(() => {
    if (!blindsTypes?.length) return
    setWindowCountByBlindsId((prev) => {
      const next = { ...prev }
      for (const b of blindsTypes) {
        if (next[b.id] === undefined) next[b.id] = ''
      }
      return next
    })
  }, [blindsTypes])

  const employeeGuestOptions = useMemo(() => {
    const org = createContext?.organizer_email?.trim().toLowerCase() ?? ''
    if (!org) return createContext?.guest_options ?? []
    return (createContext?.guest_options ?? []).filter((g) => g.email.trim().toLowerCase() !== org)
  }, [createContext])

  function setWindowInputFor(blindsId: string, value: string) {
    setWindowCountByBlindsId((w) => ({ ...w, [blindsId]: value }))
  }

  async function openCreate() {
    const p = defaultVisitScheduleParts()
    const w = joinScheduledWall(p.date, p.hour12, p.minute, p.ampm)
    setVisitWallDraft(w)
    setVisitTimeZone(coerceTimeZoneForApi(defaultTimeZone()))
    setGuestEmails([])
    setVisitNotes('')
    setCustomerId('')
    setWindowCountByBlindsId({})
    setBlindsLineSelected({})
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

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit || !customerId) return
    const wall = snapWallToQuarterMinutes(visitWallDraft).trim()
    if (!isValidScheduledWall(wall)) {
      setModalErr('Invalid date and time format.')
      return
    }
    const tz = coerceTimeZoneForApi(visitTimeZone.trim())

    const vaddr = (selectedCustomer?.address ?? '').trim()
    const orgName = createContext?.organizer_name?.trim() || undefined
    const orgEmail = createContext?.organizer_email?.trim() || undefined

    const blinds_lines: { blinds_id: string; window_count: number | null }[] = []
    for (const b of blindsTypes ?? []) {
      if (!blindsLineSelected[b.id]) continue
      const raw = (windowCountByBlindsId[b.id] ?? '').trim()
      if (raw === '') {
        setModalErr('Enter a window count for each selected blinds type.')
        return
      }
      const n = Number.parseInt(raw, 10)
      if (Number.isNaN(n) || n < 1) {
        setModalErr('Window counts must be positive integers.')
        return
      }
      blinds_lines.push({ blinds_id: b.id, window_count: n })
    }

    const guestList = guestEmails.map((e) => e.trim()).filter(Boolean)

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

                <div className="block text-xs font-medium text-slate-700">
                  <span className="block">Visit date</span>
                  <div className="mt-0.5">
                    <VisitStartQuarterPicker
                      compact
                      value={visitWallDraft}
                      onChange={(v) => {
                        setVisitWallDraft(v)
                        setModalErr(null)
                      }}
                      disabled={saving}
                    />
                  </div>
                </div>

                <label className="block text-xs font-medium text-slate-600">
                  <span>Time zone</span>
                  <select
                    required
                    className="mt-0.5 w-full rounded-md border border-slate-100 bg-slate-50/90 px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
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
              </div>

              <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2 py-2 text-xs text-slate-700">
                <p className="font-semibold text-slate-800">Organizer & employees</p>
                <div className="mt-1 max-h-28 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5">
                  {createContextLoading || !createContext ? (
                    <span className="text-[11px] text-slate-400">Loading…</span>
                  ) : (
                    <>
                      <div className="flex items-start gap-2 rounded px-1 py-0.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-not-allowed rounded border-slate-300 text-teal-600 opacity-70"
                          aria-label="Organizer (always included)"
                        />
                        <span className="min-w-0 leading-snug">
                          <span className="font-medium text-slate-800">{createContext.organizer_name}</span>
                          <span className="ml-1 align-middle rounded bg-teal-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-900">
                            Organizer
                          </span>
                          {createContext.organizer_email ? (
                            <span className="block text-slate-500">{createContext.organizer_email}</span>
                          ) : (
                            <span className="block text-slate-400">No organizer email on file</span>
                          )}
                        </span>
                      </div>
                      {employeeGuestOptions.length === 0 ? (
                        <span className="text-[11px] text-slate-400">No additional team contacts.</span>
                      ) : (
                        employeeGuestOptions.map((g) => {
                          const checked = guestEmails.some((e) => e.toLowerCase() === g.email.toLowerCase())
                          return (
                            <label
                              key={g.email.toLowerCase()}
                              className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-slate-50"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                                checked={checked}
                                disabled={createContextLoading || !createContext}
                                onChange={() => {
                                  setGuestEmails((prev) =>
                                    checked
                                      ? prev.filter((e) => e.toLowerCase() !== g.email.toLowerCase())
                                      : [...prev, g.email.trim()],
                                  )
                                }}
                              />
                              <span className="min-w-0 leading-snug">
                                <span className="font-medium text-slate-800">{g.label}</span>
                                <span className="block text-slate-500">{g.email}</span>
                              </span>
                            </label>
                          )
                        })
                      )}
                    </>
                  )}
                </div>
              </div>

              <fieldset className="rounded-md border border-slate-200 p-2">
                <legend className="px-1 text-xs font-medium text-slate-800">Blinds types</legend>
                <p className="mb-1 text-[10px] text-slate-500">
                  Optional — enter a window count only for types you want on this estimate.
                </p>
                <div className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {(blindsTypes ?? []).map((b) => {
                    const checked = Boolean(blindsLineSelected[b.id])
                    return (
                      <label
                        key={b.id}
                        className="flex flex-wrap items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-xs hover:bg-slate-50/80"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                          checked={checked}
                          onChange={(ev) => {
                            const on = ev.target.checked
                            setBlindsLineSelected((prev) => ({ ...prev, [b.id]: on }))
                            if (!on) setWindowCountByBlindsId((w) => ({ ...w, [b.id]: '' }))
                          }}
                          aria-label={`Include ${b.name}`}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{b.name}</span>
                        <input
                          type="number"
                          min={1}
                          placeholder="Qty"
                          title="Windows"
                          disabled={!checked}
                          className="w-14 rounded border border-slate-200 px-1 py-0.5 text-xs outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                          value={windowCountByBlindsId[b.id] ?? ''}
                          onChange={(ev) => {
                            const v = ev.target.value
                            setWindowInputFor(b.id, v)
                            const n = Number.parseInt(v.trim(), 10)
                            if (!Number.isNaN(n) && n >= 1)
                              setBlindsLineSelected((prev) => ({ ...prev, [b.id]: true }))
                          }}
                        />
                      </label>
                    )
                  })}
                </div>
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
                disabled={saving || !customerId || customers?.length === 0 || blindsTypes?.length === 0}
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
                onClick={() => setFilterStatusEstiId('')}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  filterStatusEstiId.trim() === ''
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                } ${loading ? 'opacity-60' : ''}`}
                title="All statuses"
              >
                All
              </button>
              {(estimateStatusOpts ?? []).map((s) => {
                const selected = filterStatusEstiId === s.id
                const c = estimateFilterChipClasses(s.name, s.code)
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setFilterStatusEstiId(s.id)}
                    className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                      selected ? c.active : c.base
                    } ${selected ? '' : 'hover:brightness-[0.98]'} ${loading ? 'opacity-60' : ''}`}
                    aria-pressed={selected}
                    title={s.name}
                  >
                    {s.name}
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
                <th className="px-2 py-3 sm:px-4">Visit date</th>
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
                    <EstimateStatusBadge status={r.status} label={r.status_label} />
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
                            {r.status?.toLowerCase() === 'pending' && canCreateOrder ? (
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
