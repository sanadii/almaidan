import { object, identifier, integer, text, deny, type Mode, type Format, type Profile } from './core';
import { anchor, compareAnchor, filters as parseFilters, type Filters, type Anchor } from './cursor';
export type Route = 'LEGACY' | 'ROUND' | 'COMPETITIVE';
export const tuples = Object.freeze([
 [2,'CLASSIC','TIER_BOARD','enta-classic-2','LEGACY'],
 [3,'CLASSIC','TIER_BOARD','enta-classic-3','LEGACY'],[3,'KIDS','TIER_BOARD','enta-kids-3','LEGACY'],
 [4,'CLASSIC','MIXED_BOARD','enta-format-1','ROUND'],[4,'LIST','STANDALONE_LIST','enta-format-1','ROUND'],[4,'ACTING','STANDALONE_ACTING','enta-format-1','ROUND'],
 [5,'CLASSIC','TIER_BOARD','enta-competitive-1','COMPETITIVE'],[5,'CLASSIC','MIXED_BOARD','enta-competitive-1','COMPETITIVE'],[5,'LIST','STANDALONE_LIST','enta-competitive-1','COMPETITIVE'],[5,'ACTING','STANDALONE_ACTING','enta-competitive-1','COMPETITIVE'],
] as const);
export interface HistoryRow { id:string;admissionProtocol:2|3|4|5;mode:Mode;executionFormat:Format;retainedRulesProfile:Profile;status:'ACTIVE'|'FINISHED';createdAt:string;finishedAt:string|null;teams:{name:string;score:number}[];summary:null|{reason:'ALL_QUESTIONS_PLAYED'|'ALL_ROUNDS'|'HOST_ENDED';unplayedCount:number;isTie:boolean};route:Route }
const fields=['id','admissionProtocol','mode','executionFormat','retainedRulesProfile','status','createdAt','finishedAt','teams','summary'] as const;
/** Pure metadata syntax/closed tuple checks are NOT ownership, UTC or installed integrity proof. */
export function projectMetadata(value:unknown):HistoryRow {
 try {
  const r=object(value,fields);identifier(r.id);anchor({createdAt:r.createdAt,id:r.id});
  const tuple=tuples.find(t=>t[0]===r.admissionProtocol&&t[1]===r.mode&&t[2]===r.executionFormat&&t[3]===r.retainedRulesProfile);
  if(!tuple||!['ACTIVE','FINISHED'].includes(r.status as string)||!Array.isArray(r.teams)||r.teams.length<2||r.teams.length>4)deny('HISTORY_DATA_UNAVAILABLE',503);
  const standalone=r.executionFormat==='STANDALONE_LIST'||r.executionFormat==='STANDALONE_ACTING';
  if((standalone||r.mode==='KIDS')&&r.teams.length!==2)deny('HISTORY_DATA_UNAVAILABLE',503);
  if(r.status==='ACTIVE'?(r.finishedAt!==null||r.summary!==null):(r.finishedAt===null||r.summary===null))deny('HISTORY_DATA_UNAVAILABLE',503);
  if(r.finishedAt!==null)anchor({createdAt:r.finishedAt,id:r.id}); // UTC does not imply finish>=creation.
  const teams=r.teams.map(v=>{const t=object(v,['name','score']);return{name:text(t.name,2,22),score:integer(t.score,-2147483648,2147483647)};});
  let summary:HistoryRow['summary']=null;
  if(r.summary!==null){const s=object(r.summary,['reason','unplayedCount','isTie']);const completed=tuple![0]<4?'ALL_QUESTIONS_PLAYED':'ALL_ROUNDS';if(![completed,'HOST_ENDED'].includes(s.reason as string)||typeof s.isTie!=='boolean')deny('HISTORY_DATA_UNAVAILABLE',503);summary={reason:s.reason as NonNullable<HistoryRow['summary']>['reason'],unplayedCount:integer(s.unplayedCount,0,standalone||r.mode==='KIDS'?tuple![0]===3?6:4:36),isTie:s.isTie as boolean};if((summary.reason===completed&&summary.unplayedCount!==0)||(summary.reason==='HOST_ENDED'&&(summary.unplayedCount===0||(tuple![0]===5&&summary.isTie))))deny('HISTORY_DATA_UNAVAILABLE',503);}
  return {id:r.id as string,admissionProtocol:tuple![0],mode:tuple![1],executionFormat:tuple![2],retainedRulesProfile:tuple![3],status:r.status as HistoryRow['status'],createdAt:r.createdAt as string,finishedAt:r.finishedAt as string|null,teams,summary,route:tuple![4]};
 }catch{return deny('HISTORY_DATA_UNAVAILABLE',503);}
}
export function parseRow(value:unknown):HistoryRow {
 try{const r=object(value,[...fields,'route']);const {route,...metadata}=r;const row=projectMetadata(metadata);if(route!==row.route)deny('HISTORY_DATA_UNAVAILABLE',503);return row;}catch{return deny('HISTORY_DATA_UNAVAILABLE',503);}
}
export function routePath(row:HistoryRow):string {
 const checked=parseRow(row),base=checked.route==='LEGACY'?'/enta/matches/':checked.route==='ROUND'?'/enta/round-matches/':'/enta/competitive/matches/';
 return base+checked.id+(checked.status==='FINISHED'?'/result':'');
}
export interface Query {filters:Filters;limit:number;cursor:string|null}
export function parseQuery(input:Record<string,unknown>):Query {
 try {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mode','format','rules','status','limit','cursor'].includes(k)))deny('INVALID_HISTORY_QUERY');
  const f=parseFilters({mode:input.mode??null,format:input.format??null,rules:input.rules??null,status:input.status??null});
  const limit=input.limit===undefined?25:typeof input.limit==='string'&&/^(?:[1-9]|[1-4][0-9]|50)$/.test(input.limit)?Number(input.limit):deny('INVALID_HISTORY_QUERY');
  const cursor=input.cursor===undefined?null:typeof input.cursor==='string'&&input.cursor.length<=1024&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(input.cursor)?input.cursor:deny('INVALID_HISTORY_QUERY');
  return{filters:f,limit,cursor};
 }catch{return deny('INVALID_HISTORY_QUERY');}
}
/** Bounds/fences only; no DB/anchor ownership or provenance authority is supplied by this function. */
export function projectPageRows(values:unknown[],f:Filters,limit:number,upper:Anchor|null,before:Anchor|null) {
 f=parseFilters(f);integer(limit,1,50);if(!Array.isArray(values)||values.length>limit+1)deny('HISTORY_DATA_UNAVAILABLE',503);
 if(upper)upper=anchor(upper);if(before)before=anchor(before);if((before&&!upper)||(upper&&before&&compareAnchor(before,upper)>0))deny('INVALID_CURSOR');
 const rows=values.map(projectMetadata);if(rows.length&&!upper)deny('HISTORY_DATA_UNAVAILABLE',503);
 let previous=before;
 for(const row of rows){const a={createdAt:row.createdAt,id:row.id};if((previous&&compareAnchor(a,previous)>=0)||(upper&&compareAnchor(a,upper)>0)||(f.mode!==null&&row.mode!==f.mode)||(f.format!==null&&row.executionFormat!==f.format)||(f.rules!==null&&row.retainedRulesProfile!==f.rules)||(f.status!==null&&row.status!==f.status))deny('HISTORY_DATA_UNAVAILABLE',503);previous=a;}
 const matches=rows.slice(0,limit);return{matches,hasMore:rows.length>limit,before:matches.length?{createdAt:matches.at(-1)!.createdAt,id:matches.at(-1)!.id}:null};
}

