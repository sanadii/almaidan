import { EntaClientError, type EntaMode, type HistoryProjection } from './client';
import { parseSuccessorSetup } from './pending-intent';
const id = /^[A-Za-z0-9_-]{1,128}$/;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function date(value: unknown): value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false; try { return new Date(value).toISOString() === value; } catch { return false; } }
const invalid = (): never => { throw new EntaClientError('MALFORMED_RESPONSE'); };
function validName(value:unknown):value is string {
 if(typeof value!=='string'||value.length<2||value.length>22||value.normalize('NFC').replace(/^ +| +$/g,'')!==value||/[<>\p{Cc}\p{Zl}\p{Zp}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/u.test(value))return false;
 for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c>=0xdc00&&c<=0xdfff)return false;if(c>=0xd800&&c<=0xdbff){const d=value.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))return false;}}return true;
}
const tuples = [
 [2,'CLASSIC','TIER_BOARD','enta-classic-2','LEGACY'],[3,'CLASSIC','TIER_BOARD','enta-classic-3','LEGACY'],[3,'KIDS','TIER_BOARD','enta-kids-3','LEGACY'],
 [4,'CLASSIC','MIXED_BOARD','enta-format-1','ROUND'],[4,'LIST','STANDALONE_LIST','enta-format-1','ROUND'],[4,'ACTING','STANDALONE_ACTING','enta-format-1','ROUND'],
 [5,'CLASSIC','TIER_BOARD','enta-competitive-1','COMPETITIVE'],[5,'CLASSIC','MIXED_BOARD','enta-competitive-1','COMPETITIVE'],[5,'LIST','STANDALONE_LIST','enta-competitive-1','COMPETITIVE'],[5,'ACTING','STANDALONE_ACTING','enta-competitive-1','COMPETITIVE'],
] as const;
export function parseHistory(value: unknown, filters: {mode?:string;format?:string;rules?:string;status?:string} = {}): HistoryProjection {
 if (!exact(value,['registryVersion','queryVersion','matches','nextCursor']) || value.registryVersion !== 1 || value.queryVersion !== 2 || !Array.isArray(value.matches) || value.matches.length > 25 || (value.nextCursor !== null && (value.matches.length !== 25 || typeof value.nextCursor !== 'string' || value.nextCursor.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.nextCursor)))) return invalid();
 const matches = value.matches.map(row => {
  if (!exact(row,['id','admissionProtocol','mode','executionFormat','retainedRulesProfile','status','createdAt','finishedAt','teams','summary','route']) || typeof row.id !== 'string' || !id.test(row.id) || !date(row.createdAt) || (row.finishedAt !== null && !date(row.finishedAt)) || !['ACTIVE','FINISHED'].includes(row.status as string) || !Array.isArray(row.teams) || row.teams.length < 2 || row.teams.length > 4) return invalid();
  const tuple=tuples.find(t=>t[0]===row.admissionProtocol&&t[1]===row.mode&&t[2]===row.executionFormat&&t[3]===row.retainedRulesProfile&&t[4]===row.route); if(!tuple) return invalid();
  if ((filters.mode && row.mode!==filters.mode)||(filters.format && row.executionFormat!==filters.format)||(filters.rules && row.retainedRulesProfile!==filters.rules)||(filters.status && row.status!==filters.status)) return invalid();
  if ((row.mode==='KIDS'||row.executionFormat==='STANDALONE_LIST'||row.executionFormat==='STANDALONE_ACTING') && row.teams.length!==2) return invalid();
  for(const team of row.teams) if(!exact(team,['name','score']) || !validName(team.name) || !Number.isInteger(team.score) || (team.score as number)<-2147483648 || (team.score as number)>2147483647) return invalid();
  if(row.status==='ACTIVE' ? row.finishedAt!==null || row.summary!==null : row.finishedAt===null || row.summary===null) return invalid();
  if(row.summary!==null) { const s=row.summary; if(!exact(s,['reason','unplayedCount','isTie']) || ![tuple[0]<4?'ALL_QUESTIONS_PLAYED':'ALL_ROUNDS','HOST_ENDED'].includes(s.reason as string) || !Number.isInteger(s.unplayedCount) || (s.unplayedCount as number)<0 || (s.unplayedCount as number)>(row.mode==='KIDS'?6:row.executionFormat==='STANDALONE_LIST'||row.executionFormat==='STANDALONE_ACTING'?4:36) || typeof s.isTie!=='boolean' || ((s.reason==='HOST_ENDED') !== ((s.unplayedCount as number)>0)) || (tuple[0]===5&&s.reason==='HOST_ENDED'&&s.isTie)) return invalid(); }
  return row as unknown as HistoryProjection['matches'][number];
 });
 for(let i=1;i<matches.length;i++) {const a=matches[i-1], b=matches[i]; if(a.createdAt<b.createdAt || (a.createdAt===b.createdAt && a.id<=b.id)) return invalid();}
 return {registryVersion:1,queryVersion:2,matches,nextCursor:value.nextCursor as string|null};
}
export function parseRematchSetup(value: unknown) {
  if (!exact(value, ['mode', 'predecessorVersion', 'setup']) || !['CLASSIC', 'KIDS'].includes(value.mode as string) || !Number.isSafeInteger(value.predecessorVersion) || (value.predecessorVersion as number) < 2 || (value.predecessorVersion as number) > 2000000000) return invalid();
  return { mode: value.mode as EntaMode, predecessorVersion: value.predecessorVersion as number, setup: parseSuccessorSetup(value.setup, value.mode as EntaMode) };
}


