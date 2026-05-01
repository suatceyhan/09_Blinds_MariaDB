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
    # Accept both `from`/`to` and `from_date`/`to_date` (frontend uses *_date).
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    row = db.execute(
        text(
            """
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                DATE(COALESCE(o.agreement_date, o.created_at)) AS d,
                COALESCE(o.total_amount, 0) AS subtotal_ex_tax,
                COALESCE(o.tax_amount, 0) AS tax_amount,
                COALESCE(o.tax_uygulanacak_miktar, 0) AS taxable_base,
                COALESCE(o.downpayment, 0) AS downpayment,
                COALESCE(o.balance, 0) AS balance
              FROM orders o
              WHERE o.company_id = :cid
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
                AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
            ),
            payments AS (
              SELECT
                p.company_id,
                p.order_id,
                COALESCE(SUM(p.amount), 0) AS pay_sum
              FROM order_payment_entries p
              JOIN base_orders b ON b.company_id = p.company_id AND b.id = p.order_id
              WHERE COALESCE(p.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            ),
            expenses AS (
              SELECT
                e.company_id,
                e.order_id,
                COALESCE(SUM(e.amount), 0) AS exp_sum
              FROM order_expense_entries e
              JOIN base_orders b ON b.company_id = e.company_id AND b.id = e.order_id
              WHERE COALESCE(e.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            )
            SELECT
              CAST(COUNT(*) AS SIGNED) AS orders_count,
              COALESCE(SUM(b.subtotal_ex_tax + b.tax_amount), 0) AS revenue_total,
              COALESCE(SUM(b.downpayment + COALESCE(pm.pay_sum, 0)), 0) AS collected_total,
              COALESCE(SUM(GREATEST(b.balance, 0)), 0) AS balance_total,
              COALESCE(SUM(b.tax_amount), 0) AS tax_total,
              COALESCE(SUM(b.taxable_base), 0) AS taxable_base_total,
              COALESCE(SUM(COALESCE(ex.exp_sum, 0)), 0) AS expense_total,
              COALESCE(SUM((b.subtotal_ex_tax + b.tax_amount) - COALESCE(ex.exp_sum, 0)), 0) AS profit_total
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
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    bal_row = db.execute(
        text(
            """
            SELECT
              COALESCE(SUM(GREATEST(COALESCE(o.balance, 0), 0)), 0) AS balance_total,
              CAST(COALESCE(SUM(CASE WHEN COALESCE(o.balance, 0) > 0 THEN 1 ELSE 0 END), 0) AS SIGNED) AS positive_balance_orders
            FROM orders o
            WHERE o.company_id = :cid
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
              AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
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
              COALESCE(o.balance, 0) AS balance
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            WHERE o.company_id = :cid
              AND o.active IS TRUE
              AND o.parent_order_id IS NULL
              AND COALESCE(o.balance, 0) > 0
              AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
              AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
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
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
    group: Annotated[Literal["daily", "weekly"], Query()] = "daily",
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    # Revenue: order date; Collected: payment entry date + downpayment on order date.
    # MariaDB doesn't support generate_series/date_trunc/::date casts, so we use
    # WITH RECURSIVE for series and WEEKDAY() for week bucketing (Monday-start).
    bucket_expr = "d" if group == "daily" else "DATE_SUB(d, INTERVAL WEEKDAY(d) DAY)"
    pay_bucket_expr = "d" if group == "daily" else "DATE_SUB(d, INTERVAL WEEKDAY(d) DAY)"
    series_start = ":start" if group == "daily" else "DATE_SUB(:start, INTERVAL WEEKDAY(:start) DAY)"
    series_end = "DATE_SUB(:end, INTERVAL 1 DAY)" if group == "daily" else "DATE_SUB(DATE_SUB(:end, INTERVAL 1 DAY), INTERVAL WEEKDAY(DATE_SUB(:end, INTERVAL 1 DAY)) DAY)"
    series_step = "1 DAY" if group == "daily" else "7 DAY"

    rows = db.execute(
        text(
            f"""
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                DATE(COALESCE(o.agreement_date, o.created_at)) AS d,
                (COALESCE(o.total_amount, 0) + COALESCE(o.tax_amount, 0)) AS revenue,
                COALESCE(o.downpayment, 0) AS downpayment
              FROM orders o
              WHERE o.company_id = :cid
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
                AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
            ),
            order_roll AS (
              SELECT
                {bucket_expr} AS bucket,
                COALESCE(SUM(revenue), 0) AS revenue,
                COALESCE(SUM(downpayment), 0) AS downpayment
              FROM base_orders
              GROUP BY 1
            ),
            payment_roll AS (
              SELECT
                DATE(p.created_at) AS d,
                COALESCE(SUM(p.amount), 0) AS payments
              FROM order_payment_entries p
              JOIN orders o ON o.company_id = p.company_id AND o.id = p.order_id
              WHERE p.company_id = :cid
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND COALESCE(p.is_deleted, FALSE) = FALSE
                AND DATE(p.created_at) >= :start
                AND DATE(p.created_at) < :end
              GROUP BY 1
            ),
            pay_bucket AS (
              SELECT
                {pay_bucket_expr} AS bucket,
                COALESCE(SUM(payments), 0) AS payments
              FROM payment_roll
              GROUP BY 1
            ),
            series AS (
              WITH RECURSIVE s AS (
                SELECT {series_start} AS d
                UNION ALL
                SELECT DATE_ADD(d, INTERVAL {series_step})
                FROM s
                WHERE d < {series_end}
              )
              SELECT d FROM s
            )
            SELECT
              s.d AS d,
              COALESCE(o.revenue, 0) AS revenue,
              (COALESCE(o.downpayment, 0) + COALESCE(p.payments, 0)) AS collected
            FROM series s
            LEFT JOIN order_roll o ON o.bucket = s.d
            LEFT JOIN pay_bucket p ON p.bucket = s.d
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


class FinancialOrderRowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_id: str
    d: date
    customer_display: str
    revenue: float
    collected: float
    balance: float
    tax: float
    expense: float
    profit: float


class FinancialOrdersOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date
    only_positive_balance: bool
    orders: list[FinancialOrderRowOut]


@router.get(
    "/orders",
    response_model=FinancialOrdersOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def list_financial_orders(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("reports.access.view"))],
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
    from_q: Annotated[date | None, Query(alias="from")] = None,
    to_q: Annotated[date | None, Query(alias="to")] = None,
    only_positive_balance: Annotated[bool, Query()] = False,
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail=NO_ACTIVE_COMPANY_DETAIL)
    start, end = _parse_range(from_date or from_q, to_date or to_q)

    where_extra = "AND COALESCE(o.balance, 0) > 0" if only_positive_balance else ""
    rows = db.execute(
        text(
            f"""
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                DATE(COALESCE(o.agreement_date, o.created_at)) AS d,
                COALESCE(o.total_amount, 0) AS subtotal_ex_tax,
                COALESCE(o.tax_amount, 0) AS tax_amount,
                COALESCE(o.downpayment, 0) AS downpayment,
                COALESCE(o.balance, 0) AS balance,
                trim(concat_ws(' ', c.name, c.surname)) AS customer_display
              FROM orders o
              JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
              WHERE o.company_id = :cid
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                {where_extra}
                AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
                AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
            ),
            payments AS (
              SELECT
                p.company_id,
                p.order_id,
                COALESCE(SUM(p.amount), 0) AS pay_sum
              FROM order_payment_entries p
              JOIN base_orders b ON b.company_id = p.company_id AND b.id = p.order_id
              WHERE COALESCE(p.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            ),
            expenses AS (
              SELECT
                e.company_id,
                e.order_id,
                COALESCE(SUM(e.amount), 0) AS exp_sum
              FROM order_expense_entries e
              JOIN base_orders b ON b.company_id = e.company_id AND b.id = e.order_id
              WHERE COALESCE(e.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            )
            SELECT
              b.id AS order_id,
              b.d,
              b.customer_display,
              (b.subtotal_ex_tax + b.tax_amount) AS revenue,
              (b.downpayment + COALESCE(pm.pay_sum, 0)) AS collected,
              GREATEST(b.balance, 0) AS balance,
              b.tax_amount AS tax,
              COALESCE(ex.exp_sum, 0) AS expense,
              ((b.subtotal_ex_tax + b.tax_amount) - COALESCE(ex.exp_sum, 0)) AS profit
            FROM base_orders b
            LEFT JOIN payments pm ON pm.company_id = b.company_id AND pm.order_id = b.id
            LEFT JOIN expenses ex ON ex.company_id = b.company_id AND ex.order_id = b.id
            ORDER BY b.d DESC, b.id DESC
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    return FinancialOrdersOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        only_positive_balance=only_positive_balance,
        orders=[
            FinancialOrderRowOut(
                order_id=str(r["order_id"]),
                d=r["d"],
                customer_display=str(r["customer_display"] or "").strip() or str(r["order_id"]),
                revenue=float(r["revenue"] or 0),
                collected=float(r["collected"] or 0),
                balance=float(r["balance"] or 0),
                tax=float(r["tax"] or 0),
                expense=float(r["expense"] or 0),
                profit=float(r["profit"] or 0),
            )
            for r in rows
        ],
    )


class MonthlyPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: date  # first day of month
    revenue: float
    expense: float
    tax: float
    profit: float


class MonthlyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    range_from: date
    range_to: date
    points: list[MonthlyPointOut]


@router.get(
    "/monthly",
    response_model=MonthlyOut,
    responses={400: {"description": "Invalid date range."}, 403: {"description": NO_ACTIVE_COMPANY_DETAIL}},
)
def get_financial_monthly(
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
            WITH base_orders AS (
              SELECT
                o.id,
                o.company_id,
                STR_TO_DATE(DATE_FORMAT(DATE(COALESCE(o.agreement_date, o.created_at)), '%Y-%m-01'), '%Y-%m-%d') AS m,
                COALESCE(o.total_amount, 0) AS subtotal_ex_tax,
                COALESCE(o.tax_amount, 0) AS tax_amount
              FROM orders o
              WHERE o.company_id = :cid
                AND o.active IS TRUE
                AND o.parent_order_id IS NULL
                AND DATE(COALESCE(o.agreement_date, o.created_at)) >= :start
                AND DATE(COALESCE(o.agreement_date, o.created_at)) < :end
            ),
            expenses AS (
              SELECT
                e.company_id,
                e.order_id,
                COALESCE(SUM(e.amount), 0) AS exp_sum
              FROM order_expense_entries e
              JOIN base_orders b ON b.company_id = e.company_id AND b.id = e.order_id
              WHERE COALESCE(e.is_deleted, FALSE) = FALSE
              GROUP BY 1, 2
            ),
            roll AS (
              SELECT
                b.m AS month,
                COALESCE(SUM(b.subtotal_ex_tax + b.tax_amount), 0) AS revenue,
                COALESCE(SUM(COALESCE(ex.exp_sum, 0)), 0) AS expense,
                COALESCE(SUM(b.tax_amount), 0) AS tax,
                COALESCE(SUM((b.subtotal_ex_tax + b.tax_amount) - COALESCE(ex.exp_sum, 0)), 0) AS profit
              FROM base_orders b
              LEFT JOIN expenses ex ON ex.company_id = b.company_id AND ex.order_id = b.id
              GROUP BY 1
            ),
            series AS (
              WITH RECURSIVE s AS (
                SELECT DATE_SUB(:start, INTERVAL DAY(:start) - 1 DAY) AS month
                UNION ALL
                SELECT DATE_ADD(month, INTERVAL 1 MONTH)
                FROM s
                WHERE month < DATE_SUB(DATE_SUB(:end, INTERVAL 1 DAY), INTERVAL DAY(DATE_SUB(:end, INTERVAL 1 DAY)) - 1 DAY)
              )
              SELECT month FROM s
            )
            SELECT
              s.month,
              COALESCE(r.revenue, 0) AS revenue,
              COALESCE(r.expense, 0) AS expense,
              COALESCE(r.tax, 0) AS tax,
              COALESCE(r.profit, 0) AS profit
            FROM series s
            LEFT JOIN roll r ON r.month = s.month
            ORDER BY s.month ASC
            """
        ),
        {"cid": str(cid), "start": start, "end": end},
    ).mappings().all()

    points = [
        MonthlyPointOut(
            month=r["month"],
            revenue=float(r["revenue"] or 0),
            expense=float(r["expense"] or 0),
            tax=float(r["tax"] or 0),
            profit=float(r["profit"] or 0),
        )
        for r in rows
        if isinstance(r.get("month"), date)
    ]

    return MonthlyOut(
        range_from=start,
        range_to=end - timedelta(days=1),
        points=points,
    )

