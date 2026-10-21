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

# certifi is a locked development dependency, not part of the no-dev runtime.
# Obtain and validate its bundle only in an intermediate build stage.
FROM dependencies AS frontend-ca
RUN uv sync --locked --project /app/backend
RUN python /app/backend/scripts/harden_ca.py certifi-path

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend
# Use the backend's reviewed CA bundle; do not fall back to Node's bundled roots.
COPY --from=frontend-ca /app/backend/.venv/lib/python3.12/site-packages/certifi/cacert.pem /app/npm-ca.pem
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --strict-ssl=true --cafile /app/npm-ca.pem
# TypeScript imports the same display catalog used by the backend.
COPY --from=dependencies /app/data /app/data
COPY frontend/ ./
RUN npm run build

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

# Keep the runnable product last: plain docker build must not produce a test runner.
FROM dependencies AS runtime
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
# The application must enforce this flag before network-exposed use.
ENV CITRIDE_REQUIRE_AUTH=1
# Source and dependencies remain root-owned; only default local state is writable.
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "citride.api:app", "--host", "0.0.0.0", "--port", "8000"]
