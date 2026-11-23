import assert from 'node:assert/strict';
import test from 'node:test';
import {composePublicHistory} from '../src/history-rematch/public-history-composition';

test('explicit public composition rejects mismatched identity and preserves result guard before IO',async()=>{
 let calls=0;const db={async query<T>(){calls++;return {rows:[] as T[]};}};const identity={namespace:'ns',clientProjectId:'project',async readActivePolicy(){calls++;throw Error('unexpected');},async verifyToken(){calls++;throw Error('unexpected');},async resolveIdentity(){calls++;return null;}};
 const key={active:'k',keys:new Map([['k',{bytes:Buffer.alloc(32,7),issueUntil:1000000,verifyUntil:2000000}]])};const input={namespace:'ns',projectId:'project',entaDb:db,huroofDb:db,identity,entaKeys:key,huroofKeys:key,clock:()=>0};
 assert.throws(()=>composePublicHistory({...input,projectId:'other'}),/HISTORY_COMPOSITION_INVALID/);const composed=composePublicHistory(input);await assert.rejects(composed.huroofHistory.result('token','match','1'),/RESULT_RESOURCE_UNAVAILABLE/);assert.equal(calls,0);
});

test('Huroof page denies anonymous and unverified identities before history query',async()=>{
 const {createHash}=await import('node:crypto');const raw=Buffer.from(JSON.stringify({schema:'huroof-identity-policy-v1',namespace:'ns',projectId:'project',issuer:'https://securetoken.google.com/project',audience:'project',clientProjectId:'project'}));let reads=0;
 const identity={namespace:'ns',clientProjectId:'project',async readActivePolicy(){return {namespace:'ns',revision:'1',hash:createHash('sha256').update(raw).digest('hex'),raw,projectId:'project',issuer:'https://securetoken.google.com/project',audience:{projectId:'project'}};},async verifyToken(token:string){return {aud:'project',iss:'https://securetoken.google.com/project',sub:'user',uid:'user',currentUser:{disabled:false,emailVerified:false,email:'a@example.test'},firebase:{sign_in_provider:token==='anonymous'?'anonymous':'password'}};},async resolveIdentity(){return 'identity';}};
 const db={async query<T>(){reads++;return {rows:[] as T[]};}},key={active:'k',keys:new Map([['k',{bytes:Buffer.alloc(32,7),issueUntil:1000000,verifyUntil:2000000}]])};const history=composePublicHistory({namespace:'ns',projectId:'project',entaDb:db,huroofDb:db,identity,entaKeys:key,huroofKeys:key,clock:()=>0}).huroofHistory;
 for(const token of ['anonymous','unverified'])await assert.rejects(history.page(token,{limit:25,cursor:null}),/VERIFIED_ACCOUNT_REQUIRED/);assert.equal(reads,0);
});
