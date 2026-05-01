"""DB schema-driven field catalog for workflow/action editors.

The goal is to let the UI build "ask_form" fields without hardcoding field types.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/schema", tags=["Schema"])


FieldKind = Literal["text", "textarea", "number", "boolean", "date", "datetime"]


class SchemaFieldOut(BaseModel):
    field: str
    type: FieldKind = Field(..., description="UI input kind inferred from DB type.")


class SchemaFieldsOut(BaseModel):
    """All `public` base tables and their writable-ish columns.

    Workflow runtime may only support a subset of tables for writes; the UI still lists all
    so admins can browse schema consistently.
    """

    tables: dict[str, list[SchemaFieldOut]] = Field(default_factory=dict)


_SKIP_TABLE_PREFIXES: tuple[str, ...] = ("pg_",)
_SKIP_TABLE_NAMES: frozenset[str] = frozenset(
    {
        "alembic_version",
        "spatial_ref_sys",
    }
)

_SKIP_COLUMNS: frozenset[str] = frozenset(
    {
        "company_id",
        "created_at",
        "updated_at",
        "is_deleted",
        "deleted_at",
    }
)


def _kind_for_column(col: str, data_type: str, column_type: str) -> FieldKind:
    n = col.strip().lower()
    dt = (data_type or "").strip().lower()
    ct = (column_type or "").strip().lower()
    if dt in ("timestamp", "datetime") or "timestamp" in ct or "datetime" in ct:
        return "datetime"
    if dt == "date":
        return "date"
    if dt in ("numeric", "decimal", "float", "double", "real"):
        return "number"
    if dt in ("int", "integer", "smallint", "bigint", "mediumint", "tinyint"):
        return "number"
    if dt == "boolean" or dt == "bool" or ct == "tinyint(1)":
        return "boolean"
    if "note" in n or "address" in n or "description" in n or n.endswith("_html"):
        return "textarea"
    return "text"


def _skip_column(column_name: str) -> bool:
    c = column_name.strip().lower()
    if not c:
        return True
    if c in _SKIP_COLUMNS:
        return True
    if c == "id":
        return True
    if c.endswith("_id"):
        return True
    return False


@router.get("/fields", response_model=SchemaFieldsOut)
def list_schema_fields(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    rows = db.execute(
        text(
            """
            SELECT table_name, column_name, data_type, column_type
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
            ORDER BY table_name ASC, ordinal_position ASC
            """
        )
    ).mappings().all()

    tables_raw: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        tname = str(r.get("table_name") or "").strip()
        cname = str(r.get("column_name") or "").strip()
        if not tname or not cname:
            continue
        tables_raw.setdefault(tname, []).append(
            {
                "column_name": cname,
                "data_type": str(r.get("data_type") or ""),
                "column_type": str(r.get("column_type") or ""),
            }
        )

    table_names = db.execute(
        text(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_type = 'BASE TABLE'
            ORDER BY table_name ASC
            """
        )
    ).scalars().all()

    out: dict[str, list[SchemaFieldOut]] = {}
    for tname in table_names:
        if any(tname.startswith(p) for p in _SKIP_TABLE_PREFIXES):
            continue
        if tname in _SKIP_TABLE_NAMES:
            continue
        cols = tables_raw.get(tname, [])
        fields: list[SchemaFieldOut] = []
        for c in cols:
            cname = str(c.get("column_name") or "").strip()
            if _skip_column(cname):
                continue
            fields.append(
                SchemaFieldOut(
                    field=cname,
                    type=_kind_for_column(
                        col=cname,
                        data_type=str(c.get("data_type") or ""),
                        column_type=str(c.get("column_type") or ""),
                    ),
                )
            )
        out[tname] = fields

    return SchemaFieldsOut(tables=out)
