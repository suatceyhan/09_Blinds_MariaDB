import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { fetchPhotonAddressSuggestions } from '@/lib/photonAddressSuggest'

/** Avoid re-querying Photon after a full line is chosen or pasted (still editable if shortened). */
function likelyCompleteAddressLine(s: string): boolean {
  const t = s.trim()
  if (t.length < 20) return false
  const commas = (t.match(/,/g) ?? []).length
  return commas >= 2
}

type AddressAutocompleteInputProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  /** Passed to the hint element below the field (accessibility). */
  hintId?: string
  className?: string
  /** Input element classes (border, padding, etc.). */
  inputClassName?: string
  placeholder?: string
  minQueryLength?: number
  /** Active company ISO country (Photon `countrycode`); omit or null = worldwide. */
  countryCode?: string | null
}

/**
 * Single-line address field with debounced **Photon / OpenStreetMap** suggestions (type-to-search).
 */
export function AddressAutocompleteInput({
  value,
  onChange,
  disabled = false,
  id: idProp,
  hintId,
  className = '',
  inputClassName = '',
  placeholder = '',
  minQueryLength = 3,
  countryCode = null,
}: Readonly<AddressAutocompleteInputProps>) {
  const genId = useId()
  const inputId = idProp ?? `addr-ac-${genId}`
  const listboxId = `${inputId}-suggestions`

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = value.trim()
    if (q.length < minQueryLength || likelyCompleteAddressLine(value)) {
      setItems([])
      setOpen(false)
      setLoading(false)
      return
    }

    const ac = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      void (async () => {
        try {
          const lines = await fetchPhotonAddressSuggestions(q, ac.signal, { countryCode })
          if (!ac.signal.aborted) {
            setItems(lines)
            setOpen(lines.length > 0)
          }
        } catch {
          if (!ac.signal.aborted) {
            setItems([])
            setOpen(false)
          }
        } finally {
          if (!ac.signal.aborted) setLoading(false)
        }
      })()
    }, 320)

    return () => {
      ac.abort()
      window.clearTimeout(timer)
    }
  }, [value, minQueryLength, countryCode])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const defaultInputCls =
    'w-full rounded-lg border border-slate-200 py-2 pl-3 pr-10 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 disabled:opacity-60'

  return (
    <div ref={wrapRef} className={`relative ${className}`.trim()}>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          autoComplete="street-address"
          disabled={disabled}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(false)
          }}
          onFocus={() => {
            if (items.length > 0) setOpen(true)
          }}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-describedby={hintId}
          className={`${defaultInputCls} ${inputClassName}`.trim()}
        />
        <span
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </span>
      </div>

      {open && items.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5"
        >
          {items.map((line) => (
            <li key={line} role="presentation">
              <button
                type="button"
                role="option"
                className="w-full px-3 py-2 text-left text-slate-800 hover:bg-teal-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(line)
                  setOpen(false)
                  setItems([])
                }}
              >
                {line}
              </button>
            </li>
          ))}
          <li className="border-t border-slate-100 px-2 py-1.5 text-[10px] text-slate-400">
            Suggestions from OpenStreetMap (Photon). You can still type your own line.
          </li>
        </ul>
      ) : null}
    </div>
  )
}
