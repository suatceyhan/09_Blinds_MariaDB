import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { getJson, postJson } from '@/lib/api'

type EmployeeRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  is_email_verified: boolean
  pending_status: string
  requested_at: string
}

type CompanyRow = EmployeeRow & {
  company_name: string
  company_phone: string | null
  website: string | null
}

type Tab = 'employee' | 'company'

function formatStatusLabel(status: string): string {
  return status.replaceAll('_', ' ')
}

export function SettingsPendingApplicationsPage() {
  const [tab, setTab] = useState<Tab>('employee')
  const [employees, setEmployees] = useState<EmployeeRow[]>([])
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [statusFilterEmployee, setStatusFilterEmployee] = useState<string | null>(null)
  const [statusFilterCompany, setStatusFilterCompany] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<{
    kind: 'approve' | 'deny'
    tab: Tab
    id: string
    label: string
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [e, c] = await Promise.all([
        getJson<EmployeeRow[]>('/pending-employee-registrations?limit=200'),
        getJson<CompanyRow[]>('/pending-company-registrations?limit=200'),
      ])
      setEmployees(e)
      setCompanies(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function runAction() {
    if (!action) return
    const { kind, tab: t, id } = action
    setAction(null)
    setError(null)
    try {
      const base =
        t === 'employee' ? `/pending-employee-registrations/${id}` : `/pending-company-registrations/${id}`
      if (kind === 'approve') {
        await postJson(`${base}/approve`, {})
      } else {
        await postJson(`${base}/deny`, {})
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  const rows = tab === 'employee' ? employees : companies
  const activeStatusFilter = tab === 'employee' ? statusFilterEmployee : statusFilterCompany

  const statusOptions = useMemo(() => {
    const source = tab === 'employee' ? employees : companies
    return [...new Set(source.map((r) => r.pending_status))].sort((a, b) => a.localeCompare(b))
  }, [tab, employees, companies])

  const filteredRows = useMemo(() => {
    if (!activeStatusFilter) return rows
    return rows.filter((r) => r.pending_status === activeStatusFilter)
  }, [rows, activeStatusFilter])

  function toggleStatusFilter(status: string) {
    if (tab === 'employee') {
      setStatusFilterEmployee((prev) => (prev === status ? null : status))
    } else {
      setStatusFilterCompany((prev) => (prev === status ? null : status))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ConfirmModal
        open={action != null}
        title={action?.kind === 'approve' ? 'Approve application?' : 'Deny application?'}
        description={
          action
            ? action.kind === 'approve'
              ? `Approve registration for ${action.label}?`
              : `Deny registration for ${action.label}?`
            : ''
        }
        confirmLabel={action?.kind === 'approve' ? 'Approve' : 'Deny'}
        cancelLabel="Cancel"
        variant={action?.kind === 'deny' ? 'danger' : 'default'}
        onConfirm={() => void runAction()}
        onCancel={() => setAction(null)}
      />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">Pending applications</h1>
        <p className="mt-1 text-sm text-slate-600">
          Approve or deny employee and company self-service registrations after email verification.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('employee')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'employee' ? 'bg-teal-100 text-teal-900' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Employees ({employees.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('company')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'company' ? 'bg-teal-100 text-teal-900' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            Companies ({companies.length})
          </button>
        </div>
        {!loading && statusOptions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:ml-auto">
            <span className="sr-only">Filter by status</span>
            {statusOptions.map((st) => {
              const selected = activeStatusFilter === st
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => toggleStatusFilter(st)}
                  aria-pressed={selected}
                  className={[
                    'rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                    selected
                      ? 'border-teal-600 bg-teal-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  ].join(' ')}
                >
                  {formatStatusLabel(st)}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="text-sm text-slate-500">No applications in this list.</p>
      ) : null}
      {!loading && rows.length > 0 && filteredRows.length === 0 ? (
        <p className="text-sm text-slate-500">No applications match this status filter.</p>
      ) : null}
      {!loading && filteredRows.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {filteredRows.map((row) => {
            const label =
              tab === 'company'
                ? `${(row as CompanyRow).company_name} — ${row.email}`
                : `${row.first_name} ${row.last_name} — ${row.email}`
            const canDecide = row.is_email_verified && row.pending_status === 'PENDING_APPROVAL'
            return (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  {tab === 'company' ? (
                    <p className="font-medium text-slate-900">{(row as CompanyRow).company_name}</p>
                  ) : (
                    <p className="font-medium text-slate-900">
                      {row.first_name} {row.last_name}
                    </p>
                  )}
                  <p className="text-slate-600">{row.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Status: {row.pending_status}
                    {row.is_email_verified ? ' · email verified' : ' · email not verified'}
                  </p>
                </div>
                {canDecide ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAction({ kind: 'deny', tab, id: row.id, label })}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => setAction({ kind: 'approve', tab, id: row.id, label })}
                      className="rounded-lg bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700"
                    >
                      Approve
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
