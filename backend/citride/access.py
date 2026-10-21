"""A shared demo login for hosted deployments, without frontend secrets."""

import base64
import binascii
import re
import secrets
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse


def _origin_tuple(value: str) -> tuple[str, str, int] | None:
    """Parse a serialized HTTP origin without URL-parser whitespace repairs."""
    if not value or any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
        return None
    if any(character in value for character in ("\\", "?", "#")):
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.path or parsed.username is not None or parsed.password is not None
            or not re.fullmatch(r"(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?", parsed.netloc)
            or not parsed.hostname
        ):
            return None
        port = parsed.port
        return parsed.scheme, parsed.hostname.lower(), port if port is not None else (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return None


class DemoAccessMiddleware:
    def __init__(self, app, username: str, password: str | None, required: bool, secure_origin: bool = False, configuration_valid: bool = True):
        self.app = app
        self.username = username
        # Blank is unconfigured, but never trim a configured credential.
        self.password = password if password and password.strip() else None
        self.required = required
        self.secure_origin = secure_origin
        self.configuration_valid = configuration_valid and bool(username.strip()) and ":" not in username

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if not self.configuration_valid or (self.required and self.password is None):
            response = JSONResponse(
                {
                    "detail": "The demo login has not been configured correctly.",
                    "code": "auth_not_configured",
                    "username": self.username if self.configuration_valid else "demo",
                },
                status_code=503,
                headers={"Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        headers = Headers(scope=scope)
        authenticated = False
        try:
            scheme, token = headers.get("authorization", "").split(" ", 1)
            if scheme.lower() == "basic" and self.password is not None:
                username, password = base64.b64decode(token, validate=True).decode("utf-8").split(":", 1)
                authenticated = secrets.compare_digest(username.encode(), self.username.encode()) & secrets.compare_digest(
                    password.encode(), self.password.encode(),
                )
        except (ValueError, UnicodeError, binascii.Error):
            pass
        if self.password is not None and not authenticated:
            response = JSONResponse(
                {"detail": "Sign in to access the demo.", "code": "login_required", "username": self.username},
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="CITRIDE demo", charset="UTF-8"', "Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        # Independent of login: passwordless loopback mode must also reject
        # browser form writes from other sites before receive()/repository work.
        # Origin-less CLI calls remain valid; Fetch Metadata only adds a deny
        # signal and is never authentication. Ignore X-Forwarded-* overrides.
        if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            origins = headers.getlist("origin")
            hosts = headers.getlist("host")
            scheme = "https" if self.secure_origin else scope.get("scheme", "http")
            expected = _origin_tuple(f"{scheme}://{hosts[0]}") if len(hosts) == 1 else None
            # Vite's existing loopback proxy preserves the frontend Host, so
            # exact origin comparison works without trusting arbitrary ports or
            # forwarded headers, and without a development CORS exception.
            same_origin = not origins or (
                len(origins) == 1 and expected is not None and _origin_tuple(origins[0]) == expected
            )
            cross_site = any(value.strip().lower() == "cross-site" for value in headers.getlist("sec-fetch-site"))
            if not same_origin or cross_site:
                response = JSONResponse(
                    {"detail": "Model changes require a same-origin request."}, status_code=403,
                    headers={"Cache-Control": "no-store"},
                )
                return await response(scope, receive, send)

        if self.password is None:
            return await self.app(scope, receive, send)

        async def private_send(message):
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["Cache-Control"] = "private, no-store"
                response_headers.add_vary_header("Authorization")
            await send(message)

        return await self.app(scope, receive, private_send)
