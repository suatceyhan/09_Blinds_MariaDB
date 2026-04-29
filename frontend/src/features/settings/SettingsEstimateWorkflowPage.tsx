import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, GitBranchPlus, RotateCcw, Save, Trash2 } from 'lucide-react'
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
  from_status_esti_id: string | null
  to_status_esti_id: string
  sort_order: number
  actions: WorkflowAction[]
  deleted_at?: string | null
}
type WorkflowOut = {
  workflow_definition_id: string | null
  source: 'company' | 'global' | 'none'
  transitions: WorkflowTransition[]
}

type TransitionDraft = {
  key: string
  /** Server soft-delete timestamp (ISO); absent/null = active in runtime workflow. */
  deletedAt?: string | null
  from_status_esti_id: string
  to_status_esti_id: string
  sort_order: string
  actions: WorkflowAction[]
}

function newDraft(): TransitionDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
    from_status_esti_id: '',
    to_status_esti_id: '',
    sort_order: '0',
    actions: [],
  }
}

function normalizeStoredTargetTable(t: unknown): string {
  const s = String(t ?? '').trim()
  if (!s || s === 'estimate' || s === 'estimates') return 'estimate'
  if (s === 'order') return 'orders'
  if (s === 'expenses') return 'order_expense_entries'
  return s
}

