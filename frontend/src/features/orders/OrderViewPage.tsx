import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Pencil, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { deleteJson, getJson } from '@/lib/api'
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

  const [err, setErr] = useState<string | null>(null)
  const [viewOrder, setViewOrder] = useState<OrderDetail | null | undefined>(undefined)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewAdditionDetails, setViewAdditionDetails] = useState<Record<string, OrderDetail>>({})
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState<{ orderId: string; expenseId: string } | null>(null)
  const [deleteExpensePending, setDeleteExpensePending] = useState(false)
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<{
    orderId: string
    id: string
  } | null>(null)
  const [deleteAttachmentPending, setDeleteAttachmentPending] = useState(false)

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

  async function runDeleteExpense() {
    if (!deleteExpenseTarget || !canEdit) return
    setDeleteExpensePending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${deleteExpenseTarget.orderId}/expenses/${deleteExpenseTarget.expenseId}`)
      setDeleteExpenseTarget(null)
      await refreshOrder()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove expense')
    } finally {
      setDeleteExpensePending(false)
    }
  }

  async function runDeleteAttachment() {
    if (!deleteAttachmentTarget || !canEdit) return
    const { orderId: targetOrderId, id } = deleteAttachmentTarget
    setDeleteAttachmentPending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${targetOrderId}/attachments/${id}`)
      setDeleteAttachmentTarget(null)
      await refreshOrder()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove attachment')
    } finally {
      setDeleteAttachmentPending(false)
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
      <ConfirmModal
        open={deleteAttachmentTarget !== null}
        title="Remove this file?"
        description="The attachment will no longer appear on this order."
        confirmLabel="Remove file"
        cancelLabel="Cancel"
        variant="danger"
        pending={deleteAttachmentPending}
        onConfirm={() => void runDeleteAttachment()}
        onCancel={() => !deleteAttachmentPending && setDeleteAttachmentTarget(null)}
      />

      <ConfirmModal
        open={deleteExpenseTarget !== null}
        title="Remove this expense?"
        description="This expense line will be removed. Profit will be recalculated."
        confirmLabel="Remove expense"
        cancelLabel="Cancel"
        variant="danger"
        pending={deleteExpensePending}
        onConfirm={() => void runDeleteExpense()}
        onCancel={() => !deleteExpensePending && setDeleteExpenseTarget(null)}
      />

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

              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Total (incl. tax)</span>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                      {fmtTotalIncludingTax(
                        viewOrder.financial_totals?.subtotal_ex_tax ?? viewOrder.total_amount,
                        viewOrder.financial_totals?.tax_amount ?? viewOrder.tax_amount,
                      )}
                    </p>
                  </div>
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Down payment</span>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                      {fmtMoney(viewOrder.financial_totals?.downpayment ?? viewOrder.downpayment)}
                    </p>
                  </div>
                  <div className="block min-w-0 text-sm text-slate-700">
                    <span className="mb-1 block font-medium">Taxable base</span>
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
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

              <div className="rounded-xl border border-slate-200/80 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Extra expenses</h3>
                    <p className="mt-1 text-[11px] text-slate-500">Affects profit only (does not change payments/balance).</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expense total</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                      {fmtMoney(viewOrder.expense_total ?? 0)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Profit</div>
                    <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{fmtMoney(viewOrder.profit ?? 0)}</div>
                  </div>
                </div>
                {(viewOrder.expense_entries?.length ?? 0) > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {(viewOrder.expense_entries ?? []).map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-3 bg-white px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold tabular-nums text-slate-900">{fmtMoney(e.amount)}</div>
                          {e.note?.trim() ? <div className="mt-0.5 text-xs text-slate-600">{e.note.trim()}</div> : null}
                        </div>
                        {canEdit && viewOrder.active !== false ? (
                          <button
                            type="button"
                            title="Remove expense"
                            className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                            onClick={() => orderId && setDeleteExpenseTarget({ orderId, expenseId: e.id })}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No expenses recorded.</p>
                )}
              </div>

              {viewOrder.payment_entries && viewOrder.payment_entries.length > 0 ? (
                <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Recorded payments
                  </h3>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {viewOrder.payment_entries.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
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
                </div>
              ) : null}

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
                    canEdit={canEdit && viewOrder.active !== false}
                    uploadBusy={attachmentUploadBusy}
                    setUploadBusy={setAttachmentUploadBusy}
                    onAfterServerMutation={refreshOrder}
                    setErr={setErr}
                    onRequestDeleteAttachment={(id) => orderId && setDeleteAttachmentTarget({ orderId, id })}
                  />

                  {viewOrder.blinds_lines && viewOrder.blinds_lines.length > 0 ? (
                    <section className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blinds</h3>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {viewOrder.blinds_lines.map((b) => (
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
