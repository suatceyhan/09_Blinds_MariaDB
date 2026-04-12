/** ISO 3166-1 alpha-2 for company country + Photon `countrycode` filter (CA / US + optional legacy). */

export type CountryOption = { code: string; label: string }

/** Empty = no Photon country filter (worldwide suggestions). Company UI uses CA/US (+ Any) only. */
export const ADDRESS_COUNTRY_OPTIONS: CountryOption[] = [
  { code: '', label: 'Any country (no filter)' },
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'United States' },
]

/** Adds a read-only option when the stored company country is outside the supported list. */
export function companyCountrySelectOptions(currentCountryCode: string | null | undefined): CountryOption[] {
  const cc = (currentCountryCode ?? '').trim().toUpperCase()
  const base = ADDRESS_COUNTRY_OPTIONS
  if (cc && !base.some((o) => o.code === cc)) {
    return [...base, { code: cc, label: `${cc} (legacy)` }]
  }
  return base
}
