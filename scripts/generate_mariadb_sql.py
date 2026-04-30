"""
Produce DB/blinds-mariadb.sql from DB/blinds-postgresql-reference.sql.

Target: MariaDB 10.11+ (including 12.x, e.g. 12.2): UUID(), JSON, window functions, functional indexes.
Fresh-database install via: mysql -u USER -p DATABASE < DB/blinds-mariadb.sql

Run: python scripts/generate_mariadb_sql.py
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "DB" / "blinds-postgresql-reference.sql"
DST = ROOT / "DB" / "blinds-mariadb.sql"

START_RLS = "-- # BÖLÜM 3 — Kiracı RLS (03 migration içerir)"
END_RLS = "-- -----------------------------------------------------------------------------\n-- CONSOLIDATED MIGRATIONS"

# --- Large PostgreSQL-only migration 14 (legacy product category); fresh installs skip Else branch.
REMOVE_DO_M14 = re.compile(
    r"-- 14_migrate_product_category_to_global\.sql[\s\S]*?COMMIT;\s*\n",
    re.MULTILINE,
)


def strip_initial_begin_batch(text: str) -> str:
    """PostgreSQL opened with BEGIN; — MariaDB DDL auto-commits; drop the first lone BEGIN."""

    needle = (
        "\nBEGIN;\n\n-- ############################################################################\n"
        "-- # BÖLÜM 1 — Auth / RBAC / JWT yardımcı tablolar                                    #\n"
        "-- ############################################################################\n"
    )
    if needle in text:
        return text.replace(
            needle,
            "\n\n-- ############################################################################\n"
            "-- # BÖLÜM 1 — Auth / RBAC / JWT yardımcı tablolar                                    #\n"
            "-- ############################################################################\n",
            1,
        )
    return text


def strip_rls_section(text: str) -> str:
    i = text.find(START_RLS)
    j = text.find(END_RLS)
    if i != -1 and j != -1 and j > i:
        return (
            text[:i]
            + "-- [Removed PostgreSQL tenant RLS / CREATE POLICY section]\n"
            + "-- Tenant isolation is enforced in application code for MariaDB.\n\n"
            + text[j:]
        )
    return text


def uuid_types(text: str) -> str:
    text = text.replace("gen_random_uuid()", "UUID()")
    text = text.replace("gen_random_uuid ()", "UUID()")
    protected = "__UUID_FN__"
    text = text.replace("UUID()", protected)
    text = re.sub(r"\bUUID\b", "CHAR(36)", text)
    text = text.replace(protected, "UUID()")
    # Expression default requires parentheses in MariaDB 10.7+
    text = re.sub(r"DEFAULT\s+UUID\(\)", "DEFAULT (UUID())", text)
    return text


def basic_types(text: str) -> str:
    text = text.replace("TIMESTAMPTZ", "DATETIME(6)")
    text = text.replace("TIMESTAMP WITHOUT TIME ZONE", "DATETIME")
    text = text.replace("JSONB", "JSON")
    text = re.sub(r"'(\[\]|\{\})'::jsonb", r"CAST('\1' AS JSON)", text)
    text = text.replace("jsonb", "json")
    return text


def varchar_without_length(text: str) -> str:
    """PostgreSQL allows VARCHAR without (n); MariaDB/MySQL require a length."""

    return re.sub(r"\bVARCHAR\b(?!\s*\()", "VARCHAR(512)", text)


def strip_public(text: str) -> str:
    return text.replace("public.", "")


def pg_schema_checks(text: str) -> str:
    return text.replace("table_schema = 'public'", "table_schema = DATABASE()")


def pg_expression_partial_unique_indexes(text: str) -> str:
    """
    PostgreSQL partial unique indexes on expressions (lower/btrim + WHERE …)
    are not valid in MariaDB. Use STORED generated columns + plain UNIQUE INDEX.
    """

    text = re.sub(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_pending_employee_email_active\s+"
        r"ON\s+pending_employee_self_registrations\s*\(\s*lower\s*\(\s*email\s*\)\s*\)\s+"
        r"WHERE\s+is_deleted\s*=\s*FALSE\s*;",
        """ALTER TABLE pending_employee_self_registrations
  ADD COLUMN IF NOT EXISTS email_unique_key VARCHAR(512)
  GENERATED ALWAYS AS (CASE WHEN NOT is_deleted THEN LOWER(email) ELSE NULL END) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_employee_email_active
  ON pending_employee_self_registrations (email_unique_key);""",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    text = re.sub(
        r"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_customers_company_email\s+"
        r"ON\s+customers\s*\(\s*company_id\s*,\s*lower\s*\(\s*btrim\s*\(\s*email\s*\)\s*\)\s*\)\s+"
        r"WHERE\s+email\s+IS\s+NOT\s+NULL\s+AND\s+btrim\s*\(\s*email\s*\)\s*<>\s*''\s*;",
        """ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_company_unique VARCHAR(768)
  GENERATED ALWAYS AS (
    CASE
      WHEN email IS NOT NULL AND TRIM(email) <> ''
      THEN CONCAT(CAST(company_id AS CHAR), '|', LOWER(TRIM(email)))
      ELSE NULL
    END
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_company_email
  ON customers (email_company_unique);""",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return text


def strip_partial_index_where(text: str) -> str:
    """MariaDB has no partial indexes like PostgreSQL; drop WHERE clause on CREATE INDEX."""

    def kill_where(m: re.Match) -> str:
        stmt = m.group(1)
        return stmt.rstrip() + ";"

    # CREATE INDEX ... (...) WHERE ...
    text = re.sub(
        r"(CREATE\s+(?:UNIQUE\s+)?INDEX[^\n]+?\))\s+WHERE\s+[^\n;]+;",
        kill_where,
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return text


def strip_partial_unique_multiline(text: str) -> str:
    """CREATE UNIQUE INDEX … \\n ON … (…) \\n WHERE …"""

    text = re.sub(
        r"(CREATE\s+UNIQUE\s+INDEX[^\n]+\n\s+ON\s+[^\n]+\([^)]+\))\s*\n\s*WHERE\s+[^\n]+;",
        r"\1;",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(CREATE\s+INDEX[^\n]+\n\s+ON\s+[^\n]+\([^)]+\))\s*\n\s*WHERE\s+[^\n]+;",
        r"\1;",
        text,
        flags=re.IGNORECASE,
    )
    return text


def fix_remaining_concat(text: str) -> str:
    """Catch leftover PostgreSQL `||` concat fragments after partial transformations."""

    reps: list[tuple[str, str]] = [
        (
            r"substring\s*\(\s*md5\s*\(\s*'global:est:custom:'\s*\|\|\s*lower\s*\(\s*trim\s*\(\s*name\s*\)\s*\)\s*\)\s*,\s*1\s*,\s*16\s*\)",
            "SUBSTRING(MD5(CONCAT('global:est:custom:', LOWER(TRIM(name)))), 1, 16)",
        ),
        (
            r"substring\s*\(\s*md5\s*\(\s*'global:est:custom:'\s*\|\|\s*lower\s*\(\s*trim\s*\(\s*l\.name\s*\)\s*\)\s*\)\s*,\s*1\s*,\s*16\s*\)",
            "SUBSTRING(MD5(CONCAT('global:est:custom:', LOWER(TRIM(l.name)))), 1, 16)",
        ),
        (
            r"substring\s*\(\s*md5\s*\(\s*'global:ord:custom:'\s*\|\|\s*lower\s*\(\s*trim\s*\(\s*name\s*\)\s*\)\s*\)\s*,\s*1\s*,\s*16\s*\)",
            "SUBSTRING(MD5(CONCAT('global:ord:custom:', LOWER(TRIM(name)))), 1, 16)",
        ),
        (
            r"substring\s*\(\s*md5\s*\(\s*'global:ord:custom:'\s*\|\|\s*lower\s*\(\s*trim\s*\(\s*l\.name\s*\)\s*\)\s*\)\s*,\s*1\s*,\s*16\s*\)",
            "SUBSTRING(MD5(CONCAT('global:ord:custom:', LOWER(TRIM(l.name)))), 1, 16)",
        ),
    ]
    for pat, repl in reps:
        text = re.sub(pat, repl, text, flags=re.IGNORECASE)
    return text


def strip_comment_on_any(text: str) -> str:
    """Remove COMMENT ON … lines (PostgreSQL); tolerate semicolons inside quoted strings."""

    out: list[str] = []
    for line in text.splitlines(True):
        if line.lstrip().upper().startswith("COMMENT ON"):
            continue
        out.append(line)
    return "".join(out)


def fix_cross_join_values_estimate_seed(text: str) -> str:
    """PostgreSQL VALUES-derived table → UNION ALL subquery (MariaDB)."""

    old = """CROSS JOIN (
  VALUES
    ('pending', 'Pending'),
    ('converted', 'Converted to order'),
    ('cancelled', 'Cancelled')
) AS x(slug, name);"""
    new = """CROSS JOIN (
  SELECT 'pending' AS slug, 'Pending' AS name
  UNION ALL SELECT 'converted', 'Converted to order'
  UNION ALL SELECT 'cancelled', 'Cancelled'
) AS x;"""
    return text.replace(old, new)


def quote_permissions_key_ident(text: str) -> str:
    """Quote reserved identifier `key` on permissions aliases."""

    return re.sub(r"(\b\w+)\.key\b", r"\1.`key`", text)


def split_inline_company_id_when_composite_fks_exist(text: str) -> str:
    """
    InnoDB/MariaDB can fail CREATE TABLE with errno 150 when `company_id` uses an
    inline REFERENCES companies(...) and the same table also defines composite
    FOREIGN KEY (company_id, ...) to other tables. Split into an explicit
    single-column FK on company_id plus the composite FKs.
    """

    replacements: list[tuple[str, str]] = [
        # customers
        (
            "  company_id      CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  id              VARCHAR(16) NOT NULL,",
            "  company_id      CHAR(36)        NOT NULL,\n"
            "  id              VARCHAR(16) NOT NULL,",
        ),
        (
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_customers_status_user",
            "  PRIMARY KEY (company_id, id),\n"
            "  KEY idx_customers_company_status_user (company_id, status_user_id),\n"
            "  CONSTRAINT fk_customers_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_customers_status_user",
        ),
        # estimate
        (
            "  company_id    CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  id            VARCHAR(16) NOT NULL,",
            "  company_id    CHAR(36)        NOT NULL,\n"
            "  id            VARCHAR(16) NOT NULL,",
        ),
        (
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_estimate_customer",
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_estimate_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_estimate_customer",
        ),
        # estimate_blinds (main consolidated section)
        (
            "  company_id   CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  estimate_id  VARCHAR(16) NOT NULL,",
            "  company_id   CHAR(36)        NOT NULL,\n"
            "  estimate_id  VARCHAR(16) NOT NULL,",
        ),
        # estimate_blinds (migration snippet duplicate spacing)
        (
            "  company_id  CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  estimate_id VARCHAR(16) NOT NULL,",
            "  company_id  CHAR(36)        NOT NULL,\n"
            "  estimate_id VARCHAR(16) NOT NULL,",
        ),
        (
            "  PRIMARY KEY (company_id, estimate_id, blinds_id),\n"
            "  CONSTRAINT fk_estimate_blinds_estimate",
            "  PRIMARY KEY (company_id, estimate_id, blinds_id),\n"
            "  CONSTRAINT fk_estimate_blinds_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_estimate_blinds_estimate",
        ),
        # orders
        (
            "  company_id              CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  id                      VARCHAR(16) NOT NULL,",
            "  company_id              CHAR(36)        NOT NULL,\n"
            "  id                      VARCHAR(16) NOT NULL,",
        ),
        (
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_orders_customer",
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_orders_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_orders_customer",
        ),
        # blinds_type_add
        (
            "  company_id        CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  id                VARCHAR(16) NOT NULL,",
            "  company_id        CHAR(36)        NOT NULL,\n"
            "  id                VARCHAR(16) NOT NULL,",
        ),
        (
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_blinds_type_add_blinds_type",
            "  PRIMARY KEY (company_id, id),\n"
            "  CONSTRAINT fk_blinds_type_add_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_blinds_type_add_blinds_type",
        ),
        # order_items (duplicated CREATE blocks in consolidated dump)
        (
            "  company_id        CHAR(36)        NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  id                CHAR(36)        PRIMARY KEY DEFAULT (UUID()),",
            "  company_id        CHAR(36)        NOT NULL,\n"
            "  id                CHAR(36)        PRIMARY KEY DEFAULT (UUID()),",
        ),
        (
            "  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,\n"
            "  CONSTRAINT fk_order_items_order",
            "  is_deleted        BOOLEAN     NOT NULL DEFAULT FALSE,\n"
            "  CONSTRAINT fk_order_items_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_order_items_order",
        ),
        # order_payments
        (
            "  company_id    CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  order_id      VARCHAR(16) NOT NULL,",
            "  company_id    CHAR(36) NOT NULL,\n"
            "  order_id      VARCHAR(16) NOT NULL,",
        ),
        (
            "  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,\n"
            "  CONSTRAINT fk_order_payments_order",
            "  is_deleted    BOOLEAN NOT NULL DEFAULT FALSE,\n"
            "  CONSTRAINT fk_order_payments_company\n"
            "    FOREIGN KEY (company_id) REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,\n"
            "  CONSTRAINT fk_order_payments_order",
        ),
    ]

    for old, new in replacements:
        text = text.replace(old, new)
    return text


def mariadb_composite_fk_on_delete_restrict_where_pg_used_set_null(text: str) -> str:
    """
    InnoDB rejects some composite FOREIGN KEY ... ON DELETE SET NULL definitions when
    the FK mixes NOT NULL and NULL columns (errno 150), whereas PostgreSQL only clears
    the nullable columns. Use RESTRICT on those FKs and emulate SET NULL via BEFORE DELETE
    triggers (see TRIGGER_TAIL).
    """

    subs = [
        (
            """  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL""",
            """  CONSTRAINT fk_customers_status_user
    FOREIGN KEY (company_id, status_user_id)
    REFERENCES status_user (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT""",
        ),
        (
            """  CONSTRAINT fk_orders_status_order
    FOREIGN KEY (company_id, status_orde_id)
    REFERENCES status_order (company_id, id)
    ON UPDATE CASCADE
    ON DELETE SET NULL""",
            """  CONSTRAINT fk_orders_status_order
    FOREIGN KEY (company_id, status_orde_id)
    REFERENCES status_order (company_id, id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT""",
        ),
    ]
    for old, new in subs:
        text = text.replace(old, new)
    return text


def fk_alters_idempotent(text: str) -> str:
    """
    Before each ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY, emit
    DROP FOREIGN KEY IF EXISTS so the dump can be re-imported on a non-empty DB.

    (PostgreSQL used DO $$ … IF NOT EXISTS (pg_constraint …); MariaDB has no IF NOT EXISTS for ADD CONSTRAINT.)
    """

    pattern = re.compile(
        r"(ALTER\s+TABLE\s+(\w+)\s*\n\s*ADD\s+CONSTRAINT\s+(\w+)\s+FOREIGN\s+KEY[\s\S]*?;)",
        re.IGNORECASE,
    )

    def inject(m: re.Match) -> str:
        stmt = m.group(1)
        tbl = m.group(2)
        fk = m.group(3)
        return f"ALTER TABLE {tbl} DROP FOREIGN KEY IF EXISTS {fk};\n{stmt}"

    return pattern.sub(inject, text)


def fix_permissions_key_keyword(text: str) -> str:
    """permissions.key is reserved in MariaDB — quote in DDL and INSERT column lists."""

    text = re.sub(
        r"(CREATE TABLE IF NOT EXISTS permissions \(\s*[^\n]+\n)\s*key\s+VARCHAR(?:\(\d+\))?\s+NOT NULL",
        r"\1  `key` VARCHAR(512) NOT NULL",
        text,
        flags=re.IGNORECASE,
    )
    text = text.replace(
        "CONSTRAINT uq_permissions_key UNIQUE (key)",
        "CONSTRAINT uq_permissions_key UNIQUE (`key`)",
    )
    text = text.replace(
        "INSERT IGNORE INTO permissions (key,",
        "INSERT IGNORE INTO permissions (`key`,",
    )
    text = text.replace("INSERT INTO permissions (key,", "INSERT INTO permissions (`key`,")
    return text


def strip_nulls_last(text: str) -> str:
    return re.sub(r"\s+NULLS\s+(FIRST|LAST)", "", text, flags=re.IGNORECASE)


def regexp_operators(text: str) -> str:
    text = re.sub(
        r"lower\(([^)]+)\)\s*~\s*('(?:[^'\\]|\\.)*')",
        r"LOWER(\1) REGEXP \2",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"LOWER\(([^)]+)\)\s*~\s*('(?:[^'\\]|\\.)*')",
        r"LOWER(\1) REGEXP \2",
        text,
    )
    return text


def concat_pg(text: str) -> str:
    """PostgreSQL || string concat -> CONCAT(...) for known md5/substring lines."""
    replacements = [
        (
            "substring(md5(c.id::text || ':est:' || x.slug), 1, 16)",
            "SUBSTRING(MD5(CONCAT(CAST(c.id AS CHAR), ':est:', x.slug)), 1, 16)",
        ),
        (
            "substring(md5('global:est:custom:' || lower(trim(name)))::text, 1, 16)",
            "SUBSTRING(MD5(CONCAT('global:est:custom:', LOWER(TRIM(name)))), 1, 16)",
        ),
        (
            "substring(md5('global:est:custom:' || lower(trim(l.name)))::text, 1, 16)",
            "SUBSTRING(MD5(CONCAT('global:est:custom:', LOWER(TRIM(l.name)))), 1, 16)",
        ),
        (
            "substring(md5('global:ord:custom:' || lower(trim(name)))::text, 1, 16)",
            "SUBSTRING(MD5(CONCAT('global:ord:custom:', LOWER(TRIM(name)))), 1, 16)",
        ),
        (
            "substring(md5('global:ord:custom:' || lower(trim(l.name)))::text, 1, 16)",
            "SUBSTRING(MD5(CONCAT('global:ord:custom:', LOWER(TRIM(l.name)))), 1, 16)",
        ),
        (
            "substring(md5('global:bt:' || l.company_id::text || ':' || l.id::text), 1, 16)",
            "SUBSTRING(MD5(CONCAT('global:bt:', CAST(l.company_id AS CHAR), ':', l.id)), 1, 16)",
        ),
    ]
    for a, b in replacements:
        text = text.replace(a, b)
    return text


def casts(text: str) -> str:
    text = text.replace("UUID()::text", "CAST(UUID() AS CHAR)")
    # Qualified names: c.id::text -> CAST(c.id AS CHAR)
    text = re.sub(
        r"([\w.]+)\s*::\s*text\b",
        r"CAST(\1 AS CHAR)",
        text,
    )
    text = re.sub(r"\)\s*::\s*text", ") ", text)
    text = re.sub(r"::\s*uuid\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"::\s*int\b", "", text, flags=re.IGNORECASE)
    text = re.sub(
        r"SUBSTRING\s*\(\s*([^,]+)\s+FROM\s+(\d+)\s+FOR\s+(\d+)\s*\)",
        r"SUBSTRING(\1, \2, \3)",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"substring\s*\(\s*md5\s*\(\s*gen_random_uuid\s*\(\s*\)\s*::\s*text\s*\)\s+for\s+16\s*\)",
        "SUBSTRING(MD5(UUID()), 1, 16)",
        text,
        flags=re.IGNORECASE,
    )
    return text


def bool_or_to_max(text: str) -> str:
    return text.replace("bool_or(active)", "MAX(active)")


def drop_table_cascade(text: str) -> str:
    return re.sub(
        r"DROP TABLE IF EXISTS\s+(\w+)\s+CASCADE\s*;",
        r"DROP TABLE IF EXISTS \1;",
        text,
        flags=re.IGNORECASE,
    )


def on_conflict_to_ignore(text: str) -> str:
    """INSERT ... ON CONFLICT (...) DO NOTHING -> INSERT IGNORE ..."""

    def repl_block(m: re.Match) -> str:
        core = m.group(1).strip()
        return "INSERT IGNORE INTO " + core + ";"

    text = re.sub(
        r"\bINSERT\s+INTO\s+([\s\S]+?)\s+ON\s+CONFLICT\s+[\s\S]*?DO\s+NOTHING\s*;",
        repl_block,
        text,
        flags=re.IGNORECASE,
    )
    return text


def pg_constraint_do_to_alter(text: str) -> str:
    """DO $$ ... pg_constraint ... ALTER TABLE ... END $$; -> ALTER only."""

    pattern = re.compile(
        r"DO\s+\$\$\s*BEGIN\s*IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_constraint\s+WHERE\s+conname\s*=\s*'[^']+'\s*\)\s*THEN\s*"
        r"(ALTER\s+TABLE[\s\S]*?;)\s*END\s+IF;\s*END\s*\$\$\s*;",
        re.IGNORECASE,
    )
    prev = None
    while prev != text:
        prev = text
        text = pattern.sub(r"\1", text)
    return text


def remove_rows_matching(text: str, patterns: list[str]) -> str:
    lines = text.splitlines(True)
    out = []
    for line in lines:
        if any(re.search(p, line, re.IGNORECASE) for p in patterns):
            continue
        out.append(line)
    return "".join(out)


def remove_multiline_patterns(text: str, rx_list: list[re.Pattern]) -> str:
    for rx in rx_list:
        text = rx.sub("", text)
    return text


POLICY_BLOCK = re.compile(
    r"CREATE\s+POLICY\s+[\s\S]*?\)\s*;",
    re.IGNORECASE,
)

DROP_POLICY_LINE = re.compile(r"^\s*DROP\s+POLICY[^;]*;\s*$", re.MULTILINE | re.IGNORECASE)

FUNCTION_PLPGSQL = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[\s\S]*?LANGUAGE\s+plpgsql\s*;",
    re.IGNORECASE,
)

FUNCTION_SQL_RLS = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[\s\S]*?LANGUAGE\s+sql\s+[\s\S]*?\$\$\s*;",
    re.IGNORECASE,
)

RLS_FUNCTION_SIMPLE = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[\s\S]*?\$\$\s*;",
    re.IGNORECASE,
)

COMMENT_ON = re.compile(
    r"^\s*COMMENT\s+ON\s+(?:COLUMN|TABLE)\s+[^;]+;\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def remove_pg_functions_and_policies(text: str) -> str:
    text = DROP_POLICY_LINE.sub("", text)
    text = POLICY_BLOCK.sub("", text)
    text = FUNCTION_PLPGSQL.sub("", text)
    text = FUNCTION_SQL_RLS.sub("", text)
    text = remove_rows_matching(
        text,
        [
            r"ENABLE ROW LEVEL SECURITY",
            r"FORCE ROW LEVEL SECURITY",
            r"ALTER TABLE IF EXISTS\s+\w+\s+ENABLE ROW LEVEL SECURITY",
        ],
    )
    text = COMMENT_ON.sub("", text)
    return text


def remove_trigger_blocks_pg(text: str) -> str:
    """Remove DROP/CREATE TRIGGER ... EXECUTE PROCEDURE ... (converted later)."""
    trig_pair = re.compile(
        r"DROP TRIGGER IF EXISTS[^;]+;\s*"
        r"CREATE TRIGGER\s+\w+[\s\S]*?"
        r"EXECUTE\s+PROCEDURE\s+[\w.]+\(\)\s*;",
        re.IGNORECASE,
    )
    text = trig_pair.sub("", text)
    # leftover CREATE TRIGGER lines inside DO blocks already removed with DO
    return text


def scrub_do_blocks_simple(text: str) -> str:
    """Remove DO $$ blocks that only wrapped triggers/policies (already stripped)."""
    # DO $$ BEGIN IF EXISTS pg_proc ... END $$;
    text = re.sub(
        r"DO\s+\$\$\s*BEGIN[\s\S]*?END\s*\$\$\s*;",
        "",
        text,
    )
    return text


def scrub_named_do_blocks(text: str) -> str:
    """Remove DO $tag$ ... $tag$ used for migrations that were PG-specific."""

    def strip_block(m: re.Match) -> str:
        body = m.group(0)
        if "mig32" in body:
            return MARIADB_MIG32
        if "mig40" in body:
            return replacement_m40()
        if "mig41" in body:
            return replacement_m41()
        if "mig42" in body:
            return replacement_m42()
        if "mig43" in body:
            return "-- Migration 43 (estimate workflow seed): no-op on MariaDB.\n"
        if "mig44" in body:
            return replacement_m44()
        if "mig45" in body:
            return replacement_m45()
        return ""

    text = re.sub(r"DO\s+\$mig\d+\$[\s\S]*?\$mig\d+\$\s*;", strip_block, text)
    return text


def replacement_m40() -> str:
    return """
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  company_id CHAR(36) NULL,
  entity_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_company_entity_code_version
  ON workflow_definitions (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'),
    entity_type,
    code,
    version
  );

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  workflow_definition_id CHAR(36) NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  from_status_id VARCHAR(32) NULL,
  to_status_id VARCHAR(32) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required_permission TEXT NULL,
  guard_json JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL
);
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_from
  ON workflow_transitions (workflow_definition_id, from_status_id);
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_to
  ON workflow_transitions (workflow_definition_id, to_status_id);
CREATE INDEX IF NOT EXISTS ix_workflow_transitions_def_active
  ON workflow_transitions (workflow_definition_id);

CREATE TABLE IF NOT EXISTS workflow_transition_actions (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  transition_id CHAR(36) NOT NULL REFERENCES workflow_transitions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  config JSON NOT NULL DEFAULT (CAST('{}' AS JSON)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX IF NOT EXISTS ix_workflow_transition_actions_transition
  ON workflow_transition_actions (transition_id, sort_order);

"""


def replacement_m41() -> str:
    return """
INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
SELECT 'settings.order_workflow.view', 'Order workflow — view', NULL, 'module', 'settings', 'access', 'settings', 72, FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'settings.order_workflow.view');

INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
SELECT 'settings.order_workflow.edit', 'Order workflow — edit', NULL, 'module', 'settings', 'access', 'settings', 73, FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'settings.order_workflow.edit');

INSERT IGNORE INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT r.id, p.id, TRUE, FALSE
FROM roles r
JOIN permissions p ON p.`key` IN ('settings.order_workflow.view', 'settings.order_workflow.edit')
WHERE r.name = 'superadmin' AND COALESCE(r.is_deleted, FALSE) = FALSE;

"""


def replacement_m42() -> str:
    return """
ALTER TABLE workflow_transitions
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME(6) NULL;

"""


def replacement_m44() -> str:
    return """
INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
SELECT 'settings.estimate_workflow.view', 'Estimate workflow — view', NULL, 'module', 'settings', 'access', 'settings', 74, FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'settings.estimate_workflow.view');

INSERT INTO permissions (key, name, parent_key, target_type, target_id, action, module_name, sort_index, is_deleted)
SELECT 'settings.estimate_workflow.edit', 'Estimate workflow — edit', NULL, 'module', 'settings', 'access', 'settings', 75, FALSE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE `key` = 'settings.estimate_workflow.edit');

