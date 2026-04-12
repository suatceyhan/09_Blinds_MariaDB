import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getJson } from '@/lib/api'

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const type = searchParams.get('type') ?? 'employee'
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading')
  const [message, setMessage] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('err')
      setMessage('Invalid verification link.')
      return
    }
    if (ran.current) return
    ran.current = true
    const path =
      type === 'company'
        ? `/public-registration/verify-company-email?token=${encodeURIComponent(token)}`
        : `/public-registration/verify-employee-email?token=${encodeURIComponent(token)}`
    ;(async () => {
      try {
        const res = await getJson<{ message?: string }>(path, { auth: false })
        setStatus('ok')
        setMessage(res.message ?? 'Email verified.')
      } catch (e) {
        setStatus('err')
        setMessage(e instanceof Error ? e.message : 'Verification failed.')
      }
    })()
  }, [token, type])

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      {status === 'loading' ? <p className="text-sm text-slate-600">Verifying…</p> : null}
      {status === 'ok' ? (
        <>
          <h1 className="text-xl font-semibold text-teal-800">Email verified</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
          <p className="mt-2 text-sm text-slate-500">You can close this page. Sign in once an admin approves your request.</p>
        </>
      ) : null}
      {status === 'err' ? (
        <>
          <h1 className="text-xl font-semibold text-red-800">Verification problem</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
        </>
      ) : null}
      <Link to="/login" className="mt-8 text-sm font-semibold text-teal-700 hover:text-teal-800">
        Sign in
      </Link>
    </div>
  )
}
