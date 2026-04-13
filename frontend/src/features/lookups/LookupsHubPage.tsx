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
            Maintain the catalog lines that appear on estimates and orders (names and descriptions).
            Typical actions: browse and search the list, create new types, edit existing rows, and
            deactivate or restore entries when you use show-inactive options.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Product categories</h2>
          <p className="text-sm text-slate-600">
            Names and sort order for quality tiers (e.g. Classic, Premium) used on orders together with
            blinds types. Which type accepts which category is configured under Settings → Blinds type ×
            category.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Lifting &amp; cassette options</h2>
          <p className="text-sm text-slate-600">
            Extra order-line choices (lifting system, cassette type) live under their own lookup pages.
            Allowed combinations per blinds type are set in Settings → Blinds line matrices.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Order statuses</h2>
          <p className="text-sm text-slate-600">
            Read-only list of global labels enabled for your company. Who may use which status is configured
            under Permissions → Order status matrix; superadmins add custom global statuses there.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Estimate statuses</h2>
          <p className="text-sm text-slate-600">
            Same pattern: browse enabled global labels here; matrix and custom globals live under Permissions
            → Estimate status matrix. Built-in workflow kinds still drive new estimates, conversion, and
            cancellation behavior.
          </p>
        </section>
      </div>
    </div>
  )
}
