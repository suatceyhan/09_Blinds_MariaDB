-- 04_estimate_blinds_window_count.sql
-- Her estimate_blinds satırında o tip için pencere sayısı (perde_sayisi).

BEGIN;

ALTER TABLE estimate_blinds ADD COLUMN IF NOT EXISTS perde_sayisi INTEGER;

-- Yalnızca bu tahminde tek bir tip satırı varsa header'daki sayıyı o satıra yazar (çoklu tipte yanlış dağıtım olmasın).
UPDATE estimate_blinds eb
SET perde_sayisi = e.perde_sayisi
FROM estimate e
WHERE e.company_id = eb.company_id
  AND e.id = eb.estimate_id
  AND eb.perde_sayisi IS NULL
  AND e.perde_sayisi IS NOT NULL
  AND (
    SELECT COUNT(*)::int
    FROM estimate_blinds x
    WHERE x.company_id = eb.company_id AND x.estimate_id = eb.estimate_id
  ) = 1;

COMMIT;
