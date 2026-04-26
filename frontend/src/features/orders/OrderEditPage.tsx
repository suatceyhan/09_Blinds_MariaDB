import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, FolderKanban, Trash2, Upload } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { VisitStartQuarterPicker } from '@/components/ui/VisitStartQuarterPicker'
import { deleteJson, getJson, patchJson, postJson, postMultipartJson } from '@/lib/api'
import { resizePhotoForUpload } from '@/lib/imageResize'
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
  formatMoneyInputValue,
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
  orderStatusWorkflowBucketFromName,
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

const PENDING_ADDITION_PREFIX = 'pending:'

function isPendingAdditionOrderId(orderId: string): boolean {
  return orderId.startsWith(PENDING_ADDITION_PREFIX)
}

function newPendingAdditionOrderId(): string {
  return `${PENDING_ADDITION_PREFIX}${crypto.randomUUID()}`
}

function buildLineItemAdditionPostBody(
  a: EditAdditionOrder,
  blindsOrderOptions: BlindsOrderOptions | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    blinds_lines: a.blinds_lines.map((b) => blindsLineToPayload(b, blindsOrderOptions)),
  }
  const tb = parseOptionalDecimal(a.tax_base)
  const dp = parseOptionalDecimal(a.downpayment)
  if (tb !== null) body.tax_uygulanacak_miktar = tb
  if (dp !== null) body.downpayment = dp
  if (a.agreement_date.trim()) body.agreement_date = a.agreement_date.trim()
  const note = a.order_note.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (note) body.order_note = note.slice(0, 4000)
  return body
}

function createPendingEditAdditionOrder(): EditAdditionOrder {
  const blinds_lines: BlindsLineState[] = []
  return {
    order_id: newPendingAdditionOrderId(),
    created_at: new Date().toISOString(),
    status_order_label: null,
    blinds_lines,
    downpayment: '',
    tax_base: '',
    agreement_date: todayDateInput(),
    order_note: '',
    final_payment: null,
    balance: null,
    tax_amount: null,
    total_amount: null,
  }
}

