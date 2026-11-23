import assert from 'node:assert/strict';
import test from 'node:test';
import { checkedResourceTotal, ReservationLedger, RESOURCE_HOLDERS, type ResourceEnvelope } from '../src/huroof-pg/history-archive-resource';
const envelope=Object.fromEntries(RESOURCE_HOLDERS.map(k=>[k,1n])) as ResourceEnvelope;
const identity={job:'j',profile:'p',producer:'source',epoch:'e',session:'s',fence:'1'};
test('checked holder arithmetic, missing values and overflow',()=>{assert.equal(checkedResourceTotal(envelope),16n);assert.throws(()=>checkedResourceTotal({...envelope,rawAndDetoast:-1n}));assert.throws(()=>checkedResourceTotal({...envelope,rawAndDetoast:9223372036854775807n}));const x={...envelope} as Partial<ResourceEnvelope>;delete x.nativeStack;assert.throws(()=>checkedResourceTotal(x as ResourceEnvelope));});
test('quarantine retains capacity and prevents overlap until matching cleanup',()=>{const ledger=new ReservationLedger(16n);ledger.reserve(identity,envelope);ledger.quarantine('j');assert.throws(()=>ledger.reserve({...identity,job:'next'},envelope),/RESOURCE_BUSY/);assert.throws(()=>ledger.reserve({...identity,job:'next',session:'other'},envelope),/DEFERRED_RESOURCE/);assert.throws(()=>ledger.confirmCleanup({...identity,fence:'stale'}));assert.equal(ledger.state('j'),'QUARANTINED');ledger.confirmCleanup(identity);assert.equal(ledger.state('j'),'RELEASED');ledger.reserve({...identity,job:'next'},envelope);});
test('large valid requests defer without invalidating the job or losing an existing reservation',()=>{
 const ledger=new ReservationLedger(16n); ledger.reserve(identity,envelope);
 const bigger={...envelope,rawAndDetoast:999n};assert.throws(()=>ledger.reserve({...identity,job:'large',session:'another'},bigger),/DEFERRED_RESOURCE/);assert.equal(ledger.state('j'),'RUNNING');assert.equal(ledger.state('large'),undefined);
});
