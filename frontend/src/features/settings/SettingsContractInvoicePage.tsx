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

