import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {getAuth} from 'firebase-admin/auth';
import {firebaseAdminAppForProject} from '../firebase-verifier';
import type {Principal} from '../identity';
import {assertLocalDevelopment,LOCAL_PROJECT} from './guard';
import {ContentAdminError} from './content-admin-store';
const path='D:/projects/huroof_wa_oloof/local/almaidan/admin-identity.private.json';
export const LOCAL_ADMIN_REGISTRY_PATH='D:/projects/huroof_wa_oloof/local/almaidan/admin-registry.private.json';
type Identity={projectId:string;uid:string;email:string;password:string};
/** Explicit provisioning tool only; never called by an HTTP route. */
export async function provisionLocalContentAdmin(){
 assertLocalDevelopment();let identity:Identity;
 try {identity=JSON.parse(await readFile(path,'utf8')) as Identity;if(identity.projectId!==LOCAL_PROJECT||!identity.uid?.startsWith('content-admin-')||!identity.email?.endsWith('@almaidan.local')||!identity.password)throw Error('LOCAL_ADMIN_IDENTITY_INVALID');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('LOCAL_ADMIN_IDENTITY_INVALID');identity={projectId:LOCAL_PROJECT,uid:`content-admin-${randomUUID()}`,email:`content-admin-${randomUUID()}@almaidan.local`,password:randomBytes(32).toString('base64url')};await writeFile(path,JSON.stringify(identity),{flag:'wx',mode:0o600});}
 const auth=getAuth(firebaseAdminAppForProject(LOCAL_PROJECT));
 try {const current=await auth.getUser(identity.uid);if(current.email!==identity.email||!current.emailVerified||current.disabled)throw Error('LOCAL_ADMIN_IDENTITY_MISMATCH');return;}
 catch(error){if((error as {code?:string}).code!=='auth/user-not-found')throw Error('LOCAL_ADMIN_PROVISION_UNAVAILABLE');}
 try {await auth.createUser({uid:identity.uid,email:identity.email,password:identity.password,emailVerified:true,disabled:false});}catch{throw Error('LOCAL_ADMIN_PROVISION_UNAVAILABLE');}
}
export function isRegisteredLocalContentAdmin(principal:Principal, registryText:string):boolean {
 try {
  if(!principal||principal.projectId!==LOCAL_PROJECT||!principal.verifiedAccount||principal.anonymous)return false;
  const registry:unknown=JSON.parse(registryText);
  if(!registry||typeof registry!=='object'||Array.isArray(registry))return false;
  const r=registry as Record<string,unknown>;
  if(Object.keys(r).sort().join(',')!=='entries,projectId,schemaVersion'||r.schemaVersion!==1||r.projectId!==LOCAL_PROJECT||!Array.isArray(r.entries)||r.entries.length>100)return false;
  const uids=new Set<string>(),emails=new Set<string>();
  for(const entry of r.entries){
   if(!entry||typeof entry!=='object'||Array.isArray(entry))return false;
   const e=entry as Record<string,unknown>;
   if(Object.keys(e).sort().join(',')!=='email,uid'||typeof e.uid!=='string'||!e.uid||e.uid.length>128||e.uid.trim()!==e.uid||typeof e.email!=='string'||e.email.length>254||e.email.trim()!==e.email||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.email)||uids.has(e.uid)||emails.has(e.email.toLowerCase()))return false;
   uids.add(e.uid);emails.add(e.email.toLowerCase());
  }
  return r.entries.some((entry:{uid:string;email:string})=>entry.uid===principal.uid&&entry.email===principal.email);
 } catch{return false;}
}
export function isPrimaryLocalContentAdmin(principal:Principal, identity:{projectId:string;uid:string;email:string}):boolean {
 return Boolean(principal&&principal.projectId===LOCAL_PROJECT&&principal.verifiedAccount&&!principal.anonymous&&identity.projectId===LOCAL_PROJECT&&identity.uid===principal.uid&&identity.email===principal.email);
}
export async function assertContentAdmin(principal:Principal){
 assertLocalDevelopment();
 if(!principal||principal.projectId!==LOCAL_PROJECT||!principal.verifiedAccount||principal.anonymous)throw new ContentAdminError(403,'LOCAL_ADMIN_REQUIRED');
 const identity=JSON.parse(await readFile(path,'utf8')) as Identity;
 if(isPrimaryLocalContentAdmin(principal,identity))return;
 let registry:string;
 try {registry=await readFile(LOCAL_ADMIN_REGISTRY_PATH,'utf8');}catch {throw new ContentAdminError(403,'LOCAL_ADMIN_REQUIRED');}
 if(!isRegisteredLocalContentAdmin(principal,registry))throw new ContentAdminError(403,'LOCAL_ADMIN_REQUIRED');
}
