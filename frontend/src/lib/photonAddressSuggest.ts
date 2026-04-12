/** Photon (Komoot) — OpenStreetMap-backed address search; no API key. */

const PHOTON_URL = 'https://photon.komoot.io/api/'

export type PhotonFeatureProperties = {
  name?: string
  street?: string
  housenumber?: string
  city?: string
  town?: string
  village?: string
  district?: string
  state?: string
  postcode?: string
  country?: string
  type?: string
}

/** One postal-style line, e.g. `602 Frederick St, Ennismore, Ontario, K0L 1T0`. */
export function formatAddressLineFromPhotonProperties(pr: PhotonFeatureProperties): string {
  const hn = (pr.housenumber ?? '').trim()
  const st = (pr.street ?? '').trim()
  const nm = (pr.name ?? '').trim()
  let line1 = ''
  if (hn && st) line1 = `${hn} ${st}`.trim()
  else if (hn && nm) line1 = `${hn} ${nm}`.trim()
  else if (st) line1 = st
  else if (nm) line1 = nm
  else if (hn) line1 = hn

  const city = (pr.city ?? pr.town ?? pr.village ?? pr.district ?? '').trim()
  const state = (pr.state ?? '').trim()
  const pc = (pr.postcode ?? '').trim()
  const parts = [line1, city, state, pc].filter(Boolean)
  return parts.join(', ')
}

export type PhotonSuggestOptions = {
  limit?: number
  /** ISO 3166-1 alpha-2; passed to Photon as `countrycode` when set. */
  countryCode?: string | null
}

export async function fetchPhotonAddressSuggestions(
  query: string,
  signal: AbortSignal,
  options?: PhotonSuggestOptions,
): Promise<string[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const limit = Math.min(15, Math.max(1, options?.limit ?? 10))
  const params = new URLSearchParams({ q, limit: String(limit), lang: 'en' })
  const cc = (options?.countryCode ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(cc)) {
    params.set('countrycode', cc)
  }

  const url = `${PHOTON_URL}?${params}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []

  const data = (await res.json()) as { features?: { properties?: PhotonFeatureProperties }[] }
  const features = data?.features ?? []
  const lines: string[] = []
  const seen = new Set<string>()
  for (const f of features) {
    const line = formatAddressLineFromPhotonProperties(f.properties ?? {})
    const key = line.toLowerCase()
    if (!line || seen.has(key)) continue
    seen.add(key)
    lines.push(line)
  }
  return lines
}
