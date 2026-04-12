import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Shield } from 'lucide-react'
import { getJson, postJson } from '@/lib/api'
import { appTitle } from '@/lib/brand'

export function ResetPasswordPage() {
  const title = appTitle()
  const [search] = useSearchParams()
  const token = search.get('token')?.trim() ?? ''

  const [valid, setValid] = useState<boolean | null>(null)
  const [checkErr, setCheckErr] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [show1, setShow1] = useState(false)
  const [show2, setShow2] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) {
      setValid(false)
      setCheckErr('No valid reset link.')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await getJson<{ msg: string }>(
          `/password_reset/validate?token=${encodeURIComponent(token)}`,
          { auth: false },
        )
        if (!cancelled) {
          setValid(true)
          setCheckErr(null)
        }
      } catch (ex) {
        if (!cancelled) {
          setValid(false)
          setCheckErr(ex instanceof Error ? ex.message : 'Invalid or expired link.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setOk(null)
    if (password !== again) {
      setErr('New passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const data = await postJson<{ msg: string }>(
        '/password_reset/confirm',
        {
          token,
          new_password: password,
          new_password_again: again,
        },
        { auth: false },
      )
      setOk(data.msg)
      setPassword('')
      setAgain('')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not update password')
    } finally {
      setLoading(false)
    }
  }

  const formDisabled = valid !== true || !!ok

  return (
    <div className="relative flex min-h-screen">
      <div
        className="relative hidden w-1/2 flex-col justify-between bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-800 p-10 text-white lg:flex"
        aria-hidden
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Shield className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-semibold tracking-tight">{title}</p>
            <p className="text-sm text-teal-100">New password</p>
          </div>
        </div>
        <p className="max-w-md text-teal-100/90">Choose a strong password; you can sign in after this step.</p>
        <p className="text-xs text-teal-200/80">Auth template</p>
      </div>

      <div className="flex w-full flex-1 flex-col justify-center px-4 py-12 sm:px-8 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-[400px]">
          <Link
            to="/login"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-teal-700 hover:text-teal-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Set new password</h2>
          <p className="mt-1 text-sm text-slate-600">
            {valid === null ? 'Checking link…' : null}
            {valid === false ? (checkErr ?? 'This page cannot be used.') : null}
            {valid === true ? 'Enter your new password twice.' : null}
          </p>

          {valid === true ? (
            <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-5">
              <div>
                <label htmlFor="np1" className="mb-1.5 block text-sm font-medium text-slate-700">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="np1"
                    name="password"
                    type={show1 ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={formDisabled}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-12 text-slate-900 shadow-sm outline-none ring-teal-600/0 transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                    onClick={() => setShow1((s) => !s)}
                    aria-label={show1 ? 'Hide password' : 'Show password'}
                  >
                    {show1 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="np2" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Confirm new password
                </label>
                <div className="relative">
                  <input
                    id="np2"
                    name="password2"
                    type={show2 ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={again}
                    onChange={(e) => setAgain(e.target.value)}
                    required
                    disabled={formDisabled}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-12 text-slate-900 shadow-sm outline-none ring-teal-600/0 transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                    onClick={() => setShow2((s) => !s)}
                    aria-label={show2 ? 'Hide password' : 'Show password'}
                  >
                    {show2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {ok ? (
                <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900" role="status">
                  {ok}{' '}
                  <Link to="/login" className="font-semibold underline underline-offset-2">
                    Sign in
                  </Link>
                </div>
              ) : null}

              {err ? (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                  {err}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || formDisabled}
                className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:pointer-events-none disabled:opacity-60"
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  )
}
