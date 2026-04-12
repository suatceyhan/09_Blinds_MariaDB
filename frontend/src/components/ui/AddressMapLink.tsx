import { mapsLinkForCompany } from '@/lib/googleMaps'

/** Example for placeholders (Google Maps single-line style). */
export const ADDRESS_FORMAT_PLACEHOLDER = '492 Huntingwood Dr, Scarborough, ON M1W 1G4'

/** Short hint under address fields (English UI). */
export const ADDRESS_FORMAT_HINT =
  'Type at least 3 characters for address suggestions (OpenStreetMap), or enter one line yourself: street, city, province/state, postal code.'

type AddressMapLinkProps = {
  address: string | null | undefined
  /** Company rows may supply a stored Maps URL; otherwise search uses the address text. */
  mapsUrl?: string | null
  /** Muted link style (e.g. inactive row). */
  muted?: boolean
  className?: string
  /** When true, long addresses clamp in tables. */
  lineClamp?: boolean
}

/**
 * Renders a non-empty address as a link to Google Maps (`mapsLinkForCompany` / search URL).
 */
export function AddressMapLink({
  address,
  mapsUrl,
  muted = false,
  className = '',
  lineClamp = true,
}: Readonly<AddressMapLinkProps>) {
  const t = (address ?? '').trim()
  if (!t) {
    return <span className={`text-slate-400 ${className}`.trim()}>—</span>
  }
  const href = mapsLinkForCompany(t, mapsUrl ?? null)
  const linkCls = muted
    ? 'text-slate-600 underline-offset-2 hover:text-teal-800 hover:underline'
    : 'text-teal-700 underline-offset-2 hover:text-teal-800 hover:underline'
  const wrap = lineClamp ? 'line-clamp-3 break-words' : 'break-words whitespace-pre-wrap'
  if (!href) {
    return <span className={`text-sm ${wrap} text-slate-800 ${className}`.trim()}>{t}</span>
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-sm font-medium ${wrap} ${linkCls} ${className}`.trim()}
      title="Open in Google Maps"
    >
      {t}
    </a>
  )
}
