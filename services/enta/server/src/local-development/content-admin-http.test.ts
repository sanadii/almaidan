import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readFile} from 'node:fs/promises';
import {registerLocalContentAdmin} from './content-admin';
import {firebaseAdminVerifier} from '../firebase-verifier';
import {principalFromClaims} from '../identity';
import {LOCAL_PROJECT} from './guard';
import {realContent} from './real-content';
test('real emulator admin HTTP review and activation; guest denied; restore retained source',async()=>{
 const identity=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/admin-identity.private.json','utf8'));
 async function authRequest(method:string,body:unknown){const response=await fetch(`http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local-emulator-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();}
 const admin=await authRequest('signInWithPassword',{email:identity.email,password:identity.password,returnSecureToken:true});const guest=await authRequest('signUp',{returnSecureToken:true});
 const app=express();app.use(express.json({limit:'32kb'}));const verify=firebaseAdminVerifier(LOCAL_PROJECT);
 const store=await registerLocalContentAdmin(app,async(req,res,next)=>{try{const token=req.get('authorization')?.replace(/^Bearer /,'');if(!token)throw Error();(req as any).principal=principalFromClaims(await verify(token),LOCAL_PROJECT);next();}catch{res.status(401).json({error:'UNAUTHORIZED'});}});
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as {port:number};
 const api=async(path:string,body?:unknown,token=admin.idToken)=>{const r=await fetch(`http://127.0.0.1:${address.port}/api/v1/local-admin${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const current=await store.overlays(),category=realContent().categories.findLast(c=>!current.some(o=>o.entity==='category'&&o.entityId===c.id))!;let active:string|null=null;
 try{
  assert.equal((await api('/session',undefined,guest.idToken)).status,403);assert.equal((await api('/session',undefined,'invalid')).status,401);assert.equal((await api('/session')).status,200);
  assert.equal((await api('/categories')).body.categories.length,554);assert.equal((await api('/questions?offset=0')).body.questions.length,30);
  const draft=await api('/drafts',{entity:'category',entityId:category.id,payload:{labelAr:category.labelAr+' · مراجعة'}});assert.equal(draft.status,200);
  assert.equal((await api(`/revisions/${draft.body.id}/activate`,{expectedRevisionId:null})).status,409);
  assert.equal((await api(`/revisions/${draft.body.id}/review`,{})).status,200);
  assert.equal((await api(`/revisions/${draft.body.id}/activate`,{expectedRevisionId:null})).status,200);active=draft.body.id;
  assert.equal(realContent().categories.find(c=>c.id===category.id)!.labelAr,category.labelAr+' · مراجعة');
  assert.equal((await api('/restore-original',{entity:'category',entityId:category.id,expectedRevisionId:active})).status,200);active=null;
  assert.equal(realContent().categories.find(c=>c.id===category.id)!.labelAr,category.labelAr);
 }finally{if(active)await api('/restore-original',{entity:'category',entityId:category.id,expectedRevisionId:active});await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();}
});
