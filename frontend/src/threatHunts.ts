import type { Telemetry } from "./types.ts";
import { displayTimeZone } from "./displayTime.ts";

type Row = Record<string, unknown>;
export type HuntScope = "watershed-250-utilities" | "all-monitored";
/** Matches stored records' strict query schema; never mix result counts into the query. */
export interface HuntQuery {
  kind: "source" | "account" | "off-hours";
  value: string;
  scope: HuntScope;
}
export interface HuntMatch {
  stream: Telemetry["streams"][number];
  record: Row;
}
export interface HuntResult {
  results: HuntMatch[];
  utilities: {
    utilityId: string;
    completed: number;
    probes: number;
    matches: number;
    verdict: "COMPROMISE" | "PROBING ONLY" | "NO FINDINGS";
  }[];
}
const sourceFields = [
  "id.orig_h",
  "sourceIp",
  "source_ip",
  "src_ip",
  "remote_ip",
  "src",
];
const accountFields = [
  "user",
  "username",
  "account",
  "user_name",
  "vendorAccount",
];
const assignedFields = [
  "assignedIp",
  "assigned_ip",
  "client_ip",
  "clientIp",
  "tunnel_ip",
];
const has = (r: Row, fields: string[], value: string) =>
  fields.some((key) => r[key] === value);
function supplied(
  telemetry: Telemetry | null | undefined,
  scope: HuntScope,
): HuntMatch[] {
  return (telemetry?.streams ?? [])
    .flatMap((stream) => stream.records.map((record) => ({ stream, record })))
    .filter(
      ({ record }) =>
        scope === "all-monitored" ||
        (typeof record.utilityId === "string" &&
          record.utilityId.startsWith("utility-")),
    );
}
function correlated(
  all: HuntMatch[],
  seeds: HuntMatch[],
  source?: string,
): HuntMatch[] {
  const identities = new Set(
    seeds
      .map(({ record }) => record.sharedSourceIdentity)
      .filter((v) => typeof v === "string" && v),
  );
  const sessions = new Set(
    seeds
      .flatMap(({ record }) => [record.uid, record.sessionId])
      .filter((v) => typeof v === "string" && v),
  );
  const pool = seeds
    .filter(({ stream }) => stream.id === "corelight/vpn")
    .flatMap(({ record }) =>
      assignedFields
        .filter((key) => typeof record[key] === "string")
        .map((key) => ({ address: record[key], utility: record.utilityId })),
    );
  return all.filter(
    (item) =>
      seeds.includes(item) ||
      (source && has(item.record, sourceFields, source)) ||
      (typeof item.record.sharedSourceIdentity === "string" &&
        identities.has(item.record.sharedSourceIdentity)) ||
      (typeof item.record.uid === "string" && sessions.has(item.record.uid)) ||
      pool.some(
        (p) =>
          (!p.utility || item.record.utilityId === p.utility) &&
          sourceFields.some((k) => item.record[k] === p.address),
      ),
  );
}
function summarize(all: HuntMatch[], matches: HuntMatch[]): HuntResult {
  const results = [...matches].sort(
    (a, b) => rowTime(a.record) - rowTime(b.record),
  );
  const utilities = [
    ...new Set(
      all
        .map(({ record }) => record.utilityId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ]
    .sort()
    .map((utilityId) => {
      const rows = results.filter(
        ({ record }) => record.utilityId === utilityId,
      );
      const conn = rows.filter(({ stream }) => stream.id === "corelight/conn");
      const completed = conn.filter(
        ({ record }) => record.conn_state === "SF",
      ).length;
      const probes = conn.filter(({ record }) =>
        ["S0", "REJ"].includes(String(record.conn_state)),
      ).length;
      return {
        utilityId,
        completed,
        probes,
        matches: rows.length,
        verdict: completed
          ? ("COMPROMISE" as const)
          : rows.length
            ? ("PROBING ONLY" as const)
            : ("NO FINDINGS" as const),
      };
    });
  return { results, utilities };
}
function rowTime(record: Row): number {
  return typeof record.ts === "number"
    ? record.ts * 1000
    : Date.parse(String(record.timestamp ?? record.ts ?? ""));
}
export function huntBySource(
  telemetry: Telemetry | null | undefined,
  source = "203.0.113.250",
  scope: HuntScope = "all-monitored",
): HuntResult {
  const all = supplied(telemetry, scope);
  return summarize(
    all,
    correlated(
      all,
      all.filter(
        ({ record }) =>
          has(record, sourceFields, source) ||
          record.sharedSourceIdentity === source,
      ),
      source,
    ),
  );
}
export function huntByAccount(
  telemetry: Telemetry | null | undefined,
  account = "vendor-v-support",
  scope: HuntScope = "watershed-250-utilities",
): HuntResult {
  const all = supplied(telemetry, scope);
  return summarize(
    all,
    correlated(
      all,
      all.filter(({ record }) => has(record, accountFields, account)),
    ),
  );
}
export function huntOffHours(
  telemetry: Telemetry | null | undefined,
  start = "00:00",
  end = "05:00",
  scope: HuntScope = "all-monitored",
): HuntResult {
  const all = supplied(telemetry, scope);
  const minutes = (time: string) =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
      ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
      : NaN;
  const lower = minutes(start),
    upper = minutes(end);
  const results = all.filter(({ stream, record }) => {
    const login =
      (stream.id === "corelight/vpn" &&
        String(record.action ?? record.eventType ?? "")
          .toLowerCase()
          .includes("login")) ||
      (stream.id === "controller" &&
        /authentication|login/i.test(
          String(record.eventType ?? record.action ?? ""),
        ));
    const time = rowTime(record);
    if (
      !login ||
      !Number.isFinite(time) ||
      !Number.isFinite(lower) ||
      !Number.isFinite(upper)
    )
      return false;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: displayTimeZone(),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(time));
    const value = minutes(parts);
    return lower <= upper
      ? value >= lower && value < upper
      : value >= lower || value < upper;
  });
  // Include only connection records of the matching login sessions for the verdict.
  const uids = new Set(
    results
      .flatMap(({ record }) => [record.uid, record.sessionId])
      .filter((v) => typeof v === "string"),
  );
  const connections = all.filter(
    ({ stream, record }) =>
      stream.id === "corelight/conn" &&
      typeof record.uid === "string" &&
      uids.has(record.uid),
  );
  return summarize(all, [...results, ...connections]);
}
export function runHunt(
  telemetry: Telemetry | null | undefined,
  query: HuntQuery,
): HuntResult {
  if (query.kind === "source")
    return huntBySource(telemetry, query.value, query.scope);
  if (query.kind === "account")
    return huntByAccount(telemetry, query.value, query.scope);
  const [start, end] = query.value.split(/[–—/]/);
  return huntOffHours(telemetry, start, end, query.scope);
}
