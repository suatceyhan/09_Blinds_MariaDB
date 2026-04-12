import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Shield } from 'lucide-react'
import { postLoginForm } from '@/lib/api'
import { appTitle } from '@/lib/brand'
import { setTokens } from '@/lib/authStorage'

export function LoginPage() {
  const nav = useNavigate()
  const title = appTitle()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      const data = await postLoginForm(email, password)
      setTokens(data.access_token, data.refresh_token)
      nav('/', { replace: true })
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Sign-in failed')
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
            <p className="text-sm text-teal-100">Sign in · Register · Password</p>
          </div>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Start projects faster.</h1>
          <p className="text-teal-100/90">
            JWT, RBAC, and password flows are ready—add your business logic on top.
          </p>
        </div>
        <p className="text-xs text-teal-200/80">FastAPI · React · PostgreSQL</p>
      </div>

      <div className="flex w-full flex-1 flex-col justify-center px-4 py-12 sm:px-8 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="text-xs text-slate-500">Sign in</p>
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-600">Sign in with your account to continue.</p>

          <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none ring-teal-600/0 transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-12 text-slate-900 shadow-sm outline-none ring-teal-600/0 transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

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
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/25 transition hover:bg-teal-700 disabled:pointer-events-none disabled:opacity-60"
            >
              {loading ? (
                <span className="inline-block size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            No account?{' '}
            <Link to="/register" className="font-semibold text-teal-700 hover:text-teal-800">
              Register
            </Link>
          </p>
          <p className="mt-4 text-center text-xs text-slate-500">
            First setup: use <code className="rounded bg-slate-100 px-1 py-0.5">SUPER_ADMIN_*</code> in backend{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">.env</code> to bootstrap an admin.
          </p>
        </div>
      </div>
    </div>
  )
}
