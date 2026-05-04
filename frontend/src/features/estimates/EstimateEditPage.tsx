import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, patchJson, postJson } from '@/lib/api'
import { isValidCaPostalCode, normalizeCaPostalCode } from '@/lib/caPostalCode'
import {
  defaultVisitScheduleParts,
  isValidScheduledWall,
  joinScheduledWall,
  snapWallToQuarterMinutes,
} from '@/lib/visitSchedule'
import { AddressAutocompleteInput } from '@/components/ui/AddressAutocompleteInput'
import { ADDRESS_FORMAT_HINT } from '@/components/ui/AddressMapLink'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { VisitStartQuarterPicker } from '@/components/ui/VisitStartQuarterPicker'
import {
  type BlindsLineState,
  type BlindsOrderOptions,
  BlindsTypesGrid,
  blindsLineToPayload,
  blindsLinesMissingRequiredAttributesMessage,
  hydrateBlindsLinesDefaults,
  newBlindsLineForType,
  normalizeBlindsLineFromApi,
  sanitizeLineAmountInput,
  sumBlindsLineAmounts,
} from '@/features/orders/ordersShared'

type BlindsRef = {
  id: string
  name: string
  window_count?: number | null
  line_amount?: number | null
  category?: string | null
  category_label?: string | null
  line_note?: string | null
}

type EstimateStatusOpt = {
  id: string
  name: string
  active: boolean
  code?: string | null
  sort_order?: number
}

