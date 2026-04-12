/** Google Maps search-by-address URL (same pattern as backend). Used by `AddressMapLink` in the UI. */
export function googleMapsSearchUrlFromAddress(address: string): string {
  const q = address.trim()
  if (!q) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export function mapsLinkForCompany(
  address: string | null | undefined,
  mapsUrl: string | null | undefined,
): string | null {
  if (mapsUrl && mapsUrl.trim()) {
    const m = mapsUrl.trim()
    return m.startsWith('http://') || m.startsWith('https://') ? m : `https://${m}`
  }
  if (address && address.trim()) {
    return googleMapsSearchUrlFromAddress(address)
  }
  return null
}
