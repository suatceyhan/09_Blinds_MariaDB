import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitBranchPlus, Save, Trash2 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, putJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type StatusOpt = { id: string; name: string; sort_order?: number }

type ActionType = {
  type: string
  label: string
  description?: string | null
  config_fields?: Array<{ key: string; label: string; kind: string; required: boolean }>
}

type SchemaField = { field: string; type: 'text' | 'textarea' | 'number' | 'boolean' | 'date' | 'datetime' }
type SchemaFieldsOut = { tables: Record<string, SchemaField[]> }

type WorkflowAction = { type: string; config: Record<string, unknown> }
type WorkflowTransition = {
  id: string
  from_status_orde_id: string | null
  to_status_orde_id: string
  sort_order: number
  actions: WorkflowAction[]
}
type WorkflowOut = {
  workflow_definition_id: string | null
  source: 'company' | 'global' | 'none'
  transitions: WorkflowTransition[]
}

type TransitionDraft = {
  key: string
  from_status_orde_id: string
  to_status_orde_id: string
  sort_order: string
  actions: WorkflowAction[]
}

function newDraft(): TransitionDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    from_status_orde_id: '',
    to_status_orde_id: '',
    sort_order: '0',
    actions: [],
  }
}

function normalizeStoredTargetTable(t: unknown): string {
  const s = String(t ?? '').trim()
  if (!s || s === 'order') return 'orders'
  if (s === 'expenses') return 'order_expense_entries'
  return s
}

function buildAskFormConfigFromSingleField(f: {
  targetTable: string
  targetField: string
  kind: string
  label: string
}): Record<string, unknown> {
  const key = f.targetField.trim() || 'field'
  return {
    title: '',
    description: '',
    fields: [
      {
        key,
        label: f.label.trim() || key,
        kind: f.kind,
        required: false,
        target: f.targetTable,
        target_field: f.targetField.trim() || key,
        target_meta: {},
      },
    ],
  }
}

export function SettingsOrderWorkflowPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.order_workflow.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.order_workflow.edit'))

  const [statuses, setStatuses] = useState<StatusOpt[] | null>(null)
  const [schemaFields, setSchemaFields] = useState<SchemaFieldsOut | null>(null)
  const [wf, setWf] = useState<WorkflowOut | null>(null)
  const [draft, setDraft] = useState<TransitionDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const [st, at, sf, out] = await Promise.all([
        getJson<StatusOpt[]>('/orders/lookup/order-statuses').catch(() => [] as StatusOpt[]),
        // Fetch action-types for forward compatibility / caching; this page currently uses only ask_form.
        getJson<ActionType[]>('/workflow/action-types').catch(() => [] as ActionType[]),
        getJson<SchemaFieldsOut>('/schema/fields').catch(() => null),
        getJson<WorkflowOut>('/settings/order-workflow'),
      ])
      void at
      setStatuses(st)
      setSchemaFields(sf)
      setWf(out)
      const nextDraft: TransitionDraft[] = (out.transitions ?? []).map((t) => ({
        key: t.id,
        from_status_orde_id: (t.from_status_orde_id ?? '').trim(),
        to_status_orde_id: (t.to_status_orde_id ?? '').trim(),
        sort_order: String(t.sort_order ?? 0),
        actions: (t.actions ?? []).map((a) => ({ type: a.type, config: a.config ?? {} })),
      }))
      setDraft(nextDraft.length ? nextDraft : [newDraft()])
      setDirty(false)
    } catch (e) {
      setStatuses(null)
      setSchemaFields(null)
      setWf(null)
      setDraft([newDraft()])
      setErr(e instanceof Error ? e.message : 'Could not load order workflow')
    } finally {
      setLoading(false)
    }
  }, [me, canView])

  function updateTransitionAskField(opts: {
    transitionKey: string
    enabled: boolean
    targetTable?: string
    targetField?: string
    label?: string
  }) {
    setDraft((prev) =>
      prev.map((t) => {
        if (t.key !== opts.transitionKey) return t
        if (!opts.enabled) return { ...t, actions: [] }
        const targetTable = (opts.targetTable ?? 'orders').trim() || 'orders'
        const targetField = (opts.targetField ?? '').trim()
        const label = (opts.label ?? '').trim()
        const available = schemaFields?.tables?.[targetTable] ?? []
        const inferred = available.find((x) => x.field === targetField)?.type ?? 'text'
        const kind = inferred === 'date' ? 'date' : inferred === 'datetime' ? 'datetime' : inferred
        const key = targetField || 'field'
        const action: WorkflowAction = {
          type: 'ask_form',
          config: buildAskFormConfigFromSingleField({
            targetTable,
            targetField: targetField || key,
            kind,
            label,
          }),
        }
        return { ...t, actions: [action] }
      }),
    )
    setDirty(true)
  }

  useEffect(() => {
    void load()
  }, [load])

  const statusLabel = useCallback(
    (id: string) => (statuses ?? []).find((s) => s.id === id)?.name ?? id,
    [statuses],
  )

  const sourceLabel = useMemo(() => {
    const src = wf?.source ?? 'none'
    if (src === 'company') return 'Company override'
    if (src === 'global') return 'Global default'
    return 'Not configured'
  }, [wf?.source])

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setErr(null)
    try {
      const transitions = draft
        .map((d) => {
          const to = d.to_status_orde_id.trim()
          const from = d.from_status_orde_id.trim()
          const so = Number.parseInt(d.sort_order.trim() || '0', 10)
          if (!to) return null
          return {
            from_status_orde_id: from || null,
            to_status_orde_id: to,
            sort_order: Number.isNaN(so) ? 0 : so,
            actions: (d.actions ?? []).filter((a) => String(a.type ?? '').trim()),
          }
        })
        .filter(Boolean)

      await putJson<WorkflowOut>('/settings/order-workflow', { transitions })
      setConfirmOpen(false)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">
        You do not have permission to view the order workflow.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <GitBranchPlus className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Order workflow</h1>
            <p className="mt-1 text-sm text-slate-600">
              Configure which status transitions are allowed, and which transitions require extra user input.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Source: <span className="font-semibold text-slate-700">{sourceLabel}</span>
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" strokeWidth={2} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Transitions</h2>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft((prev) => [...prev, newDraft()])
                    setDirty(true)
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  + Add transition
                </button>
              ) : null}
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">From</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2">Sort</th>
                    <th className="px-3 py-2">Actions</th>
                    <th className="px-3 py-2 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.map((d) => (
                    <tr key={d.key} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <select
                          disabled={!canEdit}
                          value={d.from_status_orde_id}
                          onChange={(e) => {
                            const v = e.target.value
                            setDraft((prev) => prev.map((x) => (x.key === d.key ? { ...x, from_status_orde_id: v } : x)))
                            setDirty(true)
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="">(any / initial)</option>
                          {(statuses ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          disabled={!canEdit}
                          value={d.to_status_orde_id}
                          onChange={(e) => {
                            const v = e.target.value
                            setDraft((prev) => prev.map((x) => (x.key === d.key ? { ...x, to_status_orde_id: v } : x)))
                            setDirty(true)
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <option value="">Select…</option>
                          {(statuses ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        {d.to_status_orde_id.trim() && !d.to_status_orde_id.trim().includes(' ') ? (
                          <p className="mt-1 text-[11px] text-slate-500">To: {statusLabel(d.to_status_orde_id)}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          disabled={!canEdit}
                          inputMode="numeric"
                          value={d.sort_order}
                          onChange={(e) => {
                            setDraft((prev) => prev.map((x) => (x.key === d.key ? { ...x, sort_order: e.target.value } : x)))
                            setDirty(true)
                          }}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const enabled = (d.actions ?? []).some((x) => x.type === 'ask_form')
                          const a = (d.actions ?? []).find((x) => x.type === 'ask_form') ?? null
                          const cfg = a?.config ?? {}
                          const fields = Array.isArray((cfg as Record<string, unknown>).fields)
                            ? ((cfg as Record<string, unknown>).fields as unknown[])
                            : []
                          const f0 = (fields[0] && typeof fields[0] === 'object' ? (fields[0] as Record<string, unknown>) : null) ?? null
                          const targetTable = normalizeStoredTargetTable(f0?.target)
                          const targetField = String(f0?.target_field ?? f0?.key ?? '').trim()
                          const label = String(f0?.label ?? '').trim()
                          const available = schemaFields?.tables?.[targetTable] ?? []
                          const tableNames = Object.keys(schemaFields?.tables ?? {}).sort()
                          const inferred = available.find((x) => x.field === targetField)?.type ?? 'text'
                          return (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-3 text-sm">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`action-${d.key}`}
                                    disabled={!canEdit}
                                    checked={!enabled}
                                    onChange={() => updateTransitionAskField({ transitionKey: d.key, enabled: false })}
                                  />
                                  No action
                                </label>
                                <label className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={`action-${d.key}`}
                                    disabled={!canEdit}
                                    checked={enabled}
                                    onChange={() =>
                                      updateTransitionAskField({
                                        transitionKey: d.key,
                                        enabled: true,
                                        targetTable: 'orders',
                                        targetField: 'installation_scheduled_start_at',
                                        label: 'Installation date',
                                      })
                                    }
                                  />
                                  Action
                                </label>
                              </div>

                              {enabled ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <label className="block">
                                    <div className="text-xs font-semibold text-slate-600">Table</div>
                                    <select
                                      disabled={!canEdit}
                                      value={targetTable}
                                      onChange={(e) => {
                                        const v = e.target.value
                                        updateTransitionAskField({
                                          transitionKey: d.key,
                                          enabled: true,
                                          targetTable: v,
                                          targetField: '',
                                          label,
                                        })
                                      }}
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {tableNames.length ? (
                                        tableNames.map((tn) => (
                                          <option key={tn} value={tn}>
                                            {tn}
                                          </option>
                                        ))
                                      ) : (
                                        <option value="orders">orders</option>
                                      )}
                                    </select>
                                  </label>
                                  <label className="block">
                                    <div className="text-xs font-semibold text-slate-600">Field</div>
                                    <select
                                      disabled={!canEdit}
                                      value={targetField}
                                      onChange={(e) => {
                                        updateTransitionAskField({
                                          transitionKey: d.key,
                                          enabled: true,
                                          targetTable,
                                          targetField: e.target.value,
                                          label,
                                        })
                                      }}
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      <option value="">Select…</option>
                                      {available.map((x) => (
                                        <option key={`${targetTable}-${x.field}`} value={x.field}>
                                          {x.field}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="block sm:col-span-2">
                                    <div className="text-xs font-semibold text-slate-600">Label</div>
                                    <input
                                      disabled={!canEdit}
                                      value={label}
                                      onChange={(e) =>
                                        updateTransitionAskField({
                                          transitionKey: d.key,
                                          enabled: true,
                                          targetTable,
                                          targetField,
                                          label: e.target.value,
                                        })
                                      }
                                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    />
                                    <div className="mt-1 text-[11px] text-slate-500">
                                      Input type (auto): <span className="font-mono">{inferred}</span> · Optional
                                    </div>
                                  </label>
                                </div>
                              ) : null}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEdit ? (
                          <button
                            type="button"
                            title="Remove transition"
                            aria-label="Remove transition"
                            className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setDraft((prev) => prev.filter((x) => x.key !== d.key))
                              setDirty(true)
                            }}
                            disabled={draft.length <= 1}
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        ) : null}
                        {!canEdit ? null : draft.length <= 1 ? (
                          <span className="ml-2 text-[11px] font-medium text-slate-400">Keep at least one row</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Tip: every DB table is listed for discovery; workflow transitions can currently write only to{' '}
              <span className="font-mono">orders</span> or <span className="font-mono">order_expense_entries</span>.
            </p>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Save order workflow?"
        description="This will replace the company's current workflow transitions."
        confirmLabel="Save"
        cancelLabel="Cancel"
        pending={saving}
        onCancel={() => !saving && setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </div>
  )
}

