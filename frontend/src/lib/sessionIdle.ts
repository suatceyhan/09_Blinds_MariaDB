/** Hareketsizlik süresi (dakika). Boş = 30 dk. 0 veya negatif = devre dışı. */
export function idleLogoutMs(): number | null {
  const raw = import.meta.env.VITE_IDLE_LOGOUT_MINUTES
  if (raw === undefined || raw === '') return 30 * 60 * 1000
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return n * 60 * 1000
}
