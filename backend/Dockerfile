# Build from repository root: docker build -f backend/Dockerfile --target verification .
FROM python:3.12-slim AS dependencies
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock /app/backend/
COPY backend/citride /app/backend/citride
COPY data /app/data
COPY backend/scripts/harden_ca.py /app/backend/scripts/harden_ca.py
RUN CITRIDE_CONTAINER_CA_BUILD=1 python /app/backend/scripts/harden_ca.py bootstrap
RUN pip --disable-pip-version-check install --no-cache-dir --only-binary=:all: --upgrade pip==26.2.2 \
    && CITRIDE_CONTAINER_CA_BUILD=1 python /app/backend/scripts/harden_ca.py verify \
    && pip --disable-pip-version-check install --no-cache-dir --only-binary=:all: uv==0.13.4 \
    && uv sync --locked --no-dev --project /app/backend
ENV PYTHONPATH=/app/backend
ENV PATH="/app/backend/.venv/bin:${PATH}"
RUN groupadd --gid 10001 citride \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin citride \
    && mkdir -p /app/.local \
    && chown 10001:10001 /app/.local

FROM dependencies AS runtime
# The application must enforce this flag before network-exposed use.
ENV CITRIDE_REQUIRE_AUTH=1
# Source and dependencies remain root-owned; only default local state is writable.
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "citride.api:app", "--host", "0.0.0.0", "--port", "8000"]

FROM dependencies AS verification
# The declared dev group includes image-composition and browser-test libraries.
RUN uv sync --locked --project /app/backend
COPY backend/Dockerfile /app/backend/Dockerfile
COPY backend/tests /app/backend/tests
COPY backend/scripts /app/backend/scripts
COPY scripts /app/scripts
COPY frontend /app/frontend
COPY docs /app/docs
COPY .specs /app/.specs
COPY .github/workflows/ci.yml /app/.github/workflows/ci.yml
COPY README.md /app/README.md
COPY vercel.json /app/vercel.json
USER 10001:10001
CMD ["python", "-m", "pytest", "backend/tests", "-q"]
