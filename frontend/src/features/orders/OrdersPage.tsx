import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Eye, FolderKanban, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ShowDeletedToggle } from '@/components/ui/ShowDeletedToggle'
import { deleteJson, getJson, patchJson, postJson, postMultipartJson } from '@/lib/api'
import {
  BlindsLineState,
  BlindsOrderOptions,
  BlindsTypesGrid,
  customerLabel,
  CustomerOpt,
  fmtDisplayDate,
  fmtDisplayDateTime,
  fmtMoney,
  fmtTotalIncludingTax,
  fmtWholeCalendarDaysElapsedSince,
  hydrateBlindsLinesDefaults,
  newBlindsLineForType,
  normalizeBlindsLineFromApi,
  OrderAdvanceAction,
  OrderAttachmentsBlock,
  OrderDetail,
  OrderFinancialSecondRow,
  OrderInfoModal,
  OrderPrefill,
  OrderRow,
  OrderStatusBadge,
  OrderStatusOpt,
  PendingOrderAttachment,
  parseMoneyAmount,
  parseOptionalDecimal,
  parseTaxRatePercent,
  blindsLineToPayload,
  orderAdvanceButtonLabel,
  orderAdvanceStage,
  orderAdvanceTextButtonClass,
  orderListPaidDisplay,
  orderListRowDoneSyncedHighlight,
  orderStatusWorkflowBucketFromName,
  resolveOrderAdvanceAction,
  safeRound2,
  sanitizeLineAmountInput,
  statusColorClasses,
  sumBlindsLineAmounts,
  todayDateInput,
} from './ordersShared'

