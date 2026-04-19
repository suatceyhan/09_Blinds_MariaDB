import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FileText } from 'lucide-react'
import { getJson, putJson } from '@/lib/api'
import { useAuthSession } from '@/app/authSession'

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

/** Mirrors backend `_html_page` print styles enough for settings preview. */
function previewDocumentHtml(innerBody: string): string {
  let body = innerBody
  for (const [k, v] of Object.entries(PREVIEW_SAMPLE)) {
    body = body.split(k).join(v)
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  :root { --ink:#0f172a; --muted:#475569; --line:#cbd5e1; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; color: var(--ink); font: 12px/1.25 ui-sans-serif, system-ui, Segoe UI, Roboto, Arial; }
  h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: 0.2px; }
  h2 { margin: 22px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .rule { border-top: 1px solid var(--line); margin: 14px 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; }
  .row { display: grid; grid-template-columns: 160px 1fr; gap: 10px; padding: 2px 0; }
  .k { color: var(--muted); }
  .v { min-height: 18px; border-bottom: 1px solid var(--line); padding-bottom: 2px; }
  .v.inline { border-bottom: none; padding-bottom: 0; }
  .mono { font-variant-numeric: tabular-nums; }
  .small { font-size: 12px; color: var(--muted); }
  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .doc-card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; background: #f8fafc; }
  .doc-accent { border-left: 4px solid #0d9488; padding-left: 14px; background: #f8fafc; border-radius: 10px; }
  .doc-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #0f766e; text-transform: uppercase; }
  .doc-h1 { margin: 8px 0 4px; font-size: 21px; letter-spacing: -0.02em; }
  .doc-meta { font-size: 11px; color: var(--muted); }
  .doc-price-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
  .doc-price-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .doc-price-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .doc-price-table tr:last-child td { border-bottom: none; font-weight: 600; }
  .doc-terms { font-size: 11px; color: var(--muted); line-height: 1.45; }
</style>
</head>
<body><div class="page">${body}</div></body>
</html>`
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

  const previewDepositSrcDoc = useMemo(() => {
    const key = selectedDepositKey
    const preset = depositPresets.find((p) => p.key === key)
    const body = preset?.body_html ?? templates?.deposit_contract.body_html ?? ''
    if (!body.trim()) return previewDocumentHtml('<p class="small">Select a template.</p>')
    return previewDocumentHtml(body)
  }, [depositPresets, selectedDepositKey, templates])

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
                    <div className="h-[min(32rem,70vh)] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner">
                      <iframe title="Deposit template preview" className="h-full w-full bg-white" srcDoc={previewDepositSrcDoc} />
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Sample data only. Generated PDFs use live fields from your estimate or order.
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
