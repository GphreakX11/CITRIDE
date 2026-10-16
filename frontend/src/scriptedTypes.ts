import type { Bootstrap } from "./types.ts";
import type {
  CommandAction,
  CommandIncident,
  CommandView,
} from "./commandTypes.ts";
export interface People {
  onSite: number;
  remote: number;
  traveling: number;
  standby: number;
}
export interface Change {
  who: string;
  when: string;
  what: unknown;
  [key: string]: unknown;
}
export interface RecordItem {
  id: string;
  origin?: string;
  sourceRefs?: string[];
  classification?: string;
  handling?: string[];
  history?: Change[];
  incidentId?: string;
  caseId?: string;
  title?: string;
  name?: string;
  short?: string;
  unit?: string;
  label?: string;
  detail?: string;
  note?: string;
  status?: string;
  statusText?: string;
  severity?: string;
  summary?: string;
  incidentType?: string;
  sectors?: string[];
  location?: {
    label?: string;
    region?: string;
    schematic?: { x: number; y: number };
  };
  schematic?: { x: number; y: number };
  locationLabel?: string;
  nearEntityId?: string;
  people?: People;
  workingOn?: string;
  forensics?: string;
  lead?: string;
  updates?: {
    text: string;
    relativeTimeHours?: number;
    offsetMinutes?: number;
    at?: string;
  }[];
  partnerRole?: string;
  group?: string;
  entityId?: string;
  teamId?: string;
  ownerRole?: string;
  subject?: string;
  cluster?: string;
  actorLabel?: string;
  confidence?: string;
  byUnit?: string;
  indicators?: { type: string; value: string; label: string; status: string }[];
  query?: { kind: string; value: string; scope: string };
  number?: number;
  resultNote?: string;
  ownerTeamId?: string;
  optionId?: string;
  decision?: string;
  decidedBy?: string;
  recordedBy?: string;
  startedAt?: string;
  closedAt?: string;
  at?: string;
  dueAt?: string;
  doneAt?: string;
  etaAt?: string;
  late?: boolean;
  relativeTimeHours?: number;
  startedRelativeHours?: number;
  offsetMinutes?: number;
  dueOffsetMinutes?: number;
  doneOffsetMinutes?: number;
  linkedEventIds?: string[];
  modeled?: boolean;
  relatedNote?: string;
  reviews?: unknown;
  progress?: unknown;
  functionId?: string;
  low?: number;
  high?: number;
  text?: string;
  contactRole?: string;
  scope?: string;
  when?: Record<string, unknown>;
  triggers?: { eventObservations: string[]; impactFunctions: string[] };
  actor?: string;
  basisText?: string;
  citation?: string;
  verification?: string;
  [key: string]: unknown;
}
export interface RecordsState {
  statewideIncidents: RecordItem[];
  teams: RecordItem[];
  responseTasks: RecordItem[];
  contacts: RecordItem[];
  assessments: RecordItem[];
  assetStatuses: RecordItem[];
  hunts: RecordItem[];
  decisions: RecordItem[];
  partnerProducts: RecordItem[];
  storyNow: string;
  timing: Record<string, unknown>;
  taskGroups: RecordItem[];
  contactStatusLabels: Record<string, string>;
  huntStatusLabels: Record<string, string>;
  decisionLabels: Record<string, string>;
  teamStatusLabels?: Record<string, string>;
  taskStatusLabels?: Record<string, string>;
  assetStatusLabels?: Record<string, string>;
  [key: string]: unknown;
}
export interface ReferenceData {
  referenceVersion: string;
  sources: RecordItem[];
  responseOptions: RecordItem[];
  planningRates: RecordItem[];
  boilWaterRules: RecordItem[];
  firstActions: RecordItem[];
  optionTimingLabels: Record<string, string>;
  firstActionsLabel: string;
  responseClock: {
    startsAt: string;
    targetMinutes: number;
    amberMinutes: number;
    redMinutes: number;
    verification?: string;
    note?: string;
  };
  [key: string]: unknown;
}
export type RecordAction =
  | {
      action: "record_assessment";
      subject: string;
      cluster: string;
      actorLabel: string;
      confidence: string;
      note: string;
    }
  | {
      action: "set_asset_status";
      entityId: string;
      status: string;
      note: string;
    }
  | {
      action: "record_hunt";
      huntId: string;
      status: string;
      resultNote: string;
    }
  | {
      action: "set_contact_status";
      contactId: string;
      status: string;
      note: string;
    }
  | {
      action: "record_decision";
      optionId: string;
      decision: string;
      decidedBy: string;
      note: string;
    }
  | {
      action: "set_team_status";
      teamId: string;
      status: string;
      people: People;
      locationLabel: string;
      updateText: string;
    }
  | {
      action: "add_task";
      label: string;
      teamId: string;
      ownerRole: string;
      dueAt: string;
    }
  | { action: "set_task_status"; taskId: string; status: string };
export interface ScriptedViewProps {
  data: Bootstrap;
  incidents: CommandIncident[];
  selected: CommandIncident | null;
  view: CommandView;
  records: RecordsState;
  reference: ReferenceData;
}
export const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
export const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const list = (value: unknown): RecordItem[] =>
  Array.isArray(value)
    ? (value.filter(
        (item) =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      ) as RecordItem[])
    : [];
export type MutateRecord = (action: CommandAction) => Promise<unknown>;
