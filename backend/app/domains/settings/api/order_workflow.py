"""Order workflow editor (company-scoped).

The workflow engine tables live in DB/40_workflow_engine.sql.
This API allows editing the active company's order workflow definition (company override).
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/settings", tags=["Settings — workflow"])


class OrderWorkflowActionOut(BaseModel):
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class OrderWorkflowTransitionOut(BaseModel):
    id: str
    from_status_orde_id: str | None = None
    from_status_label: str | None = None
    to_status_orde_id: str
    to_status_label: str
    actions: list[OrderWorkflowActionOut] = Field(default_factory=list)
    sort_order: int = 0


class OrderWorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workflow_definition_id: str | None = None
    source: str = Field(..., description="company | global | none")
    transitions: list[OrderWorkflowTransitionOut] = Field(default_factory=list)


class OrderWorkflowActionIn(BaseModel):
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class OrderWorkflowTransitionIn(BaseModel):
    from_status_orde_id: str | None = Field(None, max_length=32)
    to_status_orde_id: str = Field(..., min_length=1, max_length=32)
    sort_order: int = Field(0, ge=-999, le=9_999_999)
    actions: list[OrderWorkflowActionIn] = Field(default_factory=list)


class OrderWorkflowPutIn(BaseModel):
    transitions: list[OrderWorkflowTransitionIn] = Field(default_factory=list)


def _status_label(db: Session, company_id: UUID, status_id: str | None) -> str | None:
    sid = (status_id or "").strip()
    if not sid:
        return None
    row = db.execute(
        text(
            """
            SELECT so.name
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.id = :sid
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "sid": sid},
    ).mappings().first()
    name = str((row["name"] if row else "") or "").strip()
    return name or sid


def _active_def(db: Session, company_id: UUID) -> tuple[str | None, str]:
    """Return (definition_id, source)."""
    row = db.execute(
        text(
            """
            SELECT wd.id::text AS id, wd.company_id
            FROM workflow_definitions wd
            WHERE wd.is_active IS TRUE
              AND wd.entity_type = 'order'
              AND (wd.company_id = CAST(:cid AS uuid) OR wd.company_id IS NULL)
            ORDER BY (wd.company_id IS NOT NULL) DESC, wd.version DESC, wd.created_at DESC
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    if not row:
        return None, "none"
    src = "company" if row.get("company_id") else "global"
    return str(row["id"]), src


def _assert_status_enabled(db: Session, company_id: UUID, status_id: str) -> None:
    ok = db.execute(
        text(
            """
            SELECT 1
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.id = :sid AND so.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "sid": status_id.strip()},
    ).first()
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or inactive order status for this company.")


@router.get("/order-workflow", response_model=OrderWorkflowOut)
def get_order_workflow(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.order_workflow.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    def_id, src = _active_def(db, cid)
    if not def_id:
        return OrderWorkflowOut(workflow_definition_id=None, source="none", transitions=[])
    rows = db.execute(
        text(
            """
            SELECT
              t.id::text AS id,
              NULLIF(btrim(t.from_status_id::text), '') AS from_status_id,
              t.to_status_id::text AS to_status_id,
              t.sort_order
            FROM workflow_transitions t
            WHERE t.workflow_definition_id = CAST(:wid AS uuid)
            ORDER BY t.sort_order ASC, t.created_at ASC, t.id ASC
            """
        ),
        {"wid": def_id},
    ).mappings().all()
    out: list[OrderWorkflowTransitionOut] = []
    for r in rows:
        tid = str(r["id"])
        from_sid = (r.get("from_status_id") or "").strip() or None
        to_sid = str(r["to_status_id"])
        act_rows = db.execute(
            text(
                """
                SELECT type, config, sort_order
                FROM workflow_transition_actions
                WHERE transition_id = CAST(:tid AS uuid)
                ORDER BY sort_order ASC, created_at ASC, id ASC
                """
            ),
            {"tid": tid},
        ).mappings().all()
        actions = [
            OrderWorkflowActionOut(type=str(a.get("type") or ""), config=a.get("config") or {})
            for a in act_rows
        ]
        out.append(
            OrderWorkflowTransitionOut(
                id=tid,
                from_status_orde_id=from_sid,
                from_status_label=_status_label(db, cid, from_sid),
                to_status_orde_id=to_sid,
                to_status_label=_status_label(db, cid, to_sid) or to_sid,
                actions=actions,
                sort_order=int(r.get("sort_order") or 0),
            )
        )
    return OrderWorkflowOut(workflow_definition_id=def_id, source=src, transitions=out)


@router.put("/order-workflow", response_model=OrderWorkflowOut)
def put_order_workflow(
    body: OrderWorkflowPutIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.order_workflow.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")

    # Company override definition (create if missing).
    row = db.execute(
        text(
            """
            SELECT id::text AS id
            FROM workflow_definitions
            WHERE company_id = CAST(:cid AS uuid)
              AND entity_type = 'order'
              AND code = 'default_order'
              AND is_active IS TRUE
            ORDER BY version DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    if row:
        def_id = str(row["id"])
    else:
        ins = db.execute(
            text(
                """
                INSERT INTO workflow_definitions (company_id, entity_type, code, name, version, is_active)
                VALUES (CAST(:cid AS uuid), 'order', 'default_order', 'Company order workflow', 1, TRUE)
                RETURNING id::text AS id
                """
            ),
            {"cid": str(cid)},
        ).mappings().first()
        def_id = str(ins["id"])

    # Replace transitions/actions (config data; safe to hard delete).
    db.execute(
        text(
            """
            DELETE FROM workflow_transition_actions
            WHERE transition_id IN (
              SELECT id FROM workflow_transitions WHERE workflow_definition_id = CAST(:wid AS uuid)
            )
            """
        ),
        {"wid": def_id},
    )
    db.execute(
        text("DELETE FROM workflow_transitions WHERE workflow_definition_id = CAST(:wid AS uuid)"),
        {"wid": def_id},
    )

    # Insert new transitions
    seen: set[tuple[str, str]] = set()
    for t in body.transitions:
        to_sid = t.to_status_orde_id.strip()
        from_sid = (t.from_status_orde_id or "").strip() or None
        _assert_status_enabled(db, cid, to_sid)
        if from_sid:
            _assert_status_enabled(db, cid, from_sid)
        key = (from_sid or "", to_sid)
        if key in seen:
            continue
        seen.add(key)
        tr = db.execute(
            text(
                """
                INSERT INTO workflow_transitions (
                  workflow_definition_id, from_status_id, to_status_id, sort_order
                )
                VALUES (
                  CAST(:wid AS uuid), :from_sid, :to_sid, :so
                )
                RETURNING id::text AS id
                """
            ),
            {
                "wid": def_id,
                "from_sid": from_sid,
                "to_sid": to_sid,
                "so": int(t.sort_order or 0),
            },
        ).mappings().first()
        tid = str(tr["id"])

        for idx, a in enumerate(t.actions):
            typ = (a.type or "").strip()
            if not typ:
                continue
            cfg = a.config or {}
            if not isinstance(cfg, dict):
                cfg = {}
            db.execute(
                text(
                    """
                    INSERT INTO workflow_transition_actions (transition_id, type, config, sort_order, is_required)
                    VALUES (CAST(:tid AS uuid), :typ, CAST(:cfg AS jsonb), :so, TRUE)
                    """
                ),
                {"tid": tid, "typ": typ, "cfg": json.dumps(cfg), "so": idx},
            )

    db.commit()
    return get_order_workflow(db=db, current_user=current_user)

