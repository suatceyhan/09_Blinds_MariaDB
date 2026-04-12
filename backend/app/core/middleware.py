import time
from collections import defaultdict
from typing import List

from fastapi import Request, status
from fastapi.responses import JSONResponse

PUBLIC_PATHS: List[str] = [
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/health",
    "/ping",
    "/integrations/google/callback",
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/password_reset",
    "/public-registration",
]

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX_REQUESTS = 10000
RATE_LIMIT_PUBLIC_WINDOW = 60
RATE_LIMIT_PUBLIC_MAX_REQUESTS = 20000

request_counts: defaultdict[str, list] = defaultdict(list)


def is_public_path(path: str) -> bool:
    clean_path = path.split("?")[0]
    if clean_path in PUBLIC_PATHS:
        return True
    return any(clean_path.startswith(p) for p in PUBLIC_PATHS)


def is_rate_limited(client_ip: str, path: str) -> bool:
    current_time = time.time()
    window = RATE_LIMIT_PUBLIC_WINDOW if is_public_path(path) else RATE_LIMIT_WINDOW
    max_requests = (
        RATE_LIMIT_PUBLIC_MAX_REQUESTS if is_public_path(path) else RATE_LIMIT_MAX_REQUESTS
    )
    request_counts[client_ip] = [
        t for t in request_counts[client_ip] if current_time - t < window
    ]
    if len(request_counts[client_ip]) >= max_requests:
        return True
    request_counts[client_ip].append(current_time)
    return False


async def auth_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if is_rate_limited(client_ip, path):
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": "Rate limit exceeded. Please try again later.",
                "retry_after": RATE_LIMIT_WINDOW,
            },
        )
    if is_public_path(path):
        return await call_next(request)
    return await call_next(request)
