import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getJson } from '@/lib/api'
import { DirectRegistrationForm } from '@/features/auth/registration/DirectRegistrationForm'

export function DirectRegistrationGate() {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    getJson<{ direct_registration_enabled: boolean }>('/public-registration/options', { auth: false })
      .then((o) => setAllowed(o.direct_registration_enabled))
      .catch(() => setAllowed(false))
  }, [])

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-600">Loading…</p>
      </div>
    )
  }

  if (!allowed) {
    return <Navigate to="/register" replace />
  }

  return <DirectRegistrationForm />
}
