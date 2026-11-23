import { createHash } from 'node:crypto';
import type { Principal } from '../identity';
import type { MatchRecord } from '../gameplay/types';
import { projectMatch } from '../gameplay/projection';
import { deny } from '../history-rematch/core';
import { authenticate, advance, issue, compareAnchor, type Keyring } from '../history-rematch/cursor';
import { parseQuery, projectMetadata, type HistoryRow } from '../history-rematch/dto';
import { parseOriginalResult, type OriginalResult } from '../history-rematch/result';
import { assertLocalDevelopment, LOCAL_PROJECT } from './guard';
import type { RoundGame } from '../rounds/types';
import type { CompetitionGame } from '../rounds/competition-types';
import { currentEngineResult } from '../rounds/competition-results';

export type LocalHistoryEntry={row:HistoryRow;result:OriginalResult|null};
export type LocalHistoryProvider=(p:Principal)=>Promise<LocalHistoryEntry[]>;
export function roundHistoryEntry(game:(RoundGame|CompetitionGame)&{localCreatedAt:number;localFinishedAt:number|null},competitive:boolean):LocalHistoryEntry {
 const format=game.request.executionFormat,mode=format==='STANDALONE_LIST'?'LIST':format==='STANDALONE_ACTING'?'ACTING':'CLASSIC';
 const retainedRulesProfile=competitive?'enta-competitive-1':'enta-format-1',protocol=competitive?5:4;
 const terminal=competitive?currentEngineResult(game as CompetitionGame)?.payload:null;
 const max=Math.max(...game.teams.map(t=>t.score)),winnerIds=competitive?(terminal?.winnerParticipantIds??[]):game.teams.filter(t=>t.score===max).map(t=>t.id);
 const summary=game.finished?{reason:game.resultReason!,unplayedCount:terminal?.unplayedCount??(game as RoundGame).rounds.filter(r=>r.state!=='RESOLVED').length,isTie:competitive?terminal?.outcome==='UNRESOLVED_TIE':winnerIds.length>1}:null;
 const row:HistoryRow={id:game.id,admissionProtocol:protocol,mode,executionFormat:format,retainedRulesProfile,status:game.finished?'FINISHED':'ACTIVE',createdAt:new Date(game.localCreatedAt).toISOString(),finishedAt:game.finished?new Date(game.localFinishedAt!).toISOString():null,teams:game.teams.map(t=>({name:t.name,score:t.score})),summary,route:competitive?'COMPETITIVE':'ROUND'};
 return {row,result:summary?parseOriginalResult({schemaVersion:1,id:row.id,physicalProtocol:protocol,mode,executionFormat:format,retainedRulesProfile,...summary,teams:game.teams.map(t=>({name:t.name,score:t.score,winner:winnerIds.includes(t.id)}))},row.id):null};
}
export function legacyHistoryEntry(game:MatchRecord):LocalHistoryEntry {
 const projection=projectMatch(game,Date.now()), result=projection.result;
 const row:HistoryRow={id:game.id,admissionProtocol:3,mode:game.mode??'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:game.mode==='KIDS'?'enta-kids-3':'enta-classic-3',status:result?'FINISHED':'ACTIVE',createdAt:game.createdAt!,finishedAt:result?game.finishedAt!:null,teams:game.teams.map(t=>({name:t.name,score:t.score})),summary:result?{reason:result.reason,unplayedCount:result.unplayedCount,isTie:result.isTie}:null,route:'LEGACY'};
 return {row,result:result?parseOriginalResult({schemaVersion:1,id:row.id,physicalProtocol:3,mode:row.mode,executionFormat:row.executionFormat,retainedRulesProfile:row.retainedRulesProfile,...row.summary,teams:game.teams.map(t=>({name:t.name,score:t.score,winner:result.winnerTeamIds.includes(t.id)}))},row.id):null};
}
/** Local metadata only. Cursor MACs bind owner, filters and page boundaries. */
export function createLocalHistory(providers:LocalHistoryProvider[],keyBytes?:Buffer) {
 const bytes=keyBytes??createHash('sha256').update('almaidan-local-history\0').update(assertLocalDevelopment()).digest();
 const ring:Keyring={active:'local1',keys:new Map([['local1',{bytes,issueUntil:8_000_000_000_000,verifyUntil:8_000_001_000_000}]])};
 function verified(p:Principal){if(p.projectId!==LOCAL_PROJECT||!p.verifiedAccount||p.anonymous||!p.uid)deny('HISTORY_UNAVAILABLE',403);}
 async function entries(p:Principal){verified(p);const rows=(await Promise.all(providers.map(provider=>provider(p)))).flat().map(entry=>{const {route,...metadata}=entry.row;return {...entry,row:projectMetadata(metadata)};});if(new Set(rows.map(e=>e.row.id)).size!==rows.length)deny('HISTORY_DATA_UNAVAILABLE',503);return rows;}
 return {
  async page(p:Principal,input:Record<string,unknown>){
   verified(p);const query=parseQuery(input);if(query.limit!==25)deny('INVALID_HISTORY_QUERY');
   const context={uid:p.uid,projectId:p.projectId,namespaceId:'almaidan-local'},now=Date.now(),f=query.filters;
   const cursor=query.cursor?authenticate(query.cursor,context,ring,now,f,25):null;
   const all=(await entries(p)).map(e=>e.row).sort((a,b)=>-compareAnchor(a,b));
   if(cursor&&(!all.some(r=>compareAnchor(r,cursor.upper)===0)||!all.some(r=>compareAnchor(r,cursor.before)===0)))deny('INVALID_CURSOR');
   const selected=all.filter(r=>(!f.mode||r.mode===f.mode)&&(!f.format||r.executionFormat===f.format)&&(!f.rules||r.retainedRulesProfile===f.rules)&&(!f.status||r.status===f.status)&&(!cursor||(compareAnchor(r,cursor.upper)<=0&&compareAnchor(r,cursor.before)<0)));
   const matches=selected.slice(0,25),last=matches.at(-1),upper=cursor?.upper??selected[0];
   const before=last?{id:last.id,createdAt:last.createdAt}:null,first=upper?{id:upper.id,createdAt:upper.createdAt}:null;
   const nextCursor=selected.length>25&&before&&first?(cursor?advance(cursor,before,context,ring,Date.now()):issue(context,ring,Date.now(),f,25,first,before)):null;
   return {registryVersion:1 as const,queryVersion:2 as const,matches,nextCursor};
  },
  async original(p:Principal,id:string){const entry=(await entries(p)).find(e=>e.row.id===id);if(!entry?.result)return deny('RESULT_UNAVAILABLE',404);return parseOriginalResult(entry.result,id);},
 };
}
