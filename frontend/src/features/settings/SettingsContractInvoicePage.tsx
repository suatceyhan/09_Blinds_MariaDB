import { useCallback, useEffect, useState } from 'react'
import { Check, FileText } from 'lucide-react'
import { apiBase, getJson, putJson } from '@/lib/api'
import { useAuthSession } from '@/app/authSession'
import { getAccessToken } from '@/lib/authStorage'

type TemplateKind = 'deposit_contract' | 'final_invoice'

type TemplateRow = {
  kind: TemplateKind
  subject: string
  body_html: string
  preset_key?: string | null
  legacy_custom?: boolean
}

type PresetCatalogItem = {
  kind: string
  key: string
  name: string
  description: string
  body_html: string
}

/** Final invoice iframe only — deposit preview uses GET /preview/deposit-contract (same HTML as PDF). */
const PREVIEW_SAMPLE: Record<string, string> = {
  '{{business_name}}': 'Acme Blinds Inc.',
  '{{business_address}}': '123 Main St, Toronto, ON M5J 2N1',
  '{{business_phone}}': '(416) 555-0100',
  '{{business_email}}': 'jobs@acmeblinds.example',
  '{{customer_name}}': 'John Doe',
  '{{customer_address}}': '88 King St, Toronto, ON',
  '{{customer_phone}}': '(647) 555-7788',
  '{{invoice_number}}': 'INV-EST-abc12345',
  '{{invoice_date}}': 'Apr 18, 2026',
  '{{product}}': 'Custom Zebra Blinds',
  '{{description}}': 'Living room — 3× windows, blackout fabric',
  '{{measurements}}': 'Per field measure sheet',
  '{{installation_address}}': '88 King St, Toronto, ON',
  '{{total_project_price}}': '3,834.00',
  '{{deposit_required}}': '1,917.00',
  '{{balance_remaining}}': '1,917.00',
  '{{deposit_paid}}': '1,917.00',
  '{{balance_due}}': '1,917.00',
  '{{balance_paid}}': '1,917.00',
  '{{payment_method}}': 'E-transfer',
  '{{payment_date}}': 'Apr 18, 2026',
  '{{status}}': 'PAID',
}

