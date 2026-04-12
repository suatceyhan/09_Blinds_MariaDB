/** English UI copy; consistent visit labels across list and forms. */
const LOCALE = 'en-US'

/**
 * Estimates list (and detail): `Apr 1, 2026 - 2:30 PM` (no seconds).
 */
export function formatVisitDateTimeList(raw: string | null | undefined): string {
  const t = (raw ?? '').trim()
  if (!t) return '—'
  const dt = new Date(t)
  if (Number.isNaN(dt.getTime())) return t
  const datePart = dt.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
  const timePart = dt.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${datePart} - ${timePart}`
}

/**
 * Visit picker date trigger from calendar `YYYY-MM-DD`: `Apr 1, 2026`.
 */
export function formatVisitDateShortFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return ymd.trim()
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return ymd.trim()
  return d.toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })
}
