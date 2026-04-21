import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays, ShoppingBag } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { formatVisitDateTimeList } from '@/lib/formatVisitDisplay'
import { apiBase, getJson, postJson } from '@/lib/api'
import { AddressMapLink } from '@/components/ui/AddressMapLink'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { getAccessToken } from '@/lib/authStorage'

type BlindsRef = { id: string; name: string; window_count?: number | null; line_amount?: number | null }

type EstimateDetail = {
  id: string
  company_id: string
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
  perde_sayisi: number | null
  status?: string | null
  status_label?: string | null
  is_deleted?: boolean | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  tarih_saat: string | null
  lead_id: string | null
  linked_order_id?: string | null
  calendar_provider: string | null
  google_event_id: string | null
  visit_time_zone?: string | null
  visit_address?: string | null
  visit_postal_code?: string | null
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
  const canViewOrders = Boolean(me?.permissions.includes('orders.view'))
  const [row, setRow] = useState<EstimateDetail | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [docBusy, setDocBusy] = useState<null | 'send' | 'download'>(null)
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

  async function downloadDepositContract() {
    if (!estimateId) return
    const tok = getAccessToken()
    if (!tok) {
      setErr('You are signed out. Please sign in again.')
      return
    }
    setErr(null)
    setDocBusy('download')
    try {
      const res = await fetch(`${apiBase()}/estimates/${encodeURIComponent(estimateId)}/documents/deposit-contract`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${tok}` },
      })
      if (!res.ok) {
        let msg = 'Could not download document.'
        try {
          const j = (await res.json()) as { detail?: string }
          if (j?.detail) msg = j.detail
        } catch {
          // ignore
        }
        throw new Error(msg)
      }
      const pdf = await res.arrayBuffer()
      const blob = new Blob([pdf], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `deposit-invoice-contract-${estimateId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not download document')
    } finally {
      setDocBusy(null)
    }
  }

  async function sendDepositContractEmail() {
    if (!estimateId) return
    setErr(null)
    setDocBusy('send')
    try {
      await postJson(`/estimates/${estimateId}/documents/deposit-contract/send-email`, {})
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send email')
    } finally {
      setDocBusy(null)
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
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <CalendarDays className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-slate-900">Estimate Details</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <WorkflowStatusBadge status={row.status} label={row.status_label} />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row.is_deleted && canEdit && estimateId ? (
                    <button
                      type="button"
                      onClick={() => setRestoreOpen(true)}
                      className="rounded-xl bg-teal-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700"
                    >
                      Restore
                    </button>
                  ) : null}
                  {row.status?.toLowerCase() === 'pending' && !row.is_deleted && estimateId ? (
                    <>
                      <button
                        type="button"
                        disabled={!canEdit || docBusy !== null}
                        onClick={() => void sendDepositContractEmail()}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                        title={!canEdit ? 'You do not have permission to send emails.' : 'Send by email'}
                      >
                        {docBusy === 'send' ? 'Sending…' : 'Send email'}
                      </button>
                      <button
                        type="button"
                        disabled={docBusy !== null}
                        onClick={() => void downloadDepositContract()}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                        title="Download deposit invoice and agreement (PDF)"
                      >
                        {docBusy === 'download' ? 'Preparing…' : 'Download PDF'}
                      </button>
                      {canCreateOrder ? (
                        <Link
                          to={`/orders?fromEstimate=${encodeURIComponent(estimateId)}`}
                          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-700"
                        >
                          <ShoppingBag className="h-4 w-4" strokeWidth={2} />
                          Make order
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                  {row.status?.toLowerCase() === 'converted' &&
                  !row.is_deleted &&
                  (row.linked_order_id ?? '').trim() &&
                  canViewOrders ? (
                    <Link
                      to={`/orders?viewOrder=${encodeURIComponent((row.linked_order_id ?? '').trim())}`}
                      className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50"
                    >
                      View order
                    </Link>
                  ) : null}
                  {canEdit && estimateId && !row.is_deleted && row.status?.toLowerCase() !== 'converted' ? (
                    <Link
                      to={`/estimates/${estimateId}/edit`}
                      className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50"
                    >
                      Edit
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {(row.customer_id ?? '').trim() ? (
                      <Link to={`/customers/${row.customer_id}`} className="hover:underline">
                        {row.customer_display || row.customer_id}
                      </Link>
                    ) : (
                      <span>{row.customer_display?.trim() || 'Prospect'}</span>
                    )}
                  </div>
                  <div className="mt-2 space-y-0.5 text-sm text-slate-700">
                    {row.prospect_phone?.trim() ? <div>{row.prospect_phone.trim()}</div> : null}
                    {row.prospect_email?.trim() ? <div>{row.prospect_email.trim()}</div> : null}
                  </div>
                  {estimateId ? (
                    <>
                      <div className="mt-3 text-xs font-semibold text-slate-500">Estimate ID</div>
                      <div className="mt-0.5 font-mono text-sm font-semibold text-slate-700">{estimateId}</div>
                    </>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Scheduled start
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-slate-900">
                          {formatDt(row.scheduled_start_at ?? row.tarih_saat)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Scheduled end
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-slate-900">{formatDt(row.scheduled_end_at)}</div>
                      </div>
                    </div>
                    {row.visit_time_zone ? (
                      <div className="text-xs font-semibold text-slate-500">Time zone: {row.visit_time_zone}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              {row.is_deleted ? (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  This estimate is deleted. It is hidden from the default list unless you enable{' '}
                  <strong>Show deleted</strong> on the estimates page.
                </div>
              ) : null}

              <div className="space-y-5 text-sm text-slate-800">
                <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Address</h3>
                  <div className="mt-2">
                    <AddressMapLink address={row.customer_address} lineClamp={false} />
                  </div>
                  {row.customer_postal_code?.trim() ? (
                    <div className="mt-1 text-xs font-medium text-slate-600">
                      Postal code: {row.customer_postal_code.trim()}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Blinds</h3>
                  {row.blinds_types?.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {row.blinds_types.map((b) => (
                        <li
                          key={b.id}
                          className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900 ring-1 ring-teal-100"
                        >
                          {b.name}
                          {b.window_count != null ? ` · ${b.window_count} windows` : ''}
                          {b.line_amount != null && b.line_amount > 0 ? ` · $${Number(b.line_amount).toFixed(2)}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 text-slate-600">—</div>
                  )}
                  {row.blinds_types?.length ? (
                    <div className="mt-3 text-xs font-semibold text-rose-700">
                      Total amount: $
                      {row.blinds_types
                        .reduce((acc, b) => acc + (Number(b.line_amount ?? 0) || 0), 0)
                        .toFixed(2)}
                    </div>
                  ) : null}
                </section>

                {row.visit_address?.trim() ? (
                  <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Visit address</h3>
                    <div className="mt-2">
                      <AddressMapLink address={row.visit_address} lineClamp={false} />
                    </div>
                    {row.visit_postal_code?.trim() ? (
                      <div className="mt-1 text-xs font-medium text-slate-600">
                        Postal code: {row.visit_postal_code.trim()}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {row.visit_notes?.trim() ? (
                  <section className="rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-amber-900/80">Notes</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{row.visit_notes}</p>
                  </section>
                ) : null}

                <section className="rounded-xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Google Calendar Connections
                  </h3>
                  <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                    {row.visit_organizer_name?.trim() || row.visit_organizer_email?.trim() ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Organizer</dt>
                        <dd className="mt-1 text-slate-800">
                          {[row.visit_organizer_name?.trim(), row.visit_organizer_email?.trim()].filter(Boolean).join(' · ')}
                        </dd>
                      </div>
                    ) : null}
                    {row.visit_guest_emails?.length ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Guest emails</dt>
                        <dd className="mt-1 text-slate-800">{row.visit_guest_emails.join(', ')}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  )
}
