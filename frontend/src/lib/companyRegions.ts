/** Canada / US subdivisions for company settings + Photon ranking (matchers vs OSM `state`). */

export type CompanySubnational = {
  code: string
  label: string
  /** Lowercase substrings matched against Photon `properties.state`. */
  matchers: string[]
  lat: number
  lon: number
  zoom: number
}

const CA_REGIONS: CompanySubnational[] = [
  { code: 'AB', label: 'Alberta', matchers: ['alberta'], lat: 53.9, lon: -118.8, zoom: 5 },
  { code: 'BC', label: 'British Columbia', matchers: ['british columbia'], lat: 53.7, lon: -127.6, zoom: 5 },
  { code: 'MB', label: 'Manitoba', matchers: ['manitoba'], lat: 55.0, lon: -97.5, zoom: 5 },
  { code: 'NB', label: 'New Brunswick', matchers: ['new brunswick'], lat: 46.6, lon: -66.4, zoom: 6 },
  { code: 'NL', label: 'Newfoundland and Labrador', matchers: ['newfoundland', 'labrador', 'newfoundland and labrador'], lat: 53.1, lon: -57.7, zoom: 5 },
  { code: 'NS', label: 'Nova Scotia', matchers: ['nova scotia'], lat: 44.7, lon: -63.7, zoom: 6 },
  { code: 'NT', label: 'Northwest Territories', matchers: ['northwest territories'], lat: 64.8, lon: -124.8, zoom: 5 },
  { code: 'NU', label: 'Nunavut', matchers: ['nunavut'], lat: 70.0, lon: -90.0, zoom: 4 },
  { code: 'ON', label: 'Ontario', matchers: ['ontario'], lat: 50.0, lon: -86.0, zoom: 5 },
  { code: 'PE', label: 'Prince Edward Island', matchers: ['prince edward island'], lat: 46.4, lon: -63.2, zoom: 7 },
  { code: 'QC', label: 'Quebec', matchers: ['quebec', 'québec'], lat: 52.0, lon: -72.0, zoom: 5 },
  { code: 'SK', label: 'Saskatchewan', matchers: ['saskatchewan'], lat: 54.0, lon: -106.0, zoom: 5 },
  { code: 'YT', label: 'Yukon', matchers: ['yukon'], lat: 64.0, lon: -135.0, zoom: 5 },
]

