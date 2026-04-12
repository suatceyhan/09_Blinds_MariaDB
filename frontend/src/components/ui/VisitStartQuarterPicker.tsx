import { useMemo } from 'react'
import {
  VISIT_MINUTE_QUARTERS,
  from24HourTo12,
  joinScheduledWall,
  parseScheduledWallToParts,
  snapWallToQuarterMinutes,
  to24HourFrom12,
  type VisitAmPm,
  type VisitMinuteQuarter,
} from '@/lib/visitSchedule'

/** All 24×4 quarter-hour slots; value key `HH:mm` (24h) for a single `<select>`. */
const VISIT_QUARTER_TIME_OPTIONS: readonly { key: string; label: string }[] = (() => {
  const out: { key: string; label: string }[] = []
  for (let hi = 0; hi < 24; hi++) {
    for (const m of VISIT_MINUTE_QUARTERS) {
      const { hour12, ampm } = from24HourTo12(hi)
      const ap = ampm === 'am' ? 'AM' : 'PM'
      out.push({
        key: `${String(hi).padStart(2, '0')}:${m}`,
        label: `${hour12}:${m} ${ap}`,
      })
    }
  }
  return out
})()

function timeKeyFromUiParts(parts: {
  hour12: string
  minute: VisitMinuteQuarter
  ampm: VisitAmPm
}): string {
  const h12 = Number.parseInt(String(parts.hour12).replaceAll(/\D/g, ''), 10)
  const h12c = Number.isNaN(h12) ? 12 : Math.min(12, Math.max(1, h12))
  const hi = to24HourFrom12(h12c, parts.ampm)
  return `${String(hi).padStart(2, '0')}:${parts.minute}`
}

type VisitStartQuarterPickerProps = {
  /** API wall clock `YYYY-MM-DDTHH:mm` (24h); minutes should be 00/15/30/45. */
  value: string
  onChange: (wall: string) => void
  disabled?: boolean
  /** Slightly tighter controls for modals. */
  compact?: boolean
  className?: string
}

/**
 * Visit start: one **date** field + one **time** dropdown (96 × 15-minute choices).
 * Same `scheduled_wall` string as before.
 */
export function VisitStartQuarterPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  className = '',
}: Readonly<VisitStartQuarterPickerProps>) {
  const p = useMemo(
    () => parseScheduledWallToParts(snapWallToQuarterMinutes(value.trim())),
    [value],
  )

  const timeKey = timeKeyFromUiParts(p)

  const ctl = compact
    ? 'rounded-md border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60'
    : 'rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60'

  return (
    <fieldset
      className={`m-0 flex min-w-0 flex-1 flex-wrap items-end gap-1.5 border-0 p-0 sm:gap-2 ${className}`.trim()}
      aria-label="Visit start date and time"
    >
      <label className="flex min-w-0 flex-col text-[10px] font-medium text-slate-500">
        <span className="mb-0.5">Date</span>
        <input
          type="date"
          disabled={disabled}
          className={`min-w-0 ${ctl}`}
          value={p.date}
          onChange={(e) => {
            const d = e.target.value
            if (d) {
              onChange(joinScheduledWall(d, p.hour12, p.minute, p.ampm))
            }
          }}
        />
      </label>
      <label className="flex min-w-[9rem] flex-1 flex-col text-[10px] font-medium text-slate-500 sm:min-w-[10.5rem]">
        <span className="mb-0.5">Time</span>
        <select
          disabled={disabled}
          className={`w-full min-w-0 ${ctl}`}
          value={timeKey}
          onChange={(e) => {
            const key = e.target.value
            const [hs, ms] = key.split(':')
            const hi = Number.parseInt(hs, 10)
            const m = (VISIT_MINUTE_QUARTERS.includes(ms as VisitMinuteQuarter) ? ms : '00') as VisitMinuteQuarter
            if (Number.isNaN(hi) || hi < 0 || hi > 23) return
            const { hour12, ampm } = from24HourTo12(hi)
            onChange(joinScheduledWall(p.date, String(hour12), m, ampm))
          }}
          aria-label="Time (15-minute steps only)"
        >
          {VISIT_QUARTER_TIME_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}
