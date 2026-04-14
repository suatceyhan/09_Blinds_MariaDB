/** Photon (Komoot) — OpenStreetMap-backed address search; no API key. */

import {
  findCompanySubnational,
  photonBiasForCompanyRegion,
  photonFeatureMatchesCompanyRegion,
  photonSearchQueryWithRegionContext,
} from '@/lib/companyRegions'

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
  /** Some Photon responses use ISO 3166-2 style (e.g. ON, CA-ON). */
  statecode?: string | number
  type?: string
}

function photonCountryCode(pr: PhotonFeatureProperties): string {
  const raw = pr.countrycode
  if (raw && typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase()
  const c = (pr.country ?? '').trim()
  if (c.length === 2 && /^[a-z]{2}$/i.test(c)) return c.toUpperCase()
  return ''
}

/** Leading civic number the user typed (e.g. `405` from `405 fred mcla`). */
export function parseLeadingHouseNumber(query: string): string | null {
  const re = /^(\d{1,6}[A-Za-z]?)\b/
  const m = re.exec(query.trim())
  return m?.[1] ?? null
}

function stripLeadingHouseNumberFromQuery(query: string): string {
  return query.trim().replace(/^\d{1,6}[A-Za-z]?\s+/, '').trim()
}

function hasStreetQueryTokens(queryRaw: string): boolean {
  const rest = stripLeadingHouseNumberFromQuery(queryRaw)
  if (!rest) return false
  const tokens = rest.split(/\s+/).filter((t) => t.length >= 2)
  return tokens.length > 0
}

function normalizeForPrefixMatch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function normalizeHouseToken(s: string): string {
  return s.trim().toUpperCase().replaceAll(/\s+/g, '')
}

/** True if OSM `housenumber` equals `want`, or `want` lies in a range like `405-407`. */
export function houseNumberFieldMatchesWant(field: string | undefined, want: string): boolean {
  if (!want || !field) return false
  const w = normalizeHouseToken(want)
  const raw = field.trim()
  if (!raw) return false
  const segments = raw.split(/[/,;]|\s+-\s+/)
  for (const seg of segments) {
    const p = normalizeHouseToken(seg)
    if (p === w) return true
    const rangeRe = /^(\d+)\s*-\s*(\d+)$/
    const range = rangeRe.exec(seg.trim())
    if (range) {
      const lo = Number.parseInt(range[1], 10)
      const hi = Number.parseInt(range[2], 10)
      const n = Number.parseInt(want, 10)
      if (!Number.isNaN(lo) && !Number.isNaN(hi) && !Number.isNaN(n) && n >= lo && n <= hi) return true
    }
  }
  return normalizeHouseToken(raw) === w
}

function queryStreetMatchesFeature(pr: PhotonFeatureProperties, queryRaw: string): boolean {
  const rest = stripLeadingHouseNumberFromQuery(queryRaw).toLowerCase()
  if (rest.length < 2) return false
  const street = (pr.street ?? '').toLowerCase()
  const nm = (pr.name ?? '').toLowerCase()
  const hay = street || nm
  if (!hay) return false
  const tokens = rest.split(/\s+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return true
  return tokens.every((t) => hay.includes(t))
}

/** Remove trailing CA postal or US ZIP so we can dedupe street-level Photon clutter. */
function stripTrailingPostcodeFromAddressLine(line: string): string {
  return line
    .replace(/,?\s*[A-Z]\d[A-Z]\s?\d[A-Z]\d\s*$/i, '')
    .replace(/,?\s*\d{5}(?:-\d{4})?\s*$/i, '')
    .trim()
}

/** One postal-style line, e.g. `602 Frederick St, Ennismore, Ontario, K0L 1T0`. */
export function formatAddressLineFromPhotonProperties(
  pr: PhotonFeatureProperties,
  options?: { includePostcode?: boolean },
): string {
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
  const includePostcode = options?.includePostcode ?? true
  const parts = [line1, city, state, includePostcode ? pc : ''].filter(Boolean)
  return parts.join(', ')
}

/**
 * Photon often returns street/postcode segments without `housenumber`. If the user typed a
 * leading number and the street tokens match, prepend that number so the line reads like a full civic address.
 * (Postcode may still be an OSM segment guess — not Canada Post–verified.)
 */
/**
 * Single-line suggestion for the address field only. Postal/ZIP is omitted — forms use a separate
 * postal code field (`stripTrailingPostcodeFromAddressLine` as a safety net on the composed line).
 */
export function buildDisplayLineForSuggest(pr: PhotonFeatureProperties, queryRaw: string): string {
  const hnWant = parseLeadingHouseNumber(queryRaw)
  const hn = (pr.housenumber ?? '').trim()
  if (hnWant && houseNumberFieldMatchesWant(hn, hnWant)) {
    return stripTrailingPostcodeFromAddressLine(
      formatAddressLineFromPhotonProperties(pr, { includePostcode: false }),
    )
  }
  if (hnWant && queryStreetMatchesFeature(pr, queryRaw)) {
    const st = (pr.street ?? '').trim()
    const nm = (pr.name ?? '').trim()
    const line1Street = st || nm
    if (line1Street) {
      const city = (pr.city ?? pr.town ?? pr.village ?? pr.district ?? '').trim()
      const state = (pr.state ?? '').trim()
      return stripTrailingPostcodeFromAddressLine(
        [`${hnWant} ${line1Street}`, city, state].filter(Boolean).join(', '),
      )
    }
  }
  return stripTrailingPostcodeFromAddressLine(
    formatAddressLineFromPhotonProperties(pr, { includePostcode: false }),
  )
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
    if (photonFeatureMatchesCompanyRegion(pr, cc, rc)) score += 150
    else if (fcc === cc || !fcc) score += 25
  } else if (cc && (fcc === cc || !fcc)) {
    score += 40
  }

  return score
}

type ScoredPhoton = { index: number; pr: PhotonFeatureProperties; score: number }

function applyHouseNumberScoring(
  pr: PhotonFeatureProperties,
  baseScore: number,
  queryRaw: string,
  hnWant: string | null,
): number {
  if (baseScore < 0) return baseScore
  if (!hnWant) return baseScore
  const h = (pr.housenumber ?? '').trim()
  if (h && !houseNumberFieldMatchesWant(h, hnWant)) return -1
  if (houseNumberFieldMatchesWant(h, hnWant)) {
    // If the user typed more than just a civic number (e.g. `134 mar`),
    // require the remaining tokens to match the street/name to avoid unrelated `134 ...` results.
    if (hasStreetQueryTokens(queryRaw) && !queryStreetMatchesFeature(pr, queryRaw)) return -1
    return baseScore + 800
  }
  if (queryStreetMatchesFeature(pr, queryRaw)) return baseScore + 120
  return baseScore
}

function filterToCompanySubdivision(kept: ScoredPhoton[], cc: string, rc: string): ScoredPhoton[] {
  const inRegion = kept.filter((x) => photonFeatureMatchesCompanyRegion(x.pr, cc, rc))
  if (inRegion.length > 0) return inRegion
  const row = findCompanySubnational(cc, rc)
  if (!row) return kept
  const label = row.label.toLowerCase()
  const byLine = kept.filter((x) =>
    formatAddressLineFromPhotonProperties(x.pr).toLowerCase().includes(label),
  )
  return byLine.length > 0 ? byLine : kept
}

export type PhotonSuggestOptions = {
  limit?: number
  /** ISO 3166-1 alpha-2; passed to Photon as `countrycode` when set. */
  countryCode?: string | null
  /** Province/state code (CA/US) — biases search and ranks matching subdivisions first. */
  regionCode?: string | null
}

function photonSuggestUrl(
  qUser: string,
  cc: string,
  rc: string,
  regionLocked: boolean,
  apiLimit: number,
): string {
  const qForPhoton = photonSearchQueryWithRegionContext(qUser, cc || null, rc || null)
  const params = new URLSearchParams({ q: qForPhoton, limit: String(apiLimit), lang: 'en' })
  if (/^[A-Z]{2}$/.test(cc)) {
    params.set('countrycode', cc.toLowerCase())
  }
  const bias = photonBiasForCompanyRegion(cc || null, rc || null)
  if (bias) {
    params.set('lat', String(bias.lat))
    params.set('lon', String(bias.lon))
    params.set('zoom', String(bias.zoom))
    params.set('location_bias_scale', String(regionLocked ? 0.42 : bias.location_bias_scale))
  }
  return `${PHOTON_URL}?${params}`
}

function collectDedupedLines(kept: ScoredPhoton[], q: string, hnWant: string | null, limit: number): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  const qPrefix = normalizeForPrefixMatch(q)
  for (const { pr } of kept) {
    const line = buildDisplayLineForSuggest(pr, q)
    if (qPrefix) {
      const linePrefix = normalizeForPrefixMatch(line)
      if (!linePrefix.startsWith(qPrefix)) continue
    }
    const dedupeKey = hnWant ? stripTrailingPostcodeFromAddressLine(line).toLowerCase() : line.toLowerCase()
    if (!line || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    lines.push(line)
    if (lines.length >= limit) break
  }
  return lines
}

export async function fetchPhotonAddressSuggestions(
  query: string,
  signal: AbortSignal,
  options?: PhotonSuggestOptions,
): Promise<string[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const hnWant = parseLeadingHouseNumber(q)
  const limit = Math.min(15, Math.max(1, options?.limit ?? 10))
  const cc = (options?.countryCode ?? '').trim().toUpperCase()
  const rc = (options?.regionCode ?? '').trim().toUpperCase()
  const regionLocked = Boolean(rc && (cc === 'CA' || cc === 'US'))
  /** Ask Photon for more rows when a province/state is fixed; we then keep only that subdivision. */
  const apiLimit = regionLocked ? Math.min(50, Math.max(limit, 28)) : limit

  const url = photonSuggestUrl(q, cc, rc, regionLocked, apiLimit)
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return []

  const data = (await res.json()) as { features?: { properties?: PhotonFeatureProperties }[] }
  const features = data?.features ?? []

  const scored = features.map((f, index) => {
    const pr = f.properties ?? {}
    const sc = applyHouseNumberScoring(pr, scorePhotonFeature(pr, cc || null, rc || null), q, hnWant)
    return { index, pr, score: sc }
  })
  let kept: ScoredPhoton[] = scored.filter((x) => x.score >= 0)
  if (regionLocked) kept = filterToCompanySubdivision(kept, cc, rc)
  kept.sort((a, b) => b.score - a.score || a.index - b.index)

  return collectDedupedLines(kept, q, hnWant, limit)
}
