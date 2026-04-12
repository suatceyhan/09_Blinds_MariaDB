import { useMemo } from 'react'
import {
  VISIT_MINUTE_QUARTERS,
  joinScheduledWall,
  parseScheduledWallToParts,
  snapWallToQuarterMinutes,
  type VisitAmPm,
} from '@/lib/visitSchedule'

const HOURS_12 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const

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
 * Visit start without native `datetime-local` minute list (browsers ignore 15-minute steps there).
 * Date + hour (12) + quarter minutes + AM/PM → same `scheduled_wall` string as before.
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

  const ctl = compact
    ? 'rounded-md border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60'
    : 'rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-60'

  function push(next: { date?: string; hour12?: string; minute?: string; ampm?: VisitAmPm }) {
    onChange(
      joinScheduledWall(
        next.date ?? p.date,
        next.hour12 ?? p.hour12,
        next.minute ?? p.minute,
        next.ampm ?? p.ampm,
      ),
    )
  }

  return (
    <div
      className={`flex min-w-0 flex-1 flex-wrap items-end gap-1.5 sm:gap-2 ${className}`.trim()}
      role="group"
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
            if (d) push({ date: d })
          }}
        />
      </label>
      <label className="flex flex-col text-[10px] font-medium text-slate-500">
        <span className="mb-0.5">Hour</span>
        <select
          disabled={disabled}
          className={`w-[4.25rem] shrink-0 ${ctl}`}
          value={p.hour12}
          onChange={(e) => push({ hour12: e.target.value })}
          aria-label="Hour (12-hour)"
        >
          {HOURS_12.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-[10px] font-medium text-slate-500">
        <span className="mb-0.5">Min</span>
        <select
          disabled={disabled}
          className={`w-[3.25rem] shrink-0 ${ctl}`}
          value={p.minute}
          onChange={(e) => push({ minute: e.target.value })}
          aria-label="Minutes (15-minute steps)"
        >
          {VISIT_MINUTE_QUARTERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-[10px] font-medium text-slate-500">
        <span className="mb-0.5">AM/PM</span>
        <select
          disabled={disabled}
          className={`w-[4.5rem] shrink-0 ${ctl}`}
          value={p.ampm}
          onChange={(e) => push({ ampm: e.target.value as VisitAmPm })}
          aria-label="AM or PM"
        >
          <option value="am">AM</option>
          <option value="pm">PM</option>
        </select>
      </label>
    </div>
  )
}
