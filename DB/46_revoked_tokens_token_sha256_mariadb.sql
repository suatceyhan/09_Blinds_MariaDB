-- MariaDB: store JWT blacklist fingerprint (SHA-256 hex) instead of full JWT string.
-- Reason: JWTs can exceed VARCHAR(255); MariaDB also doesn't support INSERT ... RETURNING.
--
-- Apply on existing databases created from older `blinds-mariadb.clean.sql`.
-- After this ALTER, old rows containing full JWTs are invalid for the app logic; truncate if needed.

ALTER TABLE revoked_tokens
  MODIFY COLUMN token CHAR(64) NOT NULL;
