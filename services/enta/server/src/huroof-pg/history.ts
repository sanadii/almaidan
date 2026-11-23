import { parseHistoryResultDto } from './history-result-dto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authenticate, requireHosting, type IdentityDependencies } from './identity-policy';
import type { QueryBoundary } from './repository';

const MAX = 9223372036854775807n;
function decimal(value: unknown): string { if(typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value)>MAX) throw new Error('INVALID_HISTORY_CURSOR'); return value; }
/** No accepted resource policy exists for materializing historical semantic artifacts. */
function requireResultResources(): void { throw new Error('RESULT_RESOURCE_UNAVAILABLE'); }
function exact(x:unknown,keys:string[]):x is Record<string,unknown> {return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));}
function utc(value: unknown): value is string { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;try{return new Date(value).toISOString()===value;}catch{return false;} }
export interface PgCursorKey { bytes: Buffer; issueUntil:number; verifyUntil:number }
export interface PgHistoryKeys { active:string; keys:ReadonlyMap<string,PgCursorKey> }
interface Cursor { version:1; key:string; issuedAt:number; expiresAt:number; limit:number; upper:string; before:string }
function key(keys:PgHistoryKeys, version:string, now:number, issuing:boolean):Buffer { const k=keys.keys.get(version); if(!k||!Buffer.isBuffer(k.bytes)||k.bytes.length<32||k.bytes.length>128||!Number.isSafeInteger(k.issueUntil)||!Number.isSafeInteger(k.verifyUntil)||k.verifyUntil<k.issueUntil+930000||now>k.verifyUntil||(issuing&&(version!==keys.active||now>k.issueUntil))) throw new Error('HISTORY_UNAVAILABLE');return k.bytes; }
function mac(secret:Buffer, parts:string[]):Buffer { const h=createHmac('sha256',secret);for(const part of parts){const b=Buffer.from(part,'utf8');const n=Buffer.alloc(4);n.writeUInt32BE(b.length);h.update(n).update(b);}return h.digest(); }
function wire(c:Cursor,namespace:string,project:string,uid:string,keys:PgHistoryKeys,now:number,issuing:boolean):string {const payload=JSON.stringify(c);const encoded=Buffer.from(payload).toString('base64url');const signature=mac(key(keys,c.key,now,issuing),['maydan/huroof/history-cursor',namespace,project,uid,payload]).toString('base64url');const result=`${encoded}.${signature}`;if(result.length>1024)throw new Error('INVALID_HISTORY_CURSOR');return result;}
function verify(value:string, namespace:string,project:string,uid:string,keys:PgHistoryKeys,now:number,limit:number):Cursor {
 if(value.length>1024||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value))throw new Error('INVALID_HISTORY_CURSOR'); const [encoded,sig]=value.split('.');const bytes=Buffer.from(encoded,'base64url'),signature=Buffer.from(sig,'base64url');if(bytes.length>735||bytes.toString('base64url')!==encoded||signature.length!==32||signature.toString('base64url')!==sig)throw new Error('INVALID_HISTORY_CURSOR');
 let raw:string, parsed:unknown; try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);parsed=JSON.parse(raw);}catch{throw new Error('INVALID_HISTORY_CURSOR');}
 if(!exact(parsed,['version','key','issuedAt','expiresAt','limit','upper','before'])||parsed.version!==1||typeof parsed.key!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(parsed.key)||!Number.isSafeInteger(parsed.issuedAt)||!Number.isSafeInteger(parsed.expiresAt)||parsed.expiresAt!==(parsed.issuedAt as number)+900000||parsed.limit!==limit||now>=(parsed.expiresAt as number)||(parsed.issuedAt as number)>now+30000)throw new Error('INVALID_HISTORY_CURSOR');
 const c:Cursor={version:1,key:parsed.key,issuedAt:parsed.issuedAt as number,expiresAt:parsed.expiresAt as number,limit,upper:decimal(parsed.upper),before:decimal(parsed.before)};if(JSON.stringify(c)!==raw||BigInt(c.before)>BigInt(c.upper))throw new Error('INVALID_HISTORY_CURSOR');const expected=mac(key(keys,c.key,now,false),['maydan/huroof/history-cursor',namespace,project,uid,raw]);if(!timingSafeEqual(signature,expected))throw new Error('INVALID_HISTORY_CURSOR');return c;
}
export function createPgHistory(identity:IdentityDependencies, db:QueryBoundary, keys:PgHistoryKeys, now:()=>number) {
 return {
  async page(token:string, input:unknown) {
   const context=await authenticate(identity,token);requireHosting(context);if(!exact(input,['limit','cursor'])||!Number.isInteger(input.limit)||(input.limit as number)<1||(input.limit as number)>50||(input.cursor!==null&&typeof input.cursor!=='string'))throw new Error('INVALID_HISTORY_QUERY');
   const limit=input.limit as number, time=now();if(!Number.isSafeInteger(time)||time<0)throw new Error('HISTORY_UNAVAILABLE');key(keys,keys.active,time,true);
   const cursor=input.cursor===null?null:verify(input.cursor as string,context.policy.namespace,context.policy.projectId,context.principal.uid,keys,time,limit);
   const reply=await db.query<{value:unknown}>('SELECT public.pro311_huroof_history($1,$2,$3,$4,$5::jsonb) AS value',[context.policy.namespace,context.identityId,context.policy.revision,context.policy.hash,JSON.stringify({limit,upper:cursor?.upper??null,before:cursor?.before??null})]);
   const finished=now();if(!Number.isSafeInteger(finished)||finished<0)throw new Error('HISTORY_UNAVAILABLE');if(cursor)verify(input.cursor as string,context.policy.namespace,context.policy.projectId,context.principal.uid,keys,finished,limit);
   if(reply.rows.length!==1||!exact(reply.rows[0].value,['rows','upper','hasMore'])||!Array.isArray(reply.rows[0].value.rows)||reply.rows[0].value.rows.length>limit||typeof reply.rows[0].value.hasMore!=='boolean')throw new Error('HISTORY_UNAVAILABLE');
   const value=reply.rows[0].value, rows=value.rows as unknown[];let previous=cursor?.before??null;
   const safe=rows.map(r=>{if(!exact(r,['sequence','matchId','resultVersion','occurredAt'])||typeof r.matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.matchId)||!utc(r.occurredAt))throw new Error('HISTORY_UNAVAILABLE');const sequence=decimal(r.sequence),resultVersion=decimal(r.resultVersion);if(previous&&BigInt(sequence)>=BigInt(previous))throw new Error('HISTORY_UNAVAILABLE');previous=sequence;return {sequence,matchId:r.matchId,resultVersion,occurredAt:r.occurredAt};});
   const upper=value.upper===null?null:decimal(value.upper);if((safe.length>0&&!upper)||(cursor&&upper!==cursor.upper)||(safe.some(r=>BigInt(r.sequence)>BigInt(upper!))))throw new Error('HISTORY_UNAVAILABLE');let nextCursor:string|null=null;if(value.hasMore){if(safe.length!==limit||!upper||!previous)throw new Error('HISTORY_UNAVAILABLE');const c:Cursor=cursor?{...cursor,before:previous}:{version:1,key:keys.active,issuedAt:finished,expiresAt:finished+900000,limit,upper,before:previous};nextCursor=wire(c,context.policy.namespace,context.policy.projectId,context.principal.uid,keys,finished,!cursor);}
   return {version:1,rows:safe,nextCursor};
  },
  async result(token:string,matchId:string,resultVersion:string) {
   // Held until an approved full-artifact resource policy exists. This guard
   // precedes authentication and the fixed SQL call as well as raw decoding.
   requireResultResources();
   const context=await authenticate(identity,token);if(!/^[A-Za-z0-9_-]{1,128}$/.test(matchId))throw new Error('RESULT_UNAVAILABLE');const version=decimal(resultVersion);
   const reply=await db.query<{value:unknown}>('SELECT public.pro311_huroof_result($1,$2,$3,$4,$5,$6::bigint) AS value',[context.policy.namespace,context.identityId,context.policy.revision,context.policy.hash,matchId,version]);
   if(reply.rows.length!==1)throw new Error('RESULT_UNAVAILABLE');
   return parseHistoryResultDto(reply.rows[0].value,matchId,version);
  },
 };
}
