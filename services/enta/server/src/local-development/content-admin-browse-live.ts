import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const directory='D:/projects/huroof_wa_oloof/local/almaidan';
async function main(){
 const identity=JSON.parse(await readFile(`${directory}/admin-identity.private.json`,'utf8'));
 assert.equal(identity.projectId,'demo-almaidan-local');
 async function auth(method:string,body:unknown){const r=await fetch(`http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=local-emulator-only`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return (await r.json()).idToken as string;}
 const admin=await auth('signInWithPassword',{email:identity.email,password:identity.password,returnSecureToken:true});
 const guest=await auth('signUp',{returnSecureToken:true});
 async function get(path:string,token=admin,expected=200){const r=await fetch(`http://127.0.0.1:14001/api/v1/local-admin${path}`,{headers:{authorization:`Bearer ${token}`},cache:'no-store'});assert.equal(r.status,expected,path);return r.json();}
 await get('/categories',guest,403);await get('/questions',guest,403);await get('/categories','invalid',401);
 const before=await get('/session'),categories=(await get('/categories')).categories as Record<string,any>[];
 assert.equal(categories.length,554);const authored=categories.filter(c=>c.sourceKind==='local-authored');assert.equal(authored.length,24);
 const formats:Record<string,{categories:number;items:number}>=Object.create(null);
 for(const c of authored){assert.equal(c.editable,false);const page=await get(`/questions?category=${encodeURIComponent(c.id)}`);assert.equal(page.total,18);assert.equal(page.questions.length,18);const f=formats[c.format]??(formats[c.format]={categories:0,items:0});f.categories++;f.items+=page.total;
  for(const q of page.questions){assert.equal(q.editable,false);assert.equal(q.categoryId,c.id);assert.equal(q.releaseRootHash,c.releaseRootHash);assert.ok(q.revisionId);assert.ok(q.contentHash);if(c.format==='KIDS'){assert.equal(q.ageBand,'7-10');assert.ok(q.acceptedAnswers.includes(q.canonicalAnswer));}else if(c.format==='DRAWING_TARGET')assert.ok(q.target);else assert.ok(q.items.length);}
 }
 assert.deepEqual(Object.keys(formats).sort(),['ACTING_ITEMS','DRAWING_TARGET','KIDS','LIST_ITEMS']);
 for(const f of Object.values(formats))assert.deepEqual(f,{categories:6,items:108});
 const boundary=await get('/questions?offset=115620');assert.equal(boundary.total,116068);assert.equal(boundary.questions.length,30);assert.equal(boundary.questions.filter((q:any)=>q.sourceKind==='local-authored').length,14);
 const after=await get('/session');assert.equal(after.activeReleaseId,before.activeReleaseId);
 const report={at:new Date().toISOString(),localOnly:true,contentReadOnly:true,categories:categories.length,totalEntries:boundary.total,authoredCategories:authored.length,formats,guestAndInvalidDenied:true,sourceUnchanged:true,activeReleaseId:after.activeReleaseId};
 const file=`${directory}/content-admin-browse-live-${Date.now()}.json`;await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({ok:true,report:file,...report}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Admin browse acceptance failed');process.exitCode=1;});
