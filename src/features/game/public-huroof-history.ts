export type PublicHuroofHistoryRow={sequence:string;matchId:string;resultVersion:string;occurredAt:string};
const fail=():never=>{throw Error('MALFORMED_HISTORY');};
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
export function parsePublicHuroofHistory(value:unknown):{rows:PublicHuroofHistoryRow[];nextCursor:string|null}{
 if(!exact(value,['version','rows','nextCursor'])||value.version!==1||!Array.isArray(value.rows)||value.rows.length>25||!(value.nextCursor===null||typeof value.nextCursor==='string'&&value.nextCursor.length<=1024&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value.nextCursor)))return fail();
 let last:bigint|null=null;const seen=new Set<string>();const rows=value.rows.map((v:unknown)=>{if(!exact(v,['sequence','matchId','resultVersion','occurredAt'])||!decimal(v.sequence)||!decimal(v.resultVersion)||typeof v.matchId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(v.matchId)||typeof v.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.occurredAt))return fail();try{if(new Date(v.occurredAt).toISOString()!==v.occurredAt) return fail();}catch{return fail();}const sequence=BigInt(v.sequence),id=`${v.matchId}:${v.resultVersion}`;if(last!==null&&sequence>=last||seen.has(id))return fail();last=sequence;seen.add(id);return {sequence:v.sequence,matchId:v.matchId,resultVersion:v.resultVersion,occurredAt:v.occurredAt};});
 if(value.nextCursor!==null&&rows.length!==25)return fail();return {rows,nextCursor:value.nextCursor as string|null};
}
