import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Bootstrap, Event, Telemetry } from './types.ts';
import type { CommandIncident } from './commandTypes.ts';
import type { RecordsState, ReferenceData } from './scriptedTypes.ts';
import type { ConsequenceProjection } from './consequencesModel.ts';
import type { AnalystIncidentSelection } from './analystIncidentShared.ts';
import { api } from './api.ts';
import { resolveEventTimestamp } from './displayTime.ts';

/** Public A1–A6 / Case File / Entity Profile contract. No synthetic saved case.
 * selectedIncident is the register row; activeCase is durable casework, if any.
 * mainStore is the actual Bootstrap, never a case snapshot disguised as live data.
 */
export interface AnalystIncidentContextValue extends AnalystIncidentSelection {
  mainStore: Bootstrap;
  records: RecordsState;
  reference: ReferenceData | null;
  telemetry: Telemetry | null;
  cases: readonly CommandIncident[];
  selectIncident: (incidentId: string) => void;
  selectCase: (caseId: string | null) => void;
  locked: boolean;
  /** Read-only existing C2/C4 API envelope, with preliminary/reviewed analysis kind. */
  projection: ConsequenceProjection | null;
  projectionLoading: boolean;
  projectionError: string;
  /** Shared card/sort timestamp: persisted sample anchor, or live aware timestamp. */
  eventTimestamp: (event: Event) => string | undefined;
}

const AnalystIncidentContext = createContext<AnalystIncidentContextValue | null>(null);

/** Optional hook supports independently embedded legacy screens during migration. */
export function useAnalystIncident(): AnalystIncidentContextValue | null {
  return useContext(AnalystIncidentContext);
}

export interface AnalystIncidentProviderProps {
  selection: AnalystIncidentSelection;
  mainStore: Bootstrap;
  records: RecordsState | null;
  reference: ReferenceData | null;
  telemetry: Telemetry | null;
  cases: readonly CommandIncident[];
  selectIncident: (incidentId: string) => void;
  selectCase: (caseId: string | null) => void;
  locked: boolean;
  /** Disable read-only preview loading when the Analyst subtree is hidden. */
  enabled: boolean;
  children: ReactNode;
}

export function AnalystIncidentProvider({ selection, enabled, children, ...props }: AnalystIncidentProviderProps) {
  const incidentId = selection.selectedIncidentId;
  const [result, setResult] = useState<{ id: string; projection: ConsequenceProjection | null; error: string } | null>(null);
  useEffect(() => {
    let live = true;
    setResult(null);
    if (enabled && incidentId && props.records) {
      void api<ConsequenceProjection>(`/v1/command/consequences?incidentId=${encodeURIComponent(incidentId)}`)
        .then(projection => {
          if (!live) return;
          if (projection.incident?.id !== incidentId)
            throw new Error('Analysis incident did not match the selected incident.');
          setResult({ id: incidentId, projection, error: '' });
        })
        .catch(error => {
          if (live) setResult({ id: incidentId, projection: null, error: error instanceof Error ? error.message : String(error) });
        });
    }
    return () => { live = false; };
  }, [enabled, incidentId, props.records, props.mainStore.baselineRevision, selection.activeCase?.version, selection.activeCase?.id]);
  // Leave initial hydration and standalone legacy workspace rendering unblocked.
  if (!props.records) return children;
  const records = props.records;
  const current = enabled && result?.id === incidentId ? result : null;
  const value: AnalystIncidentContextValue = {
    ...props,
    records: props.records,
    ...selection,
    projection: current?.projection ?? null,
    projectionLoading: !!(enabled && incidentId && !current),
    projectionError: current?.error ?? '',
    eventTimestamp: event => resolveEventTimestamp(event, records),
  };
  return createElement(AnalystIncidentContext.Provider, { value }, children);
}
