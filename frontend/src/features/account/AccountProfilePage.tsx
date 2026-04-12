import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, User } from 'lucide-react'
import { useAuthSession, REFRESH_SESSION_EVENT } from '@/app/authSession'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { postJson } from '@/lib/api'

type Pending =
  | { kind: 'company'; id: string; name: string }
  | { kind: 'role'; name: string }
  | null

export function AccountProfilePage() {
  const me = useAuthSession()
  const [pending, setPending] = useState<Pending>(null)
  const [pendingSubmit, setPendingSubmit] = useState(false)

  if (!me) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    )
  }

  const activeSessionCompanyId = me.active_company_id ?? me.company_id ?? null
  const activeSessionRole = me.active_role ?? me.roles[0] ?? null
  const defaultRoleName = me.default_role ?? null

  const companiesCount = me.companies?.length ?? 0
  const companiesLabel = companiesCount === 1 ? 'Company' : 'Companies'
  const rolesLabel = me.roles.length === 1 ? 'Role' : 'Roles'
  const defaultCompanyId = me.company_id

  function chipCompanyLabel(c: { id: string; name: string }) {
    const isDefault = defaultCompanyId != null && String(c.id) === String(defaultCompanyId)
    return isDefault ? `${c.name} (default)` : c.name
  }

  function chipRoleLabel(role: string) {
    const isDefault = defaultRoleName != null && role === defaultRoleName
    return isDefault ? `${role} (default)` : role
  }

  async function confirmDefaultChange() {
    if (!pending) return
    setPendingSubmit(true)
    try {
      if (pending.kind === 'company') {
        await postJson('/auth/set-default-company', { company_id: pending.id })
      } else {
        await postJson('/auth/set-default-role', { role: pending.name })
      }
      globalThis.dispatchEvent(new Event(REFRESH_SESSION_EVENT))
      setPending(null)
    } catch {
      /* keep modal open; user can cancel */
    } finally {
      setPendingSubmit(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <ConfirmModal
        open={pending != null}
        title={pending?.kind === 'company' ? 'Set default company' : 'Set default role'}
        description={
          pending == null
            ? ''
            : pending.kind === 'company'
              ? `Use “${pending.name}” as your default company on the next login? Your current session company (header) does not change.`
              : `Use “${pending.name}” as your default role on the next login? Your active role in the header does not change.`
        }
        confirmLabel="Save default"
        pending={pendingSubmit}
        onConfirm={() => void confirmDefaultChange()}
        onCancel={() => !pendingSubmit && setPending(null)}
      />

      <div className="flex items-start gap-4">
        {me.photo_url ? (
          <img
            src={me.photo_url}
            alt=""
            className="h-16 w-16 rounded-2xl object-cover ring-2 ring-slate-100"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-600 text-lg font-semibold text-white">
            {(me.first_name[0] ?? '') + (me.last_name[0] ?? '')}
          </div>
        )}
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <User className="h-6 w-6 text-teal-600" strokeWidth={2} />
            Profile
          </h1>
          <p className="mt-1 text-slate-600">Your account details from the server.</p>
        </div>
      </div>

      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</dt>
          <dd className="text-sm font-medium text-slate-900 sm:col-span-2">
            {me.first_name} {me.last_name}
          </dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt>
          <dd className="text-sm text-slate-800 sm:col-span-2">{me.email}</dd>
        </div>
        <div className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
          <dd className="text-sm text-slate-800 sm:col-span-2">{me.phone || '—'}</dd>
        </div>
        {companiesCount > 0 ? (
          <div className="grid gap-2 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {companiesLabel}
            </dt>
            <dd className="sm:col-span-2">
              <ul className="flex flex-wrap gap-2">
                {me.companies!.map((c) => {
                  const isSession =
                    activeSessionCompanyId != null && String(c.id) === String(activeSessionCompanyId)
                  const isDefault = me.company_id != null && String(c.id) === String(me.company_id)
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={isDefault}
                        onClick={() => {
                          if (!isDefault) setPending({ kind: 'company', id: c.id, name: c.name })
                        }}
                        className={
                          isSession
                            ? 'inline-flex rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm disabled:cursor-default disabled:opacity-100'
                            : 'inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200/90 transition hover:bg-slate-200/80 disabled:cursor-not-allowed disabled:opacity-60'
                        }
                      >
                        {chipCompanyLabel(c)}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Teal = active session (header). Click another company to set the default for next login.
              </p>
            </dd>
          </div>
        ) : null}
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rolesLabel}</dt>
          <dd className="sm:col-span-2">
            {me.roles.length === 0 ? (
              <span className="text-sm text-slate-600">—</span>
            ) : (
              <>
                <ul className="flex flex-wrap gap-2">
                  {me.roles.map((role) => {
                    const isSession = activeSessionRole != null && role === activeSessionRole
                    const isDefault = defaultRoleName != null && role === defaultRoleName
                    return (
                      <li key={role}>
                        <button
                          type="button"
                          disabled={isDefault}
                          onClick={() => {
                            if (!isDefault) setPending({ kind: 'role', name: role })
                          }}
                          className={
                            isSession
                              ? 'inline-flex rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm disabled:cursor-default disabled:opacity-100'
                              : 'inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200/90 transition hover:bg-slate-200/80 disabled:cursor-not-allowed disabled:opacity-60'
                          }
                        >
                          {chipRoleLabel(role)}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  Teal = active role (header). Click another role to set the default for next login.
                </p>
              </>
            )}
          </dd>
        </div>
      </dl>

      <Link
        to="/account/password"
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/50"
      >
        <KeyRound className="h-4 w-4 text-teal-700" />
        Change password
      </Link>
    </div>
  )
}
