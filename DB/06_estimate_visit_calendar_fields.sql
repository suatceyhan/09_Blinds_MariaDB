-- Visit / calendar metadata for estimates (organizer, guests, TZ, address, notes, optional recurrence).

BEGIN;

ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_time_zone TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_address TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_notes TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_name TEXT;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_organizer_email VARCHAR(320);
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_guest_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE estimate ADD COLUMN IF NOT EXISTS visit_recurrence_rrule TEXT;

COMMENT ON COLUMN estimate.visit_time_zone IS 'IANA timezone for calendar display (e.g. Europe/Istanbul).';
COMMENT ON COLUMN estimate.visit_address IS 'Visit location override for calendar; falls back to customer address.';
COMMENT ON COLUMN estimate.visit_notes IS 'User note; Google description also includes customer name and blinds lines.';
COMMENT ON COLUMN estimate.visit_guest_emails IS 'Additional attendee emails (JSON array of strings).';
COMMENT ON COLUMN estimate.visit_recurrence_rrule IS 'Google Calendar RRULE line(s); NULL = does not repeat.';

COMMIT;
