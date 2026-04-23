import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatVisitDateShortFromYmd } from '@/lib/formatVisitDisplay'
import {
  VISIT_MINUTE_QUARTERS,
  from24HourTo12,
  joinScheduledWall,
  parseScheduledWallToParts,
  snapWallToQuarterMinutes,
  type VisitAmPm,
  type VisitMinuteQuarter,
} from '@/lib/visitSchedule'

function parseYmdToLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function localDateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTimeTrigger(hour12: string, minute: string, ampm: VisitAmPm): string {
  const ap = ampm === 'am' ? 'AM' : 'PM'
  return `${hour12}:${minute} ${ap}`
}

/** Monday = 0 … Sunday = 6 */
function weekdayIndexMondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

type TimeSlot = { wall: string; label: string }

function timeSlotsForDay(ymd: string): TimeSlot[] {
  const out: TimeSlot[] = []
  for (let hi = 0; hi < 24; hi++) {
    for (const minute of VISIT_MINUTE_QUARTERS) {
      const { hour12, ampm } = from24HourTo12(hi)
      const wall = joinScheduledWall(ymd, String(hour12), minute as VisitMinuteQuarter, ampm as VisitAmPm)
      const ap = ampm === 'am' ? 'AM' : 'PM'
      out.push({ wall, label: `${hour12}:${minute} ${ap}` })
    }
  }
  return out
}

type VisitStartQuarterPickerProps = {
  /** API wall clock `YYYY-MM-DDTHH:mm` (24h); minutes should be 00/15/30/45. */
  value: string
  onChange: (wall: string) => void
  disabled?: boolean
  /** Slightly tighter controls for modals. */
  compact?: boolean
  className?: string
  /** When true, opens the picker panel once (on mount / when toggled). */
  autoOpen?: boolean
}

/**
 * Visit date + time: two triggers (date | time); opens a panel with calendar + 15-minute time list.
 * Same `scheduled_wall` string as before (`YYYY-MM-DDTHH:mm`).
 */