/** Public page syntax only; signature/authentication stays server-private. */
export function parsePage(value:unknown,limit=25,f:Filters={mode:null,format:null,rules:null,status:null}) {
 try{
  integer(limit,1,50);f=parseFilters(f);const p=object(value,['registryVersion','queryVersion','matches','nextCursor']);
  if(p.registryVersion!==1||p.queryVersion!==2||!Array.isArray(p.matches)||p.matches.length>limit)deny('HISTORY_DATA_UNAVAILABLE',503);
  const matches=p.matches.map(parseRow);let previous:Anchor|null=null;
  for(const row of matches){const a={createdAt:row.createdAt,id:row.id};if(previous&&compareAnchor(a,previous)>=0)deny('HISTORY_DATA_UNAVAILABLE',503);if((f.mode!==null&&row.mode!==f.mode)||(f.format!==null&&row.executionFormat!==f.format)||(f.rules!==null&&row.retainedRulesProfile!==f.rules)||(f.status!==null&&row.status!==f.status))deny('HISTORY_DATA_UNAVAILABLE',503);previous=a;}
  if(p.nextCursor!==null&&(typeof p.nextCursor!=='string'||p.nextCursor.length>1024||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(p.nextCursor)||matches.length!==limit))deny('HISTORY_DATA_UNAVAILABLE',503);
  return{registryVersion:1 as const,queryVersion:2 as const,matches,nextCursor:p.nextCursor as string|null};
 }catch{return deny('HISTORY_DATA_UNAVAILABLE',503);}
}
