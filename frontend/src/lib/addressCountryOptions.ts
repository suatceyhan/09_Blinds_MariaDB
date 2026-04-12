/** ISO 3166-1 alpha-2 for company country + Photon `countrycode` filter. */

export type CountryOption = { code: string; label: string }

/** Empty = no Photon country filter (worldwide suggestions). */
export const ADDRESS_COUNTRY_OPTIONS: CountryOption[] = [
  { code: '', label: 'Any country (no filter)' },
  { code: 'CA', label: 'Canada' },
  { code: 'US', label: 'United States' },
  { code: 'TR', label: 'Turkey' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'BE', label: 'Belgium' },
  { code: 'AT', label: 'Austria' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'PL', label: 'Poland' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'MX', label: 'Mexico' },
  { code: 'BR', label: 'Brazil' },
  { code: 'IN', label: 'India' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'SA', label: 'Saudi Arabia' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
  { code: 'SG', label: 'Singapore' },
]
