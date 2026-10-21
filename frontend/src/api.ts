export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly loginUsername: string | undefined;

  constructor(
    message: string,
    status: number,
    code?: string,
    loginUsername?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.loginUsername = loginUsername;
  }
}

// Deduplicate overlapping reads, not writes. Only deployment-bundled reference
// material gets a short document-local cache; cases, evidence and workspace
// snapshots always hit the server once a previous request has finished.
const referencePaths = new Set([
  "/v1/reference",
  "/v1/reference/idt",
  "/v1/ontology",
]);
const referenceTtlMs = 60_000;
const readCache = new Map<string, { expires: number; data: unknown }>();
const pendingReads = new Map<string, Promise<unknown>>();
let readEpoch = 0;

function invalidateReads() {
  ++readEpoch;
  readCache.clear();
  pendingReads.clear();
}

export async function api<T>(path: string, body?: unknown, options?: { readScope?: string }): Promise<T> {
  if (body !== undefined) {
    invalidateReads();
    try {
      return (await request(path, body)) as T;
    } finally {
      // Failed/uncertain writes need fresh reads too. Late pre-write responses
      // cannot populate a new epoch's cache or displace its in-flight request.
      invalidateReads();
    }
  }
  // A changed accepted snapshot must not join an obsolete same-path read.
  // Scope stays document-local: never add snapshot data to URLs or headers.
  const key = JSON.stringify([path, options?.readScope ?? null]);
  const cached = readCache.get(key);
  if (cached && cached.expires > Date.now())
    return structuredClone(cached.data) as T;
  readCache.delete(key);
  let pending = pendingReads.get(key);
  if (!pending) {
    const epoch = readEpoch;
    pending = request(path, undefined, options?.readScope !== undefined)
      .then((data) => {
        if (epoch === readEpoch && referencePaths.has(path))
          readCache.set(key, { expires: Date.now() + referenceTtlMs, data });
        return data;
      })
      .finally(() => {
        if (pendingReads.get(key) === pending) pendingReads.delete(key);
      });
    pendingReads.set(key, pending);
  }
  return structuredClone(await pending) as T;
}

async function request(path: string, body?: unknown, freshRead = false): Promise<unknown> {
  const response = await fetch(
    path,
    body === undefined
      ? freshRead ? { cache: "no-store" } : {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) invalidateReads();
    const metadata =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const detail =
      data && typeof data === "object" && "detail" in data
        ? data.detail
        : `Request failed (${response.status})`;
    throw new ApiError(
      typeof detail === "string" ? detail : JSON.stringify(detail),
      response.status,
      typeof metadata.code === "string"
        ? metadata.code
        : (response.headers.get("X-CITRIDE-Setup-Required") ?? undefined),
      typeof metadata.username === "string" ? metadata.username : undefined,
    );
  }
  return data;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

export function windowLabel(
  window: [number, number] | null | undefined,
): string {
  if (!window) return "Unknown";
  return window[0] === window[1]
    ? `${window[0]} h`
    : `${window[0]}–${window[1]} h`;
}

export function describe(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
