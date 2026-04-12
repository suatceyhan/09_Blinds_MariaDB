from enum import Enum


class PendingStatus(str, Enum):
    EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
