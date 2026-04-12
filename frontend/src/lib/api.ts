import { touchLastActivity } from '@/lib/authStorage'

/**
 * Ağ: Vite proxy `/api` → FastAPI kökü (127.0.0.1:8000).
 */
export function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE ?? '/api'
  return base.replace(/\/$/, '')
}

function authHeaders(): HeadersInit {
  const t = localStorage.getItem('starter_app_access_token')
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function bumpActivityIfAuthed(opts?: { auth?: boolean }): void {
  if (opts?.auth === false) return
  touchLastActivity()
}

export async function getJson<T>(
  path: string,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {}
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
  return res.json() as Promise<T>
}

async function readErrorDetail(res: Response): Promise<string | null> {
  const text = await res.text()
  try {
    const j = JSON.parse(text) as { detail?: string | string[] }
    if (typeof j.detail === 'string') return j.detail
    if (Array.isArray(j.detail)) return j.detail.map((d) => String(d)).join(', ')
  } catch {
    /* plain text */
  }
  return text || null
}

/** FastAPI OAuth2 /auth/login: application/x-www-form-urlencoded */
export async function postLoginForm(
  email: string,
  password: string,
): Promise<{
  access_token: string
  refresh_token?: string
  token_type?: string
  must_change_password?: boolean
}> {
  const url = `${apiBase()}/auth/login`
  const body = new URLSearchParams()
  body.set('email', email.trim())
  body.set('password', password)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || 'Sign-in failed')
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    token_type?: string
    must_change_password?: boolean
  }>
}

export async function postJson<T>(
  path: string,
  body: unknown,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
  if (res.status === 204) return {} as T
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export async function putJson<T>(
  path: string,
  body: unknown,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export async function patchJson<T>(
  path: string,
  body: unknown,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

/** multipart/form-data (örn. logo yükleme); Content-Type ayarlamayın. */
export async function postMultipartJson<T>(
  path: string,
  formData: FormData,
  opts?: { auth?: boolean },
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {}
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export async function deleteJson(
  path: string,
  opts?: { auth?: boolean },
): Promise<void> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {}
  if (opts?.auth !== false) {
    Object.assign(headers, authHeaders() as Record<string, string>)
  }
  const res = await fetch(url, { method: 'DELETE', headers })
  if (!res.ok) {
    const msg = await readErrorDetail(res)
    throw new Error(msg || `${res.status} ${res.statusText}`)
  }
  bumpActivityIfAuthed(opts)
}
