from pydantic import BaseModel, ConfigDict


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str
    new_password_again: str


class PasswordResetRequestResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    msg: str
    reset_token: str | None = None
