"""Order workflow editor (company-scoped).

The workflow engine tables are defined in DB/blinds-postgresql.sql (migration 40).
This API allows editing the active company's order workflow definition (company override).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users
from app.domains.settings.services.workflow_company_bootstrap import (
    bootstrap_company_workflow_transitions_from_global_if_empty,
)


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
    deleted_at: datetime | None = None


class OrderWorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    workflow_definition_id: str | None = None
    source: str = Field(..., description="company | global | none")
    transitions: list[OrderWorkflowTransitionOut] = Field(default_factory=list)


class OrderWorkflowActionIn(BaseModel):
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class OrderWorkflowTransitionIn(BaseModel):
    """Optional id matches an existing transition row when updating/restoring."""

    id: str | None = Field(None, max_length=48)
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


def _replace_transition_actions(db: Session, transition_id: str, actions: list[OrderWorkflowActionIn]) -> None:
    db.execute(
        text("DELETE FROM workflow_transition_actions WHERE transition_id = CAST(:tid AS uuid)"),
        {"tid": transition_id},
    )
    for idx, a in enumerate(actions):
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
            {"tid": transition_id, "typ": typ, "cfg": json.dumps(cfg), "so": idx},
        )


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
    include_deleted: bool = Query(False, description="Include soft-deleted transitions (for restore in settings UI)."),
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
              t.sort_order,
              t.deleted_at AS deleted_at
            FROM workflow_transitions t
            WHERE t.workflow_definition_id = CAST(:wid AS uuid)
              AND (:inc_del OR t.deleted_at IS NULL)
            ORDER BY t.sort_order ASC, t.created_at ASC, t.id ASC
            """
        ),
        {"wid": def_id, "inc_del": include_deleted},
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
        da = r.get("deleted_at")
        deleted_at = da if isinstance(da, datetime) else None
        out.append(
            OrderWorkflowTransitionOut(
                id=tid,
                from_status_orde_id=from_sid,
                from_status_label=_status_label(db, cid, from_sid),
                to_status_orde_id=to_sid,
                to_status_label=_status_label(db, cid, to_sid) or to_sid,
                actions=actions,
                sort_order=int(r.get("sort_order") or 0),
                deleted_at=deleted_at,
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

    bootstrap_company_workflow_transitions_from_global_if_empty(
        db,
        company_definition_id=def_id,
        entity_type="order",
        definition_code="default_order",
    )

    if not body.transitions:
        raise HTTPException(status_code=400, detail="At least one transition is required.")

    def _uuid_str(s: str | None) -> str | None:
        s = (s or "").strip()
        if not s:
            return None
        try:
            return str(UUID(s))
        except ValueError:
            return None

    existing_rows = db.execute(
        text(
            """
            SELECT id::text AS id
            FROM workflow_transitions
            WHERE workflow_definition_id = CAST(:wid AS uuid)
            """
        ),
        {"wid": def_id},
    ).mappings().all()
    existing_ids: set[str] = {str(r["id"]) for r in existing_rows}
    matched_ids: set[str] = set()

    seen_keys: set[tuple[str, str]] = set()
    for t in body.transitions:
        to_sid = t.to_status_orde_id.strip()
        from_sid = (t.from_status_orde_id or "").strip() or None
        _assert_status_enabled(db, cid, to_sid)
        if from_sid:
            _assert_status_enabled(db, cid, from_sid)
        nk = (from_sid or "", to_sid)
        if nk in seen_keys:
            continue
        seen_keys.add(nk)

        tid_to_use: str | None = None
        id_param = _uuid_str(t.id)
        if id_param:
            chk = db.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM workflow_transitions
                    WHERE id = CAST(:tid AS uuid) AND workflow_definition_id = CAST(:wid AS uuid)
                    """
                ),
                {"tid": id_param, "wid": def_id},
            ).mappings().first()
            if chk:
                tid_to_use = str(chk["id"])

        if not tid_to_use:
            nkrow = db.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM workflow_transitions
                    WHERE workflow_definition_id = CAST(:wid AS uuid)
                      AND COALESCE(from_status_id, '') = COALESCE(:from_sid, '')
                      AND to_status_id = :to_sid
                    ORDER BY (deleted_at IS NULL) DESC, created_at ASC
                    LIMIT 1
                    """
                ),
                {"wid": def_id, "from_sid": from_sid or "", "to_sid": to_sid},
            ).mappings().first()
            if nkrow:
                tid_to_use = str(nkrow["id"])

        so = int(t.sort_order or 0)
        if tid_to_use:
            db.execute(
                text(
                    """
                    UPDATE workflow_transitions
                    SET
                      from_status_id = :from_sid,
                      to_status_id = :to_sid,
                      sort_order = :so,
                      deleted_at = NULL
                    WHERE id = CAST(:tid AS uuid)
                    """
                ),
                {"tid": tid_to_use, "from_sid": from_sid, "to_sid": to_sid, "so": so},
            )
            _replace_transition_actions(db, tid_to_use, t.actions)
            matched_ids.add(tid_to_use)
        else:
            ins = db.execute(
                text(
                    """
                    INSERT INTO workflow_transitions (
                      workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at
                    )
                    VALUES (
                      CAST(:wid AS uuid), :from_sid, :to_sid, :so, NULL
                    )
                    RETURNING id::text AS id
                    """
                ),
                {"wid": def_id, "from_sid": from_sid, "to_sid": to_sid, "so": so},
            ).mappings().first()
            tid_new = str(ins["id"])
            _replace_transition_actions(db, tid_new, t.actions)
            matched_ids.add(tid_new)

    for eid in existing_ids - matched_ids:
        db.execute(
            text("UPDATE workflow_transitions SET deleted_at = NOW() WHERE id = CAST(:id AS uuid)"),
            {"id": eid},
        )

    db.commit()
    return get_order_workflow(db=db, current_user=current_user, include_deleted=False)

