const ACCESS = 'starter_app_access_token'
const REFRESH = 'starter_app_refresh_token'
const LAST_ACTIVITY = 'starter_app_last_activity_ms'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH)
}

export function setTokens(access: string, refresh?: string | null): void {
  localStorage.setItem(ACCESS, access)
  if (refresh != null && refresh !== '') {
    localStorage.setItem(REFRESH, refresh)
  }
  touchLastActivity()
}

/** Son etkileşim (idle oturum kapatma için). */
export function touchLastActivity(): void {
  try {
    localStorage.setItem(LAST_ACTIVITY, String(Date.now()))
  } catch {
    /* private mode vb. */
  }
}

export function getLastActivityMs(): number | null {
  const s = localStorage.getItem(LAST_ACTIVITY)
  if (s == null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS)
  localStorage.removeItem(REFRESH)
  localStorage.removeItem(LAST_ACTIVITY)
}
