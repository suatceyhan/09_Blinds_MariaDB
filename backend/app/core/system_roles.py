"""Değiştirilemeyen / silinemeyen sabit rol adları (küçük-büyük harf duyarsız)."""

RESERVED_SYSTEM_ROLE_NAMES = frozenset({"superadmin", "admin", "user"})


def is_reserved_system_role_name(name: str) -> bool:
    return (name or "").strip().lower() in RESERVED_SYSTEM_ROLE_NAMES
