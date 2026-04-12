/** Photon (Komoot) — OpenStreetMap-backed address search; no API key. */

import { photonBiasForCompanyRegion, photonStateMatchesCompanyRegion } from '@/lib/companyRegions'

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
  /** GeocodeJSON / Photon (lowercase ISO alpha-2). */
  countrycode?: string
  type?: string
}

function photonCountryCode(pr: PhotonFeatureProperties): string {
  const raw = pr.countrycode
  if (raw && typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase()
  const c = (pr.country ?? '').trim()
  if (c.length === 2 && /^[a-z]{2}$/i.test(c)) return c.toUpperCase()
  return ''
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

function scorePhotonFeature(
  pr: PhotonFeatureProperties,
  companyCountry: string | null | undefined,
  companyRegion: string | null | undefined,
): number {
  const cc = (companyCountry ?? '').trim().toUpperCase()
  const rc = (companyRegion ?? '').trim().toUpperCase()
  const fcc = photonCountryCode(pr)

  if (cc && /^[A-Z]{2}$/.test(cc)) {
    if (fcc && fcc !== cc) return -1
  }

  let score = 0
  if (fcc === cc && cc) score += 200
  if (!cc) score += 10

  if (rc && (cc === 'CA' || cc === 'US')) {
    if (photonStateMatchesCompanyRegion(pr.state, cc, rc)) score += 150
    else if (fcc === cc || !fcc) score += 25
  } else if (cc && (fcc === cc || !fcc)) {
    score += 40
  }

  return score
}

export type PhotonSuggestOptions = {
  limit?: number
  /** ISO 3166-1 alpha-2; passed to Photon as `countrycode` when set. */
  countryCode?: string | null
  /** Province/state code (CA/US) — biases search and ranks matching subdivisions first. */
  regionCode?: string | null
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
    params.set('countrycode', cc.toLowerCase())
  }

  const bias = photonBiasForCompanyRegion(cc || null, options?.regionCode ?? null)
  if (bias) {
    params.set('lat', String(bias.lat))
    params.set('lon', String(bias.lon))
    params.set('zoom', String(bias.zoom))
    params.set('location_bias_scale', String(bias.location_bias_scale))
  }

  const url = `${PHOTON_URL}?${params}`
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []

  const data = (await res.json()) as { features?: { properties?: PhotonFeatureProperties }[] }
  const features = data?.features ?? []

  const scored = features.map((f, index) => ({
    index,
    pr: f.properties ?? {},
    score: scorePhotonFeature(f.properties ?? {}, cc || null, options?.regionCode ?? null),
  }))
  const kept = scored.filter((x) => x.score >= 0)
  kept.sort((a, b) => b.score - a.score || a.index - b.index)

  const lines: string[] = []
  const seen = new Set<string>()
  for (const { pr } of kept) {
    const line = formatAddressLineFromPhotonProperties(pr)
    const key = line.toLowerCase()
    if (!line || seen.has(key)) continue
    seen.add(key)
    lines.push(line)
    if (lines.length >= limit) break
  }
  return lines
}
