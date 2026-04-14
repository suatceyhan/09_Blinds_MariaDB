import type { LucideIcon } from 'lucide-react'

type LookupPageLayoutProps = {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  /** Optional right-side actions (e.g. matrix link is in description for read-only pages). */
  headerAside?: React.ReactNode
  /** Wider content column for dense CRUD tables (default read-only width). */
  wide?: boolean
  children: React.ReactNode
}

/**
 * Shared shell for Lookups hub pages: icon, title, description, then toolbar + table content.
 */
export function LookupPageLayout(props: Readonly<LookupPageLayoutProps>) {
  const Icon = props.icon
  const max = props.wide ? 'max-w-6xl' : 'max-w-4xl'
  return (
    <div className={`mx-auto ${max} space-y-4 px-4 py-4`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{props.title}</h1>
            {props.description ? (
              <div className="mt-1 text-sm text-slate-600">{props.description}</div>
            ) : null}
          </div>
        </div>
        {props.headerAside}
      </div>
      {props.children}
    </div>
  )
}

export function LookupSearchToolbar(props: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex flex-wrap items-center gap-3">{props.children}</div>
}