export function VisitStartQuarterPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  className = '',
  autoOpen = false,
}: Readonly<VisitStartQuarterPickerProps>) {
  const normalized = useMemo(() => snapWallToQuarterMinutes(value.trim() || ''), [value])
  const parts = useMemo(() => parseScheduledWallToParts(normalized), [normalized])

  const [open, setOpen] = useState(false)
  const [panelYear, setPanelYear] = useState(() => {
    const d = parseYmdToLocalDate(parts.date)
    return d ? d.getFullYear() : new Date().getFullYear()
  })
  const [panelMonthIndex, setPanelMonthIndex] = useState(() => {
    const d = parseYmdToLocalDate(parts.date)
    return d ? d.getMonth() : new Date().getMonth()
  })
  const [draftYmd, setDraftYmd] = useState(parts.date)

  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timeListRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ display: 'none' })

  const listId = useId()

  useEffect(() => {
    if (!open) return
    const d = parseYmdToLocalDate(parts.date)
    if (d) {
      setPanelYear(d.getFullYear())
      setPanelMonthIndex(d.getMonth())
    }
    setDraftYmd(parts.date)
  }, [open, parts.date])

  const syncPanelFromParts = useCallback(() => {
    const d = parseYmdToLocalDate(parts.date)
    if (d) {
      setPanelYear(d.getFullYear())
      setPanelMonthIndex(d.getMonth())
    }
  }, [parts.date])

  const openPanel = useCallback(() => {
    if (disabled) return
    syncPanelFromParts()
    setDraftYmd(parts.date)
    setOpen(true)
  }, [disabled, parts.date, syncPanelFromParts])

  const didAutoOpen = useRef(false)
  useEffect(() => {
    if (!autoOpen) {
      didAutoOpen.current = false
      return
    }
    // If disabled at first render, wait until enabled to auto-open.
    if (disabled) return
    if (didAutoOpen.current) return
    didAutoOpen.current = true
    globalThis.setTimeout(() => openPanel(), 0)
  }, [autoOpen, disabled, openPanel])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setPanelStyle({ display: 'none' })
      return
    }
    const anchor = rootRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const panelW = compact ? 300 : 340
    const panelH = compact ? 280 : 320
    let left = anchor.left
    let top = anchor.bottom + 6
    if (left + panelW > vw - 8) left = Math.max(8, vw - panelW - 8)
    if (top + panelH > vh - 8) top = Math.max(8, anchor.top - panelH - 6)
    setPanelStyle({
      position: 'fixed',
      left,
      top,
      width: panelW,
      zIndex: 80,
      display: 'block',
    })
  }, [open, compact])

  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocPointerDown)
    document.addEventListener('touchstart', onDocPointerDown, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown)
      document.removeEventListener('touchstart', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !timeListRef.current) return
    const slots = timeSlotsForDay(draftYmd)
    const idx = slots.findIndex((s) => s.wall === normalized)
    if (idx >= 0) {
      const row = timeListRef.current.querySelector(`[data-slot-idx="${idx}"]`) as HTMLElement | null
      row?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, draftYmd, normalized])

  const calendarCells = useMemo(() => {
    const first = new Date(panelYear, panelMonthIndex, 1)
    const pad = weekdayIndexMondayFirst(first)
    const dim = daysInMonth(panelYear, panelMonthIndex)
    const cells: ({ day: number } | null)[] = []
    for (let i = 0; i < pad; i++) cells.push(null)
    for (let day = 1; day <= dim; day++) cells.push({ day })
    return cells
  }, [panelYear, panelMonthIndex])

  const monthTitle = useMemo(
    () =>
      new Date(panelYear, panelMonthIndex, 1).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
      }),
    [panelYear, panelMonthIndex],
  )

  const slots = useMemo(() => timeSlotsForDay(draftYmd), [draftYmd])

  function pickDay(day: number) {
    const ymd = localDateToYmd(new Date(panelYear, panelMonthIndex, day))
    setDraftYmd(ymd)
    const wall = joinScheduledWall(ymd, parts.hour12, parts.minute, parts.ampm)
    onChange(snapWallToQuarterMinutes(wall))
  }

  function pickTime(wall: string) {
    onChange(snapWallToQuarterMinutes(wall))
    setOpen(false)
  }

  function prevMonth() {
    setPanelMonthIndex((m) => {
      if (m === 0) {
        setPanelYear((y) => y - 1)
        return 11
      }
      return m - 1
    })
  }

  function nextMonth() {
    setPanelMonthIndex((m) => {
      if (m === 11) {
        setPanelYear((y) => y + 1)
        return 0
      }
      return m + 1
    })
  }

  const todayYmd = localDateToYmd(new Date())
  const btnPad = compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'
  const triggerBase =
    'min-w-0 flex-1 rounded-lg border font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50'
  const triggerClosed = 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
  const triggerOpen = 'border-teal-500 bg-teal-50/80 text-teal-900 ring-1 ring-teal-200'

  const panel = open ? (
    <div
      ref={panelRef}
      style={panelStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${listId}-title`}
      className="rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5"
    >
      <div className="flex max-h-[min(320px,70vh)] divide-x divide-slate-100">
        <div className={`flex min-w-0 flex-1 flex-col ${compact ? 'p-2' : 'p-3'}`}>
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className="rounded-md p-1 text-slate-600 hover:bg-slate-100"
              aria-label="Previous month"
              onClick={prevMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span
              id={`${listId}-title`}
              className={`text-center font-semibold text-slate-900 ${compact ? 'text-xs' : 'text-sm'}`}
            >
              {monthTitle}
            </span>
            <button
              type="button"
              className="rounded-md p-1 text-slate-600 hover:bg-slate-100"
              aria-label="Next month"
              onClick={nextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className={`grid grid-cols-7 gap-0.5 text-center ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => (
              <div key={d} className="py-1 font-semibold text-slate-400">
                {d}
              </div>
            ))}
            {calendarCells.map((cell, i) => {
              if (!cell) return <div key={`e-${i}`} className="aspect-square" />
              const ymd = localDateToYmd(new Date(panelYear, panelMonthIndex, cell.day))
              const isSelected = ymd === draftYmd
              const isToday = ymd === todayYmd
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => pickDay(cell.day)}
                  className={`flex aspect-square items-center justify-center rounded-full text-xs font-medium transition ${
                    isSelected
                      ? 'bg-teal-600 text-white'
                      : isToday
                        ? 'bg-teal-100 text-teal-900 ring-1 ring-teal-300'
                        : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>
        </div>
        <div className={`flex w-[44%] min-w-[7.5rem] flex-col ${compact ? 'py-1' : 'py-2'}`}>
          <div
            ref={timeListRef}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 ${compact ? 'max-h-[220px]' : 'max-h-[260px]'}`}
            role="listbox"
            aria-label="Visit time, 15-minute steps"
          >
            {slots.map((s, idx) => {
              const sel = s.wall === normalized
              return (
                <button
                  key={s.wall}
                  type="button"
                  data-slot-idx={idx}
                  role="option"
                  aria-selected={sel}
                  onClick={() => pickTime(s.wall)}
                  className={`w-full rounded-md px-2 py-1 text-left text-xs font-medium transition sm:text-sm ${
                    sel ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`.trim()}>
      <div className="flex min-w-0 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (open) setOpen(false)
            else openPanel()
          }}
          className={`${triggerBase} ${btnPad} ${open ? triggerOpen : triggerClosed}`}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {formatVisitDateShortFromYmd(parts.date)}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (open) setOpen(false)
            else openPanel()
          }}
          className={`${triggerBase} ${btnPad} ${open ? triggerOpen : triggerClosed}`}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {formatTimeTrigger(parts.hour12, parts.minute, parts.ampm)}
        </button>
      </div>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
