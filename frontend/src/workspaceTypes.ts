import type { Bootstrap, RunSummary } from "./types";
import type { CommandIncident } from "./commandTypes";
import type { RecordsState, ReferenceData } from "./scriptedTypes";

/** One authenticated, coherent read of the durable workspace; never persisted in JS storage. */
export interface WorkspaceSnapshot {
  bootstrap: Bootstrap;
  runs: RunSummary[];
  incidents: CommandIncident[];
  records: RecordsState;
  reference: ReferenceData;
  health: {
    status: string;
    baselineRevision: number;
    demoMode: boolean;
    resetEnabled?: boolean;
    now?: string;
  };
}
