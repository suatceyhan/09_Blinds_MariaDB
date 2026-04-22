import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { VisitStartQuarterPicker } from '@/components/ui/VisitStartQuarterPicker'
import { deleteJson, getJson, patchJson, postJson } from '@/lib/api'
import { snapWallToQuarterMinutes } from '@/lib/visitSchedule'
import {
  BlindsLineState,
  blindsLineToPayload,
  BlindsOrderOptions,
  BlindsTypesGrid,
  customerLabel,
  CustomerOpt,
  datetimeLocalToIso,
  EditDraft,
  fmtDisplayDateTime,
  fmtMoney,
  fmtTotalIncludingTax,
  hydrateBlindsLinesDefaults,
  installationWallFromIso,
  isReadyForInstallationStatus,
  newBlindsLineForType,
  normalizeBlindsLineFromApi,
  OrderAttachmentsBlock,
  OrderAttachmentRow,
  OrderDetail,
  OrderFinancialSecondRow,
  OrderStatusBadge,
  OrderStatusOpt,
  parseMoneyAmount,
  parseOptionalDecimal,
  parseTaxRatePercent,
  PaymentEntry,
  safeRound2,
  sanitizeLineAmountInput,
  sumBlindsLineAmounts,
  todayDateInput,
} from './ordersShared'

type EditAdditionOrder = {
  order_id: string
  created_at?: string | null
  status_order_label?: string | null
  blinds_lines: BlindsLineState[]
  downpayment: string
  tax_base: string
  agreement_date: string
  order_note: string
  final_payment: string | number | null | undefined
  balance: string | number | null | undefined
  tax_amount: string | number | null | undefined
  total_amount: string | number | null | undefined
}

function toEditAdditionOrder(ad: OrderDetail): EditAdditionOrder {
  return {
    order_id: ad.id,
    created_at: ad.created_at ?? null,
    status_order_label: ad.status_order_label ?? null,
    blinds_lines: ad.blinds_lines?.length
      ? ad.blinds_lines.map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>))
      : [],
    downpayment: ad.downpayment != null ? String(ad.downpayment) : '',
    tax_base: ad.tax_uygulanacak_miktar != null ? String(ad.tax_uygulanacak_miktar) : '',
    agreement_date: (ad.agreement_date ?? '').toString().trim().slice(0, 10),
    order_note: ad.order_note ?? '',
    final_payment: ad.final_payment,
    balance: ad.balance,
    tax_amount: ad.tax_amount,
    total_amount: ad.total_amount,
  }
}

