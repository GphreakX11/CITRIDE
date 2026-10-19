import type { Event } from './types.ts';
import type { RecordsState } from './scriptedTypes.ts';

type Timestamp = string | Date | null | undefined;

/** Persisted records.sampleDataAnchor, never records.now or the authored model epoch. */
export type SampleDataTiming = { sampleDataAnchor?: unknown } | RecordsState;

/** Shared cards/sorting clock. Sample offsets take precedence over stale authored
 * timestamps. Live feeds without an offset retain their aware source timestamp.
 * Missing/invalid anchors stay unavailable rather than inventing a wall time.
 */
export function resolveEventTimestamp(event: Event, timing: SampleDataTiming): string | undefined {
  if (typeof event.relativeTimeHours === 'number') {
    const anchor = typeof timing.sampleDataAnchor === 'string' ? timestampMillis(timing.sampleDataAnchor) : null;
    if (anchor === null || !Number.isFinite(event.relativeTimeHours)) return undefined;
    const time = anchor + event.relativeTimeHours * 3600000;
    const date = new Date(time);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  for (const direct of [event.timestamp, event.eventTime])
    if (direct && timestampMillis(direct) !== null) return direct;
  return undefined;
}

// Only the active customer's display preference is held here, never records or runs.
let operationsTimeZone: string | undefined;
export function configureDisplayTime(timeZone?: string) {
  operationsTimeZone = timeZone;
}
export function displayTimeZone() { return operationsTimeZone; }

function timestampMillis(value: Timestamp): number | null {
  // A timezone-free string depends on the viewer's machine. Do not invent one.
  if (typeof value === "string" && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))
    return null;
  const time =
    value instanceof Date ? value.getTime() : value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

/** UTC source timestamps are displayed in the configured zone (browser if unset). */
export function formatTime(value: Timestamp, timeZone = operationsTimeZone, unavailable = "—"): string {
  const time = timestampMillis(value);
  return time === null ? unavailable : new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).format(time);
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

/** Resolve record-relative due offsets from the persisted anchor before calling. */
export function formatDueTime(value: Timestamp, unavailable = "—", timeZone = operationsTimeZone): string {
  return `Due ${formatTime(value, timeZone, unavailable)}`;
}
