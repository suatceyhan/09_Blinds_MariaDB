import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type BlindsRef = { id: string; name: string; window_count?: number | null }
type BlindsOpt = { id: string; name: string }

type WorkflowStatus = 'pending' | 'converted' | 'cancelled'

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

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus>('pending')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restorePending, setRestorePending] = useState(false)

  const [scheduledLocal, setScheduledLocal] = useState('')
  const [visitTimeZone, setVisitTimeZone] = useState('UTC')
  const [visitAddress, setVisitAddress] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [selectedBlindsIds, setSelectedBlindsIds] = useState<string[]>([])
  const [windowCountByBlindsId, setWindowCountByBlindsId] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!me || !estimateId || !canEdit) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadErr(null)
      try {
        const [d, bt, ctx] = await Promise.all([
          getJson<EstimateDetail>(`/estimates/${estimateId}`),
          getJson<BlindsOpt[]>(`/estimates/lookup/blinds-types`),
          getJson<CreateContext>(`/estimates/lookup/create-context`),
        ])
        if (cancelled) return
        setDetail(d)
        setBlindsTypes(bt)
        setCreateContext(ctx)
        const st = (d.status ?? 'pending').toLowerCase()
        setWorkflowStatus(
          st === 'converted' || st === 'cancelled' ? st : 'pending',
        )
        const wall = d.scheduled_wall?.trim() ?? ''
        setScheduledLocal(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall) ? wall : toDatetimeLocalValue(new Date()),
        )
        const tz = coerceTimeZoneForApi(d.visit_time_zone?.trim() || 'UTC')
        setVisitTimeZone(tz)
        setVisitAddress((d.visit_address ?? d.customer_address ?? '').trim())
        setVisitNotes((d.visit_notes ?? '').trim())
        setGuestEmail(d.visit_guest_emails?.[0]?.trim() ?? '')
        const ids = (d.blinds_types ?? []).map((b) => b.id)
        setSelectedBlindsIds(ids)
        const wc: Record<string, string> = {}
        for (const b of d.blinds_types ?? []) {
          wc[b.id] = b.window_count != null ? String(b.window_count) : ''
        }
        setWindowCountByBlindsId(wc)
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

  useEffect(() => {
    setWindowCountByBlindsId((w) => {
      const next: Record<string, string> = {}
      for (const id of selectedBlindsIds) {
        next[id] = w[id] ?? ''
      }
      return next
    })
  }, [selectedBlindsIds])

  function toggleBlinds(id: string) {
    setSelectedBlindsIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

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

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!estimateId || !canEdit || detail?.is_deleted || selectedBlindsIds.length < 1) return
    const wall = scheduledLocal.trim()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) {
      setSaveErr('Invalid date and time format.')
      return
    }
    const tz = coerceTimeZoneForApi(visitTimeZone.trim())

    const blinds_lines: { blinds_id: string; window_count: number | null }[] = []
    for (const bid of selectedBlindsIds) {
      const raw = (windowCountByBlindsId[bid] ?? '').trim()
      if (raw === '') {
        blinds_lines.push({ blinds_id: bid, window_count: null })
        continue
      }
      const n = Number.parseInt(raw, 10)
      if (Number.isNaN(n) || n < 1) {
        setSaveErr('Window counts must be positive integers or left empty.')
        return
      }
      blinds_lines.push({ blinds_id: bid, window_count: n })
    }

    setSaving(true)
    setSaveErr(null)
    try {
      await patchJson<EstimateDetail>(`/estimates/${estimateId}`, {
        scheduled_wall: wall,
        visit_time_zone: tz,
        visit_address: visitAddress.trim() || null,
        visit_notes: visitNotes.trim() || null,
        visit_guest_emails: guestEmail.trim() ? [guestEmail.trim()] : [],
        blinds_lines,
        status: workflowStatus,
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
      const st = (d.status ?? 'pending').toLowerCase()
      setWorkflowStatus(
        st === 'converted' || st === 'cancelled' ? st : 'pending',
      )
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
                value={workflowStatus}
                disabled={formDisabled}
                onChange={(e) => setWorkflowStatus(e.target.value as WorkflowStatus)}
              >
                {(detail.status ?? 'pending').toLowerCase() === 'converted' ? (
                  <>
                    <option value="converted">Converted to order</option>
                    <option value="cancelled">Cancelled</option>
                  </>
                ) : (
                  <>
                    <option value="pending">Pending</option>
                    <option value="cancelled">Cancelled</option>
                  </>
                )}
              </select>
              {(detail.status ?? 'pending').toLowerCase() === 'converted' ? (
                <p className="mt-1 text-xs text-slate-500">
                  Status is set automatically when an order is linked from this estimate.
                </p>
              ) : null}
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Time zone
              <select
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
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
            <label className="block text-sm font-medium text-slate-700">
              Visit start
              <input
                required
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={scheduledLocal}
                disabled={formDisabled}
                onChange={(e) => setScheduledLocal(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <div>
              <span className="font-medium text-slate-800">Customer address</span>
              <span className="ml-1">{customerAddressView}</span>
            </div>
            <div>
              <span className="font-medium text-slate-800">Organizer</span>
              <span className="ml-1">
                {detail.visit_organizer_name || createContext?.organizer_name || '—'}
                {(detail.visit_organizer_email || createContext?.organizer_email) &&
                  ` · ${detail.visit_organizer_email || createContext?.organizer_email}`}
              </span>
            </div>
            <label className="block">
              <span className="font-medium text-slate-800">Guest</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={guestEmail}
                disabled={formDisabled}
                onChange={(e) => setGuestEmail(e.target.value)}
              >
                <option value="">None</option>
                {guestSelectOptions.map((g) => (
                  <option key={g.email.toLowerCase()} value={g.email}>
                    {g.label} ({g.email})
                  </option>
                ))}
              </select>
            </label>
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
            <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {(blindsTypes ?? []).map((b) => {
                const checked = selectedBlindsIds.includes(b.id)
                return (
                  <div
                    key={b.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-2 text-sm ${
                      checked ? 'border-teal-200 bg-teal-50/40' : 'border-transparent'
                    }`}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600"
                        checked={checked}
                        onChange={() => toggleBlinds(b.id)}
                      />
                      <span className="font-medium text-slate-800">{b.name}</span>
                    </label>
                    {checked ? (
                      <input
                        type="number"
                        min={1}
                        placeholder="Windows"
                        className="w-20 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-teal-500"
                        value={windowCountByBlindsId[b.id] ?? ''}
                        onChange={(ev) => setWindowInputFor(b.id, ev.target.value)}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
            {selectedBlindsIds.length === 0 ? (
              <p className="mt-2 text-xs text-amber-700">Choose at least one type.</p>
            ) : null}
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
              disabled={formDisabled || saving || selectedBlindsIds.length < 1}
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
