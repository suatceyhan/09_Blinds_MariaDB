from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


class EstimateListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    customer_display: str | None = None
    blinds_summary: str | None = None
    scheduled_start_at: datetime | None = None
    tarih_saat: datetime | None = None


class AgingBucket(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    label: str
    count: int


class DashboardSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    today_estimates: list[EstimateListItem]
    week_estimate_count: int
    order_age_buckets: list[AgingBucket]
    ready_waiting: list[dict[str, Any]]
    open_orders_count: int
    balance_due_total: float
    upcoming_installations: list[dict[str, Any]]


def _utc_today_range() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("dashboard.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    start, end = _utc_today_range()
    week_end = start + timedelta(days=7)
    est_params = {"start": start, "end": end, "cid": str(cid)}

    today_rows = db.execute(
        text(
            """
            SELECT
              e.id,
              e.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              COALESCE(
                (
                  SELECT string_agg(
                    CASE
                      WHEN eb.perde_sayisi IS NOT NULL THEN bt.name || ' (' || eb.perde_sayisi::text || ')'
                      ELSE bt.name
                    END,
                    ', ' ORDER BY eb.sort_order, bt.name
                  )
                  FROM estimate_blinds eb
                  JOIN blinds_type bt ON bt.id = eb.blinds_id
                  WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
                ),
                (
                  SELECT CASE
                    WHEN e.perde_sayisi IS NOT NULL THEN bt.name || ' (' || e.perde_sayisi::text || ')'
                    ELSE bt.name
                  END
                  FROM blinds_type bt
                  WHERE bt.id = e.blinds_id
                  LIMIT 1
                )
              ) AS blinds_summary,
              e.scheduled_start_at,
              e.tarih_saat
            FROM estimate e
            JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = CAST(:cid AS uuid)
              AND e.is_deleted IS NOT TRUE
              AND (se.builtin_kind IS NULL OR se.builtin_kind <> 'cancelled')
              AND (
                (e.scheduled_start_at >= :start AND e.scheduled_start_at < :end)
               OR (e.scheduled_start_at IS NULL AND e.tarih_saat >= :start AND e.tarih_saat < :end)
              )
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) ASC
            LIMIT 50
            """
        ),
        est_params,
    ).mappings().all()

    week_count = db.execute(
        text(
            """
            SELECT COUNT(*)::int AS c
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = CAST(:cid AS uuid)
              AND e.is_deleted IS NOT TRUE
              AND (se.builtin_kind IS NULL OR se.builtin_kind <> 'cancelled')
              AND (
                (e.scheduled_start_at >= :start AND e.scheduled_start_at < :week_end)
               OR (e.scheduled_start_at IS NULL AND e.tarih_saat >= :start AND e.tarih_saat < :week_end)
              )
            """
        ),
        {"start": start, "week_end": week_end, "cid": str(cid)},
    ).mappings().one()["c"]

    # Order aging by created_at (days since order created)
    buckets = [
        ("0-2d", 0, 2),
        ("3-7d", 3, 7),
        ("8-14d", 8, 14),
        ("15d+", 15, 10_000),
    ]
    bucket_counts: list[AgingBucket] = []
    for label, lo, hi in buckets:
        if label == "15d+":
            q = text(
                """
                SELECT COUNT(*)::int AS c
                FROM orders
                WHERE company_id = CAST(:cid AS uuid)
                  AND created_at < (NOW() - (:lo || ' days')::interval)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "cid": str(cid)}).mappings().one()["c"]
        else:
            q = text(
                """
                SELECT COUNT(*)::int AS c
                FROM orders
                WHERE company_id = CAST(:cid AS uuid)
                  AND created_at >= (NOW() - (:hi || ' days')::interval)
                  AND created_at <  (NOW() - (:lo || ' days')::interval)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "hi": hi, "cid": str(cid)}).mappings().one()["c"]
        bucket_counts.append(AgingBucket(label=label, count=int(c)))

    # Ready orders waiting for installation: status_code ready_for_install, fallback to status_orde_id if status_code absent.
    ready_rows = db.execute(
        text(
            """
            SELECT
              id,
              customer_id,
              status_code,
              ready_at,
              created_at,
              GREATEST(
                0,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(ready_at, created_at))) / 86400)
              )::int AS waiting_days
            FROM orders
            WHERE company_id = CAST(:cid AS uuid)
              AND active IS TRUE
              AND (
                COALESCE(status_code, '') = 'ready_for_install'
                OR COALESCE(status_orde_id, '') ILIKE '%ready%'
              )
            ORDER BY waiting_days DESC, COALESCE(ready_at, created_at) ASC
            LIMIT 50
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    open_orders_count = db.execute(
        text(
            """
            SELECT COUNT(*)::int AS c
            FROM orders
            WHERE company_id = CAST(:cid AS uuid)
              AND active IS TRUE
              AND parent_order_id IS NULL
            """
        ),
        {"cid": str(cid)},
    ).mappings().one()["c"]

    bal_row = db.execute(
        text(
            """
            SELECT COALESCE(SUM(GREATEST(COALESCE(balance, 0), 0)), 0) AS s
            FROM orders
            WHERE company_id = CAST(:cid AS uuid)
              AND active IS TRUE
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    balance_due_total = float(bal_row["s"] if bal_row else 0)

    upcoming_rows = db.execute(
        text(
            """
            SELECT
              o.id,
              o.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              o.installation_scheduled_start_at
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND o.installation_scheduled_start_at IS NOT NULL
              AND o.installation_scheduled_start_at >= NOW() - INTERVAL '6 hours'
              AND o.installation_scheduled_start_at < NOW() + INTERVAL '7 days'
            ORDER BY o.installation_scheduled_start_at ASC
            LIMIT 20
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    return DashboardSummary(
        today_estimates=[EstimateListItem(**dict(r)) for r in today_rows],
        week_estimate_count=int(week_count),
        order_age_buckets=bucket_counts,
        ready_waiting=[dict(r) for r in ready_rows],
        open_orders_count=int(open_orders_count),
        balance_due_total=balance_due_total,
        upcoming_installations=[dict(r) for r in upcoming_rows],
    )

