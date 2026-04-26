from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/reports/customer-sources", tags=["Reports — customer sources"])

NO_ACTIVE_COMPANY_DETAIL = "No active company."


def _parse_range(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    """Return (start_inclusive, end_exclusive). Defaults: last 12 months ending today."""
    today = date.today()
    start = from_date or date(today.year, today.month, 1).replace(year=today.year - 1)
    end_incl = to_date or today
    if end_incl < start:
        raise HTTPException(status_code=400, detail="Invalid date range.")
    return start, end_incl + timedelta(days=1)


Source = Literal["referral", "advertising", "unknown"]


class MonthlySourcePointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: date
    referral: int
    advertising: int
    unknown: int


class MonthlySourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date
    points: list[MonthlySourcePointOut]


@router.get(
    "/estimates-monthly",
    response_model=MonthlySourceOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def estimates_monthly_sources(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    rows = db.execute(
        text(
            """
            WITH base AS (
              SELECT
                date_trunc('month', e.created_at::date)::date AS month,
                COALESCE(NULLIF(lower(btrim(e.lead_source)), ''), 'unknown') AS src,
                (
                  CASE
                    WHEN e.customer_id IS NOT NULL AND btrim(e.customer_id) <> '' THEN 'cust:' || btrim(e.customer_id)
                    ELSE 'pros:' || COALESCE(
                      NULLIF(lower(btrim(e.prospect_email)), ''),
                      NULLIF(regexp_replace(btrim(COALESCE(e.prospect_phone, '')), '\\s+', '', 'g'), ''),
                      e.id::text
                    )
                  END
                ) AS customer_key
              FROM estimate e
              WHERE e.company_id = CAST(:cid AS uuid)
                AND e.is_deleted IS NOT TRUE
                AND e.created_at::date >= :start
                AND e.created_at::date < :end
            ),
            roll AS (
              SELECT
                month,
                COUNT(DISTINCT customer_key) FILTER (WHERE src = 'referral')::int AS referral,
                COUNT(DISTINCT customer_key) FILTER (WHERE src = 'advertising')::int AS advertising,
                COUNT(DISTINCT customer_key) FILTER (WHERE src NOT IN ('referral','advertising'))::int AS unknown
              FROM base
              GROUP BY 1
            ),
            series AS (
              SELECT generate_series(
                date_trunc('month', CAST(:start AS date))::date,
                date_trunc('month', CAST(:end AS date) - INTERVAL '1 day')::date,
                INTERVAL '1 month'
              )::date AS month
            )
            SELECT
              s.month,
              COALESCE(r.referral, 0)::int AS referral,
              COALESCE(r.advertising, 0)::int AS advertising,
              COALESCE(r.unknown, 0)::int AS unknown
            FROM series s
            LEFT JOIN roll r ON r.month = s.month
            ORDER BY s.month ASC
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    return MonthlySourceOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        points=[
            MonthlySourcePointOut(
                month=r["month"],
                referral=int(r["referral"] or 0),
                advertising=int(r["advertising"] or 0),
                unknown=int(r["unknown"] or 0),
            )
            for r in rows
            if isinstance(r.get("month"), date)
        ],
    )


@router.get(
    "/orders-monthly",
    response_model=MonthlySourceOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def orders_monthly_sources(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    rows = db.execute(
        text(
            """
            WITH base AS (
              SELECT
                date_trunc('month', COALESCE(o.agreement_date::date, o.created_at::date))::date AS month,
                COALESCE(NULLIF(lower(btrim(e.lead_source)), ''), 'unknown') AS src,
                ('cust:' || btrim(o.customer_id)) AS customer_key
              FROM orders o
              LEFT JOIN estimate e
                ON e.company_id = o.company_id
               AND e.id = o.estimate_id
              WHERE o.company_id = CAST(:cid AS uuid)
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND COALESCE(o.agreement_date::date, o.created_at::date) >= :start
                AND COALESCE(o.agreement_date::date, o.created_at::date) < :end
            ),
            roll AS (
              SELECT
                month,
                COUNT(DISTINCT customer_key) FILTER (WHERE src = 'referral')::int AS referral,
                COUNT(DISTINCT customer_key) FILTER (WHERE src = 'advertising')::int AS advertising,
                COUNT(DISTINCT customer_key) FILTER (WHERE src NOT IN ('referral','advertising'))::int AS unknown
              FROM base
              GROUP BY 1
            ),
            series AS (
              SELECT generate_series(
                date_trunc('month', CAST(:start AS date))::date,
                date_trunc('month', CAST(:end AS date) - INTERVAL '1 day')::date,
                INTERVAL '1 month'
              )::date AS month
            )
            SELECT
              s.month,
              COALESCE(r.referral, 0)::int AS referral,
              COALESCE(r.advertising, 0)::int AS advertising,
              COALESCE(r.unknown, 0)::int AS unknown
            FROM series s
            LEFT JOIN roll r ON r.month = s.month
            ORDER BY s.month ASC
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    return MonthlySourceOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        points=[
            MonthlySourcePointOut(
                month=r["month"],
                referral=int(r["referral"] or 0),
                advertising=int(r["advertising"] or 0),
                unknown=int(r["unknown"] or 0),
            )
            for r in rows
            if isinstance(r.get("month"), date)
        ],
    )