export function OrdersPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('orders.view'))
  const canEdit = Boolean(me?.permissions.includes('orders.edit'))
  const canViewCustomers = Boolean(me?.permissions.includes('customers.view'))
  const canViewCompanies = Boolean(me?.permissions.includes('companies.view'))
  const sessionCompanyId = me?.active_company_id ?? me?.company_id ?? null
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [rows, setRows] = useState<OrderRow[] | null>(null)
  const [customers, setCustomers] = useState<CustomerOpt[] | null>(null)
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
  const blindsTypes = blindsOrderOptions?.blinds_types ?? null
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [customerId, setCustomerId] = useState('')
  const [linkedEstimateId, setLinkedEstimateId] = useState<string | null>(null)
  const [blindsLines, setBlindsLines] = useState<BlindsLineState[]>([])
  const [taxBaseAmount, setTaxBaseAmount] = useState('')
  const [downpayment, setDownpayment] = useState('')
  const [agreementDate, setAgreementDate] = useState(() => todayDateInput())
  const [orderNote, setOrderNote] = useState('')
  const [companyTaxRatePercent, setCompanyTaxRatePercent] = useState<number | null>(null)

  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [restoreOrderId, setRestoreOrderId] = useState<string | null>(null)
  const [restorePending, setRestorePending] = useState(false)

  const [createPendingAttachments, setCreatePendingAttachments] = useState<PendingOrderAttachment[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)

  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOpt[] | null>(null)
  const [advanceConfirm, setAdvanceConfirm] = useState<{
    row: OrderRow
    act: Extract<OrderAdvanceAction, { kind: 'patch' }>
  } | null>(null)
  const [advanceConfirmPending, setAdvanceConfirmPending] = useState(false)
  const [orderBalanceInfo, setOrderBalanceInfo] = useState<{
    orderId: string
    customerDisplay: string
    balance: string | number | null
  } | null>(null)

  const fromEstimateQ = useMemo(() => searchParams.get('fromEstimate')?.trim() ?? '', [searchParams])
  const readyInstallQ = useMemo(() => (searchParams.get('ready_install') ?? '').trim().toLowerCase(), [searchParams])
  const ageBucketQ = useMemo(() => (searchParams.get('age_bucket') ?? '').trim().toLowerCase(), [searchParams])

  function ageBucketMatch(createdAtIso: string | null | undefined): boolean {
    if (!ageBucketQ) return true
    const d = createdAtIso ? new Date(createdAtIso) : null
    if (!d || Number.isNaN(d.getTime())) return false
    const days = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (ageBucketQ === '0-6d') return days >= 0 && days <= 6
    if (ageBucketQ === '7-13d') return days >= 7 && days <= 13
    if (ageBucketQ === '14-20d') return days >= 14 && days <= 20
    if (ageBucketQ === '21-27d') return days >= 21 && days <= 27
    if (ageBucketQ === '28d+' || ageBucketQ === '28d%2b') return days >= 28
    return true
  }
  const filteredRows = useMemo(() => {
    if (!rows) return rows
    return rows.filter((r) => {
      if (!ageBucketMatch(r.created_at ?? null)) return false
      if (readyInstallQ !== 'with_date' && readyInstallQ !== 'missing_date') return true
      const statusCodeReady = (r.status_code ?? '').trim().toLowerCase() === 'ready_for_install'
      const statusLabelBucket = orderStatusWorkflowBucketFromName((r.status_order_label ?? '').trim())
      const statusLabelReady = statusLabelBucket === 'rfi'
      if (!statusCodeReady && !statusLabelReady) return false
      const hasDate = Boolean(String(r.installation_scheduled_start_at ?? '').trim())
      return readyInstallQ === 'with_date' ? hasDate : !hasDate
    })
  }, [rows, readyInstallQ, ageBucketQ])
  const lineSubtotalParsed = useMemo(() => sumBlindsLineAmounts(blindsLines), [blindsLines])
  const taxBaseParsed = useMemo(() => parseOptionalDecimal(taxBaseAmount), [taxBaseAmount])
  const dpParsed = useMemo(() => parseOptionalDecimal(downpayment), [downpayment])

  const computedTaxAmount = useMemo(() => {
    if (companyTaxRatePercent == null || taxBaseParsed == null) return null
    if (companyTaxRatePercent <= 0 || taxBaseParsed <= 0) return safeRound2(0)
    return safeRound2((taxBaseParsed * companyTaxRatePercent) / 100)
  }, [companyTaxRatePercent, taxBaseParsed])

  const computedTotalInclTax = useMemo(
    () => safeRound2(lineSubtotalParsed + (computedTaxAmount ?? 0)),
    [lineSubtotalParsed, computedTaxAmount],
  )
  const computedPaid = useMemo(() => safeRound2(dpParsed ?? 0), [dpParsed])
  const computedBalance = useMemo(
    () => safeRound2(computedTotalInclTax - computedPaid),
    [computedTotalInclTax, computedPaid],
  )

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const [filterStatusOrderId, setFilterStatusOrderId] = useState('')

  const listParams = useMemo(() => {
    const p = new URLSearchParams()
    p.set('limit', '200')
    if (debouncedSearch.trim()) p.set('search', debouncedSearch.trim())
    if (showDeleted) p.set('include_deleted', 'true')
    if (filterStatusOrderId.trim()) p.set('status_orde_id', filterStatusOrderId.trim())
    return p.toString()
  }, [debouncedSearch, showDeleted, filterStatusOrderId])

  async function reloadList() {
    const list = await getJson<OrderRow[]>(`/orders?${listParams}`)
    setRows(list)
  }

  async function runDeleteOrder() {
    if (!deleteOrderId || !canEdit) return
    setDeletePending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${deleteOrderId}`)
      setDeleteOrderId(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete order')
    } finally {
      setDeletePending(false)
    }
  }

  async function runRestoreOrder() {
    if (!restoreOrderId || !canEdit) return
    const oid = restoreOrderId
    setRestorePending(true)
    setErr(null)
    try {
      await postJson(`/orders/${oid}/restore`, {})
      setRestoreOrderId(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not restore order')
    } finally {
      setRestorePending(false)
    }
  }

  function openAdvanceStatusFromRow(row: OrderRow) {
    const act = resolveOrderAdvanceAction(row, orderStatuses)
    if (!act || !canEdit) return
    if (act.kind === 'done_info') {
      navigate(`/orders/${row.id}`)
      setOrderBalanceInfo({
        orderId: row.id,
        customerDisplay: row.customer_display || row.customer_id,
        balance: row.balance,
      })
      return
    }
    setAdvanceConfirm({ row, act })
  }

  async function confirmAdvanceOrderStatus(opts?: { navigateToEdit?: boolean }) {
    if (!advanceConfirm || !canEdit) return
    const { row, act } = advanceConfirm
    const navigateToEdit = Boolean(opts?.navigateToEdit)
    if (navigateToEdit) {
      // Do not mutate status yet. Preselect it in Edit and auto-open installation picker.
      setAdvanceConfirm(null)
      navigate(`/orders/${row.id}/edit?prefillStatus=${encodeURIComponent(act.status_orde_id)}&openInstallation=1`)
      return
    }
    setAdvanceConfirmPending(true)
    setErr(null)
    try {
      await patchJson(`/orders/${row.id}`, { status_orde_id: act.status_orde_id })
      setAdvanceConfirm(null)
      await reloadList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update order status')
    } finally {
      setAdvanceConfirmPending(false)
    }
  }

  async function confirmAdvanceOrderStatusAndOpenExpense() {
    if (!advanceConfirm || !canEdit) return
    const { row, act } = advanceConfirm
    setAdvanceConfirmPending(true)
    setErr(null)
    try {
      await patchJson(`/orders/${row.id}`, { status_orde_id: act.status_orde_id })
      setAdvanceConfirm(null)
      await reloadList()
      navigate(
        `/orders/${row.id}/edit?openExpense=1&expenseNote=${encodeURIComponent('Production cost')}`,
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update order status')
    } finally {
      setAdvanceConfirmPending(false)
    }
  }

  // (final invoice actions moved to the order details popup)

  useEffect(() => {
    if (!me || !canView) return
    let c = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const list = await getJson<OrderRow[]>(`/orders?${listParams}`)
        if (!c) setRows(list)
      } catch (e) {
        if (!c) {
          setRows(null)
          setErr(e instanceof Error ? e.message : 'Could not load orders')
        }
      } finally {
        if (!c) setLoading(false)
      }
    })()
    return () => {
      c = true
    }
  }, [me, canView, listParams])

  useEffect(() => {
    if (!me || !canView) return
    let c = false
    ;(async () => {
      try {
        const custReq = getJson<CustomerOpt[]>(`/customers/lookup?limit=300`).catch(() => [] as CustomerOpt[])
        const [custList, opts, st] = await Promise.all([
          custReq,
          getJson<BlindsOrderOptions>(`/orders/lookup/blinds-order-options`),
          getJson<OrderStatusOpt[]>(`/orders/lookup/order-statuses`).catch(() => [] as OrderStatusOpt[]),
        ])
        if (!c) {
          setCustomers(custList)
          setBlindsOrderOptions(opts)
          setOrderStatuses(st)
        }
      } catch {
        if (!c) {
          setCustomers([])
          setBlindsOrderOptions(null)
        }
      }
    })()
    return () => {
      c = true
    }
  }, [me, canView])

  useEffect(() => {
    if (!me || !canViewCompanies || !sessionCompanyId) {
      setCompanyTaxRatePercent(null)
      return
    }
    let c = false
    ;(async () => {
      try {
        const co = await getJson<{ tax_rate_percent?: string | number | null }>(
          `/companies/${sessionCompanyId}`,
        )
        if (!c) setCompanyTaxRatePercent(parseTaxRatePercent(co.tax_rate_percent))
      } catch {
        if (!c) setCompanyTaxRatePercent(null)
      }
    })()
    return () => {
      c = true
    }
  }, [me, canViewCompanies, sessionCompanyId])

  useEffect(() => {
    if (!me || !fromEstimateQ || !canView) return
    let cancelled = false
    ;(async () => {
      setErr(null)
      try {
        const p = await getJson<OrderPrefill>(`/orders/prefill-from-estimate/${fromEstimateQ}`)
        if (cancelled) return
        if (p.estimate_status !== 'pending' && p.estimate_status !== 'new') {
          setErr(
            p.estimate_status === 'converted'
              ? 'This estimate is already converted. Find the order in the list below.'
              : p.estimate_status === 'cancelled'
                ? 'Cancelled estimates cannot be turned into an order.'
                : 'Only open estimates (pending or new) can be turned into an order.',
          )
          setSearchParams({}, { replace: true })
          return
        }
        setCustomerId((p.customer_id ?? '').trim())
        setLinkedEstimateId(fromEstimateQ)
        setBlindsLines(
          hydrateBlindsLinesDefaults(
            (p.blinds_lines ?? []).map((x: Record<string, unknown>) =>
              normalizeBlindsLineFromApi(x),
            ),
            blindsOrderOptions,
          ),
        )
        setAgreementDate(todayDateInput())
        setOrderNote(p.visit_notes?.trim() ? p.visit_notes : '')
        const pr = parseTaxRatePercent(p.company_tax_rate_percent)
        if (pr !== null) setCompanyTaxRatePercent(pr)
        setShowCreateForm(true)
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Could not load estimate for this order')
        }
      } finally {
        if (!cancelled) setSearchParams({}, { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canView, fromEstimateQ, setSearchParams, blindsOrderOptions])

  useEffect(() => {
    if (!canView) return
    const orderId = searchParams.get('viewOrder')?.trim()
    if (!orderId) return
    navigate(`/orders/${orderId}`, { replace: true })
  }, [canView, navigate, searchParams])

  useEffect(() => {
    if (!linkedEstimateId || !blindsOrderOptions) return
    setBlindsLines((prev) => hydrateBlindsLinesDefaults(prev, blindsOrderOptions))
  }, [linkedEstimateId, blindsOrderOptions])

  function resetCreateForm() {
    setCustomerId('')
    setLinkedEstimateId(null)
    setBlindsLines([])
    setTaxBaseAmount('')
    setDownpayment('')
    setAgreementDate(todayDateInput())
    setOrderNote('')
    setCreatePendingAttachments([])
  }

  function toggleBlinds(id: string) {
    setBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = (blindsTypes ?? []).find((x) => x.id === id)
      const name = bt?.name ?? id
      return [...prev, newBlindsLineForType(id, name, blindsOrderOptions)]
    })
  }

  function setBlindsCount(id: string, v: string) {
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

  function setBlindsLineField(id: string, jsonKey: string, value: string) {
    const v = value.trim() ? value.trim().toLowerCase() : null
    setBlindsLines((prev) =>
      prev.map((x) => (x.id === id ? { ...x, [jsonKey]: v } : x)),
    )
  }

  function setBlindsLineNote(id: string, value: string) {
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function setBlindsLineAmount(id: string, value: string) {
    const next = sanitizeLineAmountInput(value)
    setBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
  }

  function openNewOrder() {
    resetCreateForm()
    setShowCreateForm(true)
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) return
    if (!linkedEstimateId && !customerId.trim()) return
    const taxBase = taxBaseParsed
    const dp = dpParsed
    setSaving(true)
    setErr(null)
    const pendingAtt = [...createPendingAttachments]
    try {
      const created = await postJson<OrderDetail>('/orders', {
        ...(customerId.trim() ? { customer_id: customerId.trim() } : {}),
        ...(linkedEstimateId ? { estimate_id: linkedEstimateId } : {}),
        ...(taxBase !== null ? { tax_uygulanacak_miktar: taxBase } : {}),
        ...(dp !== null ? { downpayment: dp } : {}),
        ...(agreementDate.trim() ? { agreement_date: agreementDate.trim() } : {}),
        ...(orderNote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
          ? { order_note: orderNote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().slice(0, 4000) }
          : {}),
        blinds_lines: blindsLines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
      })
      for (const p of pendingAtt) {
        const fd = new FormData()
        fd.append('kind', p.kind)
        fd.append('file', p.file)
        await postMultipartJson(`/orders/${created.id}/attachments`, fd)
      }
      setShowCreateForm(false)
      resetCreateForm()
      await reloadList()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) {
    return (
      <div className="w-full">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="w-full max-w-none space-y-4">
        <p className="text-sm text-slate-600">You do not have permission to view orders.</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <FolderKanban className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Orders</h1>
            <p className="mt-1 text-slate-600">
              Create orders here or start from an estimate using Make order on the Estimates page. Linking an
              estimate marks it as converted automatically.
            </p>
          </div>
        </div>
        {canEdit && !showCreateForm ? (
          <div className="ml-auto flex shrink-0 items-center sm:pt-1">
            <button
              type="button"
              onClick={() => openNewOrder()}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
            >
              New order
            </button>
          </div>
        ) : null}
      </div>

      {err ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p>
      ) : null}

      {canEdit && showCreateForm ? (
        <form
          onSubmit={(e) => void onCreate(e)}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-800">New order</h2>
          {linkedEstimateId ? (
            <p className="mt-2 rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2 text-xs text-teal-900">
              From estimate{' '}
              <Link className="font-semibold underline" to={`/estimates/${linkedEstimateId}`}>
                {linkedEstimateId}
              </Link>
              .{' '}
              {customerId.trim()
                ? 'Customer is fixed to match the estimate.'
                : 'No customer record yet — one is created from the estimate when you save this order.'}
            </p>
          ) : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Customer</span>
              <select
                required={!linkedEstimateId}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                value={customerId}
                disabled={Boolean(linkedEstimateId)}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">
                  {linkedEstimateId && !customerId.trim() ? 'Created from estimate on save' : 'Select…'}
                </option>
                {(customers ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {customerLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Blinds types &amp; quantities
              </legend>
              <BlindsTypesGrid
                blindsTypes={blindsTypes ?? []}
                blindsOrderOptions={blindsOrderOptions}
                lines={blindsLines}
                toggleType={toggleBlinds}
                setCount={setBlindsCount}
                setLineField={setBlindsLineField}
                setLineNote={setBlindsLineNote}
                setLineAmount={setBlindsLineAmount}
              />
              {blindsLines.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
              ) : null}
            </fieldset>
            <label className="block w-full min-w-0 text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Order note</span>
              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                rows={2}
                maxLength={4000}
                placeholder="Optional note for this order…"
                className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
            <div className="space-y-3 sm:col-span-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Total (incl. tax)</span>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                    {fmtTotalIncludingTax(lineSubtotalParsed, computedTaxAmount)}
                  </p>
                </div>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Down payment</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={downpayment}
                    onChange={(e) => setDownpayment(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Taxable base</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={taxBaseAmount}
                    onChange={(e) => setTaxBaseAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </label>
              </div>
              <OrderFinancialSecondRow
                paidDisplay={fmtMoney(computedPaid)}
                balance={computedBalance}
                tax={computedTaxAmount}
              />
            </div>

            <label className="block text-sm text-slate-700 sm:col-span-2">
              <span className="mb-1 block font-medium">Agreement date (optional)</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={agreementDate}
                onChange={(e) => setAgreementDate(e.target.value)}
              />
            </label>
            <div className="sm:col-span-2">
              <OrderAttachmentsBlock
                blockId="new-order-att"
                orderId={null}
                serverFiles={[]}
                pendingFiles={createPendingAttachments}
                onPendingChange={setCreatePendingAttachments}
                canEdit={canEdit}
                uploadBusy={attachmentUploadBusy || saving}
                setUploadBusy={setAttachmentUploadBusy}
                onAfterServerMutation={async () => {}}
                setErr={setErr}
                onRequestDeleteAttachment={() => {}}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setShowCreateForm(false)
                resetCreateForm()
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!linkedEstimateId && !customerId.trim())}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create order'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-slate-800">All orders</h2>

            <input
              type="search"
              placeholder="Search id, customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 min-w-[10rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:max-w-[18rem]"
              aria-label="Search orders"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => setFilterStatusOrderId('')}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                  filterStatusOrderId.trim() === ''
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                } ${loading ? 'opacity-60' : ''}`}
                title="All statuses"
              >
                All
              </button>
              {(orderStatuses ?? []).map((s) => {
                const selected = filterStatusOrderId === s.id
                const c = statusColorClasses(s.name)
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setFilterStatusOrderId(s.id)}
                    className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition ${
                      selected ? c.active : c.base
                    } ${selected ? '' : 'hover:brightness-[0.98]'} ${loading ? 'opacity-60' : ''}`}
                    title={s.name}
                    aria-pressed={selected}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <ShowDeletedToggle
                id="show-deleted-orders"
                checked={showDeleted}
                onChange={setShowDeleted}
                disabled={loading}
              />
            </div>
          </div>
        </div>
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[50rem] text-left text-sm [word-break:break-word]">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Customer</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Agreement date</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Installation date</th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4" title="Total (incl. tax) + Paid">
                  Total / Paid
                </th>
                <th className="whitespace-nowrap px-2 py-3 sm:px-4">Balance</th>
                <th className="min-w-[13rem] whitespace-nowrap px-2 py-3 text-right sm:px-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading || filteredRows === null ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    No orders yet. Use New order or Make order from an estimate.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const advance = resolveOrderAdvanceAction(r, orderStatuses)
                  const doneSyncedHighlight = orderListRowDoneSyncedHighlight(r)
                  const bucket = orderStatusWorkflowBucketFromName((r.status_order_label ?? '').trim())
                  const missingInstallation =
                    r.active !== false && bucket === 'rfi' && !String(r.installation_scheduled_start_at ?? '').trim()
                  return (
                  <tr
                    key={r.id}
                    className={
                      r.active === false
                        ? 'bg-slate-50/90 opacity-80 hover:bg-slate-50/80'
                        : doneSyncedHighlight
                          ? 'bg-emerald-50/50 hover:bg-emerald-50/75'
                          : 'hover:bg-slate-50/80'
                    }
                  >
                    <td className="px-2 py-3 sm:px-4">
                      <div className="flex flex-col gap-1">
                        {canViewCustomers ? (
                          <Link
                            to={`/customers/${r.customer_id}`}
                            className="font-semibold text-slate-900 hover:text-slate-950 hover:underline"
                          >
                            {r.customer_display || r.customer_id}
                          </Link>
                        ) : (
                          <span className="font-semibold text-slate-900">{r.customer_display || r.customer_id}</span>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <OrderStatusBadge label={r.status_order_label} />
                          {missingInstallation ? (
                            <span className="group relative inline-flex items-center">
                              <AlertTriangle
                                className="h-4 w-4 text-amber-700"
                                strokeWidth={2}
                                aria-label="Installation date-time missing"
                              />
                              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 shadow-lg opacity-0 transition group-hover:opacity-100">
                                Ready for installation, but no installation date-time is set.
                              </span>
                            </span>
                          ) : null}
                          {r.active === false ? (
                            <span className="text-[11px] font-medium text-slate-500">Deleted</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">
                      <div className="flex flex-col gap-0.5">
                        <span>{fmtDisplayDate(r.agreement_date)}</span>
                        <span className="text-[11px] text-slate-500">
                          {(() => {
                            const d = fmtWholeCalendarDaysElapsedSince(r.agreement_date)
                            return d === '—' ? '—' : `${d} days past`
                          })()}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-slate-600 sm:px-4">
                      {fmtDisplayDateTime(r.installation_scheduled_start_at)}
                    </td>
                    <td className="px-2 py-3 sm:px-4">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{fmtTotalIncludingTax(r.total_amount, r.tax_amount)}</span>
                          {(() => {
                            const exp = parseMoneyAmount(r.expense_total) ?? 0
                            if (!(exp > 0.005)) return null
                            const tot = (parseMoneyAmount(r.total_amount) ?? 0) + (parseMoneyAmount(r.tax_amount) ?? 0)
                            const prof = safeRound2(tot - exp)
                            return (
                            <span className="group relative inline-flex">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-extrabold text-white ring-1 ring-red-600">
                                !
                              </span>
                              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 shadow-lg opacity-0 transition group-hover:opacity-100">
                                <span className="block text-slate-700">
                                  Expense total: <span className="font-semibold tabular-nums">{fmtMoney(exp)}</span>
                                </span>
                                <span className="mt-0.5 block text-slate-700">
                                  Profit: <span className="font-semibold tabular-nums">{fmtMoney(prof)}</span>
                                </span>
                              </span>
                            </span>
                            )
                          })()}
                        </div>
                        <span className="text-[11px] text-slate-600">Paid: {orderListPaidDisplay(r)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 sm:px-4">{fmtMoney(r.balance)}</td>
                    <td className="align-top px-2 py-3 text-right sm:px-4">
                      <div className="flex flex-col items-end gap-1 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-x-2">
                        {canEdit && r.active !== false && advance ? (
                          <button
                            type="button"
                            title={
                              advance.kind === 'done_info'
                                ? 'Open order details and show balance due (mark Done from Edit when ready)'
                                : `Set status to ${advance.nextLabel}`
                            }
                            disabled={advanceConfirmPending && advanceConfirm?.row.id === r.id}
                            className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${orderAdvanceTextButtonClass[orderAdvanceStage(advance)]}`}
                            onClick={() => openAdvanceStatusFromRow(r)}
                          >
                            {advanceConfirmPending && advanceConfirm?.row.id === r.id
                              ? 'Updating…'
                              : orderAdvanceButtonLabel(advance)}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="View details"
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                          onClick={() => navigate(`/orders/${r.id}`)}
                        >
                          <Eye className="h-4 w-4" strokeWidth={2} />
                        </button>
                        {canEdit && r.active !== false ? (
                          <>
                            <button
                              type="button"
                              title="Edit order"
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                              onClick={() => navigate(`/orders/${r.id}/edit`)}
                            >
                              <Pencil className="h-4 w-4" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              title="Delete order"
                              className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                              onClick={() => setDeleteOrderId(r.id)}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          </>
                        ) : null}
                        {canEdit && r.active === false ? (
                          <button
                            type="button"
                            title="Restore order"
                            className="rounded-lg border border-teal-200 p-1.5 text-teal-800 hover:bg-teal-50"
                            onClick={() => setRestoreOrderId(r.id)}
                          >
                            <RotateCcw className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={restoreOrderId !== null}
        title="Restore this order?"
        description="The order will show in the default list again as active."
        confirmLabel="Restore order"
        cancelLabel="Cancel"
        pending={restorePending}
        onConfirm={() => void runRestoreOrder()}
        onCancel={() => !restorePending && setRestoreOrderId(null)}
      />

      <ConfirmModal
        open={deleteOrderId !== null}
        title="Delete this order?"
        description="The order will be hidden from the default list (soft delete). You can restore it later from Show deleted."
        confirmLabel="Delete order"
        cancelLabel="Keep order"
        variant="danger"
        pending={deletePending}
        onConfirm={() => void runDeleteOrder()}
        onCancel={() => !deletePending && setDeleteOrderId(null)}
      />

      <ConfirmModal
        open={advanceConfirm !== null}
        title="Change order status?"
        description={
          advanceConfirm
            ? advanceConfirm.act.kind === 'patch' && advanceConfirm.act.stage === 'to_rfi'
              ? `Set this order's status to "${advanceConfirm.act.nextLabel}"? Installation date and time are optional. Use "Enter installation date now" to open Edit order and set them, or "Confirm" to change status only and add them later.`
              : `Set this order's status to "${advanceConfirm.act.nextLabel}"?`
            : ''
        }
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        secondaryAction={
          advanceConfirm?.act.kind === 'patch' && advanceConfirm.act.stage === 'to_rfi'
            ? {
                label: 'Enter installation date now',
                onClick: () => void confirmAdvanceOrderStatus({ navigateToEdit: true }),
              }
            : advanceConfirm?.act.kind === 'patch' && advanceConfirm.act.stage === 'to_production'
              ? {
                  label: 'Add production cost',
                  onClick: () => void confirmAdvanceOrderStatusAndOpenExpense(),
                }
              : undefined
        }
        pending={advanceConfirmPending}
        onConfirm={() => void confirmAdvanceOrderStatus()}
        onCancel={() => !advanceConfirmPending && setAdvanceConfirm(null)}
      />

      <OrderInfoModal
        open={orderBalanceInfo !== null}
        title="Order balance"
        description={
          orderBalanceInfo
            ? `Customer: ${orderBalanceInfo.customerDisplay}. Remaining balance due for this order: ${fmtMoney(orderBalanceInfo.balance)}.`
            : ''
        }
        onClose={() => setOrderBalanceInfo(null)}
      />

    </div>
  )
}
