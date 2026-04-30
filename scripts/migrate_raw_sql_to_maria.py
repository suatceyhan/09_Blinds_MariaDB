"""Mechanical PostgreSQL → MariaDB adjustments for raw SQL in backend Python sources."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "backend" / "app"


def transform(src: str) -> str:
    s = src

    s = re.sub(r"CAST\(:([a-z0-9_]+)\s+AS\s+uuid\)", r":\1", s, flags=re.I)

    s = s.replace("WHERE table_catalog = current_database()", "WHERE TABLE_SCHEMA = DATABASE()")
    s = s.replace("AND table_schema = 'public'", "AND TABLE_SCHEMA = DATABASE()")

    s = re.sub(r"\bbtrim\s*\(", "trim(", s, flags=re.I)

    s = s.replace("'[]'::json", "CAST('[]' AS JSON)")
    s = s.replace("ELSE '[]'::json", "ELSE CAST('[]' AS JSON)")

    s = s.replace("ORDER BY o.created_at DESC NULLS LAST", "ORDER BY (o.created_at IS NULL) ASC, o.created_at DESC")
    s = s.replace(
        "ORDER BY CASE WHEN o.id = :aid THEN 0 ELSE 1 END, o.created_at ASC NULLS LAST",
        "ORDER BY CASE WHEN o.id = :aid THEN 0 ELSE 1 END, (o.created_at IS NULL) ASC, o.created_at ASC",
    )
    s = s.replace(
        "ORDER BY CASE WHEN o.active IS TRUE THEN 0 ELSE 1 END, o.created_at DESC NULLS LAST",
        "ORDER BY CASE WHEN o.active IS TRUE THEN 0 ELSE 1 END, (o.created_at IS NULL) ASC, o.created_at DESC",
    )
    s = s.replace(
        "ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) DESC NULLS LAST, e.created_at DESC",
        "ORDER BY (COALESCE(e.scheduled_start_at, e.tarih_saat) IS NULL) ASC, COALESCE(e.scheduled_start_at, e.tarih_saat) DESC, e.created_at DESC",
    )
    s = s.replace("ORDER BY c.created_at DESC NULLS LAST", "ORDER BY (c.created_at IS NULL) ASC, c.created_at DESC")
    s = s.replace("ORDER BY created_at DESC NULLS LAST", "ORDER BY (created_at IS NULL) ASC, created_at DESC")
    s = s.replace(
        "ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) DESC NULLS LAST",
        "ORDER BY (COALESCE(e.scheduled_start_at, e.tarih_saat) IS NULL) ASC, COALESCE(e.scheduled_start_at, e.tarih_saat) DESC",
    )

    return s


def main() -> None:
    for path in sorted(ROOT.rglob("*.py")):
        orig = path.read_text(encoding="utf-8")
        new = transform(orig)
        if new != orig:
            path.write_text(new, encoding="utf-8")
            print("patched", path.relative_to(ROOT.parent))


if __name__ == "__main__":
    main()
