import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react'
import { postJson } from '@/lib/api'

export function PendingEmployeeRegisterPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const [showPass, setShowPass] = useState(false)
  /** Stops Chrome from injecting saved login into this signup email until the user focuses the field. */
  const [emailAutofillUnlocked, setEmailAutofillUnlocked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await postJson(
        '/public-registration/employee',
        {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
          request_note: note.trim() || null,
        },
        { auth: false },
      )
      setDone(true)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Could not submit application')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We sent a verification link to <strong>{email}</strong>. After you verify, your request will wait for
          admin approval.
        </p>
        <Link to="/login" className="mt-6 text-sm font-semibold text-teal-700 hover:text-teal-800">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-10">
      <Link
        to="/register"
        className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Registration options
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Employee registration</h1>
      <p className="mt-1 text-sm text-slate-600">All fields are required except the note.</p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="mt-6 space-y-4"
        autoComplete="off"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">First name</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Last name</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            minLength={5}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            name="employee_registration_email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!emailAutofillUnlocked}
            onFocus={() => setEmailAutofillUnlocked(true)}
            autoComplete="off"
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Password (min. 8)</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              name="employee_registration_password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-50"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? 'Hide password' : 'Show password'}
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
        </div>
        {err ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {err}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {loading ? 'Submitting…' : (
            <>
              Submit application
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>
    </div>
  )
}