const US_REGIONS: CompanySubnational[] = [
  { code: 'AL', label: 'Alabama', matchers: ['alabama'], lat: 32.8, lon: -86.9, zoom: 6 },
  { code: 'AK', label: 'Alaska', matchers: ['alaska'], lat: 64.2, lon: -149.5, zoom: 4 },
  { code: 'AZ', label: 'Arizona', matchers: ['arizona'], lat: 34.3, lon: -111.7, zoom: 6 },
  { code: 'AR', label: 'Arkansas', matchers: ['arkansas'], lat: 34.8, lon: -92.3, zoom: 6 },
  { code: 'CA', label: 'California', matchers: ['california'], lat: 36.8, lon: -119.4, zoom: 5 },
  { code: 'CO', label: 'Colorado', matchers: ['colorado'], lat: 39.0, lon: -105.5, zoom: 6 },
  { code: 'CT', label: 'Connecticut', matchers: ['connecticut'], lat: 41.6, lon: -72.7, zoom: 7 },
  { code: 'DE', label: 'Delaware', matchers: ['delaware'], lat: 39.3, lon: -75.5, zoom: 7 },
  { code: 'DC', label: 'District of Columbia', matchers: ['district of columbia', 'washington, d.c', 'washington dc', 'd.c.'], lat: 38.9, lon: -77.0, zoom: 10 },
  { code: 'FL', label: 'Florida', matchers: ['florida'], lat: 28.1, lon: -81.7, zoom: 6 },
  { code: 'GA', label: 'Georgia', matchers: ['georgia'], lat: 33.0, lon: -83.6, zoom: 6 },
  { code: 'HI', label: 'Hawaii', matchers: ['hawaii'], lat: 21.3, lon: -157.8, zoom: 6 },
  { code: 'ID', label: 'Idaho', matchers: ['idaho'], lat: 44.5, lon: -114.7, zoom: 6 },
  { code: 'IL', label: 'Illinois', matchers: ['illinois'], lat: 40.0, lon: -89.2, zoom: 6 },
  { code: 'IN', label: 'Indiana', matchers: ['indiana'], lat: 40.0, lon: -86.3, zoom: 6 },
  { code: 'IA', label: 'Iowa', matchers: ['iowa'], lat: 42.1, lon: -93.5, zoom: 6 },
  { code: 'KS', label: 'Kansas', matchers: ['kansas'], lat: 38.5, lon: -98.4, zoom: 6 },
  { code: 'KY', label: 'Kentucky', matchers: ['kentucky'], lat: 37.5, lon: -85.3, zoom: 6 },
  { code: 'LA', label: 'Louisiana', matchers: ['louisiana'], lat: 31.2, lon: -92.3, zoom: 6 },
  { code: 'ME', label: 'Maine', matchers: ['maine'], lat: 45.4, lon: -69.2, zoom: 6 },
  { code: 'MD', label: 'Maryland', matchers: ['maryland'], lat: 39.0, lon: -76.7, zoom: 6 },
  { code: 'MA', label: 'Massachusetts', matchers: ['massachusetts'], lat: 42.4, lon: -71.4, zoom: 6 },
  { code: 'MI', label: 'Michigan', matchers: ['michigan'], lat: 44.3, lon: -85.4, zoom: 6 },
  { code: 'MN', label: 'Minnesota', matchers: ['minnesota'], lat: 46.3, lon: -94.3, zoom: 6 },
  { code: 'MS', label: 'Mississippi', matchers: ['mississippi'], lat: 32.7, lon: -90.0, zoom: 6 },
  { code: 'MO', label: 'Missouri', matchers: ['missouri'], lat: 38.6, lon: -92.6, zoom: 6 },
  { code: 'MT', label: 'Montana', matchers: ['montana'], lat: 47.0, lon: -110.1, zoom: 6 },
  { code: 'NE', label: 'Nebraska', matchers: ['nebraska'], lat: 41.5, lon: -99.9, zoom: 6 },
  { code: 'NV', label: 'Nevada', matchers: ['nevada'], lat: 39.4, lon: -116.9, zoom: 6 },
  { code: 'NH', label: 'New Hampshire', matchers: ['new hampshire'], lat: 43.7, lon: -71.6, zoom: 6 },
  { code: 'NJ', label: 'New Jersey', matchers: ['new jersey'], lat: 40.1, lon: -74.4, zoom: 7 },
  { code: 'NM', label: 'New Mexico', matchers: ['new mexico'], lat: 34.4, lon: -106.1, zoom: 6 },
  { code: 'NY', label: 'New York', matchers: ['new york'], lat: 43.0, lon: -75.5, zoom: 6 },
  { code: 'NC', label: 'North Carolina', matchers: ['north carolina'], lat: 35.6, lon: -79.4, zoom: 6 },
  { code: 'ND', label: 'North Dakota', matchers: ['north dakota'], lat: 47.5, lon: -100.5, zoom: 6 },
  { code: 'OH', label: 'Ohio', matchers: ['ohio'], lat: 40.4, lon: -82.8, zoom: 6 },
  { code: 'OK', label: 'Oklahoma', matchers: ['oklahoma'], lat: 35.6, lon: -97.5, zoom: 6 },
  { code: 'OR', label: 'Oregon', matchers: ['oregon'], lat: 44.0, lon: -120.6, zoom: 6 },
  { code: 'PA', label: 'Pennsylvania', matchers: ['pennsylvania'], lat: 41.0, lon: -77.8, zoom: 6 },
  { code: 'RI', label: 'Rhode Island', matchers: ['rhode island'], lat: 41.6, lon: -71.5, zoom: 7 },
  { code: 'SC', label: 'South Carolina', matchers: ['south carolina'], lat: 33.8, lon: -81.2, zoom: 6 },
  { code: 'SD', label: 'South Dakota', matchers: ['south dakota'], lat: 44.4, lon: -100.2, zoom: 6 },
  { code: 'TN', label: 'Tennessee', matchers: ['tennessee'], lat: 35.9, lon: -86.3, zoom: 6 },
  { code: 'TX', label: 'Texas', matchers: ['texas'], lat: 31.5, lon: -99.3, zoom: 5 },
  { code: 'UT', label: 'Utah', matchers: ['utah'], lat: 39.3, lon: -111.7, zoom: 6 },
  { code: 'VT', label: 'Vermont', matchers: ['vermont'], lat: 44.3, lon: -72.7, zoom: 6 },
  { code: 'VA', label: 'Virginia', matchers: ['virginia'], lat: 37.9, lon: -78.2, zoom: 6 },
  { code: 'WA', label: 'Washington', matchers: ['washington'], lat: 47.4, lon: -121.5, zoom: 6 },
  { code: 'WV', label: 'West Virginia', matchers: ['west virginia'], lat: 38.6, lon: -80.6, zoom: 6 },
  { code: 'WI', label: 'Wisconsin', matchers: ['wisconsin'], lat: 44.8, lon: -89.6, zoom: 6 },
  { code: 'WY', label: 'Wyoming', matchers: ['wyoming'], lat: 43.0, lon: -107.6, zoom: 6 },
]

