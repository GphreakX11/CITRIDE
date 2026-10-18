import type { Event, Telemetry } from "./types.ts";
import { formatTime, displayTimeZone } from "./displayTime.ts";
type Row = Record<string, unknown>;
type Stream = Pick<Telemetry["streams"][number], "id"> &
  Partial<Telemetry["streams"][number]>;
export const networkStreams = [
  ...["conn", "ssl", "http", "dns", "modbus", "modbus_detailed", "notice"].map(
    (id) => ({ id: `corelight/${id}`, label: id }),
  ),
  { id: "corelight/vpn", label: "VPN" },
  { id: "controller", label: "Controller audit" },
  { id: "sensors", label: "Sensors" },
  { id: "enterprise", label: "Enterprise" },
];
const endpoints = ["id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p"];
const standard: Record<string, string[]> = {
  conn: [
    "ts",
    "uid",
    ...endpoints,
    "proto",
    "service",
    "duration",
    "orig_bytes",
    "resp_bytes",
    "conn_state",
    "local_orig",
    "local_resp",
    "missed_bytes",
    "history",
    "orig_pkts",
    "orig_ip_bytes",
    "resp_pkts",
    "resp_ip_bytes",
    "tunnel_parents",
    "community_id",
  ],
  ssl: [
    "ts",
    "uid",
    ...endpoints,
    "version",
    "cipher",
    "server_name",
    "established",
    "ja3",
    "ja3s",
  ],
  http: [
    "ts",
    "uid",
    ...endpoints,
    "trans_depth",
    "method",
    "host",
    "uri",
    "user_agent",
    "request_body_len",
    "response_body_len",
    "status_code",
    "status_msg",
  ],
  dns: [
    "ts",
    "uid",
    ...endpoints,
    "proto",
    "query",
    "qtype_name",
    "rcode_name",
    "answers",
    "TTLs",
  ],
  modbus: [
    "ts",
    "uid",
    ...endpoints,
    "unit_id",
    "func",
    "pdu_type",
    "exception",
  ],
  modbus_detailed: [
    "ts",
    "uid",
    ...endpoints,
    "unit_id",
    "func",
    "request_response",
    "address",
    "quantity",
    "values",
  ],
  notice: [
    "ts",
    "uid",
    ...endpoints,
    "note",
    "msg",
    "sub",
    "src",
    "dst",
    "p",
    "actions",
    "suppress_for",
  ],
};
const metadata = [
  "id",
  "timestamp",
  "relativeTimeHours",
  "utilityId",
  "targetAssetId",
  "observation",
  "anomalous",
  "interpretation",
  "origin",
  "sourceRefs",
  "classification",
  "handling",
  "sharedSourceIdentity",
  "previousValues",
];
export function orderedFields(stream: Stream): string[] {
  const keys = [...new Set((stream.records ?? []).flatMap(Object.keys))];
  const first = standard[stream.id.split("/").at(-1)!] ?? ["ts", "timestamp"];
  return [
    ...first.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !first.includes(key) && !metadata.includes(key)),
    ...metadata.filter((key) => keys.includes(key) && !first.includes(key)),
  ];
}
export function evidenceRefs(
  event: Event,
): { streamId: string; recordId: string }[] {
  const refs = [
    event.rawRef,
    ...(Array.isArray(event.networkEvidenceRefs)
      ? event.networkEvidenceRefs
      : []),
  ];
  return refs.filter(
    (ref): ref is { streamId: string; recordId: string } =>
      !!ref &&
      typeof ref === "object" &&
      typeof (ref as Row).streamId === "string" &&
      typeof (ref as Row).recordId === "string",
  );
}
export function visibleRecords(
  stream: Stream,
  events: Event[],
  limit = 200,
  selectedRecordId?: string | null,
) {
  const ids = new Set(
    events
      .flatMap(evidenceRefs)
      .filter((ref) => ref.streamId === stream.id)
      .map((ref) => ref.recordId),
  );
  const rows = (stream.records ?? []).map((record, index) => ({
    record,
    index,
    linked: typeof record.id === "string" && ids.has(record.id),
    selected: typeof record.id === "string" && record.id === selectedRecordId,
  }));
  // Include every linked or selected record, even when that set exceeds the cap.
  return rows
    .sort(
      (a, b) =>
        Number(b.selected) - Number(a.selected) ||
        Number(b.linked) - Number(a.linked) ||
        a.index - b.index,
    )
    .slice(
      0,
      Math.max(limit, rows.filter((row) => row.linked || row.selected).length),
    );
}
export function networkSource(stream: Stream, record?: Row): string {
  const simulated =
    record?.origin === "simulated" ||
    (Array.isArray(record?.handling) && record.handling.includes("SIMULATED"));
  const label =
    stream.id === "corelight/vpn"
      ? "VPN log"
      : stream.id.startsWith("corelight/")
        ? "Network · Corelight format"
        : stream.id === "controller"
          ? "Controller audit"
          : stream.id === "sensors"
            ? "Sensor data"
            : "Enterprise log";
  // Never inherit stream-level simulated provenance for metadata-free exports.
  return `${label}${simulated ? " (simulated)" : " · provenance unknown"}`;
}
/** Compact repeated table copy, preserving the original record's provenance. */
export function compactNetworkSource(stream: Stream, record: Row): string {
  return networkSource(stream, record).replace(
    "Network · Corelight format",
    "Network",
  );
}
export function streamSourceLabel(stream: Stream): string {
  const labels = [
    ...new Set(
      (stream.records ?? []).map((record) => networkSource(stream, record)),
    ),
  ];
  return labels.length === 1
    ? labels[0]!
    : labels.length
      ? "Mixed record provenance"
      : networkSource(stream);
}
function dateOf(value: unknown): Date | null {
  const date =
    typeof value === "number"
      ? new Date(value * 1000)
      : typeof value === "string"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
export function evidenceTime(value: unknown): string {
  const date = dateOf(value);
  return formatTime(date, undefined, "Time unknown");
}
export function jsonlExport(stream: Stream) {
  return {
    filename: `${stream.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-complete.jsonl`,
    contents:
      (stream.records ?? []).map((row) => JSON.stringify(row)).join("\n") +
      ((stream.records?.length ?? 0) ? "\n" : ""),
  };
}
export type Hunt = "shared-source" | "vendor-account" | "off-hours";
export function huntEvidence(
  telemetry: Telemetry | null | undefined,
  hunt: Hunt,
) {
  const all = (telemetry?.streams ?? []).flatMap((stream) =>
    stream.records.map((record) => ({ stream, record })),
  );
  const sourceFields = [
    "id.orig_h",
    "sourceIp",
    "source_ip",
    "src_ip",
    "remote_ip",
    "src",
    "sharedSourceIdentity",
  ];
  const shared = (record: Row) =>
    sourceFields.some((key) => record[key] === "203.0.113.250");
  const vendor = (record: Row) =>
    ["user", "username", "account", "user_name", "vendorAccount"].some(
      (key) => record[key] === "vendor-v-support",
    );
  const pool = new Set(
    all
      .filter(
        ({ stream, record }) => stream.id === "corelight/vpn" && shared(record),
      )
      .flatMap(({ record }) => [
        record.assignedIp,
        record.assigned_ip,
        record.client_ip,
        record.clientIp,
        record.tunnel_ip,
      ])
      .filter((value): value is string => typeof value === "string"),
  );
  const attacker = (record: Row) =>
    shared(record) ||
    ["id.orig_h", "sourceIp", "source_ip"].some((key) =>
      pool.has(String(record[key])),
    );
  const results = all.filter(({ record }) => {
    if (hunt === "shared-source") return attacker(record);
    if (hunt === "vendor-account") return vendor(record);
    if (!attacker(record) && !vendor(record)) return false;
    const date = dateOf(record.ts ?? record.timestamp);
    if (!date) return false;
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: displayTimeZone(),
        hour: "2-digit",
        hourCycle: "h23",
      }).format(date),
    );
    return hour < 6 || hour >= 20;
  });
  const utilities = [
    ...new Set(
      results
        .map(({ record }) => record.utilityId)
        .filter((value): value is string => typeof value === "string"),
    ),
  ]
    .sort()
    .map((utilityId) => {
      const connections = all.filter(
        ({ stream, record }) =>
          stream.id === "corelight/conn" &&
          record.utilityId === utilityId &&
          attacker(record),
      );
      return {
        utilityId,
        completed: connections.filter(
          ({ record }) => record.conn_state === "SF",
        ).length,
        probes: connections.filter(({ record }) =>
          ["S0", "REJ"].includes(String(record.conn_state)),
        ).length,
      };
    });
  return { results, utilities };
}
export function eventSourceChips(event: Event): string[] {
  const streams = evidenceRefs(event).map((ref) => ref.streamId);
  const sources = event.sourceRefs ?? [];
  return [
    ...new Set([
      ...(streams.includes("corelight/vpn") || sources.includes("src-vpn")
        ? ["VPN log"]
        : []),
      ...(streams.includes("controller") || sources.includes("src-controller")
        ? ["Controller audit"]
        : []),
      ...(streams.some(
        (id) => id.startsWith("corelight/") && id !== "corelight/vpn",
      ) || sources.includes("src-network")
        ? [
            event.origin === "simulated" ||
            event.evidenceCategory === "simulated" ||
            (Array.isArray(event.handling) &&
              event.handling.includes("SIMULATED"))
              ? "Network (Corelight format, simulated)"
              : "Network (Corelight format, provenance unknown)",
          ]
        : []),
      ...(streams.includes("sensors") || sources.includes("src-sensors")
        ? ["Sensor data"]
        : []),
    ]),
  ];
}
