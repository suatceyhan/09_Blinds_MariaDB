-- ISO 3166-1 alpha-2: restricts Photon address autocomplete to this country when set.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) NULL;

COMMENT ON COLUMN companies.country_code IS 'ISO 3166-1 alpha-2; address suggestions (Photon) filter; NULL = no country filter.';