type EstimateDetail = {
  id: string
  customer_id?: string | null
  customer_display: string
  customer_address?: string | null
  customer_postal_code?: string | null
  prospect_name?: string | null
  prospect_surname?: string | null
  prospect_phone?: string | null
  prospect_email?: string | null
  prospect_address?: string | null
  prospect_postal_code?: string | null
  blinds_types: BlindsRef[]
  scheduled_wall: string | null
  visit_time_zone?: string | null
  visit_address?: string | null
  visit_postal_code?: string | null
  visit_notes?: string | null
  visit_organizer_name?: string | null
  visit_organizer_email?: string | null
  visit_guest_emails?: string[]
  status?: string | null
  status_label?: string | null
  status_esti_id?: string | null
  is_deleted?: boolean | null
  linked_order_id?: string | null
  lead_source?: 'referral' | 'advertising' | null
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

type EstimateEditBaseline = {
  selectedStatusEstiId: string
  visitWallDraft: string
  visitTimeZone: string
  visitAddress: string
  visitPostalCode: string
  visitNotes: string
  guestEmails: string[]
  blindsLines: BlindsLineState[]
  prospectName: string
  prospectSurname: string
  prospectPhone: string
  prospectEmail: string
  prospectAddress: string
  prospectPostalCode: string
  leadSource: 'referral' | 'advertising'
}

function estimateEditLinesFromDetail(d: EstimateDetail, opts: BlindsOrderOptions | null): BlindsLineState[] {
  const rawLines = d.blinds_types ?? []
  if (!opts?.blinds_types?.length) {
    return hydrateBlindsLinesDefaults(
      rawLines
        .filter((x) => x.window_count != null && Number(x.window_count) >= 1)
        .map((raw) =>
          normalizeBlindsLineFromApi({
            id: raw.id,
            name: raw.name,
            window_count: raw.window_count,
            line_amount: raw.line_amount,
            line_note: raw.line_note != null ? String(raw.line_note) : '',
            ...(raw.category ? { category: raw.category } : {}),
          }),
        ),
      opts,
    )
  }
  const out: BlindsLineState[] = []
  for (const bt of opts.blinds_types) {
    const raw = rawLines.find((x) => x.id === bt.id)
    if (!raw || raw.window_count == null || Number(raw.window_count) < 1) continue
    out.push(
      normalizeBlindsLineFromApi({
        id: raw.id,
        name: raw.name ?? bt.name,
        window_count: raw.window_count,
        line_amount: raw.line_amount,
        line_note: raw.line_note != null ? String(raw.line_note) : '',
        ...(raw.category ? { category: raw.category } : {}),
      }),
    )
  }
  return hydrateBlindsLinesDefaults(out, opts)
}

export function EstimateEditPage() {
  const { estimateId } = useParams()
  const navigate = useNavigate()
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('estimates.edit'))
  const isCa = ((me?.active_company_country_code ?? '').trim().toUpperCase() || '') === 'CA'

  const [detail, setDetail] = useState<EstimateDetail | null>(null)
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
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
  const [visitTimeZone, setVisitTimeZone] = useState('UTC')
  const [visitAddress, setVisitAddress] = useState('')
  const [visitPostalCode, setVisitPostalCode] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [guestEmails, setGuestEmails] = useState<string[]>([])
  const [blindsLines, setBlindsLines] = useState<BlindsLineState[]>([])
  const [prospectName, setProspectName] = useState('')
  const [prospectSurname, setProspectSurname] = useState('')
  const [prospectPhone, setProspectPhone] = useState('')
  const [prospectEmail, setProspectEmail] = useState('')
  const [prospectAddress, setProspectAddress] = useState('')
  const [prospectPostalCode, setProspectPostalCode] = useState('')
  const [leadSource, setLeadSource] = useState<'referral' | 'advertising'>('advertising')
  const [estimateFormBaseline, setEstimateFormBaseline] = useState<EstimateEditBaseline | null>(null)

  const prospectPostalErr = isCa && prospectPostalCode.trim() !== '' && !isValidCaPostalCode(prospectPostalCode)

  const blindsTypes = useMemo(() => blindsOrderOptions?.blinds_types ?? [], [blindsOrderOptions])

  function hydrateEstimateFormFields(d: EstimateDetail, opts: BlindsOrderOptions | null) {
    setSelectedStatusEstiId((d.status_esti_id ?? '').trim())
    const p0 = defaultVisitScheduleParts()
    const wallRaw = d.scheduled_wall?.trim() ?? ''
    const initialWall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wallRaw)
      ? snapWallToQuarterMinutes(wallRaw)
      : joinScheduledWall(p0.date, p0.hour12, p0.minute, p0.ampm)
    setVisitWallDraft(initialWall)
    const tz = coerceTimeZoneForApi(d.visit_time_zone?.trim() || 'UTC')
    setVisitTimeZone(tz)
    // View/edit UX does not expose a separate visit address for estimates.
    setVisitAddress('')
    setVisitPostalCode('')
    setVisitNotes((d.visit_notes ?? '').trim())
    setGuestEmails((d.visit_guest_emails ?? []).map((e) => e.trim()).filter(Boolean))
    setBlindsLines(estimateEditLinesFromDetail(d, opts))
    setProspectName((d.prospect_name ?? '').trim())
    setProspectSurname((d.prospect_surname ?? '').trim())
    setProspectPhone((d.prospect_phone ?? '').trim())
    setProspectEmail((d.prospect_email ?? '').trim())
    setProspectAddress((d.prospect_address ?? '').trim())
    setProspectPostalCode((d.prospect_postal_code ?? '').trim())
    const ls = (d.lead_source ?? '').trim().toLowerCase()
    setLeadSource(ls === 'referral' ? 'referral' : 'advertising')
  }

  useEffect(() => {
    if (!me || !estimateId || !canEdit) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadErr(null)
      try {
        const [d, opts, ctx, estSt] = await Promise.all([
          getJson<EstimateDetail>(`/estimates/${estimateId}`),
          getJson<BlindsOrderOptions>(`/estimates/lookup/blinds-order-options`),
          getJson<CreateContext>(`/estimates/lookup/create-context`),
          getJson<EstimateStatusOpt[]>(`/lookups/estimate-statuses?limit=50&include_inactive=true`),
        ])
        if (cancelled) return
        setDetail(d)
        setBlindsOrderOptions(opts)
        setCreateContext(ctx)
        setEstimateStatuses(estSt)
        hydrateEstimateFormFields(d, opts)
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
    if (!detail || !estimateId) return
    if ((detail.status ?? '').toLowerCase() !== 'converted') return
    navigate(`/estimates/${estimateId}`, { replace: true })
  }, [detail, estimateId, navigate])

  const estimateStatusSelectOptions = useMemo(() => {
    if (!detail || !estimateStatuses?.length) return []
    const cur = (detail.status ?? '').toLowerCase()
    const curId = (detail.status_esti_id ?? '').trim()
    const filtered = estimateStatuses.filter((s) => {
      const w = (s.code ?? '').toLowerCase()
      if (!s.active && s.id !== curId) return false
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

  useEffect(() => {
    if (!detail || !blindsOrderOptions) return
    setBlindsLines((prev) => hydrateBlindsLinesDefaults(prev, blindsOrderOptions))
  }, [detail?.id, blindsOrderOptions])

  function toggleEditBlindsType(id: string) {
    setBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = blindsTypes.find((x) => x.id === id)
      const name = bt?.name ?? id
      return [...prev, newBlindsLineForType(id, name, blindsOrderOptions)]
    })
  }

  function setEditBlindsCount(id: string, v: string) {
    const t = v.trim()
    if (t === '') {
      setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: null } : x)))
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)))
  }

  function setEditBlindsLineField(id: string, jsonKey: string, value: string) {
    const v = value.trim() ? value.trim().toLowerCase() : null
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, [jsonKey]: v } : x)))
  }

  function setEditBlindsLineNote(id: string, value: string) {
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function setEditBlindsLineAmount(id: string, value: string) {
    const next = sanitizeLineAmountInput(value)
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
  }

  const blindsAmountTotal = useMemo(() => sumBlindsLineAmounts(blindsLines), [blindsLines])

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

  const buildEstimateEditBaseline = useCallback((): EstimateEditBaseline => {
    return {
      selectedStatusEstiId,
      visitWallDraft,
      visitTimeZone,
      visitAddress,
      visitPostalCode,
      visitNotes,
      guestEmails: [...guestEmails],
      blindsLines: structuredClone(blindsLines),
      prospectName,
      prospectSurname,
      prospectPhone,
      prospectEmail,
      prospectAddress,
      prospectPostalCode,
      leadSource,
    }
  }, [
    selectedStatusEstiId,
    visitWallDraft,
    visitTimeZone,
    visitAddress,
    visitPostalCode,
    visitNotes,
    guestEmails,
    blindsLines,
    prospectName,
    prospectSurname,
    prospectPhone,
    prospectEmail,
    prospectAddress,
    prospectPostalCode,
    leadSource,
  ])

  const latestEstimateBaselineRef = useRef<EstimateEditBaseline | null>(null)
  latestEstimateBaselineRef.current = buildEstimateEditBaseline()

  const scheduleEstimateFormBaselineCapture = useCallback(() => {
    window.setTimeout(() => {
      const snap = latestEstimateBaselineRef.current
      if (snap) setEstimateFormBaseline(structuredClone(snap))
    }, 150)
  }, [])

  const isEstimateDirty = useMemo(() => {
    const cur = buildEstimateEditBaseline()
    if (!estimateFormBaseline) return false
    return JSON.stringify(cur) !== JSON.stringify(estimateFormBaseline)
  }, [buildEstimateEditBaseline, estimateFormBaseline])

  function revertEstimateForm() {
    if (!estimateFormBaseline) return
    const b = estimateFormBaseline
    setSelectedStatusEstiId(b.selectedStatusEstiId)
    setVisitWallDraft(b.visitWallDraft)
    setVisitTimeZone(b.visitTimeZone)
    setVisitAddress(b.visitAddress)
    setVisitPostalCode(b.visitPostalCode)
    setVisitNotes(b.visitNotes)
    setGuestEmails([...b.guestEmails])
    setBlindsLines(structuredClone(b.blindsLines))
    setProspectName(b.prospectName)
    setProspectSurname(b.prospectSurname)
    setProspectPhone(b.prospectPhone)
    setProspectEmail(b.prospectEmail)
    setProspectAddress(b.prospectAddress)
    setProspectPostalCode(b.prospectPostalCode)
    setLeadSource(b.leadSource)
    setSaveErr(null)
  }

  useEffect(() => {
    setEstimateFormBaseline(null)
  }, [estimateId])

  useEffect(() => {
    if (loading || !detail || !blindsOrderOptions) return
    const t = window.setTimeout(() => scheduleEstimateFormBaselineCapture(), 300)
    return () => window.clearTimeout(t)
  }, [loading, estimateId, blindsOrderOptions, scheduleEstimateFormBaselineCapture])

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!estimateId || !canEdit || detail?.is_deleted) return
    const wall = snapWallToQuarterMinutes(visitWallDraft).trim()
    if (!isValidScheduledWall(wall)) {
      setSaveErr('Invalid date and time format.')
      return
    }
    const tz = coerceTimeZoneForApi(visitTimeZone.trim())

    if (!(detail?.customer_id ?? '').trim() && !prospectName.trim()) {
      setSaveErr('Enter a name for the prospect.')
      return
    }

    const missingAttr = blindsLinesMissingRequiredAttributesMessage(blindsLines, blindsTypes, blindsOrderOptions)
    if (missingAttr) {
      setSaveErr(missingAttr)
      return
    }

    const blinds_lines: {
      blinds_id: string
      window_count: number | null
      line_amount?: number
      category?: string
      line_note?: string
    }[] = []
    for (const b of blindsLines) {
      const wc = b.window_count
      if (wc == null || typeof wc !== 'number' || wc < 1) {
        setSaveErr('Enter a window count for each selected blinds type.')
        return
      }
      const p = blindsLineToPayload(b, blindsOrderOptions)
      const row: {
        blinds_id: string
        window_count: number | null
        line_amount?: number
        category?: string
        line_note?: string
      } = {
        blinds_id: String(p.id),
        window_count: wc,
      }
      const la = typeof p.line_amount === 'number' ? p.line_amount : 0
      if (la > 0) row.line_amount = la
      const cat = p.category != null && String(p.category).trim() ? String(p.category).trim().toLowerCase() : undefined
      if (cat) row.category = cat
      const noteRaw = p.line_note != null ? String(p.line_note).trim() : ''
      if (noteRaw) row.line_note = noteRaw.slice(0, 2000)
      blinds_lines.push(row)
    }

    const statusEstiId = selectedStatusEstiId.trim()
    if (!statusEstiId) {
      setSaveErr('Could not resolve estimate status. Reload the page or check Lookups → Estimate statuses.')
      return
    }
    if (prospectPostalErr) return

    setSaving(true)
    setSaveErr(null)
    try {
      const patchBody: Record<string, unknown> = {
        scheduled_wall: wall,
        visit_time_zone: tz,
        // Estimates use a single scheduled date-time; address is always the customer/prospect address.
        // Keep visit_address fields null to match the view UX (no separate visit address block).
        visit_address: null,
        visit_postal_code: null,
        visit_notes: visitNotes.trim() || null,
        visit_guest_emails: guestEmails.map((e) => e.trim()).filter(Boolean),
        blinds_lines,
        status_esti_id: statusEstiId,
        lead_source: leadSource,
      }
      if (!(detail?.customer_id ?? '').trim()) {
        patchBody.prospect_name = prospectName.trim() || null
        patchBody.prospect_surname = prospectSurname.trim() || null
        patchBody.prospect_phone = prospectPhone.trim() || null
        patchBody.prospect_email = prospectEmail.trim() || null
        patchBody.prospect_address = prospectAddress.trim() || null
        patchBody.prospect_postal_code = prospectPostalCode.trim() || null
      }
      let nextDetail = await patchJson<EstimateDetail>(`/estimates/${estimateId}`, patchBody)
      if (!nextDetail?.id) {
        nextDetail = await getJson<EstimateDetail>(`/estimates/${estimateId}`)
      }
      setDetail(nextDetail)
      hydrateEstimateFormFields(nextDetail, blindsOrderOptions)
      scheduleEstimateFormBaselineCapture()
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
        <Link to="/estimates" className="text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline">
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
      hydrateEstimateFormFields(d, blindsOrderOptions)
      scheduleEstimateFormBaselineCapture()
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
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
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
        <form onSubmit={(e) => void onSave(e)} className="space-y-6">
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <CalendarDays className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight text-slate-900">Edit estimate</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-900 ring-1 ring-slate-200">
                      {(detail.status_label ?? '').trim() || 'Status'}
                    </span>
                    <span className="text-xs font-medium text-slate-400">·</span>
                    <span className="text-xs font-semibold text-slate-500">Customer source</span>
                    <span
                      className={[
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
                        leadSource === 'referral'
                          ? 'bg-indigo-50 text-indigo-900 ring-indigo-200'
                          : 'bg-slate-50 text-slate-900 ring-slate-200',
                      ].join(' ')}
                    >
                      {leadSource === 'referral' ? 'Referral' : 'Advertising'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {(detail.customer_id ?? '').trim() ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span>{detail.customer_display}</span>
                        <Link
                          to={`/customers/${detail.customer_id}`}
                          className="text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                        >
                          Customer profile
                        </Link>
                      </span>
                    ) : (
                      <span>{detail.customer_display?.trim() || 'Prospect'}</span>
                    )}
                  </div>
                  {!(detail.customer_id ?? '').trim() ? (
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      Prospect only — saved to Customers when an order is created.
                    </div>
                  ) : null}
                  <div className="mt-3 text-xs font-semibold text-slate-500">Estimate ID</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-700">{estimateId}</div>

                  <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Customer source
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={formDisabled}
                      onClick={() => setLeadSource('advertising')}
                      className={[
                        'h-8 rounded-full px-3 text-xs font-semibold ring-1 transition',
                        leadSource === 'advertising'
                          ? 'bg-slate-900 text-white ring-slate-900'
                          : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
                        formDisabled ? 'opacity-60' : '',
                      ].join(' ')}
                      aria-pressed={leadSource === 'advertising'}
                    >
                      Advertising
                    </button>
                    <button
                      type="button"
                      disabled={formDisabled}
                      onClick={() => setLeadSource('referral')}
                      className={[
                        'h-8 rounded-full px-3 text-xs font-semibold ring-1 transition',
                        leadSource === 'referral'
                          ? 'bg-indigo-600 text-white ring-indigo-600'
                          : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50',
                        formDisabled ? 'opacity-60' : '',
                      ].join(' ')}
                      aria-pressed={leadSource === 'referral'}
                    >
                      Referral
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</div>
                      <div className="mt-2">
                        <select
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
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
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Scheduled</div>
                        <div className="mt-2">
                          <VisitStartQuarterPicker
                            value={visitWallDraft}
                            onChange={(v) => {
                              setVisitWallDraft(v)
                              setSaveErr(null)
                            }}
                            disabled={formDisabled}
                            compact
                          />
                        </div>
                      </div>
                      <label className="block">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time zone</div>
                        <select
                          required
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
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
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {detail.is_deleted ? (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
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

          {!(detail.customer_id ?? '').trim() ? (
            <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</h3>
              <p className="mt-1 text-xs text-slate-500">
                Prospect only — saved to Customers when an order is created.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-700">
                First name
                <input
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  value={prospectName}
                  disabled={formDisabled}
                  onChange={(e) => setProspectName(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Last name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  value={prospectSurname}
                  disabled={formDisabled}
                  onChange={(e) => setProspectSurname(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Phone
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  value={prospectPhone}
                  disabled={formDisabled}
                  onChange={(e) => setProspectPhone(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Email
                <input
                  type="email"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  value={prospectEmail}
                  disabled={formDisabled}
                  onChange={(e) => setProspectEmail(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                Address
                <div className="mt-1">
                  <AddressAutocompleteInput
                    value={prospectAddress}
                    onChange={setProspectAddress}
                    disabled={formDisabled}
                    hintId="estimate-edit-prospect-address-hint"
                    countryCode={me?.active_company_country_code ?? null}
                    regionCode={me?.active_company_region_code ?? null}
                  />
                </div>
                <span id="estimate-edit-prospect-address-hint" className="mt-1 block text-xs text-slate-500">
                  {ADDRESS_FORMAT_HINT}
                </span>
              </label>
              <label className="block text-sm text-slate-700 sm:col-span-2">
                Postal code (optional)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  value={prospectPostalCode}
                  disabled={formDisabled}
                  onChange={(e) => setProspectPostalCode(e.target.value)}
                  onBlur={() => {
                    if (!isCa) return
                    if (prospectPostalCode.trim()) setProspectPostalCode(normalizeCaPostalCode(prospectPostalCode))
                  }}
                />
                {prospectPostalErr ? (
                  <span className="mt-1 block text-xs text-red-700">
                    Enter a valid Canadian postal code (e.g. A1A 1A1) or leave empty.
                  </span>
                ) : null}
              </label>
            </div>
            </section>
          ) : null}

          {/* Schedule is shown in the header card to match the view layout. */}

          <div className="space-y-5 text-sm text-slate-800">
          <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Google Calendar Connections</h3>
            <div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700">
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
          </section>

          <fieldset className="rounded-xl border border-slate-200 bg-white p-4" disabled={formDisabled}>
            <legend className="px-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Blinds</legend>
            <p className="mt-1 text-xs text-slate-500">
              Quantity required for each included type; category matches your blinds × category matrix (same as orders).
              Optional amount and line note per row; notes copy to the order when you convert.
            </p>
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50/80 px-3 py-2">
                <div className="text-sm font-semibold text-rose-900">Total amount</div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-rose-900">
                  ${blindsAmountTotal.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="mt-2 max-h-72 min-w-0 overflow-y-auto">
              <BlindsTypesGrid
                blindsTypes={blindsTypes}
                blindsOrderOptions={blindsOrderOptions}
                lines={blindsLines}
                toggleType={toggleEditBlindsType}
                setCount={setEditBlindsCount}
                setLineField={setEditBlindsLineField}
                setLineNote={setEditBlindsLineNote}
                setLineAmount={setEditBlindsLineAmount}
                keyPrefix="est-edit"
                disabled={formDisabled}
              />
            </div>
          </fieldset>

          <section className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/80">Notes</h3>
            <textarea
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              value={visitNotes}
              disabled={formDisabled}
              onChange={(e) => setVisitNotes(e.target.value)}
              placeholder="Optional notes for this estimate..."
            />
          </section>

          {saveErr ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {saveErr}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={formDisabled || !isEstimateDirty || saving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => revertEstimateForm()}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={formDisabled || saving || !isEstimateDirty}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
