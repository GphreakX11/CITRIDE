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
    const detail =
      data && typeof data === "object" && "detail" in data
        ? data.detail
        : `Request failed (${response.status})`;
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail),
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
