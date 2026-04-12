/** Visit start uses 15-minute steps only (no full 0–59 minute picker). */

export const VISIT_MINUTE_QUARTERS = ['00', '15', '30', '45'] as const
export type VisitMinuteQuarter = (typeof VISIT_MINUTE_QUARTERS)[number]

export type VisitAmPm = 'am' | 'pm'

/** UI state: local date + 12-hour clock + quarter minutes (API wall stays 24h `YYYY-MM-DDTHH:mm`). */
export type VisitScheduleUiParts = {
  date: string
  hour12: string
  minute: VisitMinuteQuarter
  ampm: VisitAmPm
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Floor clock minute to 0, 15, 30, or 45. */
export function snapMinuteToQuarter(m: number): VisitMinuteQuarter {
  const q = Math.floor(Math.max(0, Math.min(59, m)) / 15) * 15
  return pad2(q) as VisitMinuteQuarter
}

export function from24HourTo12(h24: number): { hour12: number; ampm: VisitAmPm } {
  const clamped = Math.min(23, Math.max(0, Math.trunc(h24)))
  const ampm: VisitAmPm = clamped >= 12 ? 'pm' : 'am'
  let h12 = clamped % 12
  if (h12 === 0) h12 = 12
  return { hour12: h12, ampm }
}

export function to24HourFrom12(hour12: number, ampm: VisitAmPm): number {
  const h = Math.min(12, Math.max(1, Math.trunc(hour12)))
  if (ampm === 'am') return h === 12 ? 0 : h
  return h === 12 ? 12 : h + 12
}

export function defaultVisitScheduleParts(d = new Date()): VisitScheduleUiParts {
  const { hour12, ampm } = from24HourTo12(d.getHours())
  return {
    date: toDateOnly(d),
    hour12: String(hour12),
    minute: snapMinuteToQuarter(d.getMinutes()),
    ampm,
  }
}

/** Build API `scheduled_wall` (24-hour) from UI parts. */
export function joinScheduledWall(
  date: string,
  hour12: string,
  minute: string,
  ampm: VisitAmPm,
): string {
  const h12raw = Number.parseInt(String(hour12).replaceAll(/\D/g, ''), 10)
  const h12 = Number.isNaN(h12raw) ? 12 : Math.min(12, Math.max(1, h12raw))
  const hi = to24HourFrom12(h12, ampm)
  const m = VISIT_MINUTE_QUARTERS.includes(minute as VisitMinuteQuarter)
    ? minute
    : snapMinuteToQuarter(Number.parseInt(minute, 10) || 0)
  return `${date.trim()}T${pad2(hi)}:${m}`
}

/** Parse `YYYY-MM-DDTHH:mm` and snap minutes to a quarter; expose as 12-hour UI. */
export function parseScheduledWallToParts(wall: string): VisitScheduleUiParts {
  const t = wall.trim()
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{1,2})$/.exec(t)
  if (!m) {
    return defaultVisitScheduleParts()
  }
  const date = m[1]
  const hi = Math.min(23, Math.max(0, Number.parseInt(m[2], 10) || 0))
  const rawMin = Number.parseInt(m[3], 10)
  const minute = Number.isNaN(rawMin) ? '00' : snapMinuteToQuarter(rawMin)
  const { hour12, ampm } = from24HourTo12(hi)
  return { date, hour12: String(hour12), minute, ampm }
}

export function isValidScheduledWall(wall: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall.trim())
}

/** Snap minutes to 00/15/30/45 and normalize hour for API `scheduled_wall`. */
export function snapWallToQuarterMinutes(wall: string): string {
  const parts = parseScheduledWallToParts(wall)
  return joinScheduledWall(parts.date, parts.hour12, parts.minute, parts.ampm)
}
