# Build from repository root: docker build -f backend/Dockerfile --target verification .
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock /app/backend/
COPY backend/citride /app/backend/citride
COPY data /app/data
RUN pip install --no-cache-dir uv==0.13.1 \
    && uv sync --locked --no-dev --project /app/backend
ENV PYTHONPATH=/app/backend
ENV PATH="/app/backend/.venv/bin:${PATH}"
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "citride.api:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS verification
# The declared dev group includes image-composition and browser-test libraries.
RUN uv sync --locked --project /app/backend
COPY backend/Dockerfile /app/backend/Dockerfile
COPY backend/tests /app/backend/tests
COPY scripts /app/scripts
COPY frontend /app/frontend
COPY docs /app/docs
COPY .specs /app/.specs
COPY README.md /app/README.md
CMD ["python", "-m", "pytest", "backend/tests", "-q"]