export function OrderEditPage() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const me = useAuthSession()
  const canEdit = Boolean(me?.permissions.includes('orders.edit'))
  const canViewCompanies = Boolean(me?.permissions.includes('companies.view'))
  const sessionCompanyId = me?.active_company_id ?? me?.company_id ?? null

  const [err, setErr] = useState<string | null>(null)
  const [customers, setCustomers] = useState<CustomerOpt[] | null>(null)
  const [blindsOrderOptions, setBlindsOrderOptions] = useState<BlindsOrderOptions | null>(null)
  const [companyTaxRatePercent, setCompanyTaxRatePercent] = useState<number | null>(null)
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOpt[] | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [editCustomerId, setEditCustomerId] = useState('')
  const [editEstimateId, setEditEstimateId] = useState<string | null>(null)
  const [editBlindsLines, setEditBlindsLines] = useState<BlindsLineState[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editExtraPaid, setEditExtraPaid] = useState(0)
  const [editPaymentEntries, setEditPaymentEntries] = useState<PaymentEntry[]>([])
  const [editInstallationStart, setEditInstallationStart] = useState('')
  const [editAttachments, setEditAttachments] = useState<OrderAttachmentRow[]>([])
  const [editAdditionOrders, setEditAdditionOrders] = useState<EditAdditionOrder[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [paymentPending, setPaymentPending] = useState(false)
  const [deletePaymentEntryId, setDeletePaymentEntryId] = useState<string | null>(null)
  const [deletePaymentPending, setDeletePaymentPending] = useState(false)
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<{
    orderId: string
    id: string
  } | null>(null)
  const [deleteAttachmentPending, setDeleteAttachmentPending] = useState(false)
  const [lineItemAdditionOpen, setLineItemAdditionOpen] = useState(false)
  const [lineItemAdditionSaving, setLineItemAdditionSaving] = useState(false)
  const [additionBlindsLines, setAdditionBlindsLines] = useState<BlindsLineState[]>([])
  const [additionTaxBaseAmount, setAdditionTaxBaseAmount] = useState('')
  const [additionDownpayment, setAdditionDownpayment] = useState('')
  const [additionAgreementDate, setAdditionAgreementDate] = useState(() => todayDateInput())
  const [additionOrderNote, setAdditionOrderNote] = useState('')

  const blindsTypes = blindsOrderOptions?.blinds_types ?? null

  const editLineSubtotalParsed = useMemo(() => sumBlindsLineAmounts(editBlindsLines), [editBlindsLines])
  const editTaxBaseParsed = useMemo(
    () => (editDraft ? parseOptionalDecimal(editDraft.tax_base) : null),
    [editDraft],
  )
  const editDpParsed = useMemo(
    () => (editDraft ? parseOptionalDecimal(editDraft.downpayment) : null),
    [editDraft],
  )
  const editComputedTaxAmount = useMemo(() => {
    if (!editDraft || companyTaxRatePercent == null || editTaxBaseParsed == null) return null
    if (companyTaxRatePercent <= 0 || editTaxBaseParsed <= 0) return safeRound2(0)
    return safeRound2((editTaxBaseParsed * companyTaxRatePercent) / 100)
  }, [editDraft, companyTaxRatePercent, editTaxBaseParsed])
  const editTotalInclTax = useMemo(() => {
    if (!editDraft) return 0
    return safeRound2(editLineSubtotalParsed + (editComputedTaxAmount ?? 0))
  }, [editDraft, editLineSubtotalParsed, editComputedTaxAmount])
  const editPaidTotal = useMemo(() => {
    if (!editDraft) return 0
    return safeRound2((editDpParsed ?? 0) + editExtraPaid)
  }, [editDraft, editDpParsed, editExtraPaid])
  const editComputedBalance = useMemo(() => {
    if (!editDraft) return null
    return safeRound2(editTotalInclTax - editPaidTotal)
  }, [editDraft, editTotalInclTax, editPaidTotal])

  const editAdditionComputed = useMemo(() => {
    const pct = companyTaxRatePercent
    return editAdditionOrders.map((a) => {
      const sub = sumBlindsLineAmounts(a.blinds_lines)
      const tb = parseOptionalDecimal(a.tax_base)
      const dp = parseOptionalDecimal(a.downpayment)
      const tax =
        pct == null || tb == null ? null : pct <= 0 || tb <= 0 ? safeRound2(0) : safeRound2((tb * pct) / 100)
      const totalIncl = safeRound2(sub + (tax ?? 0))
      const paid = safeRound2(dp ?? 0) + safeRound2(parseMoneyAmount(a.final_payment) ?? 0)
      const balance = safeRound2(totalIncl - paid)
      return { order_id: a.order_id, sub, tb, dp, tax, totalIncl, paid, balance }
    })
  }, [editAdditionOrders, companyTaxRatePercent])

  const editRollupTotals = useMemo(() => {
    let sub = editLineSubtotalParsed
    let tb = safeRound2(editTaxBaseParsed ?? 0)
    let dp = safeRound2(editDpParsed ?? 0)
    let tax = safeRound2(editComputedTaxAmount ?? 0)
    let totalIncl = safeRound2(editTotalInclTax)
    let paid = safeRound2(editPaidTotal)
    let bal = safeRound2(editComputedBalance ?? 0)
    for (const x of editAdditionComputed) {
      sub = safeRound2(sub + x.sub)
      tb = safeRound2(tb + (x.tb ?? 0))
      dp = safeRound2(dp + (x.dp ?? 0))
      tax = safeRound2(tax + (x.tax ?? 0))
      totalIncl = safeRound2(totalIncl + x.totalIncl)
      paid = safeRound2(paid + x.paid)
      bal = safeRound2(bal + x.balance)
    }
    return { sub, tb, dp, tax, totalIncl, paid, bal }
  }, [
    editLineSubtotalParsed,
    editTaxBaseParsed,
    editDpParsed,
    editComputedTaxAmount,
    editTotalInclTax,
    editPaidTotal,
    editComputedBalance,
    editAdditionComputed,
  ])

  const editCustomerDisplay = useMemo(() => {
    const cid = editCustomerId.trim()
    if (!cid) return ''
    const c = (customers ?? []).find((x) => x.id === cid)
    return c ? customerLabel(c) : cid
  }, [editCustomerId, customers])

  const additionLineSubtotalParsed = useMemo(() => sumBlindsLineAmounts(additionBlindsLines), [additionBlindsLines])
  const additionTaxBaseParsed = useMemo(
    () => parseOptionalDecimal(additionTaxBaseAmount),
    [additionTaxBaseAmount],
  )
  const additionDpParsed = useMemo(() => parseOptionalDecimal(additionDownpayment), [additionDownpayment])
  const additionComputedTaxAmount = useMemo(() => {
    if (companyTaxRatePercent == null || additionTaxBaseParsed == null) return null
    if (companyTaxRatePercent <= 0 || additionTaxBaseParsed <= 0) return safeRound2(0)
    return safeRound2((additionTaxBaseParsed * companyTaxRatePercent) / 100)
  }, [companyTaxRatePercent, additionTaxBaseParsed])
  const additionComputedTotalInclTax = useMemo(
    () => safeRound2(additionLineSubtotalParsed + (additionComputedTaxAmount ?? 0)),
    [additionLineSubtotalParsed, additionComputedTaxAmount],
  )
  const additionComputedPaid = useMemo(() => safeRound2(additionDpParsed ?? 0), [additionDpParsed])
  const additionComputedBalance = useMemo(
    () => safeRound2(additionComputedTotalInclTax - additionComputedPaid),
    [additionComputedTotalInclTax, additionComputedPaid],
  )

  function applyOrderData(detail: OrderDetail, additions: OrderDetail[]) {
    setEditCustomerId(detail.customer_id)
    setEditEstimateId(detail.estimate_id)
    setEditBlindsLines(
      detail.blinds_lines?.length
        ? detail.blinds_lines.map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>))
        : [],
    )
    setEditDraft({
      downpayment: detail.downpayment != null ? String(detail.downpayment) : '',
      tax_base: detail.tax_uygulanacak_miktar != null ? String(detail.tax_uygulanacak_miktar) : '',
      agreement_date: (detail.agreement_date ?? '').toString().trim().slice(0, 10),
      order_note: detail.order_note ?? '',
      status_orde_id: detail.status_orde_id?.trim() ?? '',
      status_order_label_fallback: detail.status_order_label?.trim() ?? null,
    })
    setEditExtraPaid(safeRound2(parseMoneyAmount(detail.final_payment) ?? 0))
    setEditPaymentEntries(detail.payment_entries ?? [])
    setEditInstallationStart(installationWallFromIso(detail.installation_scheduled_start_at))
    setEditAttachments(detail.attachments ?? [])
    setEditAdditionOrders(
      additions
        .map(toEditAdditionOrder)
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),
    )
  }

  async function loadOrderPageData(showSpinner = true) {
    if (!orderId || !canEdit) return
    if (showSpinner) setEditLoading(true)
    try {
      const detail = await getJson<OrderDetail>(`/orders/${orderId}`)
      const addIds = (detail.line_item_additions ?? []).map((x) => x.order_id).filter(Boolean)
      const additions = addIds.length
        ? await Promise.all(addIds.map((id) => getJson<OrderDetail>(`/orders/${id}`)))
        : []
      applyOrderData(detail, additions)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load order')
      setEditDraft(null)
      setEditCustomerId('')
      setEditEstimateId(null)
      setEditBlindsLines([])
      setEditExtraPaid(0)
      setEditPaymentEntries([])
      setEditInstallationStart('')
      setEditAttachments([])
      setEditAdditionOrders([])
    } finally {
      if (showSpinner) setEditLoading(false)
    }
  }

  useEffect(() => {
    if (!me || !canEdit) return
    let cancelled = false
    ;(async () => {
      try {
        const [custList, opts, st] = await Promise.all([
          getJson<CustomerOpt[]>('/customers?limit=300'),
          getJson<BlindsOrderOptions>('/orders/lookup/blinds-order-options'),
          getJson<OrderStatusOpt[]>('/orders/lookup/order-statuses').catch(() => [] as OrderStatusOpt[]),
        ])
        if (!cancelled) {
          setCustomers(custList)
          setBlindsOrderOptions(opts)
          setOrderStatuses(st)
        }
      } catch {
        if (!cancelled) {
          setCustomers([])
          setBlindsOrderOptions(null)
          setOrderStatuses([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canEdit])

  useEffect(() => {
    if (!me || !canViewCompanies || !sessionCompanyId) {
      setCompanyTaxRatePercent(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const co = await getJson<{ tax_rate_percent?: string | number | null }>(`/companies/${sessionCompanyId}`)
        if (!cancelled) setCompanyTaxRatePercent(parseTaxRatePercent(co.tax_rate_percent))
      } catch {
        if (!cancelled) setCompanyTaxRatePercent(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me, canViewCompanies, sessionCompanyId])

  useEffect(() => {
    if (!blindsOrderOptions) return
    setEditBlindsLines((prev) => hydrateBlindsLinesDefaults(prev, blindsOrderOptions))
    setAdditionBlindsLines((prev) => hydrateBlindsLinesDefaults(prev, blindsOrderOptions))
    setEditAdditionOrders((prev) =>
      prev.map((a) => ({ ...a, blinds_lines: hydrateBlindsLinesDefaults(a.blinds_lines, blindsOrderOptions) })),
    )
  }, [blindsOrderOptions])

  useEffect(() => {
    void loadOrderPageData()
  }, [orderId, canEdit])

  function resetLineItemAdditionForm() {
    setAdditionTaxBaseAmount('')
    setAdditionDownpayment('')
    setAdditionAgreementDate(todayDateInput())
    setAdditionOrderNote('')
    const first = (blindsTypes ?? [])[0]
    setAdditionBlindsLines(
      first && blindsOrderOptions ? [newBlindsLineForType(first.id, first.name, blindsOrderOptions)] : [],
    )
  }

  function openLineItemAddition() {
    resetLineItemAdditionForm()
    setLineItemAdditionOpen(true)
  }

  function additionToggleBlinds(id: string) {
    setAdditionBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = (blindsTypes ?? []).find((x) => x.id === id)
      return [...prev, newBlindsLineForType(id, bt?.name ?? id, blindsOrderOptions)]
    })
  }

  function additionSetBlindsCount(id: string, value: string) {
    const t = value.trim()
    if (t === '') {
      setAdditionBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: null } : x)))
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setAdditionBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)))
  }

  function additionSetBlindsLineField(id: string, jsonKey: string, value: string) {
    const next = value.trim() ? value.trim().toLowerCase() : null
    setAdditionBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, [jsonKey]: next } : x)))
  }

  function additionSetBlindsLineNote(id: string, value: string) {
    setAdditionBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function additionSetBlindsLineAmount(id: string, value: string) {
    const next = sanitizeLineAmountInput(value)
    setAdditionBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
  }

  function editToggleBlinds(id: string) {
    setEditBlindsLines((prev) => {
      const exists = prev.some((x) => x.id === id)
      if (exists) return prev.filter((x) => x.id !== id)
      const bt = (blindsTypes ?? []).find((x) => x.id === id)
      return [...prev, newBlindsLineForType(id, bt?.name ?? id, blindsOrderOptions)]
    })
  }

  function editSetBlindsCount(id: string, value: string) {
    const t = value.trim()
    if (t === '') {
      setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: null } : x)))
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)))
  }

  function editSetBlindsLineField(id: string, jsonKey: string, value: string) {
    const next = value.trim() ? value.trim().toLowerCase() : null
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, [jsonKey]: next } : x)))
  }

  function editSetBlindsLineNote(id: string, value: string) {
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_note: value } : x)))
  }

  function editSetBlindsLineAmount(id: string, value: string) {
    const next = sanitizeLineAmountInput(value)
    setEditBlindsLines((prev) => prev.map((x) => (x.id === id ? { ...x, line_amount: next } : x)))
  }

  function editAdditionUpdate(targetOrderId: string, patch: Partial<EditAdditionOrder>) {
    setEditAdditionOrders((prev) => prev.map((x) => (x.order_id === targetOrderId ? { ...x, ...patch } : x)))
  }

  function editAdditionToggleBlinds(targetOrderId: string, id: string) {
    setEditAdditionOrders((prev) =>
      prev.map((a) => {
        if (a.order_id !== targetOrderId) return a
        const exists = a.blinds_lines.some((x) => x.id === id)
        if (exists) return { ...a, blinds_lines: a.blinds_lines.filter((x) => x.id !== id) }
        const bt = (blindsTypes ?? []).find((x) => x.id === id)
        return {
          ...a,
          blinds_lines: [...a.blinds_lines, newBlindsLineForType(id, bt?.name ?? id, blindsOrderOptions)],
        }
      }),
    )
  }

  function editAdditionSetBlindsCount(targetOrderId: string, id: string, value: string) {
    const t = value.trim()
    if (t === '') {
      setEditAdditionOrders((prev) =>
        prev.map((a) =>
          a.order_id === targetOrderId
            ? { ...a, blinds_lines: a.blinds_lines.map((x) => (x.id === id ? { ...x, window_count: null } : x)) }
            : a,
        ),
      )
      return
    }
    const n = Number.parseInt(t, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.min(99, Math.max(1, n))
    setEditAdditionOrders((prev) =>
      prev.map((a) =>
        a.order_id === targetOrderId
          ? { ...a, blinds_lines: a.blinds_lines.map((x) => (x.id === id ? { ...x, window_count: clamped } : x)) }
          : a,
      ),
    )
  }

  function editAdditionSetBlindsLineField(targetOrderId: string, id: string, jsonKey: string, value: string) {
    const next = value.trim() ? value.trim().toLowerCase() : null
    setEditAdditionOrders((prev) =>
      prev.map((a) =>
        a.order_id === targetOrderId
          ? { ...a, blinds_lines: a.blinds_lines.map((x) => (x.id === id ? { ...x, [jsonKey]: next } : x)) }
          : a,
      ),
    )
  }

  function editAdditionSetBlindsLineNote(targetOrderId: string, id: string, value: string) {
    setEditAdditionOrders((prev) =>
      prev.map((a) =>
        a.order_id === targetOrderId
          ? { ...a, blinds_lines: a.blinds_lines.map((x) => (x.id === id ? { ...x, line_note: value } : x)) }
          : a,
      ),
    )
  }

  function editAdditionSetBlindsLineAmount(targetOrderId: string, id: string, value: string) {
    const next = sanitizeLineAmountInput(value)
    setEditAdditionOrders((prev) =>
      prev.map((a) =>
        a.order_id === targetOrderId
          ? { ...a, blinds_lines: a.blinds_lines.map((x) => (x.id === id ? { ...x, line_amount: next } : x)) }
          : a,
      ),
    )
  }

  async function saveOrderEdit() {
    if (!orderId || !editDraft || !canEdit) return
    if (!editDraft.status_orde_id.trim()) {
      setErr('Select an order status.')
      return
    }
    if (editBlindsLines.length === 0) {
      setErr('Choose at least one blinds type.')
      return
    }
    if (!editEstimateId && !editCustomerId.trim()) {
      setErr('Select a customer.')
      return
    }
    const stSel = editDraft.status_orde_id.trim()
    setEditSaving(true)
    setErr(null)
    try {
      for (const a of editAdditionOrders) {
        await patchJson(`/orders/${a.order_id}`, {
          downpayment: parseOptionalDecimal(a.downpayment),
          tax_uygulanacak_miktar: parseOptionalDecimal(a.tax_base),
          agreement_date: a.agreement_date.trim() || null,
          order_note: (() => {
            const n = a.order_note.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
            return n ? n.slice(0, 4000) : null
          })(),
          blinds_lines: a.blinds_lines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
        })
      }

      const body: Record<string, unknown> = {
        ...(editEstimateId ? {} : { customer_id: editCustomerId.trim() }),
        downpayment: parseOptionalDecimal(editDraft.downpayment),
        tax_uygulanacak_miktar: parseOptionalDecimal(editDraft.tax_base),
        agreement_date: editDraft.agreement_date.trim() || null,
        order_note: (() => {
          const n = editDraft.order_note.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
          return n ? n.slice(0, 4000) : null
        })(),
        status_orde_id: stSel,
        blinds_lines: editBlindsLines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
      }
      if (isReadyForInstallationStatus(stSel, orderStatuses ?? [])) {
        const startIso = datetimeLocalToIso(editInstallationStart)
        if (startIso) body.installation_scheduled_start_at = startIso
        body.installation_scheduled_end_at = null
      }
      await patchJson(`/orders/${orderId}`, body)
      navigate(`/orders/${orderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save order')
    } finally {
      setEditSaving(false)
    }
  }

  async function submitLineItemAddition(e: FormEvent) {
    e.preventDefault()
    if (!orderId || !canEdit) return
    if (additionBlindsLines.length === 0) {
      setErr('Choose at least one blinds type for the addition.')
      return
    }
    setLineItemAdditionSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        blinds_lines: additionBlindsLines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
      }
      if (additionTaxBaseParsed !== null) body.tax_uygulanacak_miktar = additionTaxBaseParsed
      if (additionDpParsed !== null) body.downpayment = additionDpParsed
      if (additionAgreementDate.trim()) body.agreement_date = additionAgreementDate.trim()
      const note = additionOrderNote.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
      if (note) body.order_note = note.slice(0, 4000)
      await postJson(`/orders/${orderId}/line-item-additions`, body)
      setLineItemAdditionOpen(false)
      resetLineItemAdditionForm()
      await loadOrderPageData(false)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not add line items')
    } finally {
      setLineItemAdditionSaving(false)
    }
  }

  async function submitRecordPayment() {
    if (!orderId || !canEdit) return
    const amt = parseOptionalDecimal(paymentAmountInput.trim())
    if (amt == null || amt <= 0) {
      setErr('Enter a valid payment amount.')
      return
    }
    setPaymentPending(true)
    setErr(null)
    try {
      await postJson<OrderDetail>(`/orders/${orderId}/record-payment`, { amount: amt })
      setPaymentModalOpen(false)
      setPaymentAmountInput('')
      await loadOrderPageData(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setPaymentPending(false)
    }
  }

  async function runDeletePaymentEntry() {
    if (!orderId || !deletePaymentEntryId || !canEdit) return
    setDeletePaymentPending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${orderId}/payment-entries/${deletePaymentEntryId}`)
      setDeletePaymentEntryId(null)
      await loadOrderPageData(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove payment')
    } finally {
      setDeletePaymentPending(false)
    }
  }

  async function runDeleteAttachment() {
    if (!deleteAttachmentTarget || !canEdit) return
    setDeleteAttachmentPending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${deleteAttachmentTarget.orderId}/attachments/${deleteAttachmentTarget.id}`)
      setDeleteAttachmentTarget(null)
      await loadOrderPageData(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove attachment')
    } finally {
      setDeleteAttachmentPending(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading...</p>

  if (!canEdit) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <p className="text-sm text-slate-600">You do not have permission to edit orders.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <ConfirmModal
        open={deletePaymentEntryId !== null}
        title="Remove this payment?"
        description="This payment line will be removed and the order balance will be recalculated. You cannot restore it from the app."
        confirmLabel="Remove payment"
        cancelLabel="Cancel"
        variant="danger"
        pending={deletePaymentPending}
        onConfirm={() => void runDeletePaymentEntry()}
        onCancel={() => !deletePaymentPending && setDeletePaymentEntryId(null)}
      />

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

      {paymentModalOpen && orderId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (!paymentPending && e.target === e.currentTarget) {
              setPaymentModalOpen(false)
              setPaymentAmountInput('')
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-edit-payment-modal-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="order-edit-payment-modal-title" className="text-lg font-semibold text-slate-900">
              Record payment
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Enter the amount to record. It cannot exceed the current balance due.
            </p>
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Amount</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
                placeholder="0.00"
                disabled={paymentPending}
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={paymentPending}
                onClick={() => {
                  setPaymentModalOpen(false)
                  setPaymentAmountInput('')
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paymentPending}
                onClick={() => void submitRecordPayment()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paymentPending ? 'Saving...' : 'Pay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lineItemAdditionOpen && orderId ? (
        <div
          className="fixed inset-0 z-[101] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(e) => {
            if (!lineItemAdditionSaving && e.target === e.currentTarget) {
              setLineItemAdditionOpen(false)
            }
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="line-item-addition-title"
            className="my-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => void submitLineItemAddition(e)}
          >
            <h2 id="line-item-addition-title" className="text-lg font-semibold text-slate-900">
              Line-item addition
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Adds a linked order for more blinds on the same job. Tax uses your company&apos;s current rate.
            </p>
            <fieldset className="mt-4 min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Blinds types &amp; quantities
              </legend>
              <BlindsTypesGrid
                blindsTypes={blindsTypes ?? []}
                blindsOrderOptions={blindsOrderOptions}
                lines={additionBlindsLines}
                toggleType={additionToggleBlinds}
                setCount={additionSetBlindsCount}
                setLineField={additionSetBlindsLineField}
                setLineNote={additionSetBlindsLineNote}
                setLineAmount={additionSetBlindsLineAmount}
              />
              {additionBlindsLines.length === 0 ? (
                <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
              ) : null}
            </fieldset>
            <label className="mt-4 block w-full text-sm text-slate-700">
              <span className="mb-1 block font-medium">Order note</span>
              <textarea
                value={additionOrderNote}
                onChange={(e) => setAdditionOrderNote(e.target.value)}
                rows={2}
                maxLength={4000}
                placeholder="Optional note for this addition..."
                className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Total (incl. tax)</span>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                    {fmtTotalIncludingTax(additionLineSubtotalParsed, additionComputedTaxAmount)}
                  </p>
                </div>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Down payment</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={additionDownpayment}
                    onChange={(e) => setAdditionDownpayment(e.target.value)}
                    placeholder="0.00"
                    disabled={lineItemAdditionSaving}
                  />
                </label>
                <label className="block min-w-0 text-sm text-slate-700">
                  <span className="mb-1 block font-medium">Taxable base</span>
                  <input
                    inputMode="decimal"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    value={additionTaxBaseAmount}
                    onChange={(e) => setAdditionTaxBaseAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={lineItemAdditionSaving}
                  />
                </label>
              </div>
              <OrderFinancialSecondRow
                paidDisplay={fmtMoney(additionComputedPaid)}
                balance={additionComputedBalance}
                tax={additionComputedTaxAmount}
              />
            </div>
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Agreement date (optional)</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={additionAgreementDate}
                onChange={(e) => setAdditionAgreementDate(e.target.value)}
                disabled={lineItemAdditionSaving}
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={lineItemAdditionSaving}
                onClick={() => setLineItemAdditionOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={lineItemAdditionSaving || additionBlindsLines.length === 0}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {lineItemAdditionSaving ? 'Saving...' : 'Save addition'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <Link to={orderId ? `/orders/${orderId}` : '/orders'} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to order
      </Link>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}

      {editLoading || !editDraft ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault()
            void saveOrderEdit()
          }}
        >
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-teal-50/90 via-white to-white px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <FolderKanban className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight text-slate-900">Edit Order</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <OrderStatusBadge label={editDraft.status_order_label_fallback ?? 'Current status'} />
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{editCustomerDisplay || editCustomerId}</div>
                  <div className="mt-3 text-xs font-semibold text-slate-500">Order ID</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold text-slate-700">{orderId}</div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</div>
                      <div className="mt-2">
                        <select
                          required
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                          value={editDraft.status_orde_id}
                          onChange={(e) =>
                            setEditDraft((d) => (d ? { ...d, status_orde_id: e.target.value } : d))
                          }
                        >
                          <option value="">Select status...</option>
                          {editDraft.status_orde_id &&
                          !(orderStatuses ?? []).some((s) => s.id === editDraft.status_orde_id) ? (
                            <option value={editDraft.status_orde_id}>
                              {editDraft.status_order_label_fallback ?? 'Current status'} (not in active list)
                            </option>
                          ) : null}
                          {(orderStatuses ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Installation date-time
                      </div>
                      <div className="mt-2">
                        <VisitStartQuarterPicker
                          value={
                            editInstallationStart.trim()
                              ? snapWallToQuarterMinutes(editInstallationStart)
                              : snapWallToQuarterMinutes('')
                          }
                          onChange={(w) => setEditInstallationStart(w)}
                          disabled={!isReadyForInstallationStatus(editDraft.status_orde_id, orderStatuses ?? [])}
                          compact
                        />
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">
                        Editable only when status is Ready for installation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-5 sm:px-6">
              <div className="space-y-5 text-sm text-slate-800">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Job totals</h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Includes the original order + all additional orders.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="block min-w-0 text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Total (incl. tax)</span>
                      <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                        {fmtMoney(editRollupTotals.totalIncl)}
                      </p>
                    </div>
                    <div className="block min-w-0 text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Down payment</span>
                      <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                        {fmtMoney(editRollupTotals.dp)}
                      </p>
                    </div>
                    <div className="block min-w-0 text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Taxable base</span>
                      <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                        {fmtMoney(editRollupTotals.tb)}
                      </p>
                    </div>
                  </div>
                  <OrderFinancialSecondRow
                    paidDisplay={fmtMoney(editRollupTotals.paid)}
                    balance={editRollupTotals.bal}
                    tax={editRollupTotals.tax}
                    belowBalance={
                      canEdit ? (
                        <button
                          type="button"
                          className="w-full rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50"
                          onClick={() => {
                            setPaymentAmountInput('')
                            setPaymentModalOpen(true)
                          }}
                        >
                          Payment
                        </button>
                      ) : undefined
                    }
                  />
                </div>

                {editPaymentEntries.length > 0 ? (
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Recorded payments
                    </h3>
                    <ul className="mt-2 divide-y divide-slate-100">
                      {editPaymentEntries.map((p) => (
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
                            {canEdit && p.id !== 'downpayment' ? (
                              <button
                                type="button"
                                title="Remove payment"
                                className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                                onClick={() => setDeletePaymentEntryId(p.id)}
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={2} />
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {editEstimateId ? (
                  <p className="rounded-lg border border-teal-100 bg-teal-50/80 px-3 py-2 text-xs text-teal-900">
                    Linked to estimate{' '}
                    <Link className="font-semibold text-slate-950 underline hover:text-slate-900" to={`/estimates/${editEstimateId}`}>
                      {editEstimateId}
                    </Link>
                    . Customer matches the estimate and cannot be changed here.
                  </p>
                ) : null}

                <details className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm" open>
                  <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">
                    Original order
                  </summary>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Blinds types &amp; quantities
                      </legend>
                      <BlindsTypesGrid
                        blindsTypes={blindsTypes ?? []}
                        blindsOrderOptions={blindsOrderOptions}
                        lines={editBlindsLines}
                        toggleType={editToggleBlinds}
                        setCount={editSetBlindsCount}
                        setLineField={editSetBlindsLineField}
                        setLineNote={editSetBlindsLineNote}
                        setLineAmount={editSetBlindsLineAmount}
                        keyPrefix="edit"
                      />
                      {editBlindsLines.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
                      ) : null}
                    </fieldset>

                    <label className="block w-full min-w-0 text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Order note</span>
                      <textarea
                        value={editDraft.order_note}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, order_note: e.target.value } : d))}
                        rows={2}
                        maxLength={4000}
                        placeholder="Optional note for this order..."
                        className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                      />
                    </label>

                    <div className="space-y-3 sm:col-span-2">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="block min-w-0 text-sm text-slate-700">
                          <span className="mb-1 block font-medium">Total (incl. tax)</span>
                          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                            {fmtTotalIncludingTax(editLineSubtotalParsed, editComputedTaxAmount)}
                          </p>
                        </div>
                        <label className="block min-w-0 text-sm text-slate-700">
                          <span className="mb-1 block font-medium">Down payment</span>
                          <input
                            inputMode="decimal"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                            value={editDraft.downpayment}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, downpayment: e.target.value } : d))}
                            placeholder="0.00"
                          />
                        </label>
                        <label className="block min-w-0 text-sm text-slate-700">
                          <span className="mb-1 block font-medium">Taxable base</span>
                          <input
                            inputMode="decimal"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                            value={editDraft.tax_base}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, tax_base: e.target.value } : d))}
                            placeholder="0.00"
                          />
                        </label>
                      </div>
                      <OrderFinancialSecondRow
                        paidDisplay={fmtMoney(editPaidTotal)}
                        balance={editComputedBalance}
                        tax={editComputedTaxAmount}
                      />
                    </div>

                    <label className="block text-sm text-slate-700 sm:col-span-2">
                      <span className="mb-1 block font-medium">Agreement date (optional)</span>
                      <input
                        type="date"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                        value={editDraft.agreement_date}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, agreement_date: e.target.value } : d))}
                      />
                    </label>

                    <div className="sm:col-span-2">
                      <OrderAttachmentsBlock
                        blockId="edit-order-att"
                        orderId={orderId ?? null}
                        serverFiles={editAttachments}
                        pendingFiles={[]}
                        onPendingChange={() => {}}
                        canEdit={canEdit}
                        uploadBusy={attachmentUploadBusy || editSaving}
                        setUploadBusy={setAttachmentUploadBusy}
                        onAfterServerMutation={async () => {
                          await loadOrderPageData(false)
                        }}
                        setErr={setErr}
                        onRequestDeleteAttachment={(id) => orderId && setDeleteAttachmentTarget({ orderId, id })}
                      />
                    </div>
                  </div>
                </details>

                <div className="space-y-3">
                  {editAdditionOrders.length
                    ? editAdditionOrders.map((a, idx) => {
                        const comp = editAdditionComputed.find((x) => x.order_id === a.order_id)
                        return (
                          <details key={a.order_id} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
                            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-900">
                              Additional order #{idx + 1}{' '}
                              <span className="ml-2 font-mono text-xs font-medium text-slate-400">{a.order_id}</span>
                            </summary>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
                                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Blinds types &amp; quantities
                                </legend>
                                <BlindsTypesGrid
                                  blindsTypes={blindsTypes ?? []}
                                  blindsOrderOptions={blindsOrderOptions}
                                  lines={a.blinds_lines}
                                  toggleType={(id) => editAdditionToggleBlinds(a.order_id, id)}
                                  setCount={(id, v) => editAdditionSetBlindsCount(a.order_id, id, v)}
                                  setLineField={(id, key, v) => editAdditionSetBlindsLineField(a.order_id, id, key, v)}
                                  setLineNote={(id, v) => editAdditionSetBlindsLineNote(a.order_id, id, v)}
                                  setLineAmount={(id, v) => editAdditionSetBlindsLineAmount(a.order_id, id, v)}
                                  keyPrefix={`edit-add-${a.order_id}`}
                                />
                                {a.blinds_lines.length === 0 ? (
                                  <p className="mt-2 text-xs text-amber-700">Choose at least one blinds type.</p>
                                ) : null}
                              </fieldset>

                              <label className="block w-full min-w-0 text-sm text-slate-700 sm:col-span-2">
                                <span className="mb-1 block font-medium">Order note</span>
                                <textarea
                                  value={a.order_note}
                                  onChange={(e) => editAdditionUpdate(a.order_id, { order_note: e.target.value })}
                                  rows={2}
                                  maxLength={4000}
                                  placeholder="Optional note for this additional order..."
                                  className="w-full whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                                />
                              </label>

                              <div className="space-y-3 sm:col-span-2">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <div className="block min-w-0 text-sm text-slate-700">
                                    <span className="mb-1 block font-medium">Total (incl. tax)</span>
                                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
                                      {fmtMoney(comp?.totalIncl ?? 0)}
                                    </p>
                                  </div>
                                  <label className="block min-w-0 text-sm text-slate-700">
                                    <span className="mb-1 block font-medium">Down payment</span>
                                    <input
                                      inputMode="decimal"
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                                      value={a.downpayment}
                                      onChange={(e) => editAdditionUpdate(a.order_id, { downpayment: e.target.value })}
                                      placeholder="0.00"
                                    />
                                  </label>
                                  <label className="block min-w-0 text-sm text-slate-700">
                                    <span className="mb-1 block font-medium">Taxable base</span>
                                    <input
                                      inputMode="decimal"
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                                      value={a.tax_base}
                                      onChange={(e) => editAdditionUpdate(a.order_id, { tax_base: e.target.value })}
                                      placeholder="0.00"
                                    />
                                  </label>
                                </div>
                                <OrderFinancialSecondRow
                                  paidDisplay={fmtMoney(comp?.paid ?? 0)}
                                  balance={comp?.balance ?? 0}
                                  tax={comp?.tax ?? 0}
                                />
                              </div>

                              <label className="block text-sm text-slate-700 sm:col-span-2">
                                <span className="mb-1 block font-medium">Agreement date (optional)</span>
                                <input
                                  type="date"
                                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                                  value={a.agreement_date}
                                  onChange={(e) => editAdditionUpdate(a.order_id, { agreement_date: e.target.value })}
                                />
                              </label>
                            </div>
                          </details>
                        )
                      })
                    : null}

                  <button
                    type="button"
                    disabled={!canEdit || editSaving || !orderId}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:opacity-50"
                    onClick={() => openLineItemAddition()}
                    title="Add additional order"
                  >
                    + Additional order
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={editSaving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => navigate(orderId ? `/orders/${orderId}` : '/orders')}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                editSaving ||
                !editDraft.status_orde_id.trim() ||
                editBlindsLines.length === 0 ||
                (!editEstimateId && !editCustomerId.trim())
              }
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {editSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