/** Expand draft additional orders once on mount without controlling `open` (avoids React/detail quirks). */
function AdditionalOrderDetails(props: {
  orderId: string
  className: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const didExpandDraft = useRef(false)
  useLayoutEffect(() => {
    if (!isPendingAdditionOrderId(props.orderId)) return
    if (didExpandDraft.current) return
    didExpandDraft.current = true
    const el = ref.current
    if (el) el.open = true
  }, [props.orderId])

  return (
    <details ref={ref} className={props.className}>
      {props.children}
    </details>
  )
}

/** Snapshot for dirty check + revert on Cancel (structuredClone-safe). */
type OrderEditBaseline = {
  editCustomerId: string
  editEstimateId: string | null
  editBlindsLines: BlindsLineState[]
  editDraft: EditDraft
  editExtraPaid: number
  editPaymentEntries: PaymentEntry[]
  editInstallationStart: string
  editAttachments: OrderAttachmentRow[]
  editAdditionOrders: EditAdditionOrder[]
}

function toEditAdditionOrder(ad: OrderDetail): EditAdditionOrder {
  return {
    order_id: ad.id,
    created_at: ad.created_at ?? null,
    status_order_label: ad.status_order_label ?? null,
    blinds_lines: ad.blinds_lines?.length
      ? ad.blinds_lines.map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>))
      : [],
    downpayment: ad.downpayment != null ? formatMoneyInputValue(String(ad.downpayment)) : '',
    tax_base: ad.tax_uygulanacak_miktar != null ? formatMoneyInputValue(String(ad.tax_uygulanacak_miktar)) : '',
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
  const location = useLocation()
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
  const [editExpenseTotal, setEditExpenseTotal] = useState(0)
  const [editProfit, setEditProfit] = useState(0)
  const [editExpenseEntries, setEditExpenseEntries] = useState<
    Array<{ id: string; amount: string | number; note?: string | null }>
  >([])
  const [editInstallationStart, setEditInstallationStart] = useState('')
  const [editAttachments, setEditAttachments] = useState<OrderAttachmentRow[]>([])
  const [editLinePhotosByOrder, setEditLinePhotosByOrder] = useState<
    Record<string, Record<string, OrderAttachmentRow[]>>
  >({})
  const [editAdditionOrders, setEditAdditionOrders] = useState<EditAdditionOrder[]>([])
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [doneGateOpen, setDoneGateOpen] = useState(false)
  const [doneGateNextStatusId, setDoneGateNextStatusId] = useState<string | null>(null)
  const [paidMustBeDoneOpen, setPaidMustBeDoneOpen] = useState(false)
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [paymentPending, setPaymentPending] = useState(false)
  const [paymentErr, setPaymentErr] = useState<string | null>(null)
  const [autoOpenInstallation, setAutoOpenInstallation] = useState(false)
  const [pendingPrefillStatusId, setPendingPrefillStatusId] = useState<string | null>(null)
  const [pendingOpenInstallation, setPendingOpenInstallation] = useState(false)
  const pendingPrefillStatusIdRef = useRef<string | null>(null)
  const pendingOpenInstallationRef = useRef<boolean>(false)
  const paymentAmountRef = useRef<HTMLInputElement | null>(null)
  const [paymentPickIds, setPaymentPickIds] = useState<string[]>([])
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [expenseAmountInput, setExpenseAmountInput] = useState('')
  const [expenseNoteInput, setExpenseNoteInput] = useState('')
  const [expensePending, setExpensePending] = useState(false)
  const [expenseErr, setExpenseErr] = useState<string | null>(null)
  const expenseAmountRef = useRef<HTMLInputElement | null>(null)
  const [productionCostPromptOpen, setProductionCostPromptOpen] = useState(false)
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState<{ orderId: string; expenseId: string } | null>(null)
  const [deleteExpensePending, setDeleteExpensePending] = useState(false)
  const [deletePaymentEntryTarget, setDeletePaymentEntryTarget] = useState<{ orderId: string; entryId: string } | null>(
    null,
  )
  const [deletePaymentPending, setDeletePaymentPending] = useState(false)
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<{
    orderId: string
    id: string
  } | null>(null)
  const [deleteAttachmentPending, setDeleteAttachmentPending] = useState(false)
  const [orderFormBaseline, setOrderFormBaseline] = useState<OrderEditBaseline | null>(null)

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

  const jobBalanceDue = useMemo(() => Math.max(0, safeRound2(editRollupTotals.bal ?? 0)), [editRollupTotals.bal])

  const doneStatusId = useMemo(() => {
    const done = (orderStatuses ?? []).find((s) => orderStatusWorkflowBucketFromName((s.name ?? '').trim()) === 'done')
    return done?.id ?? null
  }, [orderStatuses])

  const editCustomerDisplay = useMemo(() => {
    const cid = editCustomerId.trim()
    if (!cid) return ''
    const c = (customers ?? []).find((x) => x.id === cid)
    return c ? customerLabel(c) : cid
  }, [editCustomerId, customers])

  const buildOrderEditBaseline = useCallback((): OrderEditBaseline | null => {
    if (!editDraft) return null
    return {
      editCustomerId,
      editEstimateId,
      editBlindsLines: structuredClone(editBlindsLines),
      editDraft: structuredClone(editDraft),
      editExtraPaid,
      editPaymentEntries: structuredClone(editPaymentEntries),
      editInstallationStart,
      editAttachments: structuredClone(editAttachments),
      editAdditionOrders: structuredClone(editAdditionOrders),
    }
  }, [
    editCustomerId,
    editEstimateId,
    editBlindsLines,
    editDraft,
    editExtraPaid,
    editPaymentEntries,
    editInstallationStart,
    editAttachments,
    editAdditionOrders,
  ])

  const isOrderDirty = useMemo(() => {
    const cur = buildOrderEditBaseline()
    if (!cur || !orderFormBaseline) return false
    return JSON.stringify(cur) !== JSON.stringify(orderFormBaseline)
  }, [buildOrderEditBaseline, orderFormBaseline])

  const latestOrderBaselineRef = useRef<OrderEditBaseline | null>(null)
  latestOrderBaselineRef.current = buildOrderEditBaseline()

  const scheduleOrderFormBaselineCapture = useCallback(() => {
    window.setTimeout(() => {
      const snap = latestOrderBaselineRef.current
      if (snap) setOrderFormBaseline(snap)
    }, 150)
  }, [])

  function revertOrderForm() {
    if (!orderFormBaseline) return
    const b = orderFormBaseline
    setEditCustomerId(b.editCustomerId)
    setEditEstimateId(b.editEstimateId)
    setEditBlindsLines(structuredClone(b.editBlindsLines))
    setEditDraft(structuredClone(b.editDraft))
    setEditExtraPaid(b.editExtraPaid)
    setEditPaymentEntries(structuredClone(b.editPaymentEntries))
    setEditInstallationStart(b.editInstallationStart)
    setEditAttachments(structuredClone(b.editAttachments))
    setEditAdditionOrders(structuredClone(b.editAdditionOrders))
    setErr(null)
  }

  function applyOrderData(detail: OrderDetail, additions: OrderDetail[]) {
    setEditCustomerId(detail.customer_id)
    setEditEstimateId(detail.estimate_id)
    setEditBlindsLines(
      detail.blinds_lines?.length
        ? detail.blinds_lines.map((x) => normalizeBlindsLineFromApi(x as Record<string, unknown>))
        : [],
    )
    const nextDraft: EditDraft = {
      downpayment: detail.downpayment != null ? formatMoneyInputValue(String(detail.downpayment)) : '',
      tax_base: detail.tax_uygulanacak_miktar != null ? formatMoneyInputValue(String(detail.tax_uygulanacak_miktar)) : '',
      agreement_date: (detail.agreement_date ?? '').toString().trim().slice(0, 10),
      order_note: detail.order_note ?? '',
      status_orde_id: detail.status_orde_id?.trim() ?? '',
      status_order_label_fallback: detail.status_order_label?.trim() ?? null,
    }
    const pre = pendingPrefillStatusIdRef.current ?? pendingPrefillStatusId
    const openInst = pendingOpenInstallationRef.current || pendingOpenInstallation
    if (pre) {
      nextDraft.status_orde_id = pre
      // Do not clear here: in React StrictMode, load effects can run twice and re-apply API status.
      // We'll clear when the user manually changes status.
    }
    if (openInst) {
      setAutoOpenInstallation(true)
      pendingOpenInstallationRef.current = false
      setPendingOpenInstallation(false)
    }
    setEditDraft(nextDraft)
    setEditExtraPaid(safeRound2(parseMoneyAmount(detail.final_payment) ?? 0))
    setEditPaymentEntries(detail.payment_entries ?? [])
    setEditExpenseTotal(safeRound2(parseMoneyAmount(detail.expense_total) ?? 0))
    setEditProfit(safeRound2(parseMoneyAmount(detail.profit) ?? 0))
    setEditExpenseEntries(
      (detail.expense_entries ?? []).map((e) => ({
        id: e.id,
        amount: e.amount,
        note: e.note ?? null,
      })),
    )
    setEditInstallationStart(installationWallFromIso(detail.installation_scheduled_start_at))
    setEditAttachments(detail.attachments ?? [])
    const linePhotoNext: Record<string, Record<string, OrderAttachmentRow[]>> = {}
    if (detail.id) linePhotoNext[detail.id] = detail.line_photos ?? {}
    for (const ad of additions) {
      if (ad?.id) linePhotoNext[ad.id] = ad.line_photos ?? {}
    }
    setEditLinePhotosByOrder(linePhotoNext)
    setEditAdditionOrders(
      additions
        .map(toEditAdditionOrder)
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),
    )
  }

  // Handle deep link from Orders list: preselect status + open installation picker.
  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const pre = (sp.get('prefillStatus') ?? '').trim()
    const openInst = sp.get('openInstallation') === '1'
    const openExpense = sp.get('openExpense') === '1'
    const expenseNote = (sp.get('expenseNote') ?? '').trim()
    if (!pre && !openInst && !openExpense && !expenseNote) return
    if (pre) {
      pendingPrefillStatusIdRef.current = pre
      setPendingPrefillStatusId(pre)
    }
    if (openInst) {
      pendingOpenInstallationRef.current = true
      setPendingOpenInstallation(true)
    }
    if (openExpense || expenseNote) {
      setExpenseAmountInput('')
      setExpenseNoteInput(expenseNote || 'Production cost')
      setExpenseModalOpen(true)
    }
    // Clear query so it won't re-trigger on further state changes.
    sp.delete('prefillStatus')
    sp.delete('openInstallation')
    sp.delete('openExpense')
    sp.delete('expenseNote')
    navigate({ pathname: location.pathname, search: sp.toString() ? `?${sp.toString()}` : '' }, { replace: true })
  }, [location.pathname, location.search, navigate])

  // Prefill is applied in `applyOrderData` after order loads, so it can't be overwritten by API state.

  async function uploadLinePhoto(targetOrderId: string, blindsTypeId: string, file: File | null | undefined) {
    if (!targetOrderId || !canEdit || !file) return
    setErr(null)
    try {
      const resized = await resizePhotoForUpload(file, {
        maxDimension: 1600,
        outputType: 'image/webp',
        quality: 0.82,
        maxBytes: 4 * 1024 * 1024,
      })
      const fd = new FormData()
      fd.append('blinds_type_id', blindsTypeId)
      fd.append('file', resized)
      await postMultipartJson<OrderDetail>(`/orders/${targetOrderId}/line-photos`, fd)
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not upload photo')
    }
  }

  function renderLinePhotoCell(targetOrderId: string, keyPrefix: string) {
    return (typeId: string, checked: boolean) => {
      const photos = editLinePhotosByOrder[targetOrderId]?.[typeId] ?? []
      const latest = photos[0] ?? null
      const camId = `${keyPrefix}-line-photo-cam-${targetOrderId}-${typeId}`
      const upId = `${keyPrefix}-line-photo-up-${targetOrderId}-${typeId}`
      return (
        <div className="flex flex-col items-center gap-1.5">
          <input
            id={camId}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={!checked}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void uploadLinePhoto(targetOrderId, typeId, f)
            }}
          />
          <input
            id={upId}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!checked}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void uploadLinePhoto(targetOrderId, typeId, f)
            }}
          />
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              title={checked ? 'Take photo' : 'Select type first'}
              aria-label={`Take photo for ${typeId}`}
              disabled={!checked}
              onClick={() => document.getElementById(camId)?.click()}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Camera className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              type="button"
              title={checked ? 'Upload photo' : 'Select type first'}
              aria-label={`Upload photo for ${typeId}`}
              disabled={!checked}
              onClick={() => document.getElementById(upId)?.click()}
              className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <Upload className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          {latest ? (
            <a
              href={latest.url}
              target="_blank"
              rel="noreferrer"
              title={latest.filename}
              className="mt-0.5 block"
            >
              <img
                src={latest.url}
                alt="Line"
                className="h-8 w-8 rounded-md border border-slate-200 object-cover"
                loading="lazy"
              />
            </a>
          ) : (
            <span className="text-[10px] text-slate-400">{checked ? '—' : ''}</span>
          )}
          {photos.length > 1 ? (
            <span className="text-[10px] font-semibold text-slate-500">{photos.length} photos</span>
          ) : null}
        </div>
      )
    }
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
      setEditExpenseTotal(0)
      setEditProfit(0)
      setEditExpenseEntries([])
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
    setEditAdditionOrders((prev) =>
      prev.map((a) => ({ ...a, blinds_lines: hydrateBlindsLinesDefaults(a.blinds_lines, blindsOrderOptions) })),
    )
  }, [blindsOrderOptions])

  useEffect(() => {
    void loadOrderPageData()
  }, [orderId, canEdit])

  useEffect(() => {
    setOrderFormBaseline(null)
  }, [orderId])

  useEffect(() => {
    if (editLoading || !editDraft || !blindsOrderOptions || !orderId) return
    const t = window.setTimeout(() => scheduleOrderFormBaselineCapture(), 150)
    return () => window.clearTimeout(t)
  }, [editLoading, orderId, blindsOrderOptions, scheduleOrderFormBaselineCapture])

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

  function appendPendingAddition() {
    const row = createPendingEditAdditionOrder()
    setEditAdditionOrders((prev) => [...prev, row])
  }

  function removePendingAddition(targetOrderId: string) {
    if (!isPendingAdditionOrderId(targetOrderId)) return
    setEditAdditionOrders((prev) => prev.filter((x) => x.order_id !== targetOrderId))
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
      const knownChildIds = new Set(
        editAdditionOrders.filter((a) => !isPendingAdditionOrderId(a.order_id)).map((a) => a.order_id),
      )
      let additionsToPatch = [...editAdditionOrders]

      for (let i = 0; i < additionsToPatch.length; i++) {
        const row = additionsToPatch[i]
        if (!isPendingAdditionOrderId(row.order_id)) continue
        if (row.blinds_lines.length === 0) {
          setErr('Choose at least one blinds type for each additional order.')
          return
        }
        const anchor = await postJson<OrderDetail>(
          `/orders/${orderId}/line-item-additions`,
          buildLineItemAdditionPostBody(row, blindsOrderOptions),
        )
        const additionIds = (anchor.line_item_additions ?? []).map((x) => x.order_id)
        const newId = additionIds.find((id) => !knownChildIds.has(id))
        if (!newId) {
          throw new Error('Could not resolve new additional order.')
        }
        knownChildIds.add(newId)
        additionsToPatch[i] = { ...row, order_id: newId }
      }

      for (const a of additionsToPatch) {
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
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save order')
    } finally {
      setEditSaving(false)
    }
  }

  async function submitRecordPayment() {
    if (!orderId || !canEdit) return
    const amt = parseOptionalDecimal(paymentAmountInput.trim())
    if (amt == null || amt <= 0) {
      setPaymentErr('Enter a valid payment amount.')
      return
    }
    setPaymentPending(true)
    setPaymentErr(null)
    try {
      await postJson<OrderDetail>(`/orders/${orderId}/record-payment`, { amount: amt })
      setPaymentModalOpen(false)
      setPaymentAmountInput('')
      setPaymentErr(null)
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
      if (doneGateNextStatusId) {
        // Best-effort: user intended to mark Done after paying.
        setEditDraft((d) => (d ? { ...d, status_orde_id: doneGateNextStatusId } : d))
        setDoneGateNextStatusId(null)
      }
    } catch (e) {
      setPaymentErr(e instanceof Error ? e.message : 'Could not record payment')
    } finally {
      setPaymentPending(false)
    }
  }

  useEffect(() => {
    if (!paymentModalOpen) return
    setPaymentErr(null)
    setPaymentPickIds([])
    const t = globalThis.setTimeout(() => {
      paymentAmountRef.current?.focus()
      paymentAmountRef.current?.select()
    }, 0)
    return () => globalThis.clearTimeout(t)
  }, [paymentModalOpen])

  useEffect(() => {
    if (!expenseModalOpen) return
    setExpenseErr(null)
    const t = globalThis.setTimeout(() => {
      expenseAmountRef.current?.focus()
      expenseAmountRef.current?.select()
    }, 0)
    return () => globalThis.clearTimeout(t)
  }, [expenseModalOpen])

  const paymentBalancePicks = useMemo(() => {
    const out: Array<{ id: string; label: string; amount: number; kind: 'job' | 'order' }> = []
    const jobRem = Math.max(0, safeRound2(editRollupTotals.bal ?? 0))
    if (jobRem > 0.005) out.push({ id: 'job', label: 'Job total remaining', amount: jobRem, kind: 'job' })
    const origRem = Math.max(0, safeRound2(editComputedBalance ?? 0))
    if (origRem > 0.005) out.push({ id: 'orig', label: 'Original order remaining', amount: origRem, kind: 'order' })
    for (let i = 0; i < editAdditionComputed.length; i++) {
      const x = editAdditionComputed[i]
      const rem = Math.max(0, safeRound2(x.balance ?? 0))
      if (rem > 0.005) out.push({ id: `add:${x.order_id}`, label: `Additional order #${i + 1} remaining`, amount: rem, kind: 'order' })
    }
    return out
  }, [editRollupTotals.bal, editComputedBalance, editAdditionComputed])

  async function runDeletePaymentEntry() {
    if (!deletePaymentEntryTarget || !canEdit) return
    setDeletePaymentPending(true)
    setErr(null)
    setPaymentErr(null)
    try {
      await deleteJson(`/orders/${deletePaymentEntryTarget.orderId}/payment-entries/${deletePaymentEntryTarget.entryId}`)
      setDeletePaymentEntryTarget(null)
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove payment')
    } finally {
      setDeletePaymentPending(false)
    }
  }

  async function submitRecordExpense() {
    if (!orderId || !canEdit) return
    const amt = parseOptionalDecimal(expenseAmountInput.trim())
    if (amt == null || amt <= 0) {
      setExpenseErr('Enter a valid expense amount.')
      return
    }
    setExpensePending(true)
    setExpenseErr(null)
    try {
      await postJson<OrderDetail>(`/orders/${orderId}/expenses`, {
        amount: amt,
        note: expenseNoteInput.trim() || null,
      })
      setExpenseModalOpen(false)
      setExpenseAmountInput('')
      setExpenseNoteInput('')
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
    } catch (e) {
      setExpenseErr(e instanceof Error ? e.message : 'Could not record expense')
    } finally {
      setExpensePending(false)
    }
  }

  async function runDeleteExpense() {
    if (!deleteExpenseTarget || !canEdit) return
    setDeleteExpensePending(true)
    setErr(null)
    try {
      await deleteJson(`/orders/${deleteExpenseTarget.orderId}/expenses/${deleteExpenseTarget.expenseId}`)
      setDeleteExpenseTarget(null)
      await loadOrderPageData(false)
      scheduleOrderFormBaselineCapture()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove expense')
    } finally {
      setDeleteExpensePending(false)
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
      scheduleOrderFormBaselineCapture()
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
        open={productionCostPromptOpen}
        title="Add production cost?"
        description="You just moved this order into In production. Do you want to record the production cost payable to the factory now?"
        confirmLabel="Record production cost"
        cancelLabel="Not now"
        pending={expensePending}
        onConfirm={() => {
          setProductionCostPromptOpen(false)
          setExpenseAmountInput('')
          setExpenseNoteInput('Production cost')
          setExpenseModalOpen(true)
        }}
        onCancel={() => {
          if (expensePending) return
          setProductionCostPromptOpen(false)
        }}
      />

      <ConfirmModal
        open={deletePaymentEntryTarget !== null}
        title="Remove this payment?"
        description="This payment line will be removed and the order balance will be recalculated. You cannot restore it from the app."
        confirmLabel="Remove payment"
        cancelLabel="Cancel"
        variant="danger"
        pending={deletePaymentPending}
        onConfirm={() => void runDeletePaymentEntry()}
        onCancel={() => !deletePaymentPending && setDeletePaymentEntryTarget(null)}
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

      <ConfirmModal
        open={doneGateOpen}
        title="Pay the balance before marking Done"
        description={`This job still has a balance due of ${fmtMoney(jobBalanceDue)}. Record the remaining payment before setting status to Done.`}
        confirmLabel="Record payment"
        cancelLabel="Keep current status"
        variant="danger"
        pending={paymentPending}
        onConfirm={() => {
          setDoneGateOpen(false)
          setPaymentAmountInput('')
          setPaymentModalOpen(true)
        }}
        onCancel={() => {
          if (paymentPending) return
          setDoneGateOpen(false)
          setDoneGateNextStatusId(null)
        }}
      />

      <ConfirmModal
        open={paidMustBeDoneOpen}
        title="Order is fully paid"
        description="This job has a zero balance due, so status must be Done."
        confirmLabel="Set status to Done"
        cancelLabel="Cancel"
        pending={false}
        onConfirm={() => {
          const did = doneStatusId
          if (did) setEditDraft((d) => (d ? { ...d, status_orde_id: did } : d))
          setPaidMustBeDoneOpen(false)
        }}
        onCancel={() => setPaidMustBeDoneOpen(false)}
      />

      {paymentModalOpen && orderId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (!paymentPending && e.target === e.currentTarget) {
              setPaymentModalOpen(false)
              setPaymentAmountInput('')
              setPaymentErr(null)
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
            {paymentErr ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {paymentErr}
              </div>
            ) : null}
            {paymentBalancePicks.length > 0 ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quick pick</div>
                <div className="mt-2 space-y-2">
                  {paymentBalancePicks.map((p) => {
                    const checked = paymentPickIds.includes(p.id)
                    return (
                      <label key={p.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2 text-slate-800">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-teal-600"
                            checked={checked}
                            disabled={paymentPending}
                            onChange={() => {
                              setPaymentErr(null)
                              setPaymentPickIds((prev) => {
                                const has = prev.includes(p.id)
                                let next = has ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                                if (p.id === 'job') {
                                  next = has ? [] : ['job']
                                } else {
                                  next = next.filter((x) => x !== 'job')
                                }
                                const pickedSum = next
                                  .map((id) => paymentBalancePicks.find((x) => x.id === id)?.amount ?? 0)
                                  .reduce((a, b) => safeRound2(a + b), 0)
                                if (pickedSum > 0) {
                                  setPaymentAmountInput(
                                    pickedSum.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    }),
                                  )
                                } else {
                                  setPaymentAmountInput('')
                                }
                                return next
                              })
                            }}
                          />
                          {p.label}
                        </span>
                        <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(p.amount)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Amount</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={paymentAmountInput}
                onChange={(e) => setPaymentAmountInput(e.target.value)}
                onBlur={() => {
                  const n = parseOptionalDecimal(paymentAmountInput)
                  if (n == null) return
                  setPaymentAmountInput(
                    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                  )
                }}
                placeholder="0.00"
                disabled={paymentPending}
                ref={paymentAmountRef}
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={paymentPending}
                onClick={() => {
                  setPaymentModalOpen(false)
                  setPaymentAmountInput('')
                  setPaymentErr(null)
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

      {expenseModalOpen && orderId ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (!expensePending && e.target === e.currentTarget) {
              setExpenseModalOpen(false)
              setExpenseAmountInput('')
              setExpenseNoteInput('')
              setExpenseErr(null)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-edit-expense-modal-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="order-edit-expense-modal-title" className="text-lg font-semibold text-slate-900">
              Record expense
            </h2>
            <p className="mt-2 text-sm text-slate-600">Expenses affect profit only. They do not change payments or balance.</p>
            {expenseErr ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {expenseErr}
              </div>
            ) : null}
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Amount</span>
              <input
                inputMode="decimal"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={expenseAmountInput}
                onChange={(e) => setExpenseAmountInput(e.target.value)}
                placeholder="0.00"
                disabled={expensePending}
                ref={expenseAmountRef}
              />
            </label>
            <label className="mt-4 block text-sm text-slate-700">
              <span className="mb-1 block font-medium">Note (optional)</span>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                value={expenseNoteInput}
                onChange={(e) => setExpenseNoteInput(e.target.value)}
                placeholder="What was this expense for?"
                disabled={expensePending}
              />
            </label>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={expensePending}
                onClick={() => {
                  setExpenseModalOpen(false)
                  setExpenseAmountInput('')
                  setExpenseNoteInput('')
                  setExpenseErr(null)
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={expensePending}
                onClick={() => void submitRecordExpense()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {expensePending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Link to="/orders" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-slate-950 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      {err && !paymentModalOpen ? (
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
                          onChange={(e) => {
                            const nextId = e.target.value
                            const prevId = editDraft.status_orde_id
                            // From deep-link prefill: once the user touches the status, stop forcing it.
                            pendingPrefillStatusIdRef.current = null
                            setPendingPrefillStatusId(null)
                            const next = (orderStatuses ?? []).find((s) => s.id === nextId)
                            const bucket = orderStatusWorkflowBucketFromName((next?.name ?? '').trim())
                            if (bucket !== 'done' && jobBalanceDue <= 0.005) {
                              setPaidMustBeDoneOpen(true)
                              return
                            }
                            if (bucket === 'done' && jobBalanceDue > 0.005) {
                              setDoneGateNextStatusId(nextId)
                              setDoneGateOpen(true)
                              return
                            }
                            setEditDraft((d) => (d ? { ...d, status_orde_id: nextId } : d))

                            const prev = (orderStatuses ?? []).find((s) => s.id === prevId)
                            const prevBucket = orderStatusWorkflowBucketFromName((prev?.name ?? '').trim())
                            if (bucket === 'production' && prevBucket !== 'production') {
                              setProductionCostPromptOpen(true)
                            }
                          }}
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
                          autoOpen={autoOpenInstallation}
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
                          disabled={!(editRollupTotals.bal > 0.005) || paymentPending}
                          title={editRollupTotals.bal > 0.005 ? 'Record a payment' : 'Job balance is already fully paid.'}
                          className="w-full rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-teal-50/60"
                          onClick={() => {
                            if (!(editRollupTotals.bal > 0.005) || paymentPending) return
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

                <div className="rounded-xl border border-slate-200/80 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra expenses</h3>
                      <p className="mt-1 text-[11px] text-slate-500">Affects profit only (does not change payments/balance).</p>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit || expensePending}
                      className="rounded-lg border border-teal-200 bg-teal-50/70 px-3 py-2 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:opacity-50"
                      onClick={() => {
                        setExpenseAmountInput('')
                        setExpenseNoteInput('')
                        setExpenseModalOpen(true)
                      }}
                    >
                      Add expense
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expense total</div>
                      <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                        {fmtMoney(editExpenseTotal)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Profit</div>
                      <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                        {fmtMoney(editProfit)}
                      </div>
                    </div>
                  </div>
                  {editExpenseEntries.length > 0 ? (
                    <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {editExpenseEntries.map((e) => (
                        <li key={e.id} className="flex items-start justify-between gap-3 bg-white px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-semibold tabular-nums text-slate-900">{fmtMoney(e.amount)}</div>
                            {e.note?.trim() ? <div className="mt-0.5 text-xs text-slate-600">{e.note.trim()}</div> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              title="Remove expense"
                              className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                              onClick={() => orderId && setDeleteExpenseTarget({ orderId, expenseId: e.id })}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">No expenses recorded.</p>
                  )}
                </div>

                {editPaymentEntries.length > 0 ? (
                  <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-3 sm:px-4">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Recorded payments
                    </h3>
                    <ul className="mt-2 divide-y divide-slate-100">
                      {editPaymentEntries.map((p) => (
                        <li
                          key={`${p.order_id ?? orderId ?? 'order'}:${p.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium tabular-nums text-slate-900">{fmtMoney(p.amount)}</span>
                            {p.id === 'downpayment' ? (
                              <span className="ml-2 text-xs font-normal text-slate-500">Down payment</span>
                            ) : null}
                            {p.order_id && orderId && p.order_id !== orderId ? (
                              <span className="ml-2 text-xs font-normal text-slate-500">
                                ({(() => {
                                  const idx =
                                    (editAdditionOrders ?? []).findIndex((a) => a.order_id === p.order_id) ?? -1
                                  return idx >= 0 ? `Additional #${idx + 1}` : p.order_id
                                })()})
                              </span>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-slate-500">{fmtDisplayDateTime(p.paid_at)}</span>
                            {canEdit && p.id !== 'downpayment' ? (
                              <button
                                type="button"
                                title="Remove payment"
                                className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                                onClick={() => {
                                  const oid = (p.order_id ?? orderId ?? '').trim()
                                  if (!oid) return
                                  setDeletePaymentEntryTarget({ orderId: oid, entryId: p.id })
                                }}
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
                    <span className="inline-flex items-center gap-2">
                      Original order
                      {editComputedBalance != null &&
                      editComputedBalance <= 0.005 &&
                      (editAdditionOrders?.length ?? 0) > 0 ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-100">
                          Paid
                        </span>
                      ) : null}
                    </span>
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
                        renderLinePhotoCell={orderId ? renderLinePhotoCell(orderId, 'edit-orig') : undefined}
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
                            onBlur={() => {
                              setEditDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      downpayment: formatMoneyInputValue(d.downpayment),
                                    }
                                  : d,
                              )
                            }}
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
                            onBlur={() => {
                              setEditDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      tax_base: formatMoneyInputValue(d.tax_base),
                                    }
                                  : d,
                              )
                            }}
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
                          scheduleOrderFormBaselineCapture()
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
                          <AdditionalOrderDetails
                            key={a.order_id}
                            orderId={a.order_id}
                            className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm"
                          >
                            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 select-none text-sm font-semibold text-slate-900">
                              <span>
                                Additional order #{idx + 1}{' '}
                                <span className="ml-2 font-mono text-xs font-medium text-slate-400">
                                  {isPendingAdditionOrderId(a.order_id) ? '(draft)' : a.order_id}
                                </span>
                                {!isPendingAdditionOrderId(a.order_id) && Math.abs(comp?.balance ?? 0) <= 0.005 ? (
                                  <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 ring-1 ring-indigo-100">
                                    Paid
                                  </span>
                                ) : null}
                              </span>
                              {isPendingAdditionOrderId(a.order_id) ? (
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                  title="Remove draft additional order"
                                  aria-label="Remove draft additional order"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                  }}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    removePendingAddition(a.order_id)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                                </button>
                              ) : null}
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
                                  renderLinePhotoCell={
                                    !isPendingAdditionOrderId(a.order_id) ? renderLinePhotoCell(a.order_id, `edit-add-${a.order_id}`) : undefined
                                  }
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
                                      onBlur={() => {
                                        editAdditionUpdate(a.order_id, {
                                          downpayment: formatMoneyInputValue(a.downpayment),
                                        })
                                      }}
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
                                      onBlur={() => {
                                        editAdditionUpdate(a.order_id, {
                                          tax_base: formatMoneyInputValue(a.tax_base),
                                        })
                                      }}
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
                          </AdditionalOrderDetails>
                        )
                      })
                    : null}

                  <button
                    type="button"
                    disabled={!canEdit || editSaving || !orderId}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm font-semibold text-teal-900 shadow-sm hover:bg-teal-50 disabled:opacity-50"
                    onClick={() => appendPendingAddition()}
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
              disabled={!isOrderDirty || editSaving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => revertOrderForm()}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                editSaving ||
                !isOrderDirty ||
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
