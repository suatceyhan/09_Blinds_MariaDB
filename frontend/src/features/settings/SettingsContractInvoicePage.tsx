import { useCallback, useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { getJson, putJson } from '@/lib/api'
import { useAuthSession } from '@/app/authSession'

type TemplateKind = 'deposit_contract' | 'final_invoice'

type TemplateRow = {
  kind: TemplateKind
  subject: string
  body_html: string
}

function kindTitle(kind: TemplateKind): string {
  return kind === 'deposit_contract' ? 'DEPOSIT INVOICE + CONTRACT' : 'FINAL INVOICE'
}

export function SettingsContractInvoicePage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.contract_invoice.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.contract_invoice.edit'))

  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingKind, setSavingKind] = useState<TemplateKind | null>(null)
  const [templates, setTemplates] = useState<Record<TemplateKind, TemplateRow> | null>(null)

  const loadTemplates = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const rows = await getJson<TemplateRow[]>('/settings/contract-invoice/templates')
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
    } catch (e) {
      setTemplates(null)
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
    void loadTemplates()
  }, [me, canView, loadTemplates])

  async function save(kind: TemplateKind) {
    if (!templates || !canEdit) return
    setErr(null)
    setSavingKind(kind)
    try {
      const t = templates[kind]
      await putJson(`/settings/contract-invoice/templates/${kind}`, {
        subject: t.subject,
        body_html: t.body_html,
      })
      await loadTemplates()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save template')
    } finally {
      setSavingKind(null)
    }
  }

  function previewHtml(raw: string): string {
    const sample: Record<string, string> = {
      '{{business_name}}': 'Acme Blinds Inc.',
      '{{business_address}}': '123 Main St, Toronto, ON',
      '{{business_phone}}': '555-123-4567',
      '{{business_email}}': 'info@acmeblinds.com',
      '{{customer_name}}': 'John Doe',
      '{{customer_address}}': '88 King St, Toronto, ON',
      '{{customer_phone}}': '555-777-8888',
      '{{invoice_number}}': 'INV-EXAMPLE-0001',
      '{{invoice_date}}': 'Apr 14, 2026',
      '{{product}}': 'Custom Zebra Blinds',
      '{{description}}': 'Living Room – 3 Windows, Blackout Fabric, Motorized',
      '{{measurements}}': 'W: ___  H: ___',
      '{{installation_address}}': '88 King St, Toronto, ON',
      '{{total_project_price}}': '3,834.00',
      '{{deposit_required}}': '1,917.00',
      '{{balance_remaining}}': '1,917.00',
      '{{deposit_paid}}': '1,917.00',
      '{{balance_due}}': '1,917.00',
      '{{balance_paid}}': '1,917.00',
      '{{payment_method}}': 'E-transfer',
      '{{payment_date}}': 'Apr 14, 2026',
      '{{status}}': 'PAID',
    }
    let out = raw
    for (const [k, v] of Object.entries(sample)) out = out.split(k).join(v)
    return `<!doctype html><html><head><meta charset="utf-8" /><style>
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
    </style></head><body>${out}</body></html>`
  }

  const placeholders = [
    '{{business_name}}',
    '{{business_address}}',
    '{{business_phone}}',
    '{{business_email}}',
    '{{customer_name}}',
    '{{customer_address}}',
    '{{customer_phone}}',
    '{{invoice_number}}',
    '{{invoice_date}}',
    '{{product}}',
    '{{description}}',
    '{{measurements}}',
    '{{installation_address}}',
    '{{total_project_price}}',
    '{{deposit_required}}',
    '{{balance_remaining}}',
    '{{deposit_paid}}',
    '{{balance_due}}',
    '{{balance_paid}}',
    '{{payment_method}}',
    '{{payment_date}}',
    '{{status}}',
  ] as const

  if (!me) return null

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <FileText className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Contract / Invoice</h1>
          <p className="mt-1 text-slate-600">
            Edit the HTML templates used for customer-facing documents. Estimates and orders will use these templates
            when sending emails and when downloading documents.
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
            <div className="space-y-6">
              {(['deposit_contract', 'final_invoice'] as const).map((k) => {
                const t = templates?.[k] ?? null
                if (!t) return null
                return (
                  <section key={k} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">{kindTitle(k)}</h2>
                        <p className="mt-1 text-xs text-slate-500">
                          Use placeholders like <code className="text-slate-700">{'{{customer_name}}'}</code>,{' '}
                          <code className="text-slate-700">{'{{invoice_number}}'}</code>,{' '}
                          <code className="text-slate-700">{'{{total_project_price}}'}</code>.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!canEdit || savingKind !== null}
                        onClick={() => void save(k)}
                        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingKind === k ? 'Saving…' : 'Save template'}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4">
                      <label className="block text-sm text-slate-700">
                        <span className="mb-1 block font-medium">Email subject</span>
                        <input
                          value={t.subject}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setTemplates((prev) =>
                              prev ? { ...prev, [k]: { ...prev[k], subject: e.target.value } } : prev,
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                        />
                      </label>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Placeholders
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {placeholders.map((ph) => (
                                <button
                                  key={ph}
                                  type="button"
                                  disabled={!canEdit}
                                  onClick={() =>
                                    setTemplates((prev) =>
                                      prev ? { ...prev, [k]: { ...prev[k], body_html: `${prev[k].body_html}${prev[k].body_html.endsWith('\n') || prev[k].body_html === '' ? '' : ' '}${ph}` } } : prev,
                                    )
                                  }
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                  title="Insert placeholder"
                                >
                                  {ph}
                                </button>
                              ))}
                            </div>
                          </div>

                          <label className="block text-sm text-slate-700">
                            <span className="mb-1 block font-medium">HTML body</span>
                            <textarea
                              value={t.body_html}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setTemplates((prev) =>
                                  prev ? { ...prev, [k]: { ...prev[k], body_html: e.target.value } } : prev,
                                )
                              }
                              rows={18}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60"
                            />
                          </label>
                        </div>

                        <div>
                          <p className="mb-1 block text-sm font-medium text-slate-700">Preview</p>
                          <div className="h-[28rem] overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <iframe title="Template preview" className="h-full w-full" srcDoc={previewHtml(t.body_html)} />
                          </div>
                          <p className="mt-2 text-[11px] text-slate-500">
                            Preview uses sample data. PDF output uses live DB values and prints on Letter size.
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

