"""Normalize person name parts for storage (first letter uppercase, rest lowercase per word)."""


def format_person_name_casing(value: str | None) -> str | None:
    if value is None:
        return None
    s = " ".join(value.split())
    if not s:
        return None
    parts: list[str] = []
    for word in s.split(" "):
        if not word:
            continue
        parts.append(word[0].upper() + word[1:].lower() if len(word) > 1 else word.upper())
    return " ".join(parts) if parts else None