export function listCompanySubnationals(countryCode: string | null | undefined): CompanySubnational[] {
  const c = (countryCode ?? '').trim().toUpperCase()
  if (c === 'CA') return CA_REGIONS
  if (c === 'US') return US_REGIONS
  return []
}

export function findCompanySubnational(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
): CompanySubnational | undefined {
  const rc = (regionCode ?? '').trim().toUpperCase()
  if (!rc) return undefined
  return listCompanySubnationals(countryCode).find((r) => r.code === rc)
}

/**
 * Match Photon/OSM subdivision: `statecode` (e.g. ON, CA-ON), `state` equals code, or full name in `state`.
 */
export function photonFeatureMatchesCompanyRegion(
  pr: { state?: string; statecode?: string | number | null },
  countryCode: string,
  regionCode: string,
): boolean {
  const row = findCompanySubnational(countryCode, regionCode)
  if (!row) return false
  const rc = regionCode.trim().toUpperCase()
  const raw = pr.statecode
  let code =
    raw === undefined || raw === null ? '' : String(raw).trim().toUpperCase().replace(/^(CA|US)-/i, '')
  if (code === rc) return true

  const stTrim = (pr.state ?? '').trim()
  if (stTrim.toUpperCase() === rc) return true

  const st = stTrim.toLowerCase()
  return row.matchers.some((m) => st.includes(m))
}

/** @deprecated Prefer {@link photonFeatureMatchesCompanyRegion} when `statecode` is available. */
export function photonStateMatchesCompanyRegion(
  stateField: string | undefined,
  countryCode: string,
  regionCode: string,
): boolean {
  return photonFeatureMatchesCompanyRegion({ state: stateField }, countryCode, regionCode)
}

/** Bias Photon’s text index toward the selected province/state (so users need not type “ON”). */
export function photonSearchQueryWithRegionContext(
  rawQuery: string,
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
): string {
  const q = rawQuery.trim()
  const cc = (countryCode ?? '').trim().toUpperCase()
  const rc = (regionCode ?? '').trim().toUpperCase()
  const row = findCompanySubnational(cc, rc)
  if (!row || !q) return q
  const ql = q.toLowerCase()
  const labelLower = row.label.toLowerCase()
  if (ql.includes(labelLower)) return q
  if (cc === 'CA') return `${q}, ${row.label}, Canada`
  if (cc === 'US') return `${q}, ${row.label}, United States`
  return q
}

export type PhotonLocationBias = {
  lat: number
  lon: number
  zoom: number
  location_bias_scale: number
}

export function photonBiasForCompanyRegion(
  countryCode: string | null | undefined,
  regionCode: string | null | undefined,
): PhotonLocationBias | null {
  const row = findCompanySubnational(countryCode, regionCode)
  if (!row) return null
  return { lat: row.lat, lon: row.lon, zoom: row.zoom, location_bias_scale: 0.28 }
}
