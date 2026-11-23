import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CapacitySupplier } from '../src/history-rematch/capacity-supplier';
import { fitsPhysicalDomain, subject } from '../src/history-rematch/capacity-contract';

test('supplier has no default authority', async () => {
  await assert.rejects(() => new CapacitySupplier().qualificationFor('receipt', 1), /CAPACITY_UNAVAILABLE/);
});
test('shared accounting retains all occupied amounts with bigint precision', () => {
  assert.equal(fitsPhysicalDomain(100n, 30n, [20n, 10n], 40n), true);
  assert.equal(fitsPhysicalDomain(100n, 30n, [20n, 11n], 40n), false);
  assert.throws(() => fitsPhysicalDomain(100n, 30n, [-1n], 1n), /CAPACITY_UNAVAILABLE/);
});
test('subject captures changing getter once and detaches result', () => {
  let calls=0;
  const value={namespace:'n',project:'p',owner:'o',route:'r',operation:'PG_SETUP',get requestDigest(){calls++;return calls===1?'a'.repeat(64):'invalid';}};
  const result=subject(value);
  assert.equal(calls,1); assert.equal(result.requestDigest,'a'.repeat(64)); assert.ok(Object.isFrozen(result));
});
test('supplier rejects an arbitrary injected success port without invoking it',async()=>{
 let calls=0;const fake={importVerifiedReceipt:async()=>{calls++;return 'approval';},readCurrentQualification:async()=>{calls++;return {};}};
 await assert.rejects(()=>new CapacitySupplier(fake).qualificationFor('receipt',1),/CAPACITY_UNAVAILABLE/);assert.equal(calls,0);
});
test('actual supplier adapter resolves only fixed SQL and decodes protected qualification',async()=>{
 const {createSqlSupplierPort}=await import('../src/history-rematch/capacity-supplier');const seen:string[]=[];
 const effect={query:async(sql:string)=>{seen.push(sql);return [{value:sql.includes('capacity_import')?'approval':{id:'qualification',generation:'9007199254740993',evidenceHash:'b'.repeat(64),validUntil:'2030-01-01T00:00:00.000Z',reuse:'ONE_USE',domain:'domain',sourceClosure:'c'.repeat(64)}}];}};
 const {createCapacityRoleEffect}=await import('../src/history-rematch/capacity-producer');
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{text:string;values:unknown[]})=>effect.query(q.text,q.values)})} as unknown as import('../src/history-rematch/successor-postgres').EntaSuccessorDatabase;
 const result=await new CapacitySupplier(createSqlSupplierPort(createCapacityRoleEffect(db))).qualificationFor('receipt',1);assert.equal(result.generation,9007199254740993n);assert.deepEqual(seen,['SELECT public.pro262_capacity_import($1) AS value','SELECT public.pro262_capacity_find_qualification($1) AS value']);
});

test('closed native applicability rejects rotations and captures discriminator getters once',async()=>{
 const {nativeApplicability,assertSameNativeApplicability}=await import('../src/history-rematch/capacity-contract');
 const expected={engine:'ENTA',operation:'ENTA_SUCCESSOR',protocol:4,mode:'mode',format:'format',rules:'rules',predecessorId:'parent',predecessorVersion:null,baseReleaseId:'base',receiptId:'receipt',baseRoot:'root',sealHash:'seal',policyVersion:'policy',formatPolicyVersion:'format-policy',formatReleaseId:'release',formatRoot:'format-root',mediaRoot:'media',competitiveReleaseId:null,competitiveProofRoot:null,competitivePaletteRoot:null,profile:null,custody:null};
 assert.deepEqual(assertSameNativeApplicability(expected,{...expected}),expected);
 for(const key of ['baseReleaseId','receiptId','baseRoot','sealHash','policyVersion','formatPolicyVersion','formatReleaseId','formatRoot','mediaRoot'] as const)assert.throws(()=>assertSameNativeApplicability(expected,{...expected,[key]:'rotated'}),/CAPACITY_UNAVAILABLE/);
 assert.throws(()=>nativeApplicability({...expected,mode:'*'}),/CAPACITY_UNAVAILABLE/);assert.throws(()=>nativeApplicability({...expected,extra:'x'}),/CAPACITY_UNAVAILABLE/);
 let reads=0;const changing={...expected,get engine(){reads++;return reads===1?'ENTA':'PG';}};assert.equal(nativeApplicability(changing).engine,'ENTA');assert.equal(reads,1);
 const setup={engine:'PG',operation:'PG_SETUP',protocol:null,namespace:'n',owner:'o',policyRevision:'1',policyHash:'hash',parentMatchId:'match',resultVersion:'1',resultHash:'result',requestedConfig:{a:1,b:2},activeCatalog:null,profile:null,custody:null,matchPin:null};
 assertSameNativeApplicability(setup,{...setup,requestedConfig:{b:2,a:1}});assert.throws(()=>assertSameNativeApplicability(setup,{...setup,policyHash:'rotated'}),/CAPACITY_UNAVAILABLE/);
});
