import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ShoppingBag } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { formatVisitDateTimeList } from '@/lib/formatVisitDisplay'
import { getJson, postJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type BlindsRef = { id: string; name: string; window_count?: number | null }

type EstimateDetail = {
  id: string
  company_id: string
  customer_id: string
  customer_display: string
  customer_address?: string | null
  blinds_types: BlindsRef[]
  perde_sayisi: number | null
  status?: string | null
  status_label?: string | null
  is_deleted?: boolean | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  tarih_saat: string | null
  lead_id: string | null
  calendar_provider: string | null
  google_event_id: string | null
  visit_time_zone?: string | null
  visit_address?: string | null
  visit_notes?: string | null
  visit_organizer_name?: string | null
  visit_organizer_email?: string | null
  visit_guest_emails?: string[]
  visit_recurrence_rrule?: string | null
  created_at: string | null
  updated_at: string | null
}

function formatDt(raw: string | null | undefined): string {
  return formatVisitDateTimeList(raw)
}

function workflowStatusLabel(status: string | null | undefined): string {
  const s = (status ?? '').toLowerCase()
  if (s === 'converted') return 'Converted to order'
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'pending') return 'Pending'
  return 'Status'
}

function WorkflowStatusBadge({
  status,
  label,
}: Readonly<{ status: string | null | undefined; label?: string | null }>) {
  const s = (status ?? '').toLowerCase()
  const labelText = (label?.trim() || workflowStatusLabel(s)).trim()
  const cls =
    s === 'converted'
      ? 'bg-emerald-100 text-emerald-900'
      : s === 'cancelled'
        ? 'bg-slate-200 text-slate-800'
        : s === 'pending'
          ? 'bg-amber-100 text-amber-900'
          : 'bg-violet-50 text-violet-900'
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{labelText}</span>
  )
}

export function EstimateViewPage() {
  const { estimateId } = useParams()
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('estimates.edit'))
  const canCreateOrder = Boolean(me?.permissions.includes('orders.edit'))
  const [row, setRow] = useState<EstimateDetail | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restorePending, setRestorePending] = useState(false)

  useEffect(() => {
    if (!me || !estimateId) return
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        const d = await getJson<EstimateDetail>(`/estimates/${estimateId}`)
        if (!cancelled) setRow(d)
      } catch (e) {
        if (!cancelled) {
          setRow(null)
          setErr(e instanceof Error ? e.message : 'Could not load estimate')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, estimateId])

  async function confirmRestore() {
    if (!estimateId || restorePending) return
    setRestorePending(true)
    setErr(null)
    try {
      const d = await postJson<EstimateDetail>(`/estimates/${estimateId}/restore`, {})
      setRow(d)
      setRestoreOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestorePending(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <ConfirmModal
        open={restoreOpen}
        title="Restore this estimate?"
        description="Put this estimate back on the active list?"
        confirmLabel="Restore"
        pending={restorePending}
        onConfirm={() => void confirmRestore()}
        onCancel={() => !restorePending && setRestoreOpen(false)}
      />

      <Link
        to="/estimates"
        className="inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to estimates
      </Link>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : row === undefined ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : row === null ? (
        <p className="text-sm text-slate-500">Estimate not found.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <CalendarDays className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Estimate visit</h1>
                <p className="mt-1 text-sm text-slate-500">Scheduled appointment and selected types</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {row.is_deleted && canEdit && estimateId ? (
                <button
                  type="button"
                  onClick={() => setRestoreOpen(true)}
                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
                >
                  Restore
                </button>
              ) : null}
              {row.status?.toLowerCase() === 'pending' &&
              !row.is_deleted &&
              canCreateOrder &&
              estimateId ? (
                <Link
                  to={`/orders?fromEstimate=${encodeURIComponent(estimateId)}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                >
                  <ShoppingBag className="h-4 w-4" strokeWidth={2} />
                  Make order
                </Link>
              ) : null}
              {canEdit && estimateId && !row.is_deleted ? (
                <Link
                  to={`/estimates/${estimateId}/edit`}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50"
                >
                  Edit
                </Link>
              ) : null}
            </div>
          </div>

          {row.is_deleted ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              This estimate is deleted. It is hidden from the default list unless you enable <strong>Show deleted</strong>{' '}
              on the estimates page.
            </div>
          ) : null}

          <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</dt>
              <dd className="mt-1">
                <WorkflowStatusBadge status={row.status} label={row.status_label} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer</dt>
              <dd className="mt-1">
                <Link
                  to={`/customers/${row.customer_id}`}
                  className="font-medium text-teal-700 hover:underline"
                >
                  {row.customer_display || row.customer_id}
                </Link>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Address</dt>
              <dd className="mt-1 text-slate-800">{row.customer_address?.trim() || '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Blinds types</dt>
              <dd className="mt-1">
                {row.blinds_types?.length ? (
                  <ul className="list-none space-y-1 text-slate-900">
                    {row.blinds_types.map((b) => (
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
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </dd>
            </div>
            {row.perde_sayisi != null ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Total windows (summary)</dt>
                <dd className="mt-1 text-slate-800">{row.perde_sayisi}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled start</dt>
              <dd className="mt-1 text-slate-800">{formatDt(row.scheduled_start_at ?? row.tarih_saat)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Scheduled end</dt>
              <dd className="mt-1 text-slate-800">{formatDt(row.scheduled_end_at)}</dd>
            </div>
            {row.visit_time_zone ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Time zone</dt>
                <dd className="mt-1 text-slate-800">{row.visit_time_zone}</dd>
              </div>
            ) : null}
            {row.visit_address?.trim() ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Visit address</dt>
                <dd className="mt-1 text-slate-800">{row.visit_address}</dd>
              </div>
            ) : null}
            {row.visit_notes?.trim() ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-800">{row.visit_notes}</dd>
              </div>
            ) : null}
            {row.visit_organizer_name?.trim() || row.visit_organizer_email?.trim() ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Organizer</dt>
                <dd className="mt-1 text-slate-800">
                  {[row.visit_organizer_name?.trim(), row.visit_organizer_email?.trim()]
                    .filter(Boolean)
                    .join(' · ')}
                </dd>
              </div>
            ) : null}
            {row.visit_guest_emails?.length ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Guest emails</dt>
                <dd className="mt-1 text-slate-800">{row.visit_guest_emails.join(', ')}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Repeats</dt>
              <dd className="mt-1 text-slate-800">
                {row.visit_recurrence_rrule?.trim() ? row.visit_recurrence_rrule : 'Does not repeat'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Legacy tarih/saat</dt>
              <dd className="mt-1 text-slate-800">{formatDt(row.tarih_saat)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Calendar</dt>
              <dd className="mt-1 text-slate-800">
                {row.calendar_provider ?? '—'}
                {row.google_event_id ? (
                  <span className="mt-1 block font-mono text-xs text-slate-500">{row.google_event_id}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</dt>
              <dd className="mt-1 text-slate-800">{formatDt(row.created_at)}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  )
}
