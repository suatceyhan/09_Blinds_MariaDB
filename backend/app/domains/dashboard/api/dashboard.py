from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import require_permissions
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


def _utc_today_range() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    _u: Annotated[Users, Depends(require_permissions("dashboard.view"))],
):
    # NOTE: We rely on tenant RLS (app.tenant_company_id) to scope rows.
    #       Superadmin bypass is handled by middleware/tenant_rls.
    start, end = _utc_today_range()
    week_end = start + timedelta(days=7)

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
                  JOIN blinds_type bt ON bt.company_id = eb.company_id AND bt.id = eb.blinds_id
                  WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
                ),
                (
                  SELECT CASE
                    WHEN e.perde_sayisi IS NOT NULL THEN bt.name || ' (' || e.perde_sayisi::text || ')'
                    ELSE bt.name
                  END
                  FROM blinds_type bt
                  WHERE bt.company_id = e.company_id AND bt.id = e.blinds_id
                  LIMIT 1
                )
              ) AS blinds_summary,
              e.scheduled_start_at,
              e.tarih_saat
            FROM estimate e
            JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            LEFT JOIN status_estimate se ON se.company_id = e.company_id AND se.id = e.status_esti_id
            WHERE e.is_deleted IS NOT TRUE
              AND (se.slug IS NULL OR se.slug <> 'cancelled')
              AND (
                (e.scheduled_start_at >= :start AND e.scheduled_start_at < :end)
               OR (e.scheduled_start_at IS NULL AND e.tarih_saat >= :start AND e.tarih_saat < :end)
              )
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) ASC
            LIMIT 50
            """
        ),
        {"start": start, "end": end},
    ).mappings().all()

    week_count = db.execute(
        text(
            """
            SELECT COUNT(*)::int AS c
            FROM estimate e
            LEFT JOIN status_estimate se ON se.company_id = e.company_id AND se.id = e.status_esti_id
            WHERE e.is_deleted IS NOT TRUE
              AND (se.slug IS NULL OR se.slug <> 'cancelled')
              AND (
                (e.scheduled_start_at >= :start AND e.scheduled_start_at < :week_end)
               OR (e.scheduled_start_at IS NULL AND e.tarih_saat >= :start AND e.tarih_saat < :week_end)
              )
            """
        ),
        {"start": start, "week_end": week_end},
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
                WHERE created_at < (NOW() - (:lo || ' days')::interval)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo}).mappings().one()["c"]
        else:
            q = text(
                """
                SELECT COUNT(*)::int AS c
                FROM orders
                WHERE created_at >= (NOW() - (:hi || ' days')::interval)
                  AND created_at <  (NOW() - (:lo || ' days')::interval)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "hi": hi}).mappings().one()["c"]
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
            WHERE active IS TRUE
              AND (
                COALESCE(status_code, '') = 'ready_for_install'
                OR COALESCE(status_orde_id, '') ILIKE '%ready%'
              )
            ORDER BY waiting_days DESC, COALESCE(ready_at, created_at) ASC
            LIMIT 50
            """
        )
    ).mappings().all()

    return DashboardSummary(
        today_estimates=[EstimateListItem(**dict(r)) for r in today_rows],
        week_estimate_count=int(week_count),
        order_age_buckets=bucket_counts,
        ready_waiting=[dict(r) for r in ready_rows],
    )

