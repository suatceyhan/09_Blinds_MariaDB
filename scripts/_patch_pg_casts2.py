from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / "backend" / "app"

for path in ROOT.rglob("*.py"):
    t = path.read_text(encoding="utf-8")
    o = t
    t = re.sub(r"COUNT\(\*\)::int", "CAST(COUNT(*) AS SIGNED)", t)
    t = t.replace("::numeric", "")
    # Remove Postgres-only integer casts where MariaDB infers SIGNED
    t = t.replace(")::int", ") AS SIGNED")
    t = t.replace("NULL::text", "CAST(NULL AS CHAR)")
    t = re.sub(r"([\w.]+)::text", r"\1", t)
    if t != o:
        path.write_text(t, encoding="utf-8")
        print("patched", path)
