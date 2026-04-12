import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { getJson, postJson } from '@/lib/api'

type MeSlice = {
  permissions: string[]
  must_change_password?: boolean
}

export function ChangePasswordPage() {
  const [me, setMe] = useState<MeSlice | null | undefined>(undefined)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [show1, setShow1] = useState(false)
  const [show2, setShow2] = useState(false)
  const [show3, setShow3] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const u = await getJson<MeSlice>('/auth/me')
        if (!cancelled) setMe(u)
      } catch {
        if (!cancelled) setMe(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!me) return
    const canEdit =
      !!me.must_change_password || me.permissions.includes('account.password.edit')
    if (!canEdit) return
    setMsg(null)
    setErr(null)
    setLoading(true)
    try {
      const r = await postJson<{ msg: string }>('/auth/change_password', {
        current_password: current,
        new_password: next,
        new_password_again: again,
      })
      setMsg(r.msg)
      setCurrent('')
      setNext('')
      setAgain('')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (me === undefined) {
    return <p className="text-sm text-slate-500">Loading…</p>
  }
  if (me === null) {
    return <Navigate to="/login" replace />
  }

  const canView =
    !!me.must_change_password || me.permissions.includes('account.password.view')
  if (!canView) {
    return <Navigate to="/" replace />
  }

  const canEdit =
    !!me.must_change_password || me.permissions.includes('account.password.edit')

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Change password</h1>
          <p className="mt-1 text-sm text-slate-600">Enter your current password and a new one. You stay signed in.</p>
        </div>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm"
      >
        {!canEdit ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your role does not allow <strong>updating</strong> the password; fields are read-only. Ask an admin
            for the <code className="text-xs">account.password.edit</code> permission.
          </div>
        ) : null}

        <fieldset
          disabled={!canEdit}
          className="min-w-0 space-y-4 border-0 p-0 [&:disabled]:opacity-65"
        >
          {['current', 'next', 'again'].map((key) => (
            <div key={key}>
              <label
                htmlFor={`cp-${key}`}
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                {key === 'current'
                  ? 'Current password'
                  : key === 'next'
                    ? 'New password'
                    : 'Confirm new password'}
              </label>
              <div className="relative">
                <input
                  id={`cp-${key}`}
                  type={
                    (key === 'current' && !show1) ||
                    (key === 'next' && !show2) ||
                    (key === 'again' && !show3)
                      ? 'password'
                      : 'text'
                  }
                  autoComplete={
                    key === 'current' ? 'current-password' : 'new-password'
                  }
                  value={key === 'current' ? current : key === 'next' ? next : again}
                  onChange={(e) =>
                    key === 'current'
                      ? setCurrent(e.target.value)
                      : key === 'next'
                        ? setNext(e.target.value)
                        : setAgain(e.target.value)
                  }
                  required={canEdit}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-12 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:bg-slate-50"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-40"
                  onClick={() =>
                    key === 'current'
                      ? setShow1((s) => !s)
                      : key === 'next'
                        ? setShow2((s) => !s)
                        : setShow3((s) => !s)
                  }
                  aria-label="Toggle password visibility"
                >
                  {(key === 'current' ? show1 : key === 'next' ? show2 : show3) ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </fieldset>

        {msg ? (
          <div
            className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900"
            role="status"
          >
            {msg}
          </div>
        ) : null}
        {err ? (
          <div
            className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {err}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !canEdit}
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
