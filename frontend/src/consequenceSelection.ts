import { useEffect, useState } from 'react';
import { identifier } from './prototypeLocation.ts';
export interface ConsequenceSelection { incidentId: string | null; sector: string; entityId: string | null }
export function readConsequenceSelection(input: string): ConsequenceSelection {
  const q = new URL(input || '/', 'https://prototype.invalid').searchParams;
  return { incidentId: identifier(q.get('incidentId')) ?? identifier(q.get('incident')), sector: q.get('sector')?.trim().toLowerCase() || 'all', entityId: identifier(q.get('entity')) };
}
/** Partial update, preserving screen/case/hash. A new incident cannot inherit stale filters. */
export function consequenceSelectionLocation(input: string, patch: Partial<ConsequenceSelection>): string {
  const url = new URL(input || '/', 'https://prototype.invalid');
  const old = readConsequenceSelection(input);
  const changed = patch.incidentId !== undefined && patch.incidentId !== old.incidentId;
  const next = { ...old, ...(changed ? {sector:'all',entityId:null} : {}), ...patch };
  for (const key of ['incident', 'incidentId']) { if(next.incidentId) url.searchParams.set(key,next.incidentId); else url.searchParams.delete(key); }
  if(next.sector && next.sector.toLowerCase() !== 'all') url.searchParams.set('sector',next.sector.toLowerCase()); else url.searchParams.delete('sector');
  if(next.entityId) url.searchParams.set('entity',next.entityId); else url.searchParams.delete('entity');
  return `${url.pathname}${url.search}${url.hash}`;
}
export function writeConsequenceSelection(patch: Partial<ConsequenceSelection>, replace = false) {
  if(typeof window === 'undefined') return;
  const next = consequenceSelectionLocation(window.location.href,patch);
  window.history[replace ? 'replaceState' : 'pushState'](null,'',next);
  window.dispatchEvent(new Event('consequence-selection'));
}
export function useConsequenceSelection() {
  const read = () => readConsequenceSelection(typeof window === 'undefined' ? '/' : window.location.href);
  const [selection,setSelection] = useState(read);
  useEffect(()=>{const sync=()=>setSelection(read());window.addEventListener('popstate',sync);window.addEventListener('consequence-selection',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('consequence-selection',sync);};},[]);
  return [selection,writeConsequenceSelection] as const;
}
