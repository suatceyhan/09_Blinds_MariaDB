import { useCallback, useEffect, useMemo, useState } from 'react'
import { Grid3x3 } from 'lucide-react'
import { useAuthSession } from '@/app/authSession'
import { getJson, putJson } from '@/lib/api'

type CategoryMatrixOut = {
  blinds_types: { id: string; name: string }[]
  categories: { id: string; name: string; sort_order: number }[]
  allowed_pairs: { blinds_type_id: string; category_code: string }[]
}

type ExtraMatrixOut = {
  kind_id: string
  kind_name: string
  blinds_types: { id: string; name: string }[]
  options: { id: string; name: string; sort_order: number }[]
  allowed_pairs: { blinds_type_id: string; option_code: string }[]
}

type KindBrief = { id: string; name: string; sort_order: number }

function pairKey(a: string, b: string) {
  return `${a}\0${b}`
}

export function SettingsBlindsLineMatricesPage() {
  const me = useAuthSession()
  const canView = Boolean(me?.permissions.includes('settings.access.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.access.edit'))

  const [kinds, setKinds] = useState<KindBrief[]>([])
  const [catData, setCatData] = useState<CategoryMatrixOut | null>(null)
  const [catSelected, setCatSelected] = useState<Set<string>>(() => new Set())
  const [catDirty, setCatDirty] = useState(false)

  const [extraByKind, setExtraByKind] = useState<
    Record<
      string,
      {
        data: ExtraMatrixOut | null
        selected: Set<string>
        dirty: boolean
        err: string | null
      }
    >
  >({})

  const [globalErr, setGlobalErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setGlobalErr(null)
    try {
      const [kList, cmat] = await Promise.all([
        getJson<KindBrief[]>('/settings/blinds-extra-matrix-kinds'),
        getJson<CategoryMatrixOut>('/settings/blinds-category-matrix'),
      ])
      setKinds(kList)
      setCatData(cmat)
      const catNext = new Set<string>()
      for (const p of cmat.allowed_pairs) {
        catNext.add(pairKey(p.blinds_type_id, p.category_code))
      }
      setCatSelected(catNext)
      setCatDirty(false)

      const settled = await Promise.allSettled(
        kList.map((k) =>
          getJson<ExtraMatrixOut>(`/settings/blinds-extra-matrix/${encodeURIComponent(k.id)}`),
        ),
      )
      const nextExtra: typeof extraByKind = {}
      for (let i = 0; i < kList.length; i++) {
        const k = kList[i]
        const r = settled[i]
        if (r.status === 'fulfilled') {
          const m = r.value
          const sel = new Set<string>()
          for (const p of m.allowed_pairs) {
            sel.add(pairKey(p.blinds_type_id, p.option_code))
          }
          nextExtra[k.id] = { data: m, selected: sel, dirty: false, err: null }
        } else {
          const msg =
            r.reason instanceof Error ? r.reason.message : `Could not load matrix for “${k.name}”.`
          nextExtra[k.id] = { data: null, selected: new Set(), dirty: false, err: msg }
        }
      }
      setExtraByKind(nextExtra)
    } catch (e) {
      setCatData(null)
      setKinds([])
      setExtraByKind({})
      setGlobalErr(e instanceof Error ? e.message : 'Could not load matrices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me || !canView) return
    void loadAll()
  }, [me, canView, loadAll])

  const anyDirty = useMemo(() => {
    if (catDirty) return true
    return Object.values(extraByKind).some((x) => x.dirty)
  }, [catDirty, extraByKind])

  const toggleCategory = useCallback((blindsTypeId: string, categoryCode: string) => {
    if (!canEdit) return
    const k = pairKey(blindsTypeId, categoryCode)
    setCatSelected((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
    setCatDirty(true)
  }, [canEdit])

  const toggleExtra = useCallback((kindId: string, blindsTypeId: string, optionCode: string) => {
    if (!canEdit) return
    const k = pairKey(blindsTypeId, optionCode)
    setExtraByKind((prev) => {
      const cur = prev[kindId]
      if (!cur) return prev
      const nextSel = new Set(cur.selected)
      if (nextSel.has(k)) nextSel.delete(k)
      else nextSel.add(k)
      return {
        ...prev,
        [kindId]: { ...cur, selected: nextSel, dirty: true, err: null },
      }
    })
  }, [canEdit])

  const catPairsPayload = useMemo(() => {
    const out: { blinds_type_id: string; category_code: string }[] = []
    for (const k of catSelected) {
      const [bt, cat] = k.split('\0')
      if (bt && cat) out.push({ blinds_type_id: bt, category_code: cat })
    }
    return out
  }, [catSelected])

  async function onSaveAll() {
    if (!canEdit || !anyDirty) return
    setSaving(true)
    setGlobalErr(null)
    setExtraByKind((prev) => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], err: null }
      }
      return next
    })
    try {
      if (catDirty) {
        await putJson<CategoryMatrixOut>('/settings/blinds-category-matrix', { pairs: catPairsPayload })
      }
      for (const k of kinds) {
        const block = extraByKind[k.id]
        if (!block?.dirty) continue
        const pairs: { blinds_type_id: string; option_code: string }[] = []
        for (const key of block.selected) {
          const [bt, opt] = key.split('\0')
          if (bt && opt) pairs.push({ blinds_type_id: bt, option_code: opt })
        }
        await putJson<ExtraMatrixOut>(`/settings/blinds-extra-matrix/${encodeURIComponent(k.id)}`, {
          pairs,
        })
      }
      await loadAll()
    } catch (e) {
      setGlobalErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!me) return <p className="text-sm text-slate-500">Loading…</p>

  if (!canView) {
    return (
      <p className="text-sm text-slate-600">You do not have permission to view this settings screen.</p>
    )
  }

  return (
    <div className="mx-auto max-w-[100rem] space-y-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Grid3x3 className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Blinds line option matrices
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              For each option list (rows), choose which blinds types (columns) may use it on orders. Product
              categories are under Lookups → Product categories; lifting, cassette, and other line options
              under their own lookup pages.
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={saving || !anyDirty}
            onClick={() => void onSaveAll()}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save all changes'}
          </button>
        ) : null}
      </div>

      {globalErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {globalErr}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Product category</h2>
            {!catData?.blinds_types.length ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Add active blinds types under Lookups first, then configure this matrix.
              </p>
            ) : !catData.categories.length ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Add product categories under Lookups → Product categories first.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="sticky left-0 z-10 min-w-[10rem] bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Product category
                      </th>
                      {catData.blinds_types.map((bt) => (
                        <th
                          key={bt.id}
                          className="min-w-[5.5rem] max-w-[8rem] px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600"
                          title={bt.id}
                        >
                          <span className="line-clamp-2">{bt.name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {catData.categories.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                          <span className="line-clamp-2">{c.name}</span>
                        </td>
                        {catData.blinds_types.map((bt) => {
                          const on = catSelected.has(pairKey(bt.id, c.id))
                          return (
                            <td key={bt.id} className="px-1 py-1 text-center align-middle">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
                                checked={on}
                                disabled={!canEdit}
                                onChange={() => toggleCategory(bt.id, c.id)}
                                aria-label={`${c.name} — ${bt.name}`}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {kinds.map((kind) => {
            const block = extraByKind[kind.id]
            const data = block?.data
            return (
              <section key={kind.id} className="space-y-3 border-t border-slate-200 pt-8">
                <h2 className="text-lg font-semibold text-slate-900">{data?.kind_name ?? kind.name}</h2>
                {block?.err ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {block.err}
                  </div>
                ) : null}
                {!data?.blinds_types.length ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Add active blinds types under Lookups first, then configure this matrix.
                  </p>
                ) : !data.options.length ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Add options for this attribute under Lookups before configuring the matrix.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full min-w-max border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className="sticky left-0 z-10 min-w-[10rem] bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Option
                          </th>
                          {data.blinds_types.map((bt) => (
                            <th
                              key={bt.id}
                              className="min-w-[5.5rem] max-w-[8rem] px-1 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600"
                              title={bt.id}
                            >
                              <span className="line-clamp-2">{bt.name}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.options.map((opt) => (
                          <tr key={opt.id} className="hover:bg-slate-50/80">
                            <td className="sticky left-0 z-10 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                              <span className="line-clamp-2">{opt.name}</span>
                            </td>
                            {data.blinds_types.map((bt) => {
                              const sel = block?.selected ?? new Set()
                              const on = sel.has(pairKey(bt.id, opt.id))
                              return (
                                <td key={bt.id} className="px-1 py-1 text-center align-middle">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
                                    checked={on}
                                    disabled={!canEdit}
                                    onChange={() => toggleExtra(kind.id, bt.id, opt.id)}
                                    aria-label={`${opt.name} — ${bt.name}`}
                                  />
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
