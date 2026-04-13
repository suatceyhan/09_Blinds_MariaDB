import { Shield } from 'lucide-react'

export function PermissionsHubPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Shield className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Permissions</h1>
          <p className="mt-1 text-slate-600">
            Role and access control. Open each subsection from the sidebar under{' '}
            <span className="font-medium text-slate-800">Permissions</span>; each screen enforces its own
            view and edit permissions.
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Click the <span className="font-medium text-slate-700">Permissions</span> row to return here; click
        again to collapse the submenu.
      </p>

      <div className="space-y-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">Roles</h2>
          <p className="text-sm text-slate-600">
            Define named roles: list roles, create or rename them, and retire roles you no longer assign.
            Roles anchor permission bundles and user assignments.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Role permissions</h2>
          <p className="text-sm text-slate-600">
            Use the permission matrix to toggle which application permissions each role receives, including
            separate view versus action keys where the app uses them.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">User roles</h2>
          <p className="text-sm text-slate-600">
            Assign one or more roles to each user: search users, change role membership, and align people
            with the areas you defined under Roles.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">User permissions</h2>
          <p className="text-sm text-slate-600">
            Grant per-user exceptions when someone needs finer control than roles alone provide; adjust
            individual flags alongside matrix defaults.
          </p>
        </section>
        <section className="space-y-2 border-t border-slate-100 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Estimate &amp; order status matrices</h2>
          <p className="text-sm text-slate-600">
            Global status labels apply to every company; each matrix row is a company and each column is a
            status. Checked cells allow that company to use the status in forms and lookups. Superadmins can
            add custom global statuses from the matrix pages.
          </p>
        </section>
      </div>
    </div>
  )
}
