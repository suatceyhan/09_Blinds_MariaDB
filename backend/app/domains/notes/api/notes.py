from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import require_permissions, resolve_tenant_company_id
from app.domains.user.models.users import Users

router = APIRouter(prefix="/notes", tags=["Notes"])

NOTE_NOT_FOUND = "Note not found."


class NoteListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    title: str
    body: str | None = None
    due_at: datetime | None = None
    is_deleted: bool
    created_at: Any | None = None
    updated_at: Any | None = None


class NoteOut(NoteListItemOut):
    created_by: UUID | None = None


class NoteCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=5000)
    body: str | None = Field(None, max_length=50_000)
    due_at: datetime | None = None


class NotePatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str | None = Field(None, min_length=1, max_length=5000)
    body: str | None = Field(None, max_length=50_000)
    due_at: datetime | None = None


@router.get("", response_model=list[NoteListItemOut])
def list_notes(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.view"))],
    limit: int = Query(200, ge=1, le=500),
    search: str | None = Query(None, max_length=200),
    include_deleted: bool = Query(False),
    only_reminders: bool = Query(False),
    company_id: UUID | None = Query(None),
):
    tenant_cid = resolve_tenant_company_id(db, current_user, company_id_param=company_id)

    term = (search or "").strip()
    where = ["n.company_id = :tenant_cid"]
    params: dict[str, Any] = {"tenant_cid": str(tenant_cid), "limit": limit}
    if not include_deleted:
        where.append("n.is_deleted <> TRUE")
    if only_reminders:
        where.append("n.due_at IS NOT NULL")
    if term:
        params["term"] = f"%{term.lower()}%"
        where.append("(LOWER(n.title) LIKE :term OR LOWER(COALESCE(n.body,'')) LIKE :term)")

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.execute(
        text(
            f"""
            SELECT
              n.id,
              n.company_id,
              n.title,
              n.body,
              n.due_at,
              n.is_deleted,
              n.created_at,
              n.updated_at
            FROM notes n
            {where_sql}
            ORDER BY (n.created_at IS NULL) ASC, n.created_at DESC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [NoteListItemOut(**dict(r)) for r in rows]


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    body: NoteCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.edit"))],
):
    cid = resolve_tenant_company_id(db, current_user)
    new_id = str(uuid4())
    db.execute(
        text(
            """
            INSERT INTO notes (id, company_id, title, body, due_at, created_by, is_deleted)
            VALUES (:id, :company_id, :title, :body, :due_at, :created_by, FALSE)
            """
        ),
        {
            "id": new_id,
            "company_id": str(cid),
            "title": body.title.strip(),
            "body": body.body.strip() if body.body and body.body.strip() else None,
            "due_at": body.due_at,
            "created_by": str(current_user.id),
        },
    )
    db.commit()
    return get_note(note_id=new_id, db=db, current_user=current_user)


@router.get("/{note_id}", response_model=NoteOut)
def get_note(
    note_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.view"))],
):
    cid = resolve_tenant_company_id(db, current_user)
    row = db.execute(
        text(
            """
            SELECT
              id, company_id, title, body, due_at, created_by, is_deleted, created_at, updated_at
            FROM notes
            WHERE company_id = :company_id AND id = :id
            LIMIT 1
            """
        ),
        {"company_id": str(cid), "id": note_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail=NOTE_NOT_FOUND)
    return NoteOut(**dict(row))


@router.patch("/{note_id}", response_model=NoteOut)
def patch_note(
    note_id: str,
    body: NotePatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.edit"))],
):
    cid = resolve_tenant_company_id(db, current_user)
    raw = body.model_dump(exclude_unset=True)
    if not raw:
        return get_note(note_id=note_id, db=db, current_user=current_user)

    sets: list[str] = []
    params: dict[str, Any] = {"company_id": str(cid), "id": note_id}
    if "title" in raw:
        title = raw.get("title")
        title = title.strip() if isinstance(title, str) else title
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty.")
        sets.append("title = :title")
        params["title"] = title
    if "body" in raw:
        b = raw.get("body")
        if isinstance(b, str):
            b = b.strip()
            if b == "":
                b = None
        sets.append("body = :body")
        params["body"] = b
    if "due_at" in raw:
        sets.append("due_at = :due_at")
        params["due_at"] = raw.get("due_at")

    sets.append("updated_at = CURRENT_TIMESTAMP(6)")
    res = db.execute(
        text(
            f"""
            UPDATE notes
            SET {', '.join(sets)}
            WHERE company_id = :company_id AND id = :id
            """
        ),
        params,
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail=NOTE_NOT_FOUND)
    db.commit()
    return get_note(note_id=note_id, db=db, current_user=current_user)


@router.delete("/{note_id}", response_model=NoteOut)
def delete_note(
    note_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.edit"))],
):
    cid = resolve_tenant_company_id(db, current_user)
    res = db.execute(
        text(
            """
            UPDATE notes
            SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP(6)
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": note_id},
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail=NOTE_NOT_FOUND)
    db.commit()
    return get_note(note_id=note_id, db=db, current_user=current_user)


@router.post("/{note_id}/restore", response_model=NoteOut)
def restore_note(
    note_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("notes.edit"))],
):
    cid = resolve_tenant_company_id(db, current_user)
    res = db.execute(
        text(
            """
            UPDATE notes
            SET is_deleted = FALSE, updated_at = CURRENT_TIMESTAMP(6)
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": note_id},
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail=NOTE_NOT_FOUND)
    db.commit()
    return get_note(note_id=note_id, db=db, current_user=current_user)

