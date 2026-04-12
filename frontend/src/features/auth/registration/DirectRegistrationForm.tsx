import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, Shield } from 'lucide-react'
import { postJson } from '@/lib/api'
import { appTitle } from '@/lib/brand'
import { setTokens } from '@/lib/authStorage'

type RegisterResponse = {
  access_token: string
  refresh_token?: string
  must_change_password?: boolean
}

export function DirectRegistrationForm() {
  const nav = useNavigate()
  const title = appTitle()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
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
      const data = await postJson<RegisterResponse>(
        '/auth/register',
        {
          email: email.trim(),
          password,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
        },
        { auth: false },
      )
      setTokens(data.access_token, data.refresh_token)
      nav('/', { replace: true })
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Registration failed')
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
            <p className="text-sm text-teal-100">Create account</p>
          </div>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Quick start</h1>
          <p className="text-teal-100/90">
            Full-stack auth template: sign-in, registration, and password flows with FastAPI + React + PostgreSQL.
          </p>
        </div>
        <p className="text-xs text-teal-200/80">Full-stack auth template</p>
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
                <p className="text-xs text-slate-500">Register</p>
              </div>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Create account</h2>
          <p className="mt-1 text-sm text-slate-600">
            Instant signup is enabled. You will be signed in after submitting this form.
          </p>

          <form onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="reg-fn" className="mb-1.5 block text-sm font-medium text-slate-700">
                  First name
                </label>
                <input
                  id="reg-fn"
                  name="first_name"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                />
              </div>
              <div>
                <label htmlFor="reg-ln" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Last name
                </label>
                <input
                  id="reg-ln"
                  name="last_name"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                />
              </div>
            </div>
            <div>
              <label htmlFor="reg-phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                Phone
              </label>
              <input
                id="reg-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                minLength={5}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                placeholder="+1 555 000 0800"
              />
            </div>
            <div>
              <label htmlFor="reg-email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="reg-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
                placeholder="you@site.com"
              />
            </div>
            <div>
              <label htmlFor="reg-pass" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password (min. 6 characters)
              </label>
              <div className="relative">
                <input
                  id="reg-pass"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-12 text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15"
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
                  Create account
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-teal-700 hover:text-teal-800">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
