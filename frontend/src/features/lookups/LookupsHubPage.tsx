import { BookMarked } from 'lucide-react'

export function LookupsHubPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <BookMarked className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Lookups</h1>
          <p className="mt-1 text-sm text-slate-600">
            Tenant catalog data used across estimates and orders. Open a subsection from the expanded list
            below the <span className="font-medium text-slate-800">Lookups</span> row in the sidebar.
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Tip: the <span className="font-medium text-slate-700">Lookups</span> row opens this overview on first
        click; click the same row again to collapse the submenu.
      </p>

      <div className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Blinds types</h2>
          <p className="text-sm text-slate-600">
            Same page layout as order statuses (header, add block, manage table), but types are stored per
            company (no global company × type matrix). Switch the active company in the header to manage another
            tenant&apos;s list; use show inactive to include deactivated rows.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Product categories</h2>
          <p className="text-sm text-slate-600">
            Same pattern as estimate and order statuses: a global catalog, a management table (name, sort,
            active), and a company × category matrix on one screen. Per-company toggles control which global
            categories each tenant may use. Which blinds type accepts which category is still configured under
            Settings → Blinds line matrices.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Estimate &amp; order statuses</h2>
          <p className="text-sm text-slate-600">
            Global status labels and per-company enablement are under Lookups → Estimate statuses and Order
            statuses. Extra line attributes (lifting, cassette, etc.) are edited only from Settings → Blinds line
            matrices.
          </p>
        </section>
      </div>
    </div>
  )
}
