"""Vercel's FastAPI service entrypoint; local startup remains unchanged."""

from citride.api import app

__all__ = ["app"]
