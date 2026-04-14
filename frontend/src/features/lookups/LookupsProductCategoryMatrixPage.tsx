import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, putJson } from '@/lib/api'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

type CompanyBrief = { id: string; name: string }
type CategoryRow = { id: string; name: string; active: boolean; sort_order: number }
type Cell = { company_id: string; status_id: string; enabled: boolean }

type MatrixOut = {
  companies: CompanyBrief[]
  categories: CategoryRow[]
  cells: Cell[]
}

function cellKey(companyId: string, categoryId: string) {
  return `${companyId}\t${categoryId}`
}

export function LookupsProductCategoryMatrixPage() {
  const me = useAuthSession()
  const canView = Boolean(
    me?.permissions.includes('lookups.product_categories.view') || me?.permissions.includes('lookups.view'),
  )
  const canEdit = Boolean(
    me?.permissions.includes('lookups.product_categories.edit') || me?.permissions.includes('lookups.edit'),
  )

  const [data, setData] = useState<MatrixOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    if (!me || !canView) return
    setLoading(true)
    setErr(null)
    try {
      const m = await getJson<MatrixOut>('/permissions/product-category-matrix')
      setData(m)
      const next: Record<string, boolean> = {}
      for (const c of m.cells) {
        next[cellKey(c.company_id, c.status_id)] = c.enabled
      }
      setEnabledMap(next)
      setDirty(false)
    } catch (e) {
      setData(null)
      setErr(e instanceof Error ? e.message : 'Could not load category availability')
    } finally {
      setLoading(false)
    }
  }, [me, canView])

  useEffect(() => {
    void load()
  }, [load])

  const gridCategories = useMemo(() => (data?.categories ?? []).filter((c) => c.active), [data])

  const toggle = useCallback(
    (companyId: string, categoryId: string) => {
      if (!canEdit) return
      const k = cellKey(companyId, categoryId)
      setEnabledMap((prev) => ({ ...prev, [k]: !prev[k] }))
      setDirty(true)
    },
    [canEdit],
  )

  const buildPayload = useCallback((): Cell[] => {
    if (!data) return []
    const out: Cell[] = []
    for (const co of data.companies) {
      for (const cat of gridCategories) {
        const k = cellKey(co.id, cat.id)
        out.push({
          company_id: co.id,
          status_id: cat.id,
          enabled: Boolean(enabledMap[k]),
        })
      }
    }
    return out
  }, [data, enabledMap, gridCategories])

  async function save() {
    if (!data || !canEdit) return
    setSaving(true)
    setSaveErr(null)
    try {
      await putJson<MatrixOut>('/permissions/product-category-matrix', { cells: buildPayload() })
      setConfirmOpen(false)
      await load()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null
  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-600">
        You do not have permission to view category availability.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <LayoutGrid className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Category availability</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Global product categories (shared catalog). Rows are companies; columns are categories. Check a cell
              to allow that company to use the category in orders, estimates, and the type×category matrix. Edit names
              on <span className="font-medium text-slate-800">Lookups → Product categories</span>.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit ? (
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => setConfirmOpen(true)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
      ) : null}
      {saveErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{saveErr}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {(() => {
          if (loading) return <p className="p-6 text-sm text-slate-500">Loading…</p>
          if (!data?.companies.length) return <p className="p-6 text-sm text-slate-500">No companies to show.</p>
          if (!gridCategories.length) return <p className="p-6 text-sm text-slate-500">No active categories.</p>
          return (
            <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90">
                  <th className="sticky left-0 z-10 bg-slate-50/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Company
                  </th>
                  {gridCategories.map((c) => (
                    <th
                      key={c.id}
                      className="min-w-[7rem] px-2 py-2 text-center text-xs font-semibold text-slate-700"
                      title={c.id}
                    >
                      <span className="line-clamp-2">{c.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.companies.map((co) => (
                  <tr key={co.id} className="border-b border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{co.name}</td>
                    {gridCategories.map((cat) => {
                      const k = cellKey(co.id, cat.id)
                      const on = Boolean(enabledMap[k])
                      return (
                        <td key={cat.id} className="px-1 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-teal-600"
                            checked={on}
                            disabled={!canEdit}
                            onChange={() => toggle(co.id, cat.id)}
                            aria-label={`${co.name} — ${cat.name}`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Save category availability"
        description="Update which companies may use each global product category?"
        confirmLabel="Save"
        pending={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      />
    </div>
  )
}
