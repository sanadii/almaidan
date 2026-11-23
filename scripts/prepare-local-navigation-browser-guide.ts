import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {CLIENT_CHALLENGE_CAPABILITY as offer} from '../src/features/game/runtime/contracts.js';
const root='D:/projects/huroof_wa_oloof/local/almaidan',base='http://127.0.0.1:18787',origin='http://127.0.0.1:5174',roomId='18c3fa65-47f6-4791-bc63-c90d5d09d1c5',code='18C3FA';
async function main(){
 const doc=await readFile('LOCAL-ALMAIDAN.md','utf8'),cred=doc.match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/)!;
 const login=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:cred[1],password:cred[2],returnSecureToken:true})});assert.equal(login.status,200);const auth=(await login.json()).idToken;
 async function api(path:string,body?:unknown,bearer=auth){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${bearer}`},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();assert.ok(r.ok,JSON.stringify({path,status:r.status,error:data.error}));return data;}
 const host=await api(`/api/rooms/${roomId}/owner-access`,{}),read=()=>api(`/api/rooms/${roomId}?challenge=${encodeURIComponent(JSON.stringify(offer))}`,undefined,host.token);
 async function intent(type:string,payload:unknown={}){const snap=await read();return api(`/api/rooms/${roomId}/intents`,{type,payload,intentId:randomUUID(),expectedRevision:snap.revision},host.token);}
 async function challenge(type:string,extra:unknown={}){const snap=await read(),ch=snap.projection.challenge;assert.ok(ch);return intent(type,{occurrence:ch.occurrence,challengeRevision:ch.revision,stage:ch.stage,...extra as object});}
 const snap=await read();assert.equal(snap.projection.challenge?.stage,'setup');await challenge('CHALLENGE_VOID',{reason:'إعادة تجهيز دليل المتصفح للاختبار المحلي'});await challenge('CHALLENGE_CONTINUE');
 const result={roomId,roomCode:code,joinUrl:origin+`/room/${code}/join`,hostUrl:origin+`/room/${code}/host`,createdAt:new Date().toISOString(),credentialTransport:'actual join form only; no credential URL; no token stored',status:'board ready for new browser guide join'};await writeFile(root+'/navigation-guide-browser.private.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(String(e));process.exitCode=1;});
