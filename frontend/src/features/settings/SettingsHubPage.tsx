import { SlidersHorizontal } from 'lucide-react'

export function SettingsHubPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <SlidersHorizontal className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
          <p className="mt-1 text-slate-600">
            Company-wide configuration. Use the items under <span className="font-medium text-slate-800">Settings</span>{' '}
            in the sidebar to work in each area; access depends on your role.
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Click the <span className="font-medium text-slate-700">Settings</span> row to return here; click again
        to collapse the submenu.
      </p>

      <div className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Pending applications</h2>
          <p className="text-sm text-slate-600">
            Review employee and company registration requests that are waiting for approval. Inspect
            submitted details and move applications through the workflow your organization uses.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Company info</h2>
          <p className="text-sm text-slate-600">
            Update the active company&apos;s profile: name, contact details, and address. Set the default
            sales tax rate so orders can calculate tax from the taxable base consistently.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Blinds line matrices</h2>
          <p className="text-sm text-slate-600">
            One screen lists every order-line option matrix: product category, lifting system, cassette type,
            and any other active line attributes. Each matrix defines which options are allowed per blinds
            type. Global product category names and per-company category enablement are on Lookups → Product
            categories (same screen).
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Integrations</h2>
          <p className="text-sm text-slate-600">
            Connect external services—for example Google Calendar OAuth—so scheduled work such as estimates
            can create or sync calendar events when the backend is configured.
          </p>
        </section>
      </div>
    </div>
  )
}
