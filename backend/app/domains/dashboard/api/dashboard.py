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


def _month_floor(dt: datetime) -> datetime:
    return datetime(dt.year, dt.month, 1, tzinfo=dt.tzinfo)


def _month_add(dt: datetime, delta: int) -> datetime:
    y, m = dt.year, dt.month + delta
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return datetime(y, m, 1, tzinfo=dt.tzinfo)


def _rolling_month_labels(now_utc: datetime, count: int = 3) -> list[str]:
    cur = _month_floor(now_utc)
    start = _month_add(cur, -(count - 1))
    keys: list[str] = []
    y, m = start.year, start.month
    for _ in range(count):
        keys.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return keys


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
    now_u = datetime.now(timezone.utc)
    win_start = _month_add(_month_floor(now_u), -2)
    win_end = _month_add(_month_floor(now_u), 1)
    month_keys = _rolling_month_labels(now_u, 3)

    est_counts = db.execute(
        text(
            """
            SELECT
              COALESCE(SUM(CASE WHEN se.builtin_kind = 'new' THEN 1 ELSE 0 END), 0) AS new_count,
              COALESCE(SUM(CASE WHEN se.builtin_kind = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :cid
              AND COALESCE(e.is_deleted, 0) = 0
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
                    END
                    ORDER BY eb.sort_order, bt.name SEPARATOR ', ')
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
              AND COALESCE(e.is_deleted, 0) = 0
              AND (se.builtin_kind IS NULL OR se.builtin_kind <> 'cancelled')
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) IS NOT NULL
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
              AND COALESCE(e.scheduled_start_at, e.tarih_saat) < DATE_ADD(NOW(), INTERVAL 30 DAY)
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) ASC
            LIMIT 20
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    week_count = db.execute(
        text(
            """
            SELECT COUNT(*) AS c
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :cid
              AND COALESCE(e.is_deleted, 0) = 0
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
            SELECT COUNT(*) AS c
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
                SELECT COUNT(*) AS c
                FROM orders
                WHERE company_id = :cid
                  AND parent_order_id IS NULL
                  AND created_at < DATE_SUB(NOW(), INTERVAL :lo DAY)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "cid": str(cid)}).mappings().one()["c"]
        else:
            q = text(
                """
                SELECT COUNT(*) AS c
                FROM orders
                WHERE company_id = :cid
                  AND parent_order_id IS NULL
                  AND created_at >= DATE_SUB(NOW(), INTERVAL :hi DAY)
                  AND created_at <  DATE_SUB(NOW(), INTERVAL :lo DAY)
                  AND active IS TRUE
                """
            )
            c = db.execute(q, {"lo": lo, "hi": hi, "cid": str(cid)}).mappings().one()["c"]
        bucket_counts.append(AgingBucket(label=label, count=int(c)))

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
                FLOOR(TIMESTAMPDIFF(SECOND, COALESCE(ready_at, created_at), NOW()) / 86400)
              ) AS waiting_days
            FROM orders
            WHERE company_id = :cid
              AND active IS TRUE
              AND parent_order_id IS NULL
              AND (
                COALESCE(status_code, '') = 'ready_for_install'
                OR LOWER(COALESCE(status_orde_id, '')) LIKE '%ready%'
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
            SELECT COUNT(*) AS c
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
              COALESCE(SUM(CASE WHEN o.installation_scheduled_start_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_date,
              COALESCE(SUM(CASE WHEN o.installation_scheduled_start_at IS NULL THEN 1 ELSE 0 END), 0) AS missing_date
            FROM orders o
            LEFT JOIN status_order so ON so.id = o.status_orde_id
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
              AND o.installation_scheduled_start_at >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
              AND o.installation_scheduled_start_at < DATE_ADD(NOW(), INTERVAL 7 DAY)
            ORDER BY o.installation_scheduled_start_at ASC
            LIMIT 20
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    conv_raw = db.execute(
        text(
            """
            SELECT
              DATE_FORMAT(e.created_at, '%Y-%m') AS month,
              COUNT(*) AS total_count,
              COALESCE(SUM(
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM orders o
                  WHERE o.company_id = e.company_id
                    AND o.estimate_id = e.id
                ) THEN 1 ELSE 0 END
              ), 0) AS converted_count
            FROM estimate e
            WHERE e.company_id = :cid
              AND COALESCE(e.is_deleted, 0) = 0
              AND e.created_at >= :win_start
              AND e.created_at < :win_end
            GROUP BY DATE_FORMAT(e.created_at, '%Y-%m')
            """
        ),
        {"cid": str(cid), "win_start": win_start, "win_end": win_end},
    ).mappings().all()
    conv_map = {str(r["month"]): r for r in conv_raw}
    estimate_conversion_last_3_months: list[EstimateConversionMonth] = []
    for mk in month_keys:
        r = conv_map.get(mk)
        tc = int(r["total_count"] or 0) if r else 0
        cc = int(r["converted_count"] or 0) if r else 0
        pct = float(round((cc * 100.0) / tc, 1)) if tc else 0.0
        estimate_conversion_last_3_months.append(
            EstimateConversionMonth(month=mk, converted_count=cc, total_count=tc, percent=pct)
        )

    src_raw = db.execute(
        text(
            """
            SELECT
              DATE_FORMAT(e.created_at, '%Y-%m') AS month,
              COALESCE(SUM(CASE WHEN COALESCE(e.lead_source, 'advertising') = 'referral' THEN 1 ELSE 0 END), 0)
                AS referral_count,
              COALESCE(SUM(CASE WHEN COALESCE(e.lead_source, 'advertising') <> 'referral' THEN 1 ELSE 0 END), 0)
                AS advertising_count,
              COUNT(*) AS total_count
            FROM estimate e
            WHERE e.company_id = :cid
              AND COALESCE(e.is_deleted, 0) = 0
              AND e.created_at >= :win_start
              AND e.created_at < :win_end
            GROUP BY DATE_FORMAT(e.created_at, '%Y-%m')
            """
        ),
        {"cid": str(cid), "win_start": win_start, "win_end": win_end},
    ).mappings().all()
    src_map = {str(r["month"]): r for r in src_raw}
    customer_sources_last_3_months = []
    for mk in month_keys:
        r = src_map.get(mk)
        customer_sources_last_3_months.append(
            CustomerSourcesMonth(
                month=mk,
                advertising_count=int(r["advertising_count"] or 0) if r else 0,
                referral_count=int(r["referral_count"] or 0) if r else 0,
                total_count=int(r["total_count"] or 0) if r else 0,
            )
        )

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
