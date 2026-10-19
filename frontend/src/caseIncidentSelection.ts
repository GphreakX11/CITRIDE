import { consequenceSelectionLocation } from './consequenceSelection.ts';
/** Case selection owns its incident aliases; unrelated URL filters cannot win. */
export function caseSelectionLocation(input:string,record:{id:string;eventId:string}|null,records:readonly {id:string;caseId?:string;linkedEventIds?:string[]}[],entityId:string|null):string {
 const incident=record ? records.find(r=>r.caseId===record.id) ?? records.find(r=>r.linkedEventIds?.includes(record.eventId)) : null;
 const next=consequenceSelectionLocation(input,record ? {incidentId:incident?.id ?? null,sector:'all',entityId} : {entityId});
 const url=new URL(next,'https://prototype.invalid');
 if(record)url.searchParams.set('case',record.id);else url.searchParams.delete('case');
 return `${url.pathname}${url.search}${url.hash}`;
}
