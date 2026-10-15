import type { Event } from "./types.ts";

export const referenceSourceEvent: Event = {
  id: "reference:waterutil-fuel-v2",
  type: "ReferenceInvestigation",
  label: "Water utility / fuel terminal compromise · report reference",
};
export interface ReferenceInvestigation {
  id: string;
  schemaVersion: number;
  title: string;
  source: {
    id: string;
    filename: string;
    title: string;
    sha256: string;
    type: string;
    pcapFilename: string;
    pcapProvided: boolean;
    redactions: string[];
  };
  capture: {
    reportedPacketCount: number;
    reportedStart: string;
    reportedEnd: string;
    reportedSeed: number;
    verified: boolean;
  };
  attribution: string;
  summary: string;
  assets: {
    id: string;
    ip: string;
    hostname: string | null;
    role: string;
    scope: string;
    verification: string;
  }[];
  timeline: {
    id: string;
    phase: number;
    title: string;
    relativeWindow: string;
    reportedPackets: string;
    reportedSeconds: string;
    reportedFlow: string | null;
    summary: string;
    reportedActivities: string[][];
    verification: string;
    corroboration: string;
  }[];
  tasks: { label: string; acceptance: string }[];
  reviewLimits: string[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const text = (row: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => typeof row[key] === "string");

/** Reject malformed report shapes rather than projecting them into the live model. */
export function referenceFromEvent(
  event: Event | null | undefined,
): ReferenceInvestigation | null {
  if (
    event?.id !== referenceSourceEvent.id ||
    event.type !== referenceSourceEvent.type
  )
    return null;
  const value = event.referenceInvestigation;
  if (
    !object(value) ||
    value.id !== "waterutil-fuel-v2" ||
    value.schemaVersion !== 1 ||
    !text(value, ["title", "attribution", "summary"])
  )
    return null;
  const source = value.source,
    capture = value.capture;
  if (
    !object(source) ||
    !text(source, [
      "id",
      "filename",
      "title",
      "sha256",
      "type",
      "pcapFilename",
    ]) ||
    !/^[0-9a-f]{64}$/.test(String(source.sha256)) ||
    source.pcapProvided !== false ||
    !strings(source.redactions)
  )
    return null;
  if (
    !object(capture) ||
    !text(capture, ["reportedStart", "reportedEnd"]) ||
    !Number.isInteger(capture.reportedPacketCount) ||
    !Number.isInteger(capture.reportedSeed) ||
    capture.verified !== false
  )
    return null;
  if (
    !Array.isArray(value.assets) ||
    !value.assets.length ||
    !value.assets.every(
      (a) =>
        object(a) &&
        text(a, ["id", "ip", "role"]) &&
        (a.hostname === null || typeof a.hostname === "string") &&
        a.scope === "case_local_reference" &&
        a.verification === "report_only",
    )
  )
    return null;
  if (
    !Array.isArray(value.timeline) ||
    !value.timeline.length ||
    !value.timeline.every(
      (p) =>
        object(p) &&
        text(p, [
          "id",
          "title",
          "relativeWindow",
          "reportedPackets",
          "reportedSeconds",
          "summary",
          "corroboration",
        ]) &&
        Number.isInteger(p.phase) &&
        (p.reportedFlow === null || typeof p.reportedFlow === "string") &&
        Array.isArray(p.reportedActivities) &&
        p.reportedActivities.every(strings) &&
        p.verification === "report_only",
    )
  )
    return null;
  if (
    !Array.isArray(value.tasks) ||
    !value.tasks.length ||
    !value.tasks.every((t) => object(t) && text(t, ["label", "acceptance"])) ||
    !strings(value.reviewLimits)
  )
    return null;
  return value as unknown as ReferenceInvestigation;
}
