type Timestamp = string | Date | null | undefined;

const centralTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function timestampMillis(value: Timestamp): number | null {
  // A timezone-free string depends on the viewer's machine. Do not invent one.
  if (typeof value === "string" && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
    return null;
  const time =
    value instanceof Date ? value.getTime() : value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

/** Story timestamps always use Central time, regardless of the viewer's timezone. */
export function formatTimeCT(value: Timestamp, unavailable = "—"): string {
  const time = timestampMillis(value);
  return time === null ? unavailable : `${centralTime.format(time)} CT`;
}

/** A duration in source-record minutes, not a wall-clock timestamp. */
export function formatDuration(
  minutes: number | null | undefined,
  unavailable = "—",
): string {
  if (
    minutes === null ||
    minutes === undefined ||
    !Number.isFinite(minutes) ||
    minutes < 0
  )
    return unavailable;
  const total = Math.floor(minutes);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}h${remainder ? ` ${remainder}m` : ""}`
    : `${remainder}m`;
}

/** Both endpoints are required; never substitute the viewer's current time. */
export function formatElapsed(
  start: Timestamp,
  end: Timestamp,
  unavailable = "—",
): string {
  const from = timestampMillis(start);
  const to = timestampMillis(end);
  return from === null || to === null
    ? unavailable
    : formatDuration((to - from) / 60000, unavailable);
}

/** Resolve record-relative due offsets with the existing story clock before calling. */
export function formatDueTime(value: Timestamp, unavailable = "—"): string {
  return `Due ${formatTimeCT(value, unavailable)}`;
}
