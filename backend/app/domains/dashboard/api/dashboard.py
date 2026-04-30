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


class EstimateConversionMonth(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str
    converted_count: int
    total_count: int
    percent: float


class CustomerSourcesMonth(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str
    advertising_count: int
    referral_count: int
    total_count: int


class DashboardSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    week_estimate_count: int
    week_order_count: int
    new_estimates_count: int
    pending_estimates_count: int
    upcoming_estimates: list[EstimateListItem]
    order_age_buckets: list[AgingBucket]
    ready_waiting: list[dict[str, Any]]
    open_orders_count: int
    balance_due_total: float
    ready_install_with_date_count: int
    ready_install_missing_date_count: int
    estimate_conversion_last_3_months: list[EstimateConversionMonth]
    customer_sources_last_3_months: list[CustomerSourcesMonth]
    upcoming_installations: list[dict[str, Any]]


def _utc_today_range() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    return start, end


@router.get(
    "/summary",
    response_model=DashboardSummary,
    responses={403: {"description": "No active company."}},
)
def get_dashboard_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("dashboard.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    start, _ = _utc_today_range()
    week_end = start + timedelta(days=7)

    est_counts = db.execute(
        text(
            """
            SELECT
              CAST(COALESCE(SUM(CASE WHEN se.builtin_kind = 'new' THEN 1 ELSE 0 END), 0) AS SIGNED) AS new_count,
              CAST(COALESCE(SUM(CASE WHEN se.builtin_kind = 'pending' THEN 1 ELSE 0 END), 0) AS SIGNED) AS pending_count
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :cid
              AND e.is_deleted IS NOT TRUE
              AND (se.builtin_kind IS NULL OR se.builtin_kind <> 'cancelled')
            """
        ),
        {"cid": str(cid)},
    ).mappings().one()
    new_estimates_count = int(est_counts["new_count"] or 0)
    pending_estimates_count = int(est_counts["pending_count"] or 0)

    upcoming_est_rows = db.execute(
        text(
            """
            SELECT
              e.id,
              e.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              COALESCE(
                (
                  SELECT GROUP_CONCAT(
                    CASE
                      WHEN eb.perde_sayisi IS NOT NULL THEN CONCAT(bt.name, ' (', CAST(eb.perde_sayisi AS CHAR), ')')
                      ELSE bt.name
                    END,
                    ', '
                    ORDER BY eb.sort_order, bt.name
                  )
                  FROM estimate_blinds eb
                  JOIN blinds_type bt ON bt.id = eb.blinds_id
                  WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
                ),
                (
                  SELECT CASE
                    WHEN e.perde_sayisi IS NOT NULL THEN CONCAT(bt.name, ' (', CAST(e.perde_sayisi AS CHAR), ')')
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
            WHERE e.company_id = :cid
              AND e.is_deleted IS NOT TRUE
              AND (se.builtin_kind IS NULL OR se.builtin_kind <> 'cancelled')
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) IS NOT NULL
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) >= (NOW() - INTERVAL 1 HOUR)
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) < (NOW() + INTERVAL 30 DAY)
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) ASC
            LIMIT 20
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    week_count = db.execute(
        text(
            """
            SELECT CAST(COUNT(*) AS SIGNED) AS c
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :cid
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

    week_order_count = db.execute(
        text(
            """
            SELECT CAST(COUNT(*) AS SIGNED) AS c
            FROM orders
            WHERE company_id = :cid
              AND active IS TRUE
              AND parent_order_id IS NULL
              AND created_at >= :start
              AND created_at < :week_end
            """
        ),
        {"start": start, "week_end": week_end, "cid": str(cid)},
    ).mappings().one()["c"]

    # Order aging by created_at (weekly buckets; days since order created)
    buckets = [
        ("0-6d", 0, 6),
        ("7-13d", 7, 13),
        ("14-20d", 14, 20),
        ("21-27d", 21, 27),
        ("28d+", 28, 10_000),
    ]
    bucket_counts: list[AgingBucket] = []
    for label, lo, hi in buckets:
        if label == "28d+":
            q = text(
                """
                SELECT CAST(COUNT(*) AS SIGNED) AS c
                FROM orders
                WHERE company_id = :cid
                  AND parent_order_id IS NULL
                  AND created_at < (NOW() - INTERVAL :lo DAY)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "cid": str(cid)}).mappings().one()["c"]
        else:
            q = text(
                """
                SELECT CAST(COUNT(*) AS SIGNED) AS c
                FROM orders
                WHERE company_id = :cid
                  AND parent_order_id IS NULL
                  AND created_at >= (NOW() - INTERVAL :hi DAY)
                  AND created_at <  (NOW() - INTERVAL :lo DAY)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "hi": hi, "cid": str(cid)}).mappings().one()["c"]
        bucket_counts.append(AgingBucket(label=label, count=int(c)))

    # Ready orders waiting for installation: status_code ready_for_install, fallback to status_order_id if status_code absent.
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
                TIMESTAMPDIFF(DAY, COALESCE(ready_at, created_at), NOW())
              ) AS waiting_days
            FROM orders
            WHERE company_id = :cid
              AND active IS TRUE
              AND parent_order_id IS NULL
              AND (
                COALESCE(status_code, '') = 'ready_for_install'
                OR LOWER(COALESCE(status_order_id, '')) LIKE '%ready%'
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
            SELECT CAST(COUNT(*) AS SIGNED) AS c
            FROM orders
            WHERE company_id = :cid
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
            WHERE company_id = :cid
              AND active IS TRUE
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    balance_due_total = float(bal_row["s"] if bal_row else 0)

    ready_install_counts = db.execute(
        text(
            """
            SELECT
              CAST(COALESCE(SUM(CASE WHEN o.installation_scheduled_start_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS SIGNED) AS with_date,
              CAST(COALESCE(SUM(CASE WHEN o.installation_scheduled_start_at IS NULL THEN 1 ELSE 0 END), 0) AS SIGNED) AS missing_date
            FROM orders o
            LEFT JOIN status_order so ON so.id = o.status_order_id
            WHERE o.company_id = :cid
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND (
                COALESCE(o.status_code, '') = 'ready_for_install'
                OR (LOWER(COALESCE(so.name, '')) LIKE '%ready%' AND LOWER(COALESCE(so.name, '')) LIKE '%install%')
              )
            """
        ),
        {"cid": str(cid)},
    ).mappings().one()
    ready_install_with_date_count = int(ready_install_counts["with_date"] or 0)
    ready_install_missing_date_count = int(ready_install_counts["missing_date"] or 0)

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
            WHERE o.company_id = :cid
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND o.installation_scheduled_start_at IS NOT NULL
              AND o.installation_scheduled_start_at >= (NOW() - INTERVAL 6 HOUR)
              AND o.installation_scheduled_start_at < (NOW() + INTERVAL 7 DAY)
            ORDER BY o.installation_scheduled_start_at ASC
            LIMIT 20
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    conv_rows = db.execute(
        text(
            """
            WITH months AS (
              SELECT 1 AS _dummy
            ),
            cohort AS (
              SELECT
                DATE_FORMAT(e.created_at, '%Y-%m-01') AS month_start,
                CAST(COUNT(*) AS SIGNED) AS total_count,
                CAST(
                  COALESCE(
                    SUM(
                      CASE
                        WHEN EXISTS (
                          SELECT 1
                          FROM orders o
                          WHERE o.company_id = e.company_id
                            AND o.estimate_id = e.id
                        )
                        THEN 1
                        ELSE 0
                      END
                    ),
                    0
                  )
                  AS SIGNED
                ) AS converted_count
              FROM estimate e
              WHERE e.company_id = :cid
                AND e.is_deleted IS NOT TRUE
                AND e.created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 MONTH)
                AND e.created_at <  DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH)
              GROUP BY 1
            )
            , months_series AS (
              WITH RECURSIVE m AS (
                SELECT DATE_SUB(STR_TO_DATE(DATE_FORMAT(NOW(), '%Y-%m-01'), '%Y-%m-%d'), INTERVAL 2 MONTH) AS month_start
                UNION ALL
                SELECT DATE_ADD(month_start, INTERVAL 1 MONTH)
                FROM m
                WHERE month_start < STR_TO_DATE(DATE_FORMAT(NOW(), '%Y-%m-01'), '%Y-%m-%d')
              )
              SELECT month_start FROM m
            )
            SELECT
              DATE_FORMAT(m.month_start, '%Y-%m') AS month,
              CAST(COALESCE(c.converted_count, 0) AS SIGNED) AS converted_count,
              CAST(COALESCE(c.total_count, 0) AS SIGNED) AS total_count,
              COALESCE(
                ROUND((COALESCE(c.converted_count, 0) * 100.0) / NULLIF(COALESCE(c.total_count, 0), 0), 1),
                0
              ) AS percent
            FROM months_series m
            LEFT JOIN cohort c ON c.month_start = m.month_start
            ORDER BY m.month_start ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    estimate_conversion_last_3_months = [
        EstimateConversionMonth(
            month=str(r["month"]),
            converted_count=int(r["converted_count"]),
            total_count=int(r["total_count"]),
            percent=float(r["percent"]),
        )
        for r in conv_rows
    ]

    sources_rows = db.execute(
        text(
            """
            WITH months AS (
              SELECT 1 AS _dummy
            ),
            cohort AS (
              SELECT
                DATE_FORMAT(e.created_at, '%Y-%m-01') AS month_start,
                CAST(COALESCE(SUM(CASE WHEN COALESCE(e.lead_source, 'advertising') = 'referral' THEN 1 ELSE 0 END), 0) AS SIGNED) AS referral_count,
                CAST(COALESCE(SUM(CASE WHEN COALESCE(e.lead_source, 'advertising') <> 'referral' THEN 1 ELSE 0 END), 0) AS SIGNED) AS advertising_count,
                CAST(COUNT(*) AS SIGNED) AS total_count
              FROM estimate e
              WHERE e.company_id = :cid
                AND e.is_deleted IS NOT TRUE
                AND e.created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 MONTH)
                AND e.created_at <  DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 MONTH)
              GROUP BY 1
            )
            , months_series AS (
              WITH RECURSIVE m AS (
                SELECT DATE_SUB(STR_TO_DATE(DATE_FORMAT(NOW(), '%Y-%m-01'), '%Y-%m-%d'), INTERVAL 2 MONTH) AS month_start
                UNION ALL
                SELECT DATE_ADD(month_start, INTERVAL 1 MONTH)
                FROM m
                WHERE month_start < STR_TO_DATE(DATE_FORMAT(NOW(), '%Y-%m-01'), '%Y-%m-%d')
              )
              SELECT month_start FROM m
            )
            SELECT
              DATE_FORMAT(m.month_start, '%Y-%m') AS month,
              CAST(COALESCE(c.advertising_count, 0) AS SIGNED) AS advertising_count,
              CAST(COALESCE(c.referral_count, 0) AS SIGNED) AS referral_count,
              CAST(COALESCE(c.total_count, 0) AS SIGNED) AS total_count
            FROM months_series m
            LEFT JOIN cohort c ON c.month_start = m.month_start
            ORDER BY m.month_start ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    customer_sources_last_3_months = [
        CustomerSourcesMonth(
            month=str(r["month"]),
            advertising_count=int(r["advertising_count"]),
            referral_count=int(r["referral_count"]),
            total_count=int(r["total_count"]),
        )
        for r in sources_rows
    ]

    return DashboardSummary(
        week_estimate_count=int(week_count),
        week_order_count=int(week_order_count),
        new_estimates_count=new_estimates_count,
        pending_estimates_count=pending_estimates_count,
        upcoming_estimates=[EstimateListItem(**dict(r)) for r in upcoming_est_rows],
        order_age_buckets=bucket_counts,
        ready_waiting=[dict(r) for r in ready_rows],
        open_orders_count=int(open_orders_count),
        balance_due_total=balance_due_total,
        ready_install_with_date_count=ready_install_with_date_count,
        ready_install_missing_date_count=ready_install_missing_date_count,
        estimate_conversion_last_3_months=estimate_conversion_last_3_months,
        customer_sources_last_3_months=customer_sources_last_3_months,
        upcoming_installations=[dict(r) for r in upcoming_rows],
    )

