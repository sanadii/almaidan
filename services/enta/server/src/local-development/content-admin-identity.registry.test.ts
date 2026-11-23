import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrimaryLocalContentAdmin,isRegisteredLocalContentAdmin} from './content-admin-identity';
import {LOCAL_PROJECT} from './guard';

const principal={projectId:LOCAL_PROJECT,uid:'fixture-admin',email:'admin@example.test',anonymous:false,verifiedAccount:true};
const registry={schemaVersion:1,projectId:LOCAL_PROJECT,entries:[{uid:principal.uid,email:principal.email}]};
const check=(p:typeof principal,r:unknown=registry)=>isRegisteredLocalContentAdmin(p,JSON.stringify(r));

test('additional local admin requires the exact verified account and project',()=>{
 assert.equal(check(principal),true);
 for(const p of [{...principal,uid:'ordinary-host'},{...principal,email:'other@example.test'},{...principal,projectId:'other-project'},{...principal,anonymous:true},{...principal,verifiedAccount:false}])assert.equal(check(p),false);
});
test('malformed, wrong-project and duplicate registry entries fail closed',()=>{
 assert.equal(isRegisteredLocalContentAdmin(principal,'{'),false);
 for(const r of [{...registry,schemaVersion:2},{...registry,projectId:'other-project'},{...registry,entries:[...registry.entries,...registry.entries]},{...registry,entries:[{...registry.entries[0],password:'not-allowed'}]},{...registry,entries:Array(101).fill(registry.entries[0])}])assert.equal(check(principal,r),false);
});

test('original primary identity remains authorized independently of the registry',()=>{
 const identity={projectId:LOCAL_PROJECT,uid:principal.uid,email:principal.email};
 assert.equal(isPrimaryLocalContentAdmin(principal,identity),true);
 assert.equal(isPrimaryLocalContentAdmin({...principal,uid:'ordinary-host'},identity),false);
 assert.equal(isPrimaryLocalContentAdmin({...principal,verifiedAccount:false},identity),false);
});
