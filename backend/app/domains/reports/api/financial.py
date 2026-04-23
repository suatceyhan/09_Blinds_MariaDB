from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/reports/financial", tags=["Reports — financial"])

NO_ACTIVE_COMPANY_DETAIL = "No active company."


def _parse_range(
    from_date: date | None,
    to_date: date | None,
) -> tuple[date, date]:
    """
    Return (start_inclusive, end_exclusive).
    Defaults: last 30 days ending tomorrow.
    """
    today = date.today()
    start = from_date or (today - timedelta(days=29))
    end_incl = to_date or today
    if end_incl < start:
        raise HTTPException(status_code=400, detail="Invalid date range.")
    return start, end_incl + timedelta(days=1)


class FinancialSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date

    revenue_total: float
    collected_total: float
    balance_total: float
    tax_total: float
    taxable_base_total: float
    expense_total: float
    profit_total: float

    orders_count: int


class TimeseriesPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    d: date
    revenue: float
    collected: float


class TimeseriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date
    group: Literal["daily", "weekly"]
    points: list[TimeseriesPointOut]


class ARTopItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_id: str
    customer_display: str
    balance: float


class ARSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date
    balance_total: float
    positive_balance_orders: int
    top: list[ARTopItemOut]


@router.get(
    "/summary",
    response_model=FinancialSummaryOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def get_financial_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date, to_date)

    row = db.execute(
        text(
            """
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                COALESCE(o.agreement_date::date, o.created_at::date) AS d,
                COALESCE(o.total_amount, 0)::numeric AS subtotal_ex_tax,
                COALESCE(o.tax_amount, 0)::numeric AS tax_amount,
                COALESCE(o.tax_uygulanacak_miktar, 0)::numeric AS taxable_base,
                COALESCE(o.downpayment, 0)::numeric AS downpayment,
                COALESCE(o.balance, 0)::numeric AS balance
              FROM orders o
              WHERE o.company_id = CAST(:cid AS uuid)
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND COALESCE(o.agreement_date::date, o.created_at::date) >= :start
                AND COALESCE(o.agreement_date::date, o.created_at::date) < :end
            ),
            payments AS (
              SELECT
                p.company_id,
                p.order_id,
                COALESCE(SUM(p.amount), 0)::numeric AS pay_sum
              FROM order_payment_entries p
              JOIN base_orders b ON b.company_id = p.company_id AND b.id = p.order_id
              WHERE COALESCE(p.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            ),
            expenses AS (
              SELECT
                e.company_id,
                e.order_id,
                COALESCE(SUM(e.amount), 0)::numeric AS exp_sum
              FROM order_expense_entries e
              JOIN base_orders b ON b.company_id = e.company_id AND b.id = e.order_id
              WHERE COALESCE(e.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            )
            SELECT
              COUNT(*)::int AS orders_count,
              COALESCE(SUM(b.subtotal_ex_tax + b.tax_amount), 0)::numeric AS revenue_total,
              COALESCE(SUM(b.downpayment + COALESCE(pm.pay_sum, 0)), 0)::numeric AS collected_total,
              COALESCE(SUM(GREATEST(b.balance, 0)), 0)::numeric AS balance_total,
              COALESCE(SUM(b.tax_amount), 0)::numeric AS tax_total,
              COALESCE(SUM(b.taxable_base), 0)::numeric AS taxable_base_total,
              COALESCE(SUM(COALESCE(ex.exp_sum, 0)), 0)::numeric AS expense_total,
              COALESCE(SUM((b.subtotal_ex_tax + b.tax_amount) - COALESCE(ex.exp_sum, 0)), 0)::numeric AS profit_total
            FROM base_orders b
            LEFT JOIN payments pm ON pm.company_id = b.company_id AND pm.order_id = b.id
            LEFT JOIN expenses ex ON ex.company_id = b.company_id AND ex.order_id = b.id
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().one()

    def f(v: Any) -> float:
        if v is None:
            return 0.0
        if isinstance(v, Decimal):
            return float(v)
        return float(v)

    return FinancialSummaryOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        revenue_total=f(row["revenue_total"]),
        collected_total=f(row["collected_total"]),
        balance_total=f(row["balance_total"]),
        tax_total=f(row["tax_total"]),
        taxable_base_total=f(row["taxable_base_total"]),
        expense_total=f(row["expense_total"]),
        profit_total=f(row["profit_total"]),
        orders_count=int(row["orders_count"] or 0),
    )


@router.get(
    "/ar",
    response_model=ARSummaryOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def get_ar_summary(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date, to_date)

    bal_row = db.execute(
        text(
            """
            SELECT
              COALESCE(SUM(GREATEST(COALESCE(o.balance, 0), 0)), 0)::numeric AS balance_total,
              COALESCE(SUM(CASE WHEN COALESCE(o.balance, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS positive_balance_orders
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND COALESCE(o.agreement_date::date, o.created_at::date) >= :start
              AND COALESCE(o.agreement_date::date, o.created_at::date) < :end
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().one()

    top_rows = db.execute(
        text(
            """
            SELECT
              o.id AS order_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              COALESCE(o.balance, 0)::numeric AS balance
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND COALESCE(o.balance, 0) > 0
              AND COALESCE(o.agreement_date::date, o.created_at::date) >= :start
              AND COALESCE(o.agreement_date::date, o.created_at::date) < :end
            ORDER BY COALESCE(o.balance, 0) DESC
            LIMIT 10
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    return ARSummaryOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        balance_total=float(bal_row["balance_total"] or 0),
        positive_balance_orders=int(bal_row["positive_balance_orders"] or 0),
        top=[
            ARTopItemOut(
                order_id=str(r["order_id"]),
                customer_display=str(r["customer_display"] or "").strip() or str(r["order_id"]),
                balance=float(r["balance"] or 0),
            )
            for r in top_rows
        ],
    )


@router.get(
    "/timeseries",
    response_model=TimeseriesOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def get_financial_timeseries(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    group: Annotated[Literal["daily", "weekly"], Query()] = "daily",
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date, to_date)

    # Revenue: order date; Collected: payment entry date + downpayment on order date.
    # Use timestamp-based generate_series for compatibility across PG versions.
    bucket_expr = "d" if group == "daily" else "date_trunc('week', d)::date"
    pay_bucket_expr = "d" if group == "daily" else "date_trunc('week', d)::date"
    series_step = "1 day" if group == "daily" else "1 week"
    series_bucket = "bucket_ts::date" if group == "daily" else "date_trunc('week', bucket_ts)::date"

    rows = db.execute(
        text(
            f"""
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                COALESCE(o.agreement_date::date, o.created_at::date) AS d,
                (COALESCE(o.total_amount, 0) + COALESCE(o.tax_amount, 0))::numeric AS revenue,
                COALESCE(o.downpayment, 0)::numeric AS downpayment
              FROM orders o
              WHERE o.company_id = CAST(:cid AS uuid)
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND COALESCE(o.agreement_date::date, o.created_at::date) >= :start
                AND COALESCE(o.agreement_date::date, o.created_at::date) < :end
            ),
            order_roll AS (
              SELECT
                {bucket_expr} AS bucket,
                COALESCE(SUM(revenue), 0)::numeric AS revenue,
                COALESCE(SUM(downpayment), 0)::numeric AS downpayment
              FROM base_orders
              GROUP BY 1
            ),
            payment_roll AS (
              SELECT
                date_trunc('day', p.created_at)::date AS d,
                COALESCE(SUM(p.amount), 0)::numeric AS payments
              FROM order_payment_entries p
              JOIN orders o ON o.company_id = p.company_id AND o.id = p.order_id
              WHERE p.company_id = CAST(:cid AS uuid)
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND COALESCE(p.is_deleted, FALSE) = FALSE
                AND date_trunc('day', p.created_at)::date >= :start
                AND date_trunc('day', p.created_at)::date < :end
              GROUP BY 1
            ),
            pay_bucket AS (
              SELECT
                {pay_bucket_expr} AS bucket,
                COALESCE(SUM(payments), 0)::numeric AS payments
              FROM payment_roll
              GROUP BY 1
            ),
            series AS (
              SELECT
                generate_series(
                  CAST(:start AS timestamp),
                  (CAST(:end AS timestamp) - INTERVAL '1 day'),
                  INTERVAL '{series_step}'
                ) AS bucket_ts
            )
            SELECT
              {series_bucket} AS d,
              COALESCE(o.revenue, 0)::numeric AS revenue,
              (COALESCE(o.downpayment, 0) + COALESCE(p.payments, 0))::numeric AS collected
            FROM series s
            LEFT JOIN order_roll o ON o.bucket = {series_bucket}
            LEFT JOIN pay_bucket p ON p.bucket = {series_bucket}
            ORDER BY d ASC
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    points = [
        TimeseriesPointOut(
            d=r["d"],
            revenue=float(r["revenue"] or 0),
            collected=float(r["collected"] or 0),
        )
        for r in rows
        if isinstance(r["d"], date)
    ]

    return TimeseriesOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        group=group,
        points=points,
    )

