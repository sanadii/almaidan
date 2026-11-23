import { strictJSON } from './strict-json';
import { object } from './core';
import type { Keyring,Key } from './cursor';
/** Reads already provisioned fixed keys only. No random generator, logging,
 * repair or fallback. Entropy/provisioning is a separate operational gate. */
export function configuredKeyring(env:Record<string,string|undefined>):Keyring|null {
 const active=env.ENTA_HISTORY_CURSOR_ACTIVE_KEY_VERSION,raw=env.ENTA_HISTORY_CURSOR_KEYS;
 if(!active||!/^[A-Za-z0-9_-]{1,32}$/.test(active)||!raw||raw.length>8192)return null;
 try{const parsed:unknown=strictJSON(raw,8192);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;const entries=Object.entries(parsed);if(entries.length<1||entries.length>8)return null;const keys=new Map<string,Key>();
 for(const [version,value]of entries){if(!/^[A-Za-z0-9_-]{1,32}$/.test(version))return null;const r=object(value,['key','issueUntil','verifyUntil']);if(typeof r.key!=='string'||r.key.length>171||!/^[A-Za-z0-9_-]+$/.test(r.key)||!Number.isSafeInteger(r.issueUntil)||!Number.isSafeInteger(r.verifyUntil)||(r.issueUntil as number)<0||!Number.isSafeInteger((r.issueUntil as number)+930000)||(r.verifyUntil as number)<(r.issueUntil as number)+930000)return null;const bytes=Buffer.from(r.key,'base64url');if(bytes.length<32||bytes.length>128||bytes.toString('base64url')!==r.key)return null;keys.set(version,{bytes,issueUntil:r.issueUntil as number,verifyUntil:r.verifyUntil as number});}
 return keys.has(active)?{active,keys}:null;}catch{return null;}
}
