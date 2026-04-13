import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Calendar } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { deleteJson, getJson } from '@/lib/api'
import { useAuthSession } from '@/app/authSession'

type CalendarStatus = {
  connected: boolean
  google_account_email: string | null
  calendar_id: string | null
}

export function SettingsIntegrationsPage() {
  const me = useAuthSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const canView = Boolean(me?.permissions.includes('settings.integrations.view'))
  const canEdit = Boolean(me?.permissions.includes('settings.integrations.edit'))

  const loadStatus = useCallback(async () => {
    setErr(null)
    try {
      const s = await getJson<CalendarStatus>('/integrations/google/status')
      setStatus(s)
    } catch (e) {
      setStatus(null)
      setErr(e instanceof Error ? e.message : 'Could not load integration status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me || !canView) {
      setLoading(false)
      return
    }
    void loadStatus()
  }, [me, canView, loadStatus])

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const cal = q.get('google_calendar')
    if (!cal) return
    if (
      cal === 'connected' ||
      cal === 'denied' ||
      cal === 'error' ||
      cal === 'calendar_scope'
    ) {
      setFlash(cal)
    }
    q.delete('google_calendar')
    navigate(`/settings/integrations${q.toString() ? `?${q}` : ''}`, { replace: true })
  }, [location.search, navigate])

  async function connectGoogle() {
    setErr(null)
    try {
      const r = await getJson<{ authorization_url: string }>('/integrations/google/authorization-url')
      window.location.assign(r.authorization_url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start Google connection')
    }
  }

  async function confirmDisconnectRun() {
    setDisconnecting(true)
    setErr(null)
    try {
      await deleteJson('/integrations/google/connection')
      setConfirmDisconnect(false)
      await loadStatus()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  if (!me) return null

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <Calendar className="h-5 w-5" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Integrations</h1>
          <p className="mt-1 text-slate-600">
            Connect Google Calendar so new estimates with a scheduled time create a calendar event.
          </p>
        </div>
      </div>

      {!canView ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You need company access to view integration status.
        </p>
      ) : (
        <>
          {flash === 'connected' && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Google Calendar connected successfully.
            </p>
          )}
          {flash === 'denied' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Google sign-in was cancelled or denied.
            </p>
          )}
          {flash === 'error' && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              Something went wrong connecting Google Calendar. Check server logs and OAuth redirect URI.
            </p>
          )}
          {flash === 'calendar_scope' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Google did not grant calendar access. In Google Account → Security → Third-party access, remove this app,
              then connect again and allow &quot;View and edit events on all your calendars&quot;. Ensure that scope is
              listed in Cloud Console → Data Access.
            </p>
          )}

          {err && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{err}</p>
          )}

          <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">Google Calendar</h2>
            <p className="mt-2 text-sm text-slate-600">
              Events are added to the connected account&apos;s primary calendar when it makes sense (server must have
              OAuth credentials configured).
            </p>

            {loading ? (
              <p className="mt-4 text-sm text-slate-500">Loading…</p>
            ) : status?.connected ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-slate-800">
                  <span className="font-medium">Connected as</span>{' '}
                  {status.google_account_email ?? '(email unknown)'}
                  {status.calendar_id && status.calendar_id !== 'primary' ? (
                    <span className="text-slate-500"> — calendar: {status.calendar_id}</span>
                  ) : null}
                </p>
                {canEdit ? (
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                    onClick={() => setConfirmDisconnect(true)}
                  >
                    Disconnect Google Calendar
                  </button>
                ) : (
                  <p className="text-sm text-slate-500">Only users who can edit company settings can disconnect.</p>
                )}
              </div>
            ) : (
              <div className="mt-4">
                {canEdit ? (
                  <button
                    type="button"
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
                    onClick={() => void connectGoogle()}
                  >
                    Connect Google Calendar
                  </button>
                ) : (
                  <p className="text-sm text-slate-500">Only users who can edit company settings can connect.</p>
                )}
              </div>
            )}
          </section>
        </>
      )}

      <ConfirmModal
        open={confirmDisconnect}
        title="Disconnect Google Calendar?"
        description="New estimates will no longer add events to Google until you connect again."
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        variant="danger"
        pending={disconnecting}
        onConfirm={() => void confirmDisconnectRun()}
        onCancel={() => !disconnecting && setConfirmDisconnect(false)}
      />
    </div>
  )
}
