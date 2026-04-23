import { useEffect, useState } from 'react'
import { BarChart3, Pencil, Printer, Trash2 } from 'lucide-react'
import { getJson } from '@/lib/api'

type MeSlice = { permissions: string[] }

const perm = {
  root: 'reports.access.view',
  ops: 'reports.ops.view',
  quarter: 'reports.ops.quarter.view',
  detail: 'reports.ops.quarter.detail.view',
  editView: 'reports.ops.quarter.detail.btn_edit.view',
  editUse: 'reports.ops.quarter.detail.btn_edit.edit',
  deleteView: 'reports.ops.quarter.detail.btn_delete.view',
  deleteUse: 'reports.ops.quarter.detail.btn_delete.edit',
  printView: 'reports.ops.quarter.detail.btn_print.view',
  printUse: 'reports.ops.quarter.detail.btn_print.edit',
} as const

function usePermissions() {
  const [perms, setPerms] = useState<string[] | null>(null)
  useEffect(() => {
    let c = false
    ;(async () => {
      try {
        const m = await getJson<MeSlice>('/auth/me')
        if (!c) setPerms(m.permissions)
      } catch {
        if (!c) setPerms([])
      }
    })()
    return () => {
      c = true
    }
  }, [])
  return perms
}

function Shell({
  title,
  subtitle,
  children,
}: Readonly<{
  title: string
  subtitle: string
  children?: React.ReactNode
}>) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">{children}</div>
    </div>
  )
}

export function ReportsHubPage() {
  return (
    <Shell
      title="Reports"
      subtitle="Use the sidebar to open each report screen."
    >
      <div className="space-y-4 text-sm text-slate-600">
        <p>
          Financial reports provide revenue, collected cash, outstanding balances, profit, tax, and trends for the
          selected date range.
        </p>
        <p className="text-xs text-slate-500">
          Click the <span className="font-medium text-slate-700">Reports</span> row to return here; click the
          same row again to collapse the submenu.
        </p>
      </div>
    </Shell>
  )
}

export function ReportsOpsPage() {
  return (
    <Shell
      title="Operational reports"
      subtitle="Second level — example area for an operations team."
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          Open <span className="font-medium text-slate-800">Quarterly summary</span> in the sidebar for the
          next level. From there you can open <span className="font-medium text-slate-800">Detail view</span>{' '}
          if your role includes that permission—the detail screen shows how toolbar buttons respect view and
          edit keys independently.
        </p>
        <p className="text-xs text-slate-500">
          Use the sidebar links in this branch to move between screens; parent rows use the same first-click
          open / second-click close pattern where the app shows a chevron.
        </p>
      </div>
    </Shell>
  )
}

export function ReportsQuarterPage() {
  return (
    <Shell
      title="Quarterly summary"
      subtitle="Third level — appears nested in the sidebar."
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          <span className="font-medium text-slate-800">Detail view</span> in the sidebar opens the
          demonstration page with Edit, Delete, and Print actions. Your permissions decide whether each
          control appears and whether it runs or stays disabled.
        </p>
        <p className="text-xs text-slate-500">
          Permission key for this level: <code className="text-slate-700">{perm.quarter}</code> (plus its
          edit pair in the matrix). Use the sidebar to return to this screen from Detail view.
        </p>
      </div>
    </Shell>
  )
}

export function ReportsQuarterDetailPage() {
  const list = usePermissions()
  const can = (k: string) => (list === null ? false : list.includes(k))

  if (list === null) {
    return (
      <Shell title="Detail view" subtitle="Sample toolbar — loading permissions…">
        <p className="text-sm text-slate-500">Loading…</p>
      </Shell>
    )
  }

  return (
    <Shell
      title="Detail view (4th level)"
      subtitle="View: button visible; Edit: action allowed. If Edit is off, the button stays disabled."
    >
      <div className="flex flex-wrap gap-2 border-b border-slate-100 pb-4">
        <ToolButton
          label="Edit"
          icon={Pencil}
          canSee={can(perm.editView)}
          canUse={can(perm.editUse)}
          permUseKey={perm.editUse}
        />
        <ToolButton
          label="Delete"
          icon={Trash2}
          canSee={can(perm.deleteView)}
          canUse={can(perm.deleteUse)}
          permUseKey={perm.deleteUse}
        />
        <ToolButton
          label="Print"
          icon={Printer}
          canSee={can(perm.printView)}
          canUse={can(perm.printUse)}
          permUseKey={perm.printUse}
        />
      </div>
      <p className="mt-4 text-sm text-slate-600">
        View / edit pairs are separate columns in the matrix. Example:{' '}
        <code className="text-xs text-slate-700">{perm.editView}</code> +{' '}
        <code className="text-xs text-slate-700">{perm.editUse}</code>.
      </p>
    </Shell>
  )
}

function ToolButton({
  label,
  icon: Icon,
  canSee,
  canUse,
  permUseKey,
}: Readonly<{
  label: string
  icon: typeof Pencil
  canSee: boolean
  canUse: boolean
  permUseKey: string
}>) {
  if (!canSee) return null

  const enabled = canUse
  const title = enabled
    ? label
    : `${label} — view only (action key: ${permUseKey})`

  return (
    <button
      type="button"
      disabled={!enabled}
      title={title}
      className={[
        'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition',
        enabled
          ? 'border-slate-200 bg-white text-slate-800 shadow-sm hover:border-teal-300 hover:bg-teal-50'
          : 'cursor-not-allowed border-amber-100 bg-amber-50/80 text-amber-900/90 line-through decoration-amber-700/50',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 opacity-80" strokeWidth={2} />
      {label}
    </button>
  )
}
