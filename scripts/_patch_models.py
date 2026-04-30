from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / "backend" / "app"
for path in root.glob("domains/**/models/*.py"):
    t = path.read_text(encoding="utf-8")
    o = t
    t = t.replace(
        "from sqlalchemy.dialects.postgresql import JSONB, UUID",
        "from sqlalchemy import JSON, Uuid",
    )
    t = t.replace("from sqlalchemy.dialects.postgresql import UUID", "from sqlalchemy import Uuid")
    t = re.sub(r"UUID\(as_uuid=True\)", r"Uuid(as_uuid=True)", t)
    t = t.replace('text("gen_random_uuid()")', 'text("(UUID())")')
    t = t.replace("JSONB", "JSON")
    if t != o:
        path.write_text(t, encoding="utf-8")
        print("updated", path)
