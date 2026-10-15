import type { Event } from "./types.ts";
export const pcapEvent: Event = {
  id: "capture:corelight-waterutil-v2",
  type: "PacketCaptureInvestigation",
  label: "Corelight capture — water-sector network observations",
  description:
    "Offline packet review. No VPN login, dosing change or physical outage established.",
};
export interface PcapEvidence {
  version: string;
  source: {
    id: string;
    filename: string;
    sha256: string;
    delivery: string;
    method: string;
  };
  capture: {
    packet_count: number;
    first_packet_utc: string;
    last_packet_utc: string;
    duration_seconds: string;
  };
  tcpFlowCount: number;
  httpRequestCount: number;
  tlsSniCount: number;
  observations: {
    id: string;
    packet: number;
    timeUtc: string;
    kind: string;
    source: string;
    destination: string;
    summary: string;
    detail: string;
    boundary: string;
  }[];
  facts: string[];
  notEstablished: string[];
  redactions: string[];
  tasks: { label: string; acceptance: string }[];
}
export function parsePcapEvidence(value: unknown): PcapEvidence | null {
  if (!value || typeof value !== "object") return null;
  const r = value as PcapEvidence;
  if (
    r.version !== "corelight-waterutil-pcap-review-v1" ||
    r.source?.sha256 !==
      "fc7211eb3d6c9e87267e79fd52d157bc003b3d44e9a95cd1f7e32c7d47537e45" ||
    r.capture?.packet_count !== 904 ||
    !Array.isArray(r.observations) ||
    !r.observations.every(
      (o) =>
        Number.isInteger(o.packet) &&
        o.packet > 0 &&
        o.packet <= 904 &&
        [
          o.id,
          o.timeUtc,
          o.kind,
          o.source,
          o.destination,
          o.summary,
          o.detail,
          o.boundary,
        ].every((v) => typeof v === "string"),
    ) ||
    ![r.facts, r.notEstablished, r.redactions].every(
      (v) => Array.isArray(v) && v.every((s) => typeof s === "string"),
    )
  )
    return null;
  return r;
}
export function pcapFromEvent(event: Event | null | undefined) {
  return event?.id === pcapEvent.id && event.type === pcapEvent.type
    ? parsePcapEvidence(event.pcapEvidence)
    : null;
}
