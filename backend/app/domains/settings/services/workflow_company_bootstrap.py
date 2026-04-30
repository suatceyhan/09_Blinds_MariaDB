"""When a company saves workflow settings for the first time, clone global transitions first.

Otherwise transitions only existed on the global ``workflow_definitions`` row; the client's row IDs
point there but PUT writes under the new company definition — omitted rows never get
``deleted_at`` set, so “Show deleted” cannot surface them (they were never rows on the company def).
"""

from __future__ import annotations

import json
from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session


def bootstrap_company_workflow_transitions_from_global_if_empty(
    db: Session,
    *,
    company_definition_id: str,
    entity_type: Literal["estimate", "order"],
    definition_code: str,
) -> None:
    cnt_raw = db.execute(
        text(
            """
            SELECT COUNT(*) AS n
            FROM workflow_transitions
            WHERE workflow_definition_id = :wid
            """
        ),
        {"wid": company_definition_id},
    ).scalar()
    if cnt_raw is not None and int(cnt_raw) > 0:
        return

    grow = db.execute(
        text(
            """
            SELECT id AS id
            FROM workflow_definitions
            WHERE company_id IS NULL
              AND entity_type = CAST(:et AS text)
              AND code = CAST(:code AS text)
              AND is_active IS TRUE
            ORDER BY version DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"et": entity_type, "code": definition_code},
    ).mappings().first()
    if not grow:
        return

    global_wid = str(grow["id"])
    trans = db.execute(
        text(
            """
            SELECT id AS id, from_status_id, to_status_id, sort_order, deleted_at
            FROM workflow_transitions
            WHERE workflow_definition_id = :gwid
            ORDER BY sort_order ASC, created_at ASC, id ASC
            """
        ),
        {"gwid": global_wid},
    ).mappings().all()

    for tr in trans:
        old_tid = str(tr["id"])
        from_sid = tr.get("from_status_id")
        to_sid = (str(tr.get("to_status_id") or "")).strip()
        if not to_sid:
            continue
        so = int(tr.get("sort_order") or 0)
        del_at = tr.get("deleted_at")

        ins = db.execute(
            text(
                """
                INSERT INTO workflow_transitions (
                  workflow_definition_id, from_status_id, to_status_id, sort_order, deleted_at
                )
                VALUES (
                  :wid, :from_sid, CAST(:to_sid AS varchar), :so, :del_at
                )
                RETURNING id
                """
            ),
            {
                "wid": company_definition_id,
                "from_sid": from_sid,
                "to_sid": to_sid,
                "so": so,
                "del_at": del_at,
            },
        ).mappings().first()
        if not ins:
            continue
        new_tid = str(ins["id"])

        actions = db.execute(
            text(
                """
                SELECT type, config, sort_order, COALESCE(is_required, TRUE) AS is_required
                FROM workflow_transition_actions
                WHERE transition_id = :tid
                ORDER BY sort_order ASC, created_at ASC, id ASC
                """
            ),
            {"tid": old_tid},
        ).mappings().all()

        for idx, a in enumerate(actions):
            typ = str(a.get("type") or "").strip()
            if not typ:
                continue
            cfg = a.get("config")
            if cfg is None:
                cfg_obj: dict = {}
            elif isinstance(cfg, dict):
                cfg_obj = cfg
            else:
                try:
                    cfg_obj = dict(cfg)  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    cfg_obj = {}
            db.execute(
                text(
                    """
                    INSERT INTO workflow_transition_actions (transition_id, type, config, sort_order, is_required)
                    VALUES (:tid, :typ, CAST(:cfg AS jsonb), :so, :req)
                    """
                ),
                {
                    "tid": new_tid,
                    "typ": typ,
                    "cfg": json.dumps(cfg_obj),
                    "so": int(a.get("sort_order") or idx),
                    "req": bool(a.get("is_required", True)),
                },
            )