function previewFinalInvoiceHtml(raw: string): string {
  let body = raw
  for (const [k, v] of Object.entries(PREVIEW_SAMPLE)) {
    body = body.split(k).join(v)
  }
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font:12px/1.25 ui-sans-serif,system-ui,Segoe UI,Roboto,Arial;margin:0;padding:16px;color:#0f172a}
    :root{--ink:#0f172a;--muted:#475569;--line:#cbd5e1}
    h1{margin:0 0 6px;font-size:18px}
    h2{margin:18px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
    .rule{border-top:1px solid var(--line);margin:12px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px}
    .row{display:grid;grid-template-columns:140px 1fr;gap:10px;padding:2px 0}
    .k{color:var(--muted)}
    .v{min-height:18px;border-bottom:1px solid var(--line);padding-bottom:2px}
    .v.inline{border-bottom:none;padding-bottom:0}
    .mono{font-variant-numeric:tabular-nums}
    .small{font-size:12px;color:var(--muted)}
  </style></head><body>${body}</body></html>`
}

export function SettingsContractInvoicePage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.contract_invoice.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.contract_invoice.edit'))

  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingDeposit, setSavingDeposit] = useState(false)
  const [savingFinal, setSavingFinal] = useState(false)

  const [depositPresets, setDepositPresets] = useState<PresetCatalogItem[]>([])
  const [templates, setTemplates] = useState<Record<TemplateKind, TemplateRow> | null>(null)
  const [selectedDepositKey, setSelectedDepositKey] = useState<string | null>(null)
  const [depositPreviewHtml, setDepositPreviewHtml] = useState<string>('')
  const [depositPreviewLoading, setDepositPreviewLoading] = useState(false)
  const [depositPreviewErr, setDepositPreviewErr] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const [rows, presets] = await Promise.all([
        getJson<TemplateRow[]>('/settings/contract-invoice/templates'),
        getJson<PresetCatalogItem[]>('/settings/contract-invoice/presets?kind=deposit_contract'),
      ])
      const map: Record<TemplateKind, TemplateRow> = {
        deposit_contract: rows.find((r) => r.kind === 'deposit_contract') ?? {
          kind: 'deposit_contract',
          subject: '',
          body_html: '',
        },
        final_invoice: rows.find((r) => r.kind === 'final_invoice') ?? {
          kind: 'final_invoice',
          subject: '',
          body_html: '',
        },
      }
      setTemplates(map)
      setDepositPresets(presets)

      const dep = map.deposit_contract
      const preferred =
        dep.preset_key && presets.some((p) => p.key === dep.preset_key)
          ? dep.preset_key
          : presets[0]?.key ?? null
      setSelectedDepositKey(preferred)
    } catch (e) {
      setTemplates(null)
      setDepositPresets([])
      setErr(e instanceof Error ? e.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me || !canView) {
      setLoading(false)
      return
    }
    void loadAll()
  }, [me, canView, loadAll])

  useEffect(() => {
    if (!canView || loading || !selectedDepositKey) {
      setDepositPreviewHtml('')
      setDepositPreviewLoading(false)
      setDepositPreviewErr(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setDepositPreviewLoading(true)
      setDepositPreviewErr(null)
      try {
        const tok = getAccessToken()
        if (!tok) {
          setDepositPreviewErr('Sign in required for preview.')
          setDepositPreviewHtml('')
          return
        }
        const url = `${apiBase()}/settings/contract-invoice/preview/deposit-contract?preset_key=${encodeURIComponent(selectedDepositKey)}`
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
        if (!res.ok) {
          const t = await res.text()
          throw new Error(t || `${res.status} preview failed`)
        }
        const html = await res.text()
        if (!cancelled) setDepositPreviewHtml(html)
      } catch (e) {
        if (!cancelled) {
          setDepositPreviewHtml('')
          setDepositPreviewErr(e instanceof Error ? e.message : 'Could not load preview')
        }
      } finally {
        if (!cancelled) setDepositPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canView, loading, selectedDepositKey])

  async function saveDepositPreset() {
    if (!selectedDepositKey || !canEdit) return
    setErr(null)
    setSavingDeposit(true)
    try {
      await putJson(`/settings/contract-invoice/templates/deposit_contract`, {
        preset_key: selectedDepositKey,
      })
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save deposit template')
    } finally {
      setSavingDeposit(false)
    }
  }

  async function saveFinalInvoice() {
    if (!templates || !canEdit) return
    setErr(null)
    setSavingFinal(true)
    try {
      const t = templates.final_invoice
      await putJson(`/settings/contract-invoice/templates/final_invoice`, {
        subject: t.subject,
        body_html: t.body_html,
      })
      await loadAll()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save final invoice template')
    } finally {
      setSavingFinal(false)
    }
  }

  const depositLegacy = Boolean(templates?.deposit_contract?.legacy_custom)

  if (!me) return null

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <FileText className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Contract / Invoice</h1>
          <p className="mt-1 text-slate-600">
            Choose a ready-made deposit invoice layout. Final invoice still uses an editable HTML template until preset
            designs are added for that document type.
          </p>
        </div>
      </div>

      {!canView ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You do not have permission to view Contract / Invoice templates.
        </p>
      ) : (
        <>
          {err ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</p>
          ) : null}

          {loading ? (
            <p className="rounded-2xl border border-slate-200/80 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Loading…
            </p>
          ) : (
            <div className="space-y-10">
              <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Deposit invoice + contract</h2>
                    <p className="mt-1 max-w-xl text-sm text-slate-600">
                      Pick the layout customers receive when you send or download the deposit package from a pending
                      estimate. More layouts will appear here later.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit || savingDeposit || !selectedDepositKey}
                    onClick={() => void saveDepositPreset()}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingDeposit ? 'Saving…' : 'Save selection'}
                  </button>
                </div>

                {depositLegacy ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    This company still has a <strong>legacy custom</strong> deposit HTML template. Choosing a layout
                    below and saving will switch to the selected preset for all new PDFs and emails.
                  </div>
                ) : null}

                <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
                  <div className="space-y-3">
                    {depositPresets.map((p) => {
                      const selected = selectedDepositKey === p.key
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => setSelectedDepositKey(p.key)}
                          className={`w-full rounded-xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-500 ${
                            selected
                              ? 'border-teal-500 bg-teal-50/80 ring-2 ring-teal-300/60'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-900">{p.name}</span>
                            {selected ? (
                              <Check className="h-5 w-5 shrink-0 text-teal-700" strokeWidth={2} aria-hidden />
                            ) : null}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-slate-600">{p.description}</p>
                        </button>
                      )
                    })}
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">Preview</p>
                    {depositPreviewErr ? (
                      <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                        {depositPreviewErr}
                      </p>
                    ) : null}
                    <div
                      className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner"
                      style={{ height: 'min(calc(100dvh - 14rem), 900px)' }}
                    >
                      {depositPreviewLoading ? (
                        <div
                          className="flex w-full items-center justify-center text-sm text-slate-500"
                          style={{ height: 'min(calc(100dvh - 14rem), 900px)' }}
                        >
                          Loading preview…
                        </div>
                      ) : (
                        <iframe
                          title="Deposit template preview"
                          className="w-full border-0 bg-white"
                          style={{ height: 'min(calc(100dvh - 14rem), 900px)' }}
                          srcDoc={
                            depositPreviewHtml ||
                            '<!doctype html><html><body style="font:14px sans-serif;padding:16px;color:#64748b">Select a template.</body></html>'
                          }
                        />
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Same HTML/CSS stack as the PDF generator (sample placeholder values). Estimate downloads insert live
                      DB fields.
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Final invoice</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Editable HTML until preset designs are added. Placeholders include{' '}
                      <code className="text-slate-700">{'{{customer_name}}'}</code>,{' '}
                      <code className="text-slate-700">{'{{balance_due}}'}</code>,{' '}
                      <code className="text-slate-700">{'{{status}}'}</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!canEdit || savingFinal}
                    onClick={() => void saveFinalInvoice()}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingFinal ? 'Saving…' : 'Save template'}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-4">
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">Email subject</span>
                      <input
                        value={templates?.final_invoice.subject ?? ''}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setTemplates((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  final_invoice: { ...prev.final_invoice, subject: e.target.value },
                                }
                              : prev,
                          )
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                      />
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="mb-1 block font-medium">HTML body</span>
                      <textarea
                        value={templates?.final_invoice.body_html ?? ''}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setTemplates((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  final_invoice: { ...prev.final_invoice, body_html: e.target.value },
                                }
                              : prev,
                          )
                        }
                        rows={16}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                      />
                    </label>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">Preview</p>
                    <div className="h-[28rem] overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <iframe
                        title="Final invoice preview"
                        className="h-full w-full"
                        srcDoc={previewFinalInvoiceHtml(templates?.final_invoice.body_html ?? '')}
                      />
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