INSERT IGNORE INTO role_permissions (role_id, permission_id, is_granted, is_deleted)
SELECT r.id, p.id, TRUE, FALSE
FROM roles r
JOIN permissions p ON p.`key` IN ('settings.estimate_workflow.view', 'settings.estimate_workflow.edit')
WHERE r.name = 'superadmin' AND COALESCE(r.is_deleted, FALSE) = FALSE;

"""


def replacement_m45() -> str:
    return """
ALTER TABLE status_order ADD COLUMN IF NOT EXISTS builtin_kind TEXT NULL;

ALTER TABLE status_order DROP CONSTRAINT IF EXISTS ck_status_order_builtin_kind_global;
ALTER TABLE status_order ADD CONSTRAINT ck_status_order_builtin_kind_global CHECK (
    builtin_kind IS NULL
    OR builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_status_order_global_builtin_nn
  ON status_order (builtin_kind);

UPDATE status_order
SET builtin_kind = 'ready_for_install'
WHERE builtin_kind IS NULL
  AND id = SUBSTRING(MD5('global:ord:builtin:ready_for_install'), 1, 16);

UPDATE status_order
SET builtin_kind = 'in_production'
WHERE builtin_kind IS NULL
  AND id = SUBSTRING(MD5('global:ord:builtin:in_production'), 1, 16);

UPDATE status_order
SET builtin_kind = 'done'
WHERE builtin_kind IS NULL
  AND id = SUBSTRING(MD5('global:ord:builtin:done'), 1, 16);

UPDATE status_order
SET builtin_kind = 'new'
WHERE builtin_kind IS NULL
  AND LOWER(TRIM(name)) = 'new order';

"""


MARIADB_MIG32 = """
-- 32_global_blinds_type_and_matrix.sql (MariaDB)
-- PostgreSQL jsonb remap on orders.blinds_lines is omitted; run a custom script if migrating legacy JSON data.

ALTER TABLE estimate_blinds DROP FOREIGN KEY fk_estimate_blinds_blinds_type;
ALTER TABLE estimate DROP FOREIGN KEY fk_estimate_blinds_type;
ALTER TABLE blinds_type_add DROP FOREIGN KEY fk_blinds_type_add_blinds_type;
ALTER TABLE blinds_type_category_allowed DROP FOREIGN KEY fk_btca_blinds_type;

ALTER TABLE blinds_type RENAME TO blinds_type_legacy;

CREATE TABLE _tmp_bt_map (
  company_id CHAR(36) NOT NULL,
  old_id VARCHAR(16) NOT NULL,
  new_id VARCHAR(16) NOT NULL,
  PRIMARY KEY (company_id, old_id)
);

INSERT INTO _tmp_bt_map (company_id, old_id, new_id)
SELECT
  l.company_id,
  l.id,
  SUBSTRING(MD5(CONCAT('global:bt:', CAST(l.company_id AS CHAR), ':', l.id)), 1, 16)
FROM blinds_type_legacy l;

CREATE TABLE blinds_type (
  id VARCHAR(16) PRIMARY KEY,
  name TEXT NOT NULL,
  aciklama TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_blinds_type_global_active ON blinds_type (active);

INSERT INTO blinds_type (id, name, aciklama, active, sort_order)
SELECT m.new_id, l.name, l.aciklama, l.active, 0
FROM blinds_type_legacy l
JOIN _tmp_bt_map m ON m.company_id = l.company_id AND m.old_id = l.id;

UPDATE estimate_blinds eb
JOIN _tmp_bt_map m ON eb.company_id = m.company_id AND eb.blinds_id = m.old_id
SET eb.blinds_id = m.new_id;

UPDATE estimate e
JOIN _tmp_bt_map m ON e.company_id = m.company_id AND e.blinds_id = m.old_id
SET e.blinds_id = m.new_id;

UPDATE blinds_type_add b
JOIN _tmp_bt_map m ON b.company_id = m.company_id AND b.blinds_type_id = m.old_id
SET b.blinds_type_id = m.new_id;

UPDATE blinds_type_category_allowed a
JOIN _tmp_bt_map m ON a.company_id = m.company_id AND a.blinds_type_id = m.old_id
SET a.blinds_type_id = m.new_id;

DROP TABLE blinds_type_legacy;

ALTER TABLE estimate_blinds
  ADD CONSTRAINT fk_estimate_blinds_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE estimate
  ADD CONSTRAINT fk_estimate_blinds_type
    FOREIGN KEY (blinds_id) REFERENCES blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE blinds_type_add
  ADD CONSTRAINT fk_blinds_type_add_blinds_type
    FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE blinds_type_category_allowed
  ADD CONSTRAINT fk_btca_blinds_type
    FOREIGN KEY (blinds_type_id) REFERENCES blinds_type (id)
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE TABLE company_blinds_type_matrix (
  company_id CHAR(36) NOT NULL REFERENCES companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  blinds_type_id VARCHAR(16) NOT NULL REFERENCES blinds_type (id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (company_id, blinds_type_id)
);
CREATE INDEX idx_company_blinds_type_matrix_company ON company_blinds_type_matrix (company_id);

INSERT IGNORE INTO company_blinds_type_matrix (company_id, blinds_type_id)
SELECT company_id, new_id FROM _tmp_bt_map;

DROP TABLE _tmp_bt_map;

"""


def patch_migration_21(text: str) -> str:
    """Rewrite PostgreSQL UPDATE...FROM + WITH to MariaDB UPDATE...JOIN."""

    text = re.sub(
        r"WITH ranked AS \(\s*SELECT company_id, id,\s*"
        r"\(ROW_NUMBER\(\) OVER \(PARTITION BY company_id ORDER BY name ASC\) - 1\) AS rn\s*"
        r"FROM status_order\s*\)\s*"
        r"UPDATE status_order so\s*SET sort_order = ranked\.rn\s*FROM ranked\s*"
        r"WHERE so\.company_id = ranked\.company_id AND so\.id = ranked\.id;",
        """UPDATE status_order so
JOIN (
  SELECT company_id, id,
    CAST((ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY name ASC) - 1) AS SIGNED) AS rn
  FROM status_order
) ranked ON so.company_id = ranked.company_id AND so.id = ranked.id
SET so.sort_order = ranked.rn;""",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    text = re.sub(
        r"WITH custom_ranked AS \(\s*SELECT company_id, id,\s*"
        r"\(100 \+ ROW_NUMBER\(\) OVER \(PARTITION BY company_id ORDER BY name ASC\)\) AS rn\s*"
        r"FROM status_estimate\s*WHERE slug IS NULL\s*\)\s*"
        r"UPDATE status_estimate se\s*SET sort_order = custom_ranked\.rn\s*FROM custom_ranked\s*"
        r"WHERE se\.company_id = custom_ranked\.company_id AND se\.id = custom_ranked\.id;",
        """UPDATE status_estimate se
JOIN (
  SELECT company_id, id,
    CAST((100 + ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY name ASC)) AS SIGNED) AS rn
  FROM status_estimate
  WHERE slug IS NULL
) custom_ranked ON se.company_id = custom_ranked.company_id AND se.id = custom_ranked.id
SET se.sort_order = custom_ranked.rn;""",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    return text


def patch_migration_25(text: str) -> str:
    old = """BEGIN;
WITH labeled AS (
  SELECT
    se.company_id,
    se.id,
    CASE
      WHEN lower(trim(se.name)) = 'new estimate' THEN 'new'
      WHEN lower(trim(se.name)) = 'pending' THEN 'pending'
      WHEN lower(trim(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
      WHEN lower(trim(se.name)) LIKE 'converted to ord%'
        OR lower(trim(se.name)) = 'converted to order'
        OR lower(trim(se.name)) = 'convert to order' THEN 'converted'
      ELSE NULL
    END AS kind,
    row_number() OVER (
      PARTITION BY se.company_id,
        CASE
          WHEN lower(trim(se.name)) = 'new estimate' THEN 'new'
          WHEN lower(trim(se.name)) = 'pending' THEN 'pending'
          WHEN lower(trim(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
          WHEN lower(trim(se.name)) LIKE 'converted to ord%'
            OR lower(trim(se.name)) = 'converted to order'
            OR lower(trim(se.name)) = 'convert to order' THEN 'converted'
          ELSE NULL
        END
      ORDER BY se.sort_order ASC, se.id ASC
    ) AS rn
  FROM status_estimate se
  WHERE se.builtin_kind IS NULL
),
to_fix AS (
  SELECT company_id, id, kind
  FROM labeled
  WHERE kind IS NOT NULL AND rn = 1
)
UPDATE status_estimate se
SET builtin_kind = tf.kind
FROM to_fix tf
WHERE se.company_id = tf.company_id AND se.id = tf.id
  AND NOT EXISTS (
    SELECT 1
    FROM status_estimate x
    WHERE x.company_id = tf.company_id AND x.builtin_kind = tf.kind
  );
COMMIT;"""
    new = """BEGIN;
UPDATE status_estimate se
JOIN (
  SELECT company_id, id, kind
  FROM (
    SELECT
      se.company_id,
      se.id,
      CASE
        WHEN LOWER(TRIM(se.name)) = 'new estimate' THEN 'new'
        WHEN LOWER(TRIM(se.name)) = 'pending' THEN 'pending'
        WHEN LOWER(TRIM(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
        WHEN LOWER(TRIM(se.name)) LIKE 'converted to ord%'
          OR LOWER(TRIM(se.name)) = 'converted to order'
          OR LOWER(TRIM(se.name)) = 'convert to order' THEN 'converted'
        ELSE NULL
      END AS kind,
      ROW_NUMBER() OVER (
        PARTITION BY se.company_id,
          CASE
            WHEN LOWER(TRIM(se.name)) = 'new estimate' THEN 'new'
            WHEN LOWER(TRIM(se.name)) = 'pending' THEN 'pending'
            WHEN LOWER(TRIM(se.name)) IN ('cancelled', 'canceled') THEN 'cancelled'
            WHEN LOWER(TRIM(se.name)) LIKE 'converted to ord%'
              OR LOWER(TRIM(se.name)) = 'converted to order'
              OR LOWER(TRIM(se.name)) = 'convert to order' THEN 'converted'
            ELSE NULL
          END
        ORDER BY se.sort_order ASC, se.id ASC
      ) AS rn
    FROM status_estimate se
    WHERE se.builtin_kind IS NULL
  ) labeled
  WHERE kind IS NOT NULL AND rn = 1
) tf ON se.company_id = tf.company_id AND se.id = tf.id
SET se.builtin_kind = tf.kind
WHERE NOT EXISTS (
    SELECT 1
    FROM status_estimate x
    WHERE x.company_id = tf.company_id AND x.builtin_kind = tf.kind
  );
COMMIT;"""
    return text.replace(old, new)


def patch_update_from_tmp_maps(text: str) -> str:
    text = text.replace(
        """UPDATE estimate e
SET status_esti_id = m.new_id
FROM tmp_est_map m
WHERE e.company_id = m.company_id AND e.status_esti_id = m.old_id;""",
        """UPDATE estimate e
JOIN tmp_est_map m ON e.company_id = m.company_id AND e.status_esti_id = m.old_id
SET e.status_esti_id = m.new_id;""",
    )
    text = text.replace(
        """UPDATE orders o
SET status_orde_id = m.new_id
FROM tmp_ord_map m
WHERE o.company_id = m.company_id AND o.status_orde_id = m.old_id;""",
        """UPDATE orders o
JOIN tmp_ord_map m ON o.company_id = m.company_id AND o.status_orde_id = m.old_id
SET o.status_orde_id = m.new_id;""",
    )
    return text


def alter_column_set_not_null(text: str) -> str:
    text = text.replace(
        "ALTER TABLE companies ALTER COLUMN is_deleted SET NOT NULL;",
        "ALTER TABLE companies MODIFY COLUMN is_deleted BOOLEAN NOT NULL;",
    )
    text = text.replace(
        "ALTER TABLE estimate ALTER COLUMN status_esti_id SET NOT NULL;",
        "ALTER TABLE estimate MODIFY COLUMN status_esti_id VARCHAR(16) NOT NULL;",
    )
    text = text.replace(
        "ALTER TABLE estimate ALTER COLUMN blinds_id DROP NOT NULL;",
        "ALTER TABLE estimate MODIFY COLUMN blinds_id VARCHAR(16) NULL;",
    )
    text = text.replace(
        "ALTER TABLE status_estimate ALTER COLUMN slug DROP NOT NULL;",
        "ALTER TABLE status_estimate MODIFY COLUMN slug TEXT NULL;",
    )
    text = text.replace(
        "ALTER TABLE estimate ALTER COLUMN customer_id DROP NOT NULL;",
        "ALTER TABLE estimate MODIFY COLUMN customer_id CHAR(36) NULL;",
    )
    return text


TRIGGER_TAIL = """
-- -----------------------------------------------------------------------------
-- MariaDB triggers (updated_at + order->estimate converted). Single-shot CREATE.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_companies_updated_at;
DELIMITER $$
CREATE TRIGGER tr_companies_updated_at
BEFORE UPDATE ON companies
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_customers_updated_at;
DELIMITER $$
CREATE TRIGGER tr_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_estimate_updated_at;
DELIMITER $$
CREATE TRIGGER tr_estimate_updated_at
BEFORE UPDATE ON estimate
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_orders_updated_at;
DELIMITER $$
CREATE TRIGGER tr_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

-- emulate PostgreSQL ON DELETE SET NULL for composite FKs (RESTRICT in DDL; see DB/README.md)
DROP TRIGGER IF EXISTS tr_status_user_before_delete_clear_customers;
DELIMITER $$
CREATE TRIGGER tr_status_user_before_delete_clear_customers
BEFORE DELETE ON status_user
FOR EACH ROW
BEGIN
  UPDATE customers
  SET status_user_id = NULL
  WHERE company_id = OLD.company_id AND status_user_id = OLD.id;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_status_order_before_delete_clear_orders;
DELIMITER $$
CREATE TRIGGER tr_status_order_before_delete_clear_orders
BEFORE DELETE ON status_order
FOR EACH ROW
BEGIN
  UPDATE orders
  SET status_orde_id = NULL
  WHERE company_id = OLD.company_id AND status_orde_id = OLD.id;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_blinds_type_add_updated_at;
DELIMITER $$
CREATE TRIGGER tr_blinds_type_add_updated_at
BEFORE UPDATE ON blinds_type_add
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_company_google_calendar_updated_at;
DELIMITER $$
CREATE TRIGGER tr_company_google_calendar_updated_at
BEFORE UPDATE ON company_google_calendar
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_leads_updated_at;
DELIMITER $$
CREATE TRIGGER tr_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_order_items_updated_at;
DELIMITER $$
CREATE TRIGGER tr_order_items_updated_at
BEFORE UPDATE ON order_items
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP(6);
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS tr_orders_mark_estimate_converted;
DELIMITER $$
CREATE TRIGGER tr_orders_mark_estimate_converted
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
  IF NEW.estimate_id IS NOT NULL AND TRIM(NEW.estimate_id) <> '' THEN
    UPDATE estimate
    SET
      status_esti_id = (SELECT se.id FROM status_estimate se WHERE se.builtin_kind = 'converted' LIMIT 1),
      updated_at = CURRENT_TIMESTAMP(6)
    WHERE company_id = NEW.company_id
      AND id = NEW.estimate_id
      AND COALESCE(is_deleted, FALSE) = FALSE;
  END IF;
END$$
DELIMITER ;

"""


def main() -> None:
    text = SRC.read_text(encoding="utf-8").replace("\r\n", "\n")

    text = strip_rls_section(text)
    text = REMOVE_DO_M14.sub(
        "-- 14_migrate_product_category_to_global.sql — skipped on MariaDB (PostgreSQL legacy path only).\n\n",
        text,
    )

    text = uuid_types(text)
    text = basic_types(text)
    text = varchar_without_length(text)
    text = strip_public(text)
    text = pg_schema_checks(text)
    # concat_pg must run before casts so patterns still contain PostgreSQL `col::text`.
    text = concat_pg(text)
    text = casts(text)
    text = regexp_operators(text)
    text = bool_or_to_max(text)
    text = pg_expression_partial_unique_indexes(text)
    text = strip_partial_index_where(text)
    text = strip_partial_unique_multiline(text)
    text = strip_nulls_last(text)
    text = drop_table_cascade(text)

    text = patch_migration_21(text)
    text = patch_migration_25(text)
    text = patch_update_from_tmp_maps(text)
    text = alter_column_set_not_null(text)

    text = pg_constraint_do_to_alter(text)

    text = remove_pg_functions_and_policies(text)
    text = remove_trigger_blocks_pg(text)

    text = on_conflict_to_ignore(text)

    text = scrub_named_do_blocks(text)
    text = scrub_do_blocks_simple(text)

    # Second pass: ON CONFLICT may appear inside blocks converted late
    text = on_conflict_to_ignore(text)

    text = fix_remaining_concat(text)
    text = strip_comment_on_any(text)
    text = fix_cross_join_values_estimate_seed(text)
    text = fix_permissions_key_keyword(text)
    text = quote_permissions_key_ident(text)
    text = split_inline_company_id_when_composite_fks_exist(text)
    text = mariadb_composite_fk_on_delete_restrict_where_pg_used_set_null(text)
    text = fk_alters_idempotent(text)
    text = strip_initial_begin_batch(text)
    text = text.replace(
        "-- PostgreSQL 13+ (gen_random_uuid).",
        "-- UUID keys default via UUID(); PK/FK columns are CHAR(36).",
    )

    header = (
        "-- blinds-mariadb.sql — generated by scripts/generate_mariadb_sql.py\n"
        "-- MariaDB 10.11+ recommended (12.2 OK).\n"
        "-- Fresh DB: mysql -u USER -p DATABASE < DB/blinds-mariadb.sql\n\n"
        "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;\n\n"
    )

    text = header + text + "\n" + TRIGGER_TAIL

    DST.write_text(text, encoding="utf-8", newline="\n")
    print("Wrote", DST)


if __name__ == "__main__":
    main()