function transitionAskSummary(d: TransitionDraft): { primary: string; secondary: string } {
  const enabled = (d.actions ?? []).some((x) => x.type === 'ask_form')
  if (!enabled) {
    return { primary: 'None', secondary: 'No prompt on status change' }
  }
  const a = (d.actions ?? []).find((x) => x.type === 'ask_form') ?? null
  const cfg = (a?.config ?? {}) as Record<string, unknown>
  const fields = Array.isArray(cfg.fields) ? cfg.fields : []
  const f0 =
    fields[0] && typeof fields[0] === 'object' ? (fields[0] as Record<string, unknown>) : null
  const targetTable = normalizeStoredTargetTable(f0?.target)
  const targetField = String(f0?.target_field ?? f0?.key ?? '').trim()
  const label = String(f0?.label ?? '').trim()
  const primary = label || (targetField ? `${targetTable}.${targetField}` : 'Custom field')
  const secondary = targetField ? `${targetTable} · ${targetField}` : targetTable
  return { primary, secondary }
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

export function SettingsEstimateWorkflowPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.estimate_workflow.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.estimate_workflow.edit'))

  const [statuses, setStatuses] = useState<StatusOpt[] | null>(null)
  const [schemaFields, setSchemaFields] = useState<SchemaFieldsOut | null>(null)
  const [wf, setWf] = useState<WorkflowOut | null>(null)
  const [draft, setDraft] = useState<TransitionDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /** Which transition row has the action editor expanded (full-width panel below the row). */
  const [actionPanelKey, setActionPanelKey] = useState<string | null>(null)
  const [rowConfirm, setRowConfirm] = useState<null | { mode: 'delete' | 'restore'; key: string }>(null)
  /** When enabled, draft rows with `deletedAt` are visible (restore / audit). */
  const [showDeleted, setShowDeleted] = useState(false)

  const activeTransitionCount = useMemo(() => draft.filter((d) => !d.deletedAt).length, [draft])

  const visibleDraft = useMemo(() => {
    if (showDeleted) return draft
    return draft.filter((d) => !d.deletedAt)
  }, [draft, showDeleted])

  const load = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const [st, at, sf, out] = await Promise.all([
        getJson<StatusOpt[]>('/lookups/estimate-statuses?limit=300').catch(() => [] as StatusOpt[]),
        getJson<ActionType[]>('/workflow/action-types').catch(() => [] as ActionType[]),
        getJson<SchemaFieldsOut>('/schema/fields').catch(() => null),
        getJson<WorkflowOut>('/settings/estimate-workflow?include_deleted=true'),
      ])
      void at
      setStatuses(st)
      setSchemaFields(sf)
      setWf(out)
      const nextDraft: TransitionDraft[] = (out.transitions ?? []).map((t) => ({
        key: t.id,
        deletedAt:
          (t as { deleted_at?: string | null; deletedAt?: string | null }).deleted_at ??
          (t as { deletedAt?: string | null }).deletedAt ??
          null,
        from_status_esti_id: (t.from_status_esti_id ?? '').trim(),
        to_status_esti_id: (t.to_status_esti_id ?? '').trim(),
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
      setErr(e instanceof Error ? e.message : 'Could not load estimate workflow')
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
        const targetTable = (opts.targetTable ?? 'estimate').trim() || 'estimate'
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

  useEffect(() => {
    if (!actionPanelKey) return
    const row = draft.find((x) => x.key === actionPanelKey)
    if (row?.deletedAt) setActionPanelKey(null)
  }, [actionPanelKey, draft])

  const sourceLabel = useMemo(() => {
    const src = wf?.source ?? 'none'
    if (src === 'company') return 'Company override'
    if (src === 'global') return 'Global default'
    return 'Not configured'
  }, [wf?.source])

  function buildPutBody(nextDraft: TransitionDraft[]) {
    const activeDraft = nextDraft.filter((d) => !d.deletedAt)
    const transitions = activeDraft
      .map((d) => {
        const to = d.to_status_esti_id.trim()
        const from = d.from_status_esti_id.trim()
        const so = Number.parseInt(d.sort_order.trim() || '0', 10)
        if (!to) return null
        return {
          id: d.key,
          from_status_esti_id: from || null,
          to_status_esti_id: to,
          sort_order: Number.isNaN(so) ? 0 : so,
          actions: (d.actions ?? []).filter((a) => String(a.type ?? '').trim()),
        }
      })
      .filter(Boolean)
    return { activeCount: activeDraft.length, body: { transitions } }
  }

  async function applyDeleteRestoreAndSave(nextDraft: TransitionDraft[]) {
    if (!canEdit) return
    setSaving(true)
    setErr(null)
    try {
      const { activeCount, body } = buildPutBody(nextDraft)
      if (activeCount === 0) throw new Error('At least one active transition is required.')
      await putJson<WorkflowOut>('/settings/estimate-workflow', body)
      setConfirmOpen(false)
      setRowConfirm(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      throw e
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setErr(null)
    try {
      const { activeCount, body } = buildPutBody(draft)
      if (activeCount === 0) {
        setErr('At least one active transition is required. Restore a deleted row or add a transition.')
        setSaving(false)
        return
      }
      await putJson<WorkflowOut>('/settings/estimate-workflow', body)
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
        You do not have permission to view the estimate workflow.
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
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Estimate workflow</h1>
            <p className="mt-1 text-sm text-slate-600">
              Configure which estimate status transitions are allowed, and which transitions require extra user input.
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

      {!loading && Array.isArray(statuses) && statuses.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          From/To lists only include statuses <strong>enabled for your company</strong> in the estimate status matrix.
          None are enabled yet, so the dropdowns are empty. Open{' '}
          <Link className="font-semibold text-teal-800 underline underline-offset-2 hover:text-teal-950" to="/lookups/estimate-statuses">
            Lookups → Estimate statuses
          </Link>{' '}
          and check the cells for your company, then return here.
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">Transitions</h2>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={showDeleted}
                    onChange={(e) => setShowDeleted(e.target.checked)}
                  />
                  Show deleted
                </label>
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
                  {visibleDraft.map((d) => {
                    const isDeleted = Boolean(d.deletedAt)
                    const sum = transitionAskSummary(d)
                    const panelOpen = actionPanelKey === d.key && !isDeleted
                    const enabled = (d.actions ?? []).some((x) => x.type === 'ask_form')
                    const a = (d.actions ?? []).find((x) => x.type === 'ask_form') ?? null
                    const cfg = a?.config ?? {}
                    const fields = Array.isArray((cfg as Record<string, unknown>).fields)
                      ? ((cfg as Record<string, unknown>).fields as unknown[])
                      : []
                    const f0 =
                      (fields[0] && typeof fields[0] === 'object' ? (fields[0] as Record<string, unknown>) : null) ??
                      null
                    const targetTable = normalizeStoredTargetTable(f0?.target)
                    const targetField = String(f0?.target_field ?? f0?.key ?? '').trim()
                    const label = String(f0?.label ?? '').trim()
                    const available = schemaFields?.tables?.[targetTable] ?? []
                    const tableNames = Object.keys(schemaFields?.tables ?? {}).sort((x, y) => x.localeCompare(y))
                    const inferred = available.find((x) => x.field === targetField)?.type ?? 'text'

                    return (
                      <Fragment key={d.key}>
                        <tr className={`hover:bg-slate-50/60 ${isDeleted ? 'bg-slate-50/90 text-slate-500' : ''}`}>
                          <td className="align-middle px-3 py-2">
                            <select
                              disabled={!canEdit || isDeleted}
                              value={d.from_status_esti_id}
                              onChange={(e) => {
                                const v = e.target.value
                                setDraft((prev) =>
                                  prev.map((x) => (x.key === d.key ? { ...x, from_status_esti_id: v } : x)),
                                )
                                setDirty(true)
                              }}
                              className="w-full max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              <option value="">(any / initial)</option>
                              {(statuses ?? []).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="align-middle px-3 py-2">
                            <select
                              disabled={!canEdit || isDeleted}
                              value={d.to_status_esti_id}
                              onChange={(e) => {
                                const v = e.target.value
                                setDraft((prev) =>
                                  prev.map((x) => (x.key === d.key ? { ...x, to_status_esti_id: v } : x)),
                                )
                                setDirty(true)
                              }}
                              className="w-full max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              <option value="">Select…</option>
                              {(statuses ?? []).map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="align-middle px-3 py-2">
                            <input
                              disabled={!canEdit || isDeleted}
                              inputMode="numeric"
                              value={d.sort_order}
                              onChange={(e) => {
                                setDraft((prev) =>
                                  prev.map((x) => (x.key === d.key ? { ...x, sort_order: e.target.value } : x)),
                                )
                                setDirty(true)
                              }}
                              className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="max-w-[14rem] px-3 py-2 align-middle">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{sum.primary}</p>
                                <p className="truncate text-xs text-slate-500">{sum.secondary}</p>
                                {isDeleted ? (
                                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                                    Deleted
                                  </p>
                                ) : null}
                              </div>
                              {canEdit && !isDeleted ? (
                                <button
                                  type="button"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                                  onClick={() =>
                                    setActionPanelKey((k) => {
                                      const next = k === d.key ? null : d.key
                                      return next
                                    })
                                  }
                                >
                                  {panelOpen ? (
                                    <>
                                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                                      Hide
                                    </>
                                  ) : (
                                    <>
                                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                                      Configure
                                    </>
                                  )}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="align-middle px-3 py-2 text-right">
                            {canEdit && isDeleted ? (
                              <button
                                type="button"
                                title="Restore transition"
                                aria-label="Restore transition"
                                className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-50"
                                onClick={() => setRowConfirm({ mode: 'restore', key: d.key })}
                              >
                                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                                Restore
                              </button>
                            ) : null}
                            {canEdit && !isDeleted ? (
                              <button
                                type="button"
                                title="Remove transition"
                                aria-label="Remove transition"
                                className="rounded-lg border border-red-200 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40"
                                onClick={() => setRowConfirm({ mode: 'delete', key: d.key })}
                                disabled={activeTransitionCount <= 1}
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={2} />
                              </button>
                            ) : null}
                          </td>
                        </tr>

                        {panelOpen ? (
                          <tr className="bg-slate-50/90">
                            <td colSpan={5} className="border-t border-slate-100 px-3 py-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Prompt on transition
                                </p>
                                <p className="mt-1 text-sm text-slate-600">
                                  Optional extra input when this From → To change runs.
                                </p>

                                <div className="mt-4 flex flex-wrap gap-6">
                                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name={`action-${d.key}`}
                                      disabled={!canEdit}
                                      checked={!enabled}
                                      onChange={() => updateTransitionAskField({ transitionKey: d.key, enabled: false })}
                                      className="text-teal-600 focus:ring-teal-500"
                                    />
                                    <span>No extra input</span>
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name={`action-${d.key}`}
                                      disabled={!canEdit}
                                      checked={enabled}
                                      onChange={() =>
                                        updateTransitionAskField({
                                          transitionKey: d.key,
                                          enabled: true,
                                          targetTable: 'estimate',
                                          targetField: 'visit_notes',
                                          label: 'Visit notes',
                                        })
                                      }
                                      className="text-teal-600 focus:ring-teal-500"
                                    />
                                    <span>Ask for one field</span>
                                  </label>
                                </div>

                                {enabled ? (
                                  <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                                    <label className="block sm:col-span-1">
                                      <span className="text-xs font-medium text-slate-700">Table</span>
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
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100"
                                      >
                                        {tableNames.length ? (
                                          tableNames.map((tn) => (
                                            <option key={tn} value={tn}>
                                              {tn}
                                            </option>
                                          ))
                                        ) : (
                                          <option value="estimate">estimate</option>
                                        )}
                                      </select>
                                    </label>
                                    <label className="block sm:col-span-1">
                                      <span className="text-xs font-medium text-slate-700">Field</span>
                                      <select
                                        disabled={!canEdit}
                                        value={targetField}
                                        onChange={(e) =>
                                          updateTransitionAskField({
                                            transitionKey: d.key,
                                            enabled: true,
                                            targetTable,
                                            targetField: e.target.value,
                                            label,
                                          })
                                        }
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100"
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
                                      <span className="text-xs font-medium text-slate-700">User-facing label</span>
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
                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-100"
                                        placeholder="e.g. Visit notes"
                                      />
                                      <p className="mt-1.5 text-xs text-slate-500">
                                        Input type is inferred from the column:{' '}
                                        <span className="font-mono">{inferred}</span>.
                                      </p>
                                    </label>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Tip: every DB table is listed for discovery; estimate workflow runtime currently supports writing to{' '}
              <span className="font-mono">estimate</span> only.
            </p>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Save estimate workflow?"
        description="This will update the company's workflow transitions. Removed rows are kept as deleted and can be shown again with “Show deleted”."
        confirmLabel="Save"
        cancelLabel="Cancel"
        pending={saving}
        onCancel={() => !saving && setConfirmOpen(false)}
        onConfirm={() => void save()}
      />

      <ConfirmModal
        open={Boolean(rowConfirm)}
        title={rowConfirm?.mode === 'restore' ? 'Restore transition?' : 'Delete transition?'}
        description={
          rowConfirm?.mode === 'restore'
            ? 'This will re-activate the transition and save immediately.'
            : 'This will soft-delete the transition and save immediately. You can restore it later using “Show deleted”.'
        }
        confirmLabel={rowConfirm?.mode === 'restore' ? 'Restore' : 'Delete'}
        cancelLabel="Cancel"
        variant={rowConfirm?.mode === 'restore' ? 'default' : 'danger'}
        pending={saving}
        onCancel={() => !saving && setRowConfirm(null)}
        onConfirm={() => {
          if (!rowConfirm || saving) return
          const k = rowConfirm.key
          if (rowConfirm.mode === 'restore') {
            const nextDraft = draft.map((x) => (x.key === k ? { ...x, deletedAt: null } : x))
            void applyDeleteRestoreAndSave(nextDraft)
          } else {
            const nextDraft = draft.filter((x) => x.key !== k)
            setActionPanelKey((cur) => (cur === k ? null : cur))
            void applyDeleteRestoreAndSave(nextDraft)
          }
        }}
      />
    </div>
  )
}

