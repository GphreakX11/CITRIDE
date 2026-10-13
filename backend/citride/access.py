"""A shared demo login for hosted deployments, without frontend secrets."""

import base64
import binascii
import secrets
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse


class DemoAccessMiddleware:
    def __init__(self, app, username: str, password: str | None, required: bool, secure_origin: bool = False):
        self.app = app
        self.username = username
        self.password = password
        self.required = required
        self.secure_origin = secure_origin

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if not self.password:
            if self.required:
                response = JSONResponse(
                    {"detail": "Set CITRIDE_DEMO_PASSWORD before serving the hosted demo."},
                    status_code=503,
                    headers={"Cache-Control": "no-store"},
                )
                return await response(scope, receive, send)
            return await self.app(scope, receive, send)

        headers = Headers(scope=scope)
        authenticated = False
        try:
            scheme, token = headers.get("authorization", "").split(" ", 1)
            if scheme.lower() == "basic":
                username, password = base64.b64decode(token, validate=True).decode("utf-8").split(":", 1)
                authenticated = secrets.compare_digest(username.encode(), self.username.encode()) & secrets.compare_digest(
                    password.encode(), self.password.encode(),
                )
        except (ValueError, UnicodeError, binascii.Error):
            pass
        if not authenticated:
            response = JSONResponse(
                {"detail": "Sign in to access the demo."}, status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="CITRIDE demo", charset="UTF-8"', "Cache-Control": "no-store"},
            )
            return await response(scope, receive, send)

        # A browser must not turn another site's request into a model edit
        # using automatically attached Basic credentials. CLI calls can omit
        # Origin; browser mutation requests must match this deployment.
        origin = headers.get("origin")
        if origin and scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            try:
                parsed = urlsplit(origin)
                same_origin = (
                    parsed.netloc.lower() == headers.get("host", "").lower()
                    and parsed.scheme == ("https" if self.secure_origin else scope.get("scheme", "http"))
                    and parsed.path == "" and not parsed.query and not parsed.fragment
                    and parsed.username is None and parsed.password is None
                )
            except ValueError:
                same_origin = False
            if not same_origin:
                response = JSONResponse(
                    {"detail": "Model changes require a same-origin request."}, status_code=403,
                    headers={"Cache-Control": "no-store"},
                )
                return await response(scope, receive, send)

        async def private_send(message):
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers["Cache-Control"] = "private, no-store"
                response_headers.add_vary_header("Authorization")
            await send(message)

        return await self.app(scope, receive, private_send)
