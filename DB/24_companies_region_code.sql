-- Province/state for company address context (CA/US only in app); drives Photon bias + ranking.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS region_code VARCHAR(8) NULL;

COMMENT ON COLUMN companies.region_code IS 'ISO 3166-2 subdivision code without country prefix (e.g. ON, BC, CA for California when country_code=US). NULL when not set or country not CA/US.';
