import {test} from "node:test";
import assert from "node:assert/strict";
import {RoomContextEpoch} from "../../src/features/game/runtime/room-context.js";
import {PgGameAdapter} from "../../src/features/game/runtime/pg-game-adapter.js";

test("view changes invalidate captured tickets even after returning to the original view",()=>{
 const epoch=new RoomContextEpoch();epoch.changePrincipal("host");epoch.changeRoute("M2-ABCDEFGH");const first=epoch.ticket();
 epoch.changeView("audience");const display=epoch.ticket();assert.equal(epoch.current(first),false);
 epoch.changeView("member");assert.equal(epoch.current(first),false);assert.equal(epoch.current(display),false);
});
test("audience adapter denies writes before authentication or network effects",async()=>{
 let effects=0;const adapter=new PgGameAdapter({namespace:"ns",projectId:"project",auth:{current:async()=>{effects++;return {principal:"host",token:"token"};},subscribe:()=>()=>{}},fetch:async()=>{effects++;throw new Error("unexpected network");}});
 adapter.bindRoute("M2-ABCDEFGH","audience");
 await assert.rejects(adapter.join("M2-ABCDEFGH","name"),/AUDIENCE_READ_ONLY/);
 await assert.rejects(adapter.submitGameIntent("room",{type:"START_MATCH",intentId:"start",expectedRevision:0,payload:{}}),/AUDIENCE_READ_ONLY/);
 assert.equal(effects,0);adapter.dispose();
});
test("view switch retains one uncertain start identity and retries its exact original body",async()=>{
 const starts:unknown[]=[];const stamp="2026-01-01T00:00:00.000Z";let paid=false;
 const auth={current:async()=>({principal:"host",token:"token"}),subscribe:(listener:(principal:string|null)=>void)=>{listener("host");return ()=>{};}};
 const fetcher:typeof fetch=async(input,init)=>{const path=String(input),body=JSON.parse(String(init?.body)) as Record<string,unknown>;
  if(path==="/start"){starts.push(body);if(starts.length===1) throw new Error("connection lost");return Response.json({admissionId:"a",matchId:"m",replayed:true,revision:1,roomId:"room",sequence:1,state:"COMMITTED",status:"STARTED"});}
  const role=body.view==="audience"?"audience":"host";
  return Response.json({schemaVersion:"huroof-realtime-v1",namespace:"ns",projectId:"project",roomId:"room",roomGeneration:"1",memberGeneration:"1",policyRevision:"1",policyHash:"a".repeat(64),principal:"host",role,stage:paid?"PAID":"SETUP",revision:paid?"1":"0",throughSequence:paid?"1":"0",readAt:stamp,snapshot:{roomId:"room",revision:paid?1:0,serverTime:stamp,role,projection:{room:{roomCode:"ABCDEFGH",state:paid?"ROUND_SETUP":"LOBBY",readyCount:0,memberCount:1}}},terminal:null,replay:{mode:"SNAPSHOT",events:[]}});
 };
 const adapter=new PgGameAdapter({namespace:"ns",projectId:"project",profileScope:"scope",auth,fetch:fetcher});
 const intent={type:"START_MATCH" as const,intentId:"same-intent",expectedRevision:0,payload:{}};
 adapter.bindRoute("M2-ABCDEFGH");await adapter.open("M2-ABCDEFGH");await assert.rejects(adapter.submitGameIntent("room",intent));
 adapter.bindRoute("M2-ABCDEFGH","audience");await adapter.open("M2-ABCDEFGH");
 paid=true;adapter.bindRoute("M2-ABCDEFGH");await adapter.open("M2-ABCDEFGH");const result=await adapter.submitGameIntent("room",intent);
 assert.equal(result.replayed,true);assert.equal(starts.length,2);assert.deepEqual(starts[1],starts[0]);adapter.dispose();
});
