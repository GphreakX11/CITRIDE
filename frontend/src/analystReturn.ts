import { commandNavigation, analystNavigation, type CommandView } from './commandTypes.ts';
import type { WorkspaceMode } from './navigation.ts';
/** Keep a reloadable, allowlisted source screen; never an external return URL. */
export function analystSourceLocation(input:string,mode:WorkspaceMode,view:string):string {
 const url=new URL(input,'http://prototype.local');
 if(mode==='command'){url.searchParams.set('returnMode',mode);url.searchParams.set('returnView',view)}
 return `${url.pathname}${url.search}${url.hash}`;
}
export function analystReturnTarget(input:string):{mode:WorkspaceMode;view:CommandView}|null {
 const url=new URL(input,'http://prototype.local'),mode=url.searchParams.get('returnMode'),view=url.searchParams.get('returnView');
 if(mode!=='command'&&mode!=='analyst')return null;
 const allowed=mode==='command'?commandNavigation:analystNavigation;
 return allowed.some(item=>item.id===view)?{mode,view:view as CommandView}:null;
}
