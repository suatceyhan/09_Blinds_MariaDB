import { Link } from 'react-router-dom'
import { Building2, LogIn, User } from 'lucide-react'
import { appTitle } from '@/lib/brand'

export function RegistrationHub() {
  const title = appTitle()
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/40 px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Register as an employee or a company. You will verify your email; an administrator must approve
            before you can sign in.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <Link
            to="/register/employee"
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-teal-300 hover:shadow-md"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-100 text-teal-700">
              <User className="h-6 w-6" strokeWidth={2} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Employee</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Join as an individual user. After approval you receive the default member role (e.g. user).
            </p>
            <p className="mt-4 text-sm font-semibold text-teal-700 group-hover:text-teal-800">Continue →</p>
          </Link>

          <Link
            to="/register/company"
            className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-violet-300 hover:shadow-md"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Building2 className="h-6 w-6" strokeWidth={2} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Company</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Register your organization. The contact person becomes a user linked to the new company and
              receives the company-owner role (default: admin).
            </p>
            <p className="mt-4 text-sm font-semibold text-violet-700 group-hover:text-violet-800">Continue →</p>
          </Link>
        </div>

        <p className="mt-10 flex flex-wrap items-center justify-center gap-2 text-center text-sm text-slate-600">
          <LogIn className="h-4 w-4 text-slate-400" />
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-teal-700 hover:text-teal-800">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
