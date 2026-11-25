import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join as pathJoin } from 'node:path';
import { tmpdir } from 'node:os';
import { applyIntent, join, newRoom, normalizeName, reconcile } from '../src/features/imposter/engine.js';
const LEASE_MS=45_000, LEASE_REFRESH_MS=30_000;
import { project, refreshViews } from '../src/features/imposter/projection.js';
import type { Intent, Room } from '../src/features/imposter/contracts.js';
import { select, contentExhausted } from '../functions/src/imposter/pack.js';
export class LocalImposterService {
 private db: DatabaseSync;
 private secret: string;
 constructor(path = pathJoin(tmpdir(),'huroof-wa-oloof-imposter.sqlite'), private clock: () => number = Date.now) { this.db = new DatabaseSync(path); this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS imposter_local_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)'); this.db.prepare('INSERT OR IGNORE INTO imposter_local_secrets(name,value) VALUES(?,?)').run('signing',randomBytes(32).toString('hex')); this.secret = (this.db.prepare('SELECT value FROM imposter_local_secrets WHERE name=?').get('signing') as {value:string}).value; }
 close() { this.db.close(); }
 private load(id: string): {id:string;room:Room}|undefined { const row=this.db.prepare('SELECT id,data FROM rooms WHERE id=? OR code=?').get(id,id) as {id:string;data:string}|undefined; if (!row) return; const room=JSON.parse(row.data) as Room; return room.gameKind==='imposter'?{id:row.id,room}:undefined; }
 private save(id:string,room:Room) { room.contentExhausted=contentExhausted(room); refreshViews(room,this.clock()); room.revision++; this.db.prepare('UPDATE rooms SET data=?, revision=revision+1 WHERE id=?').run(JSON.stringify(room),id); }
 private sign(id:string,uid:string) { const body=Buffer.from(JSON.stringify({id,uid})).toString('base64url'); return body+'.'+createHmac('sha256',this.secret).update(body).digest('base64url'); }
 private auth(id:string,token:string) { const [body,sig]=token.split('.'); if (!body || !sig) throw new Error('UNAUTHORIZED'); const actual=Buffer.from(sig); const expected=Buffer.from(createHmac('sha256',this.secret).update(body).digest('base64url')); if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new Error('UNAUTHORIZED'); const data=JSON.parse(Buffer.from(body,'base64url').toString()) as {id:string;uid:string}; if (data.id!==id || !data.uid) throw new Error('UNAUTHORIZED'); return data.uid; }
 private response(id:string,room:Room,uid:string,now:number) { return {roomId:id,projection:project(room,uid,now),serverTime:now}; }
 create(name:string,categories?:unknown) { const uid:string=randomUUID(), id=randomUUID(), now=this.clock(); let code=''; for (let i=0;i<20;i++) { code='D1-'+randomBytes(4).toString('hex').toUpperCase(); if (!this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code)) break; code=''; } if (!code) throw new Error('CODE_EXHAUSTED'); const room=newRoom(code,uid,name,now,categories); room.contentExhausted=contentExhausted(room); refreshViews(room,now); this.db.prepare('INSERT INTO rooms(id,code,revision,data) VALUES(?,?,0,?)').run(id,code,JSON.stringify(room)); return {...this.response(id,room,uid,now),roomCode:code,uid,token:this.sign(id,uid)}; }
 resolve(code:string) { const row=this.load(code.toUpperCase()); return row?{gameKind:'imposter' as const,joinable:row.room.phase==='lobby' && row.room.players.filter(p=>!p.left).length<8}:undefined; }
 join(code:string,name:string) {
  const row=this.load(code.toUpperCase()); if (!row) throw new Error('ROOM_NOT_FOUND');
  const now=this.clock(),current=reconcile(row.room,now),key=typeof name==='string'?normalizeName(name):'';
  // A player whose tab closed (session lost) may reclaim their own disconnected seat by name,
  // which keeps their place in the turn order. Connected seats keep DUPLICATE_NAME protection.
  const seat=key?current.players.find(p=>!p.left && p.leaseUntil<=now && normalizeName(p.name)===key):undefined;
  const uid:string=seat?.uid ?? randomUUID(),room=join(row.room,uid,name,now); this.save(row.id,room);
  return {...this.response(row.id,room,uid,now),roomCode:room.code,uid,token:this.sign(row.id,uid)};
 }
 read(id:string,token:string) {
  const uid=this.auth(id,token), row=this.load(id); if (!row) throw new Error('ROOM_NOT_FOUND');
  const now=this.clock(),base=structuredClone(row.room),me=base.players.find(p=>p.uid===uid && !p.left);
  // An authenticated read (open WebSocket tick, resume or sync) is presence. Extending the lease here
  // keeps players in background or locked-screen tabs connected; at most one write per ~15s per player.
  if (me && base.phase!=='closed' && me.leaseUntil-now<LEASE_REFRESH_MS) me.leaseUntil=now+LEASE_MS;
  const room=reconcile(base,now); refreshViews(room,now); if (JSON.stringify(room)!==JSON.stringify(row.room)) this.save(id,room);
  return this.response(id,room,uid,now);
 }
 intent(id:string,token:string,intent:Intent) { const uid=this.auth(id,token),row=this.load(id); if (!row) throw new Error('ROOM_NOT_FOUND'); const now=this.clock(),room=applyIntent(row.room,uid,intent,now,select); this.save(id,room); if(intent.type==='leave') return {roomId:id,serverTime:now}; return this.response(id,room,uid,now); }
}








