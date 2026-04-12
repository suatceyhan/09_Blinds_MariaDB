from pydantic import BaseModel


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    new_password_again: str


class ChangePasswordResponse(BaseModel):
    msg: str
