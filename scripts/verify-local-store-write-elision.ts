import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {assertLocalDevelopment} from '../services/enta/server/src/local-development/guard.js';
import {createLocalStore} from '../services/enta/server/src/local-development/store.js';
import {LocalRoomStore} from '../services/enta/server/src/local-development/rooms.js';
import {LocalRoundStore} from '../services/enta/server/src/local-development/round-store.js';
import {LocalCompetitionStore} from '../services/enta/server/src/local-development/competition-store.js';

// Run with the local Enta API stopped so its old polling code cannot change
// the tuple between the before/after observations. Never changes existing rows.
const root='D:/projects/huroof_wa_oloof/local/almaidan';
const config=JSON.parse(await readFile(`${root}/connection.private.json`,'utf8'));
Object.assign(process.env,{ALMAIDAN_LOCAL_ONLY:'true',ENTA_RUNTIME_MODE:'local',NODE_ENV:'test',FIREBASE_PROJECT_ID:'demo-almaidan-local',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099',DATABASE_URL:config.databaseUrl});
const db=new PrismaClient({datasourceUrl:assertLocalDevelopment()});
const owner=createLocalStore(),rooms=new LocalRoomStore(),rounds=new LocalRoundStore(),competition=new LocalCompetitionStore();
const checks:string[]=[];
try {
  for(const [table,store] of [['room_state',rooms],['round_state',rounds],['competition_state',competition]] as const){
    const tuple=async()=>db.$queryRawUnsafe<{tuple:string;version:string}[]>(`SELECT ctid::text AS tuple,xmin::text AS version FROM local_development.${table} WHERE id=1`);
    const before=await tuple();assert.equal(before.length,1);
    await store.transaction(async()=>undefined);
    assert.deepEqual(await tuple(),before,`${table}: unchanged read must not rewrite saved data`);
    checks.push(`${table}: no-op retains tuple and transaction version`);
  }
  const uid=`write-elision-${randomUUID()}`;
  await owner.transaction(uid,async state=>{state.commands.counter={hash:'local-test',sequence:0};});
  const saved=async()=>db.$queryRawUnsafe<{data:any;tuple:string}[]>('SELECT data,ctid::text AS tuple FROM local_development.owner_state WHERE uid=$1',uid);
  const before=await saved();await owner.transaction(uid,async()=>undefined);assert.deepEqual(await saved(),before);
  checks.push('New test owner: no-op retains data and tuple');
  await Promise.all([1,2,3].map(()=>owner.transaction(uid,async state=>{state.commands.counter.sequence++;})));
  assert.equal((await saved())[0].data.commands.counter.sequence,3);
  checks.push('New test owner: three concurrent mutations serialize and persist');
  const committed=await saved();await assert.rejects(owner.transaction(uid,async state=>{state.commands.counter.sequence=99;throw new Error('test rollback');}),/test rollback/);
  assert.deepEqual(await saved(),committed);
  checks.push('New test owner: thrown callback rolls back without changing committed data');
  const report={at:new Date().toISOString(),passed:true,checks,newTestOwner:uid,existingRowsMutated:false};
  await writeFile(`${root}/local-store-write-elision-current.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:true,checks}));
}finally{await Promise.all([db.$disconnect(),owner.close(),rooms.close(),rounds.close(),competition.close()]);}
