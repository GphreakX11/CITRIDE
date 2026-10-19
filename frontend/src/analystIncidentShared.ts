import type { Bootstrap } from './types.ts';
import type { CommandIncident } from './commandTypes.ts';
import type { RecordItem } from './scriptedTypes.ts';
import { defaultIncidentId, openIncidentChoices, type IncidentSelectionRecords } from './incidentSelection.ts';
import { readIncidentFocus } from './incidentFocus.ts';
import { consequenceSelectionLocation } from './consequenceSelection.ts';
import { activeCaseForIncident, caseMatchesIncident, openCasesForIncident } from './caseIncidentSelection.ts';

export interface AnalystIncidentSelection {
  selectedIncidentId: string | null;
  selectedIncident: RecordItem | null;
  /** Authenticated API register, not case-derived or a static fixture inventory. */
  openIncidents: RecordItem[];
  matchingOpenCases: CommandIncident[];
  /** Can be explicit matching closed history; fallback is always OPEN. */
  activeCase: CommandIncident | null;
}

/** Pure public selection contract. The API is responsible for customer isolation. */
export function resolveAnalystIncidentSelection(
  records: IncidentSelectionRecords,
  cases: readonly CommandIncident[],
  data: Bootstrap,
  input: string,
): AnalystIncidentSelection {
  const openIncidents = openIncidentChoices(records.statewideIncidents, data).filter(row => !row.referenceOnly);
  const requested = readIncidentFocus(input);
  const caseId = new URL(input, 'https://prototype.invalid').searchParams.get('case');
  const saved = cases.find(item => item.id === caseId);
  const selectedIncident = openIncidents.find(row => row.id === requested)
    ?? (saved && openIncidents.find(row => caseMatchesIncident(row, saved)))
    ?? openIncidents.find(row => row.id === defaultIncidentId(
      { ...records, statewideIncidents: openIncidents }, { data, url: '/' },
    )) ?? null;
  return {
    selectedIncidentId: selectedIncident?.id ?? null,
    selectedIncident,
    openIncidents,
    matchingOpenCases: selectedIncident ? openCasesForIncident(selectedIncident, cases) : [],
    activeCase: selectedIncident ? activeCaseForIncident(selectedIncident, cases, caseId) : null,
  };
}

/** Atomic incident+case change using the same URL contract as Command C2/C4.
 * Invalid/foreign IDs are a no-op. History is written by the owning App callback.
 */
export function analystIncidentSelectionLocation(
  input: string,
  incidentId: string,
  records: IncidentSelectionRecords,
  cases: readonly CommandIncident[],
  data: Bootstrap,
): string {
  const row = openIncidentChoices(records.statewideIncidents, data).find(item => item.id === incidentId && !item.referenceOnly);
  if (!row) return input;
  const previous = new URL(input, 'https://prototype.invalid');
  const selectedCase = activeCaseForIncident(row, cases, previous.searchParams.get('case'));
  const next = new URL(consequenceSelectionLocation(input, { incidentId }), 'https://prototype.invalid');
  if (selectedCase) next.searchParams.set('case', selectedCase.id);
  else next.searchParams.delete('case');
  return `${next.pathname}${next.search}${next.hash}`;
}
