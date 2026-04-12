import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'
import { postJson } from '@/lib/api'
import { appTitle } from '@/lib/brand'

const COOLDOWN_SEC = 60

type RequestResponse = { msg: string; reset_token?: string | null }

export function ForgotPasswordPage() {
  const title = appTitle()
  const [email, setEmail] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [devToken, setDevToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = globalThis.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1))
    }, 1000)
    return () => globalThis.clearInterval(t)
  }, [cooldown])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setInfo(null)
    setDevToken(null)
    setLoading(true)
    try {
      const data = await postJson<RequestResponse>(
        '/password_reset/request',
        { email: email.trim() },
        { auth: false },
      )
      setInfo(data.msg)
      if (data.reset_token) setDevToken(data.reset_token)
      setCooldown(COOLDOWN_SEC)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

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
            <p className="text-sm text-teal-100">Password reset</p>
          </div>
        </div>
        <p className="max-w-md text-teal-100/90">
          Enter your registered email. If the account exists, reset instructions are prepared; in development the
          API may return a token in the response.
        </p>
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

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Forgot password</h2>
          <p className="mt-1 text-sm text-slate-600">
            Enter your work email. You will receive instructions or (in dev) a reset link hint in the response.
          </p>

          <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-5">
            <div>
              <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="fp-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || cooldown > 0}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none ring-teal-600/0 transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 disabled:opacity-60"
                placeholder="you@company.com"
              />
            </div>

            {info ? (
              <div
                className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900"
                role="status"
              >
                {info}
                {devToken ? (
                  <p className="mt-3 border-t border-teal-200/80 pt-3 text-xs text-teal-800">
                    Development:{' '}
                    <Link
                      to={`/reset-password?token=${encodeURIComponent(devToken)}`}
                      className="font-semibold underline underline-offset-2 hover:text-teal-950"
                    >
                      Set new password
                    </Link>
                  </p>
                ) : null}
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
              disabled={loading || cooldown > 0}
              className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:pointer-events-none disabled:opacity-60"
            >
              {loading
                ? 'Sending…'
                : cooldown > 0
                  ? `Try again in ${cooldown}s`
                  : 'Send reset request'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
