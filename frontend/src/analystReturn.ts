import { commandNavigation, analystNavigation, type CommandView } from './commandTypes.ts';
import type { WorkspaceMode } from './navigation.ts';

/** Only same-screen, allowlisted Analyst sources may be restored after reload. */
export function analystProfileReturnLocation(input: string): string | null {
 const url = new URL(input, 'http://prototype.local');
 const source = url.searchParams.get('profileReturn');
 if (!source) return null;
 try {
  const target = new URL(source, url);
  const view = target.searchParams.get('view');
  if (target.origin !== url.origin || target.pathname !== url.pathname ||
      target.searchParams.get('mode') !== 'analyst' ||
      !(view === 'case-file' || analystNavigation.some(item => item.id === view))) return null;
  return `${target.pathname}${target.search}${target.hash}`;
 } catch { return null; }
}

/** Preserve Command provenance separately from the immediate Analyst profile source. */
export function analystSourceLocation(input: string, mode: WorkspaceMode, view: string, profile = false): string {
 const url = new URL(input, 'http://prototype.local');
 if (mode === 'command') {
  url.searchParams.delete('profileReturn');
  url.searchParams.set('returnMode', mode);
  url.searchParams.set('returnView', view);
 } else if (profile && view !== 'entity-profile' &&
            (view === 'case-file' || analystNavigation.some(item => item.id === view))) {
  const source = new URL(url);
  source.searchParams.delete('profileReturn');
  url.searchParams.set('profileReturn', `${source.pathname}${source.search}${source.hash}`);
 }
 return `${url.pathname}${url.search}${url.hash}`;
}
export function analystReturnTarget(input: string): { mode: WorkspaceMode; view: CommandView } | null {
 const immediate = analystProfileReturnLocation(input);
 const url = new URL(immediate ?? input, 'http://prototype.local');
 const mode = url.searchParams.get(immediate ? 'mode' : 'returnMode');
 const view = url.searchParams.get(immediate ? 'view' : 'returnView');
 if (mode !== 'command' && mode !== 'analyst') return null;
 const allowed = mode === 'command' ? commandNavigation : analystNavigation;
 return (mode === 'analyst' && view === 'case-file') || allowed.some(item => item.id === view)
  ? { mode, view: view as CommandView } : null;
}
