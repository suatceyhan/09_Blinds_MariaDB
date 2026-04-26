import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Pencil } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson } from '@/lib/api'
import {
  blindsLineSummarySuffix,
  BlindsOrderOptions,
  fmtDisplayDate,
  fmtDisplayDateTime,
  fmtMoney,
  fmtTotalIncludingTax,
  normalizeBlindsLineFromApi,
  OrderAttachmentsBlock,
  OrderDetail,
  OrderFinancialSecondRow,
  OrderStatusBadge,
  parseMoneyAmount,
  safeRound2,
  statusCodeLabel,
} from './ordersShared'

export function OrderViewPage() {
  const { orderId } = useParams()
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('orders.view'))
  const canEdit = Boolean(me?.permissions.includes('orders.edit'))
  const canMutateInView = false

  const [err, setErr] = useState<string | null>(null)
  const [viewOrder, setViewOrder] = useState<OrderDetail | null | undefined>(undefined)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewAdditionDetails, setViewAdditionDetails] = useState<Record<string, OrderDetail>>({})
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)

  const viewPaidFormatted = useMemo(() => {
    if (!viewOrder) return '-'
    const ft = viewOrder.financial_totals
    if (ft?.paid_total != null && ft.paid_total !== '') {
      return fmtMoney(ft.paid_total)
    }
    const down = parseMoneyAmount(viewOrder.downpayment) ?? 0
    const extra = parseMoneyAmount(viewOrder.final_payment) ?? 0
    return fmtMoney(safeRound2(down + extra))
  }, [viewOrder])

  const paymentSummary = useMemo(() => {
    const list = viewOrder?.payment_entries ?? []
    const count = list.length
    const lastPaidAt = count ? list[list.length - 1]?.paid_at ?? null : null
    return { count, lastPaidAt }
  }, [viewOrder])

  useEffect(() => {
    if (!me || !canView || !orderId) return
    let cancelled = false
    ;(async () => {
      try {
        const opts = await getJson<BlindsOrderOptions>('/orders/lookup/blinds-order-options')
        if (!cancelled) setBlindsOrderOptions(opts)
      } catch {
        if (!cancelled) setBlindsOrderOptions(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canView, orderId])

  useEffect(() => {
    if (!orderId || !canView) {
      setViewOrder(null)
      setViewAdditionDetails({})
      setViewLoading(false)
      return
    }
    let cancelled = false
    setViewLoading(true)
    setErr(null)
    ;(async () => {
      try {
        const d = await getJson<OrderDetail>(`/orders/${orderId}`)
        if (cancelled) return
        setViewOrder(d)
        if (!d.parent_order_id?.trim()) {
          const addIds = (d.line_item_additions ?? []).map((x) => x.order_id).filter(Boolean)
          if (addIds.length) {
            const adds = await Promise.all(addIds.map((id) => getJson<OrderDetail>(`/orders/${id}`)))
            if (!cancelled) {
              const byId: Record<string, OrderDetail> = {}
              for (const ad of adds) byId[ad.id] = ad
              setViewAdditionDetails(byId)
            }
          } else {
            setViewAdditionDetails({})
          }
        } else {
          setViewAdditionDetails({})
        }
      } catch (e) {
        if (!cancelled) {
          setViewOrder(null)
          setViewAdditionDetails({})
          setErr(e instanceof Error ? e.message : 'Could not load order')
        }
      } finally {
        if (!cancelled) setViewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId, canView])

  async function refreshOrder() {
    if (!orderId || !canView) return
    setViewLoading(true)
    try {
      const d = await getJson<OrderDetail>(`/orders/${orderId}`)
      setViewOrder(d)
      if (!d.parent_order_id?.trim()) {
        const addIds = (d.line_item_additions ?? []).map((x) => x.order_id).filter(Boolean)
        if (addIds.length) {
          const adds = await Promise.all(addIds.map((id) => getJson<OrderDetail>(`/orders/${id}`)))
          const byId: Record<string, OrderDetail> = {}
          for (const ad of adds) byId[ad.id] = ad
          setViewAdditionDetails(byId)
        } else {
          setViewAdditionDetails({})
        }
      } else {
        setViewAdditionDetails({})
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load order')
    } finally {
      setViewLoading(false)
    }
  }


  if (!me) return <p className="text-sm text-slate-500">Loading...</p>

  if (!canView) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <p className="text-sm text-slate-600">You do not have permission to view orders.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}

      {viewLoading && viewOrder === undefined ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : viewOrder === null ? (
        <p className="text-sm text-slate-500">Order not found.</p>
      ) : viewOrder ? (
        <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <FolderKanban className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight text-slate-900">Order Details</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <OrderStatusBadge
                      label={viewOrder.status_order_label?.trim() || statusCodeLabel(viewOrder.status_code)}
                    />
                  </div>
                </div>
              </div>
              {canEdit && viewOrder.active !== false && orderId ? (
                <Link
                  to={`/orders/${orderId}/edit`}
                  className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50"
                  title="Edit order"
                >
                  <Pencil className="h-4 w-4" strokeWidth={2} />
                  Edit order
                </Link>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {viewOrder.customer_display || viewOrder.customer_id}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-500">Order ID</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-slate-700">{orderId}</div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Agreement date
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-slate-900">
                        {fmtDisplayDate(viewOrder.agreement_date)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Installation date
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-slate-900">
                        {fmtDisplayDateTime(viewOrder.installation_scheduled_start_at)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="space-y-5 text-sm text-slate-800">
              {viewOrder.active === false ? (
                <p className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                  This order is soft-deleted (inactive). You can review the details below; editing is disabled.
                </p>
              ) : null}

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Job totals</h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Includes the original order + all additional orders.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Total (incl. tax)</span>
                    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                      {fmtTotalIncludingTax(
                        viewOrder.financial_totals?.subtotal_ex_tax ?? viewOrder.total_amount,
                        viewOrder.financial_totals?.tax_amount ?? viewOrder.tax_amount,
                      )}
                    </p>
                  </div>
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Down payment</span>
                    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                      {fmtMoney(viewOrder.financial_totals?.downpayment ?? viewOrder.downpayment)}
                    </p>
                  </div>
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Taxable base</span>
                    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                      {fmtMoney(viewOrder.financial_totals?.taxable_base ?? viewOrder.tax_uygulanacak_miktar)}
                    </p>
                  </div>
                </div>
                <OrderFinancialSecondRow
                  paidDisplay={viewPaidFormatted}
                  balance={viewOrder.financial_totals?.balance ?? viewOrder.balance}
                  tax={viewOrder.financial_totals?.tax_amount ?? viewOrder.tax_amount}
                />
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Recorded payments
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {paymentSummary.count
                        ? `${paymentSummary.count} payment${paymentSummary.count === 1 ? '' : 's'} · last ${fmtDisplayDateTime(paymentSummary.lastPaidAt)}`
                        : 'No payments recorded yet.'}
                    </p>
                  </div>
                </div>

                {(viewOrder.payment_entries?.length ?? 0) > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {(viewOrder.payment_entries ?? []).map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium tabular-nums text-slate-900">{fmtMoney(p.amount)}</span>
                          {p.id === 'downpayment' ? (
                            <span className="ml-2 text-xs font-normal text-slate-500">Down payment</span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-slate-500">{fmtDisplayDateTime(p.paid_at)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Extra expenses</h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Affects profit only (does not change payments/balance).
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Expense total
                    </div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMoney(viewOrder.expense_total ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Profit</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMoney(viewOrder.profit ?? 0)}
                    </div>
                  </div>
                </div>
                {(viewOrder.expense_entries?.length ?? 0) > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {(viewOrder.expense_entries ?? []).map((e) => {
                      const at = e.spent_at ?? e.created_at ?? null
                      return (
                        <li
                          key={e.id}
                          className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium tabular-nums text-slate-900">{fmtMoney(e.amount)}</span>
                            {e.note?.trim() ? (
                              <span className="ml-2 text-xs font-normal text-slate-500">{e.note.trim()}</span>
                            ) : null}
                          </div>
                          {at?.trim() ? <span className="text-slate-500">{fmtDisplayDateTime(at)}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No expenses recorded.</p>
                )}
              </div>

              <details className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm" open>
                <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">
                  <span className="inline-flex items-center gap-2">
                    Original order
                    {(Number(viewOrder.balance ?? 0) <= 0.005 || Number(viewOrder.financial_totals?.balance ?? 0) <= 0.005) &&
                    (viewOrder.line_item_additions?.length ?? 0) > 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                        Paid
                      </span>
                    ) : null}
                  </span>
                </summary>
                <div className="mt-4 space-y-5">
                  <OrderAttachmentsBlock
                    blockId="view-order-att"
                    orderId={orderId ?? null}
                    serverFiles={viewOrder.attachments ?? []}
                    pendingFiles={[]}
                    onPendingChange={() => {}}
                    canEdit={canMutateInView}
                    uploadBusy={attachmentUploadBusy}
                    setUploadBusy={setAttachmentUploadBusy}
                    onAfterServerMutation={refreshOrder}
                    setErr={setErr}
                    onRequestDeleteAttachment={() => {}}
                  />

                  {viewOrder.blinds_lines && viewOrder.blinds_lines.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blinds</h3>
                      <ul className="mt-3 space-y-2">
                        {viewOrder.blinds_lines.map((b) => {
                          const line = normalizeBlindsLineFromApi(b as Record<string, unknown>)
                          const photos = viewOrder.line_photos?.[String(b.id)] ?? []
                          const latest = photos[0] ?? null
                          return (
                            <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/40 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-900">
                                  {b.name}
                                  {b.window_count != null ? ` - ${b.window_count}` : ''}
                                  <span className="ml-1 text-xs font-normal text-slate-500">
                                    {blindsLineSummarySuffix(line, blindsOrderOptions)}
                                  </span>
                                </div>
                                {latest ? (
                                  <a
                                    href={latest.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex items-center gap-2"
                                    title={latest.filename}
                                  >
                                    <img
                                      src={latest.url}
                                      alt="Line"
                                      className="h-10 w-10 rounded-md border border-slate-200 object-cover"
                                      loading="lazy"
                                    />
                                    <span className="text-xs font-medium text-teal-700 hover:underline">
                                      View photo{photos.length > 1 ? ` (${photos.length})` : ''}
                                    </span>
                                  </a>
                                ) : (
                                  <div className="mt-2 text-xs text-slate-500">No photo yet.</div>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ) : null}

                  {viewOrder.order_note?.trim() ? (
                    <section className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Note</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{viewOrder.order_note.trim()}</p>
                    </section>
                  ) : null}

                  {viewOrder.agree_data?.trim() ? (
                    <section className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Production notes
                      </h3>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200/80 bg-white p-3 text-xs leading-relaxed text-slate-800">
                        {viewOrder.agree_data.trim()}
                      </pre>
                    </section>
                  ) : null}
                </div>
              </details>

              {viewOrder.line_item_additions && viewOrder.line_item_additions.length > 0 ? (
                <div className="space-y-3">
                  {viewOrder.line_item_additions.map((a, idx) => (
                    <details key={a.order_id} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
                      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">
                        <span className="inline-flex items-center gap-2">
                          Additional order #{idx + 1}{' '}
                          <span className="ml-2 font-mono text-xs font-medium text-slate-400">{a.order_id}</span>
                          {Math.abs(parseMoneyAmount(a.balance) ?? 0) <= 0.005 ? (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-indigo-100">
                              Paid
                            </span>
                          ) : null}
                        </span>
                      </summary>
                      <div className="mt-4 space-y-3">
                        {viewAdditionDetails[a.order_id]?.blinds_lines &&
                        viewAdditionDetails[a.order_id]!.blinds_lines!.length > 0 ? (
                          <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blinds</h3>
                            <ul className="mt-3 flex flex-wrap gap-2">
                              {viewAdditionDetails[a.order_id]!.blinds_lines!.map((b) => (
                                <li
                                  key={b.id}
                                  className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-900 ring-1 ring-teal-100"
                                >
                                  {b.name}
                                  {b.window_count != null ? ` - ${b.window_count}` : ''}
                                  {blindsLineSummarySuffix(
                                    normalizeBlindsLineFromApi(b as Record<string, unknown>),
                                    blindsOrderOptions,
                                  )}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="block min-w-0 text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Total (incl. tax)</span>
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                              {fmtTotalIncludingTax(a.subtotal_ex_tax, a.tax_amount)}
                            </p>
                          </div>
                          <div className="block min-w-0 text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Down payment</span>
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                              {fmtMoney(parseMoneyAmount(a.downpayment) ?? 0)}
                            </p>
                          </div>
                          <div className="block min-w-0 text-sm text-slate-700">
                            <span className="mb-1 block font-medium">Taxable base</span>
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                              {fmtMoney(parseMoneyAmount(a.taxable_base) ?? 0)}
                            </p>
                          </div>
                        </div>
                        <OrderFinancialSecondRow
                          paidDisplay={fmtMoney(parseMoneyAmount(a.paid_total) ?? 0)}
                          balance={parseMoneyAmount(a.balance) ?? 0}
                          tax={parseMoneyAmount(a.tax_amount) ?? 0}
                        />
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading...</p>
      )}
    </div>
  )
}
