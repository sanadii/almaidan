import { IMPOSTER_CATEGORIES } from './catalog.js';
import { PACK_VERSION } from './contracts.js';
import type { Intent, Player, Room, Settings, Word } from './contracts.js';

const timings = { fast: [20,60,20,15], default: [30,90,30,20], relaxed: [45,120,45,30] } as const;
export const normalizeGuess = (value: string) => value.normalize('NFC').replace(/[\u064B-\u065F\u0670\u0640]/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/\s+/gu, ' ').trim();
export const normalizeName = (value: string) => normalizeGuess(value).toLocaleLowerCase('ar');
/**
 * Lenient key used only to judge the imposter's final guess. Pack identity keeps the strict
 * `normalizeGuess`, but a spoken-style spelling (فراوله / فراولة، مستشفى / مستشفي، البرجر / برجر)
 * must not flip the winner.
 */
export const guessKey = (value: string) => normalizeGuess(value).toLocaleLowerCase('ar')
  .replace(/[ة]/gu, 'ه').replace(/[ى]/gu, 'ي').replace(/[ؤ]/gu, 'و').replace(/[ئ]/gu, 'ي')
  .replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean)
  .map(word => word.length > 3 && word.startsWith('ال') ? word.slice(2) : word).join(' ');
export const guessMatches = (guess: string, word: Word) => { const key = guessKey(guess); return key.length > 0 && [word.word, ...word.aliases].some(candidate => guessKey(candidate) === key); };
const fail = (message: string): never => { throw new Error(message); };
export const validName = (name: string) => typeof name === 'string' && name.trim().length > 0 && name.length <= 48 && /[\p{L}\p{N}]/u.test(name) && /^[\p{L}\p{M}\p{N} ._'-]+$/u.test(name);
function validCategories(categories: unknown): categories is string[] {
  return Array.isArray(categories) && categories.length > 0 && new Set(categories).size === categories.length && categories.every(category => IMPOSTER_CATEGORIES.includes(category));
}
const connected = (p: Player, now: number) => !p.left && p.leaseUntil > now;
const bump = (room: Room, phase: Room['phase'], deadline: number | null) => { room.phase = phase; room.phaseId = String(Number(room.phaseId) + 1); room.deadline = deadline; };
const duration = (room: Room, index: number) => timings[room.settings.pace][index] * 1000;
const totals = (votes: Record<string, string | null>, roster: number) => { const counts: Record<string, number> = {}; let abstentions = 0; for (const value of Object.values(votes)) { if (value === null) abstentions++; else counts[value] = (counts[value] ?? 0) + 1; } abstentions += Math.max(0, roster - Object.keys(votes).length); return { counts, abstentions }; };
const finish = (room: Room, winner: 'imposter' | 'insiders') => { const v = totals(room.firstVotes ?? room.votes, room.order.length); const run = room.firstVotes ? totals(room.votes, room.order.length) : undefined; room.result = { winner, imposter: room.imposter!, word: room.word!.word, guess: room.guess ?? null, totals: v.counts, abstentions: v.abstentions, ...(run ? {runoffTotals: run.counts, runoffAbstentions: run.abstentions} : {}) }; bump(room, 'results', null); for (const p of room.players) p.ready = false; };
function concludeVote(room: Room, at: number) { const {counts} = totals(room.votes, room.order.length); const max = Math.max(0, ...Object.values(counts)); const leaders = Object.keys(counts).filter(k => counts[k] === max); if (!max) return finish(room, 'imposter'); if (leaders.length > 1) { if (room.phase === 'runoff') return finish(room, 'imposter'); room.firstVotes = room.votes; room.votes = {}; room.candidates = leaders; return bump(room, 'runoff', at + duration(room,2)); } if (leaders[0] !== room.imposter) return finish(room, 'imposter'); bump(room, 'guess', at + duration(room,3)); }
const activePhases: ReadonlyArray<Room['phase']> = ['reveal','clues','discussion','vote','runoff','guess'];
const departed = (room: Room, uid: string) => room.players.find(p => p.uid === uid)?.left !== false;
const cancelRound = (room: Room) => { room.word = undefined; room.imposter = undefined; room.result = undefined; for (const p of room.players) p.ready = false; bump(room, 'cancelled', null); };
/** Departed players' clue turns pass immediately instead of each running out the full timer. */
function skipDepartedSpeakers(room: Room) { while (room.turn < room.order.length * 2 && departed(room, room.order[room.turn % room.order.length])) { room.clues.push({uid: room.order[room.turn % room.order.length], text: null}); room.turn++; } }
function nextClue(room: Room, at: number) { room.turn++; skipDepartedSpeakers(room); if (room.turn >= room.order.length * 2) bump(room, 'discussion', at + duration(room,1)); else { room.phaseId = String(Number(room.phaseId) + 1); room.deadline = at + duration(room,0); } }
function enterClues(room: Room, at: number) { bump(room, 'clues', at + duration(room,0)); skipDepartedSpeakers(room); if (room.turn >= room.order.length * 2) bump(room, 'discussion', at + duration(room,1)); }
/** A round cannot continue meaningfully once the imposter or too many players have gone. */
function settleDepartures(room: Room, at: number) {
  if (!activePhases.includes(room.phase)) return;
  const remaining = room.order.filter(id => !departed(room, id));
  if (remaining.length < 3 || (room.imposter !== undefined && departed(room, room.imposter))) return cancelRound(room);
  if (room.phase === 'reveal' && remaining.every(id => room.acks.includes(id))) return enterClues(room, at);
  if (room.phase === 'clues' && departed(room, room.order[room.turn % room.order.length])) { room.clues.push({uid: room.order[room.turn % room.order.length], text: null}); nextClue(room, at); }
  if (room.phase === 'vote' || room.phase === 'runoff') room.candidates = room.candidates.filter(id => !departed(room, id));
}
function startVote(room: Room, at: number) {
  room.votes = {};
  room.candidates = room.order.filter(id => !departed(room, id));
  bump(room, 'vote', at + duration(room, 2));
}

export function reconcile(input: Room, now: number): Room {
  const room = structuredClone(input);
  const active = room.players.filter(p => connected(p, now));
  if (!active.some(p => p.uid === room.organizer) && active.length) {
    room.organizer = [...active].sort((a, b) => a.joinedAt - b.joinedAt)[0].uid;
  }
  while (room.deadline !== null && now >= room.deadline) {
    const at = room.deadline;
    switch (room.phase) {
      case 'reveal': cancelRound(room); break;
      case 'clues': room.clues.push({ uid: room.order[room.turn % room.order.length], text: null }); nextClue(room, at); break;
      case 'discussion': startVote(room, at); break;
      case 'vote': case 'runoff': concludeVote(room, at); break;
      case 'guess': finish(room, 'insiders'); break;
      default: room.deadline = null;
    }
  }
  if (room.phase === 'vote' || room.phase === 'runoff') {
    const voters = active.filter(p => room.order.includes(p.uid));
    if (voters.length && voters.every(p => Object.hasOwn(room.votes, p.uid))) concludeVote(room, now);
  }
  return room;
}
export function newRoom(code: string, uid: string, name: string, now: number, categories: unknown = IMPOSTER_CATEGORIES): Room {
  if (!validName(name)) fail('INVALID_NAME');
  if (!validCategories(categories)) return fail('INVALID_SETTINGS');
  return {gameKind:'imposter', revision:0, packVersion:PACK_VERSION, code, phase:'lobby', phaseId:'0', round:0, organizer:uid, players:[{uid,name:name.trim(),ready:false,joinedAt:now,leaseUntil:now+45000,left:false}], settings:{mode:'spoken',pace:'default',categories:[...categories]}, deadline:null,used:[],order:[],turn:0,clues:[],acks:[],votes:{},candidates:[],receipts:{}};
}
export function join(input: Room, uid: string, name: string, now: number): Room { const room = reconcile(input,now); const own = room.players.find(p=>p.uid===uid); if (own && !own.left) { own.leaseUntil=now+45000; return room; } if (room.phase !== 'lobby') fail('JOIN_LOCKED'); if (!validName(name)) fail('INVALID_NAME'); if (room.players.filter(p=>!p.left).length>=8) fail('ROOM_FULL'); if (room.players.some(p=>!p.left && normalizeName(p.name)===normalizeName(name))) fail('DUPLICATE_NAME'); room.players = room.players.filter(p=>p.uid!==uid); room.players.push({uid,name:name.trim(),ready:false,joinedAt:now,leaseUntil:now+45000,left:false}); return room; }
export function applyIntent(input: Room, uid: string, intent: Intent, now: number, select: (room: Room) => {word: Word; imposter: string; order: string[]}): Room { const room = reconcile(input,now); const player = room.players.find(p=>p.uid===uid && !p.left); if (!player) throw new Error('NOT_MEMBER'); if (typeof intent.requestId !== 'string' || !intent.requestId || intent.requestId.length>128 || typeof intent.phaseId !== 'string' || !intent.phaseId || intent.phaseId.length>128) fail('INVALID_INTENT'); const receiptKey = `${uid}:${intent.requestId}`; const fingerprint = JSON.stringify(intent); if (room.receipts[receiptKey]) { if (room.receipts[receiptKey]!==fingerprint) fail('RECEIPT_CONFLICT'); return room; } if (intent.type !== 'heartbeat' && intent.phaseId !== room.phaseId) fail('STALE_PHASE'); const organizer = () => { if (room.organizer!==uid) fail('NOT_ORGANIZER'); }; const lobby = () => { if (room.phase !== 'lobby') fail('INVALID_PHASE'); }; switch(intent.type) {
case 'heartbeat': if (room.phase==='closed') fail('ROOM_CLOSED'); player.leaseUntil=now+45000; break;
case 'replay': organizer(); if (!['results','cancelled'].includes(room.phase)) fail('INVALID_PHASE'); room.word=undefined; room.imposter=undefined; room.result=undefined; room.guess=undefined; room.order=[]; room.turn=0; room.clues=[]; room.acks=[]; room.votes={}; room.firstVotes=undefined; room.candidates=[]; for (const p of room.players) p.ready=false; bump(room,'lobby',null); break;
case 'close': organizer(); if (!['lobby','results','cancelled'].includes(room.phase)) fail('INVALID_PHASE'); room.word=undefined; room.imposter=undefined; room.result=undefined; bump(room,'closed',null); break;
case 'leave': player.left=true; player.ready=false; settleDepartures(room,now); break;
case 'remove': organizer(); lobby(); if (uid===intent.uid) fail('CANNOT_REMOVE_SELF'); { const target=room.players.find(p=>p.uid===intent.uid && !p.left); if (!target) throw new Error('NOT_MEMBER'); target.left=true; target.ready=false; } break;
case 'ready': lobby(); player.ready=intent.ready === true; break;
case 'settings': organizer(); lobby(); { const s: Settings = intent.settings; if (!s || !['spoken','typed'].includes(s.mode) || !['fast','default','relaxed'].includes(s.pace) || !validCategories(s.categories)) fail('INVALID_SETTINGS'); room.settings=structuredClone(s); for (const p of room.players) p.ready=false; } break;
case 'start': organizer(); lobby(); { const players=room.players.filter(p=>!p.left); if (players.length<3 || players.length>8 || players.some(p=>!p.ready || !connected(p,now))) fail('NOT_READY'); const selected=select(room); if (!selected.word || !players.some(p=>p.uid===selected.imposter) || selected.order.length!==players.length || new Set(selected.order).size!==players.length || selected.order.some(id=>!players.some(p=>p.uid===id))) fail('INVALID_SELECTION'); room.round++; room.word=selected.word; room.imposter=selected.imposter; room.order=selected.order; room.used.push(normalizeGuess(selected.word.word)); room.turn=0; room.clues=[]; room.acks=[]; room.votes={}; room.firstVotes=undefined; room.candidates=[]; room.guess=undefined; room.result=undefined; bump(room,'reveal',now+60000); } break;
case 'ack': if (room.phase!=='reveal') fail('INVALID_PHASE'); if (!room.acks.includes(uid)) room.acks.push(uid); if (room.order.every(id=>room.acks.includes(id) || departed(room,id))) enterClues(room,now); break;
case 'clue': if (room.phase!=='clues' || room.order[room.turn % room.order.length]!==uid) fail('NOT_TURN'); { const text=intent.text ?? ''; if (room.settings.mode==='typed' && (typeof text !== 'string' || !/^[\p{L}\p{M}]{1,40}$/u.test(text) || !/\p{L}/u.test(text))) fail('INVALID_CLUE'); room.clues.push({uid,text:room.settings.mode==='typed'?text:null}); nextClue(room,now); } break;
case 'startVote': organizer(); if (room.phase !== 'discussion') fail('INVALID_PHASE'); startVote(room, now); break;
case 'vote': if (room.phase!=='vote' && room.phase!=='runoff') fail('INVALID_PHASE'); if (Object.hasOwn(room.votes,uid)) fail('ALREADY_VOTED'); if (intent.target!==null && (intent.target===uid || !room.candidates.includes(intent.target))) fail('INVALID_VOTE'); room.votes[uid]=intent.target; break;
case 'guess': if (room.phase!=='guess' || room.imposter!==uid) fail('INVALID_PHASE'); if (typeof intent.text!=='string' || !intent.text.trim() || intent.text.length>100) fail('INVALID_GUESS'); room.guess=intent.text.trim(); finish(room,guessMatches(room.guess,room.word!)?'imposter':'insiders'); break;
case 'cancel': organizer(); if (!activePhases.includes(room.phase)) fail('INVALID_PHASE'); cancelRound(room); break;
default: fail('INVALID_INTENT'); }
// Heartbeats are naturally idempotent; recording them would grow the room by ~18KB per player-hour.
if (intent.type!=='heartbeat') room.receipts[receiptKey]=fingerprint; return reconcile(room,now); }











