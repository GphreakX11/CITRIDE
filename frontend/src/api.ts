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

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
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
  return data as T;
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
