"""Workflow action type registry (UI + runtime hints).

This endpoint defines which action types exist and how the UI should edit/render them.
It is intentionally generic: it should not contain domain-specific status names.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/workflow", tags=["Workflow"])


class JsonSchemaFieldOut(BaseModel):
    """Minimal JSON-schema-like contract (enough for a basic editor)."""

    key: str
    label: str
    kind: Literal["text", "number", "boolean", "json", "datetime", "select"] = "text"
    required: bool = False
    options: list[dict[str, Any]] | None = None


class ActionUiSecondaryOut(BaseModel):
    """How list UIs can offer a secondary shortcut action (e.g. open expense flow)."""

    label: str
    kind: Literal["open_expense"] = "open_expense"


class WorkflowActionTypeOut(BaseModel):
    type: str
    label: str
    description: str | None = None
    config_fields: list[JsonSchemaFieldOut] = Field(default_factory=list)
    ui_secondary: ActionUiSecondaryOut | None = None


@router.get("/action-types", response_model=list[WorkflowActionTypeOut])
def list_workflow_action_types(
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    # `db` is accepted for consistency with other endpoints and future DB-driven registry;
    # current implementation is static and global.
    return [
        WorkflowActionTypeOut(
            type="ask_form",
            label="Ask for form fields",
            description="Prompts the user for additional data before completing the transition.",
            config_fields=[
                JsonSchemaFieldOut(key="title", label="Title", kind="text", required=False),
                JsonSchemaFieldOut(key="description", label="Description", kind="text", required=False),
                JsonSchemaFieldOut(
                    key="fields",
                    label="Fields",
                    kind="json",
                    required=True,
                    options=[
                        {
                            "hint": (
                                "Array of field objects: {key,label,kind,required,target,target_field,target_meta}. "
                                "Targets define where submitted values are written."
                            )
                        }
                    ],
                ),
            ],
            ui_secondary=None,
        ),
        WorkflowActionTypeOut(
            type="open_expense",
            label="Offer expense entry",
            description="UI hint: offer a shortcut to open the expense modal after advancing status.",
            config_fields=[
                JsonSchemaFieldOut(key="note", label="Default note", kind="text", required=False),
            ],
            ui_secondary=ActionUiSecondaryOut(label="Add production cost", kind="open_expense"),
        ),
        WorkflowActionTypeOut(
            type="webhook",
            label="Webhook",
            description="Calls an external URL on transition (server-side).",
            config_fields=[
                JsonSchemaFieldOut(key="url", label="URL", kind="text", required=True),
                JsonSchemaFieldOut(key="method", label="Method", kind="text", required=False),
                JsonSchemaFieldOut(key="headers", label="Headers (JSON)", kind="json", required=False),
                JsonSchemaFieldOut(key="payload", label="Payload (JSON)", kind="json", required=False),
            ],
            ui_secondary=None,
        ),
    ]

