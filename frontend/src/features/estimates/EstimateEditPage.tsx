import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'
import {
  defaultVisitScheduleParts,
  isValidScheduledWall,
  joinScheduledWall,
  snapWallToQuarterMinutes,
} from '@/lib/visitSchedule'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { VisitStartQuarterPicker } from '@/components/ui/VisitStartQuarterPicker'

type BlindsRef = { id: string; name: string; window_count?: number | null }
type BlindsOpt = { id: string; name: string }

type EstimateStatusOpt = {
  id: string
  name: string
  active: boolean
  code?: string | null
  sort_order?: number
}

type EstimateDetail = {
  id: string
  customer_id: string
  customer_display: string
  customer_address?: string | null
  blinds_types: BlindsRef[]
  scheduled_wall: string | null
  visit_time_zone?: string | null
  visit_address?: string | null
  visit_notes?: string | null
  visit_organizer_name?: string | null
  visit_organizer_email?: string | null
  visit_guest_emails?: string[]
  status?: string | null
  status_label?: string | null
  status_esti_id?: string | null
  is_deleted?: boolean | null
}

type CreateContext = {
  organizer_name: string
  organizer_email: string | null
  guest_options: { email: string; label: string }[]
}

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

export function EstimateEditPage() {
  const { estimateId } = useParams()
  const navigate = useNavigate()
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('estimates.edit'))

  const [detail, setDetail] = useState<EstimateDetail | null>(null)
  const [blindsTypes, setBlindsTypes] = useState<BlindsOpt[] | null>(null)
  const [createContext, setCreateContext] = useState<CreateContext | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedStatusEstiId, setSelectedStatusEstiId] = useState('')
  const [estimateStatuses, setEstimateStatuses] = useState<EstimateStatusOpt[] | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restorePending, setRestorePending] = useState(false)

  const [visitWallDraft, setVisitWallDraft] = useState('')
  const [visitWallApplied, setVisitWallApplied] = useState('')
  const [visitTimeZone, setVisitTimeZone] = useState('UTC')
  const [visitAddress, setVisitAddress] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [guestEmails, setGuestEmails] = useState<string[]>([])
  const [windowCountByBlindsId, setWindowCountByBlindsId] = useState<Record<string, string>>({})
  const [blindsIncluded, setBlindsIncluded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!me || !estimateId || !canEdit) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadErr(null)
      try {
        const [d, bt, ctx, estSt] = await Promise.all([
          getJson<EstimateDetail>(`/estimates/${estimateId}`),
          getJson<BlindsOpt[]>(`/estimates/lookup/blinds-types`),
          getJson<CreateContext>(`/estimates/lookup/create-context`),
          getJson<EstimateStatusOpt[]>(`/lookups/estimate-statuses?limit=50&include_inactive=true`),
        ])
        if (cancelled) return
        setDetail(d)
        setBlindsTypes(bt)
        setCreateContext(ctx)
        setEstimateStatuses(estSt)
        setSelectedStatusEstiId((d.status_esti_id ?? '').trim())
        const p0 = defaultVisitScheduleParts()
        const wallRaw = d.scheduled_wall?.trim() ?? ''
        const initialWall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallRaw)
          ? snapWallToQuarterMinutes(wallRaw)
          : joinScheduledWall(p0.date, p0.hour12, p0.minute, p0.ampm)
        setVisitWallDraft(initialWall)
        setVisitWallApplied(initialWall)
        const tz = coerceTimeZoneForApi(d.visit_time_zone?.trim() || 'UTC')
        setVisitTimeZone(tz)
        setVisitAddress((d.visit_address ?? d.customer_address ?? '').trim())
        setVisitNotes((d.visit_notes ?? '').trim())
        setGuestEmails((d.visit_guest_emails ?? []).map((e) => e.trim()).filter(Boolean))
        const wc: Record<string, string> = {}
        const inc: Record<string, boolean> = {}
        for (const b of bt ?? []) {
          const line = (d.blinds_types ?? []).find((x) => x.id === b.id)
          const raw = line?.window_count != null ? String(line.window_count) : ''
          wc[b.id] = raw
          inc[b.id] = raw.trim() !== '' && Number.parseInt(raw.trim(), 10) >= 1
        }
        setWindowCountByBlindsId(wc)
        setBlindsIncluded(inc)
      } catch (e) {
        if (!cancelled) {
          setDetail(null)
          setLoadErr(e instanceof Error ? e.message : 'Could not load estimate')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, estimateId, canEdit])

  const estimateStatusSelectOptions = useMemo(() => {
    if (!detail || !estimateStatuses?.length) return []
    const cur = (detail.status ?? '').toLowerCase()
    const curId = (detail.status_esti_id ?? '').trim()
    const filtered = estimateStatuses.filter((s) => {
      const w = (s.code ?? '').toLowerCase()
      if (!s.active && s.id !== curId) return false
      if (cur === 'converted') return w === 'converted' || w === 'cancelled'
      if (cur === 'pending') return w === 'pending' || w === 'cancelled'
      return true
    })
    return [...filtered].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [detail, estimateStatuses])

  useEffect(() => {
    if (!detail || !estimateStatuses?.length) return
    if (selectedStatusEstiId.trim()) return
    const pending = estimateStatuses.find((s) => s.code === 'pending' && s.active)
    if (pending) setSelectedStatusEstiId(pending.id)
  }, [detail, estimateStatuses, selectedStatusEstiId])

  function setWindowInputFor(blindsId: string, value: string) {
    setWindowCountByBlindsId((wt) => ({ ...wt, [blindsId]: value }))
  }

  const customerAddressView = useMemo(
    () => (detail?.customer_address ?? '').trim() || '—',
    [detail?.customer_address],
  )

  const guestSelectOptions = useMemo(() => {
    const fromCtx = createContext?.guest_options ?? []
    const seen = new Set(fromCtx.map((g) => g.email.toLowerCase()))
    const legacy = (detail?.visit_guest_emails ?? []).filter(Boolean)
    const extra: { email: string; label: string }[] = []
    for (const em of legacy) {
      const e = em.trim()
      if (!e || seen.has(e.toLowerCase())) continue
      seen.add(e.toLowerCase())
      extra.push({ email: e, label: `${e} (current)` })
    }
    return [...extra, ...fromCtx]
  }, [createContext?.guest_options, detail?.visit_guest_emails])

  const organizerEmailLc = useMemo(() => {
    const o = (detail?.visit_organizer_email || createContext?.organizer_email || '').trim().toLowerCase()
    return o
  }, [detail?.visit_organizer_email, createContext?.organizer_email])

  const employeeGuestOptions = useMemo(() => {
    if (!organizerEmailLc) return guestSelectOptions
    return guestSelectOptions.filter((g) => g.email.trim().toLowerCase() !== organizerEmailLc)
  }, [guestSelectOptions, organizerEmailLc])

  const visitSetEnabled = useMemo(() => {
    if (!visitWallDraft.trim()) return false
    if (!isValidScheduledWall(visitWallDraft)) return false
    return snapWallToQuarterMinutes(visitWallDraft) !== visitWallApplied
  }, [visitWallDraft, visitWallApplied])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!estimateId || !canEdit || detail?.is_deleted) return
    const snappedDraft = snapWallToQuarterMinutes(visitWallDraft)
    if (snappedDraft !== visitWallApplied) {
      setSaveErr('Click Set to confirm the visit start time.')
      return
    }
    const wall = visitWallApplied.trim()
    if (!isValidScheduledWall(wall)) {
      setSaveErr('Invalid date and time format.')
      return
    }
    const tz = coerceTimeZoneForApi(visitTimeZone.trim())

    const blinds_lines: { blinds_id: string; window_count: number | null }[] = []
    for (const b of blindsTypes ?? []) {
      if (!blindsIncluded[b.id]) continue
      const raw = (windowCountByBlindsId[b.id] ?? '').trim()
      if (raw === '') {
        setSaveErr('Enter a window count for each selected blinds type.')
        return
      }
      const n = Number.parseInt(raw, 10)
      if (Number.isNaN(n) || n < 1) {
        setSaveErr('Window counts must be positive integers.')
        return
      }
      blinds_lines.push({ blinds_id: b.id, window_count: n })
    }

    const statusEstiId = selectedStatusEstiId.trim()
    if (!statusEstiId) {
      setSaveErr('Could not resolve estimate status. Reload the page or check Lookups → Estimate statuses.')
      return
    }

    setSaving(true)
    setSaveErr(null)
    try {
      await patchJson<EstimateDetail>(`/estimates/${estimateId}`, {
        scheduled_wall: wall,
        visit_time_zone: tz,
        visit_address: visitAddress.trim() || null,
        visit_notes: visitNotes.trim() || null,
        visit_guest_emails: guestEmails.map((e) => e.trim()).filter(Boolean),
        blinds_lines,
        status_esti_id: statusEstiId,
      })
      navigate(`/estimates/${estimateId}`)
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>
  if (!canEdit) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-slate-600">You do not have permission to edit estimates.</p>
        <Link to="/estimates" className="text-sm text-teal-700 hover:underline">
          Back to estimates
        </Link>
      </div>
    )
  }

  async function confirmRestoreFromEdit() {
    if (!estimateId || restorePending) return
    setRestorePending(true)
    setSaveErr(null)
    try {
      const d = await postJson<EstimateDetail>(`/estimates/${estimateId}/restore`, {})
      setDetail(d)
      setRestoreOpen(false)
      setSelectedStatusEstiId((d.status_esti_id ?? '').trim())
      const p0 = defaultVisitScheduleParts()
      const wallRaw = d.scheduled_wall?.trim() ?? ''
      const initialWall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallRaw)
        ? snapWallToQuarterMinutes(wallRaw)
        : joinScheduledWall(p0.date, p0.hour12, p0.minute, p0.ampm)
      setVisitWallDraft(initialWall)
      setVisitWallApplied(initialWall)
      setVisitTimeZone(coerceTimeZoneForApi(d.visit_time_zone?.trim() || 'UTC'))
      setGuestEmails((d.visit_guest_emails ?? []).map((e) => e.trim()).filter(Boolean))
      {
        const wc: Record<string, string> = {}
        const inc: Record<string, boolean> = {}
        for (const b of blindsTypes ?? []) {
          const line = (d.blinds_types ?? []).find((x) => x.id === b.id)
          const raw = line?.window_count != null ? String(line.window_count) : ''
          wc[b.id] = raw
          inc[b.id] = raw.trim() !== '' && Number.parseInt(raw.trim(), 10) >= 1
        }
        setWindowCountByBlindsId(wc)
        setBlindsIncluded(inc)
      }
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestorePending(false)
    }
  }

  const formDisabled = Boolean(detail?.is_deleted)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ConfirmModal
        open={restoreOpen}
        title="Restore this estimate?"
        description="Put this estimate back on the active list? You can edit it again after restoring."
        confirmLabel="Restore"
        pending={restorePending}
        onConfirm={() => void confirmRestoreFromEdit()}
        onCancel={() => !restorePending && setRestoreOpen(false)}
      />

      <Link
        to="/estimates"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to estimates
      </Link>

      {loadErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadErr}
        </div>
      ) : loading || !detail ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <form onSubmit={(e) => void onSave(e)} className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <CalendarDays className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Edit estimate</h1>
              <p className="mt-1 text-sm text-slate-500">
                {detail.customer_display}
                {' · '}
                <Link to={`/customers/${detail.customer_id}`} className="text-teal-700 hover:underline">
                  Customer profile
                </Link>
              </p>
            </div>
          </div>

          {detail.is_deleted ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">This estimate is deleted</p>
              <p className="mt-1 text-amber-900/90">
                Restore it to make changes or show it in the default list again.
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
                onClick={() => setRestoreOpen(true)}
              >
                Restore estimate
              </button>
            </div>
          ) : null}

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
              Status
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                value={selectedStatusEstiId}
                disabled={formDisabled || estimateStatusSelectOptions.length < 1}
                onChange={(e) => setSelectedStatusEstiId(e.target.value)}
              >
                {estimateStatusSelectOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {(detail.status ?? 'pending').toLowerCase() === 'converted' ? (
                <p className="mt-1 text-xs text-slate-500">
                  Status is set automatically when an order is linked from this estimate.
                </p>
              ) : null}
            </label>
            <div className="block text-sm font-medium text-slate-700">
              <span className="block">Visit start</span>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <VisitStartQuarterPicker
                  value={visitWallDraft}
                  onChange={setVisitWallDraft}
                  disabled={formDisabled}
                />
                <button
                  type="button"
                  disabled={formDisabled || !visitSetEnabled}
                  onClick={() => {
                    if (!isValidScheduledWall(visitWallDraft)) return
                    const s = snapWallToQuarterMinutes(visitWallDraft)
                    setVisitWallApplied(s)
                    setVisitWallDraft(s)
                    setSaveErr(null)
                  }}
                  className="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Set
                </button>
              </div>
            </div>
            <label className="block text-sm font-medium text-slate-600">
              <span>Time zone</span>
              <select
                required
                className="mt-1 w-full rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={visitTimeZone}
                disabled={formDisabled}
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

          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
            <p className="font-semibold text-slate-800">Organizer & employees</p>
            <p className="text-xs text-slate-500">
              Calendar invite list. Customer address for the visit:{' '}
              <span className="font-medium text-slate-700">{customerAddressView}</span>
            </p>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex items-start gap-2 rounded px-1 py-1 text-sm">
                <input
                  type="checkbox"
                  checked
                  disabled
                  className="mt-1 h-3.5 w-3.5 shrink-0 cursor-not-allowed rounded border-slate-300 text-teal-600 opacity-70"
                  aria-label="Organizer (always included)"
                />
                <span className="min-w-0 leading-snug">
                  <span className="font-medium text-slate-800">
                    {detail.visit_organizer_name || createContext?.organizer_name || 'Organizer'}
                  </span>
                  <span className="ml-1 align-middle rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-900">
                    Organizer
                  </span>
                  {detail.visit_organizer_email || createContext?.organizer_email ? (
                    <span className="block text-xs text-slate-500">
                      {detail.visit_organizer_email || createContext?.organizer_email}
                    </span>
                  ) : (
                    <span className="block text-xs text-slate-400">No organizer email on file</span>
                  )}
                </span>
              </div>
              {employeeGuestOptions.length === 0 ? (
                <span className="text-xs text-slate-400">No additional team contacts.</span>
              ) : (
                employeeGuestOptions.map((g) => {
                  const checked = guestEmails.some((e) => e.toLowerCase() === g.email.toLowerCase())
                  return (
                    <label
                      key={g.email.toLowerCase()}
                      className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                        checked={checked}
                        disabled={formDisabled}
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
                        <span className="block text-xs text-slate-500">{g.email}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Calendar location (optional)
            <textarea
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={visitAddress}
              disabled={formDisabled}
              onChange={(e) => setVisitAddress(e.target.value)}
              placeholder="Overrides default; leave blank-related text as needed"
            />
          </label>

          <fieldset className="rounded-xl border border-slate-200 p-3" disabled={formDisabled}>
            <legend className="px-1 text-sm font-medium text-slate-800">Blinds types</legend>
            <p className="mt-1 text-xs text-slate-500">
              Optional — enter a window count only for types you want on this estimate.
            </p>
            <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {(blindsTypes ?? []).map((b) => {
                const checked = Boolean(blindsIncluded[b.id])
                return (
                  <label
                    key={b.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm hover:bg-slate-50/80"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600"
                      checked={checked}
                      disabled={formDisabled}
                      onChange={(ev) => {
                        const on = ev.target.checked
                        setBlindsIncluded((prev) => ({ ...prev, [b.id]: on }))
                        if (!on) setWindowCountByBlindsId((wt) => ({ ...wt, [b.id]: '' }))
                      }}
                      aria-label={`Include ${b.name}`}
                    />
                    <span className="min-w-0 flex-1 font-medium text-slate-800">{b.name}</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Qty"
                      title="Windows"
                      disabled={formDisabled || !checked}
                      className="w-20 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-teal-500 disabled:cursor-not-allowed disabled:bg-slate-100"
                      value={windowCountByBlindsId[b.id] ?? ''}
                      onChange={(ev) => {
                        const v = ev.target.value
                        setWindowInputFor(b.id, v)
                        const n = Number.parseInt(v.trim(), 10)
                        if (!Number.isNaN(n) && n >= 1) setBlindsIncluded((prev) => ({ ...prev, [b.id]: true }))
                      }}
                    />
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="block text-sm font-medium text-slate-700">
            Notes
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={visitNotes}
              disabled={formDisabled}
              onChange={(e) => setVisitNotes(e.target.value)}
            />
          </label>

          {saveErr ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {saveErr}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Link
              to="/estimates"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={formDisabled || saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
