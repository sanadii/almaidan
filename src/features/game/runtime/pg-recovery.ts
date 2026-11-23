import type { ClientRole, ProjectionEnvelope } from './contracts.js';
import type { PgRoomContext } from './room-context.js';

export interface PgEvent { sequence: string; revision: string; kind: 'CHANGED' }
export interface PgFrame {
 schemaVersion: 'huroof-realtime-v1'; namespace: string; projectId: string; roomId: string; roomGeneration: string; memberGeneration: string; policyRevision: string; policyHash: string; principal: string; role: ClientRole; stage: 'SETUP' | 'PAID'; revision: string; throughSequence: string; readAt: string; snapshot: ProjectionEnvelope; terminal: null | { version: string; hash: string }; replay: { mode: 'SNAPSHOT' | 'REPLAY' | 'RESET'; events: PgEvent[] };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const counter = (v: unknown): v is string => typeof v === 'string' && v.length <= 16 && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\u0000-\u001f]/.test(v);
const forbidden = /^(?:token|authorization|credential|password|secret|raw|rawBytes|privateState|memberBindings|identityId|intent|outcome|artifact|admission|policyHash|sourceBytes)$/i;
function bounded(v: unknown, depth = 0): boolean {
 if (depth > 32) return false;
 if (v === null || typeof v === 'boolean' || typeof v === 'string') return typeof v !== 'string' || v.length <= 32768;
 if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
 if (Array.isArray(v)) return v.length <= 217 && v.every(x => bounded(x, depth + 1));
 return record(v) && Object.keys(v).length <= 80 && Object.entries(v).every(([k,x]) => !forbidden.test(k) && bounded(x, depth + 1));
}
function allowed(v: unknown, keys: string[]): v is Record<string, unknown> { return record(v) && exact(v, keys); }
export const exactEnum=(v:unknown, values:readonly string[]):v is string => typeof v==='string' && values.includes(v);
const team=(v:unknown) => v==='horizontal' || v==='vertical';
const integer=(v:unknown) => Number.isSafeInteger(v) && Number(v)>=0;
const optional=(v:Record<string,unknown>,key:string,test:(v:unknown)=>boolean) => v[key]===undefined || test(v[key]);
const str=(v:unknown) => typeof v==='string';
const bool=(v:unknown) => typeof v==='boolean';
const rootKeys = ['room','messageAr','demo','board','activeCellId','deadlineAt','buzzOpen','matchRule','currentRound','questionScores','roundWins','currentStreak','roundResults','matchWinner','matchWinReason','contentHold','endedWithoutWinner','entitledTeam','answeringTeam','winningPath','correction','self','buzzWinner','question','challenge'];
function validChallenge(value:unknown,role:ClientRole):boolean {
 const keys=['protocolVersion','kind','recipient','occurrence','revision','assignmentGeneration','disclosureGeneration','stage','entitledTeam','answeringTeam','paused','strikes','readiness','assignments','readinessSummary','legalActions','timing','deadlineAt','result','attemptsClosed','solutionRevealed','stimulus'];
 if(!allowed(value,keys) || !bounded(value) || value.protocolVersion!=='t36-challenge-runtime-v1' || !exactEnum(value.kind,['navigation','missing_tile','memory','qatar_map','word_search']) || !exactEnum(value.recipient,role==='host'?['host']:role==='audience'?['audience']:['waiting','guide','mover','captain','stealCaptain']) || !text(value.occurrence) || !integer(value.revision) || !integer(value.assignmentGeneration) || !integer(value.disclosureGeneration) || !exactEnum(value.stage,['setup','countdown','observation','answer','steal_offer','steal','result','void']) || !team(value.entitledTeam) || !team(value.answeringTeam) || typeof value.paused!=='boolean' || !integer(value.strikes) || typeof value.attemptsClosed!=='boolean' || typeof value.solutionRevealed!=='boolean' || (value.solutionRevealed && !value.attemptsClosed) || !optional(value,'result',x=>exactEnum(x,['correct','failed','void'])) || !optional(value,'deadlineAt',x=>typeof x==='string' && Number.isFinite(Date.parse(x)))) return false;
 if(!allowed(value.readiness,['protocolHash','assignmentHash','stimulusHash','required','acknowledged']) || !text(value.readiness.protocolHash) || !text(value.readiness.assignmentHash) || !text(value.readiness.stimulusHash) || typeof value.readiness.required!=='boolean' || typeof value.readiness.acknowledged!=='boolean' || !allowed(value.assignments,['guide','mover','captain','stealCaptain']) || Object.values(value.assignments).some(x=>!text(x)) || !allowed(value.timing,['countdownSeconds','answerSeconds','observationSeconds']) || !integer(value.timing.countdownSeconds) || !optional(value.timing,'answerSeconds',integer) || !optional(value.timing,'observationSeconds',integer)) return false;
 if(value.readinessSummary!==undefined && (role!=='host' || !Array.isArray(value.readinessSummary) || value.readinessSummary.some(x=>!allowed(x,['participantId','acknowledged']) || !text(x.participantId) || typeof x.acknowledged!=='boolean'))) return false;
 const actions=role==='host'?(value.attemptsClosed?['REVEAL','CONTINUE']:value.paused?['RESUME','VOID']:value.stage==='setup'?['ASSIGN','READY','START','VOID']:value.stage==='steal_offer'?['START_STEAL','DECLINE_STEAL','VOID']:value.stage==='answer'?['PAUSE','VOID',...(typeof value.assignments.mover==='string' && value.assignments.mover.startsWith('manual:')?['MOVE']:[]),...(typeof value.assignments.captain==='string' && value.assignments.captain.startsWith('manual:')?['SUBMIT']:[])]:value.stage==='steal'?['PAUSE','VOID',...(typeof value.assignments.stealCaptain==='string' && value.assignments.stealCaptain.startsWith('manual:')?['SUBMIT']:[])]:['PAUSE','VOID']):role==='audience'?[]:value.stage==='setup' && value.recipient!=='waiting'?['READY']:value.stage==='answer' && value.recipient==='mover'?['MOVE']:((value.stage==='answer' && value.recipient==='captain')||(value.stage==='steal' && value.recipient==='stealCaptain'))?['SUBMIT']:[];
 if(!Array.isArray(value.legalActions) || value.legalActions.some(x=>typeof x!=='string' || !actions.includes(x))) return false;
 if(value.stimulus===undefined) return true;
 if(!record(value.stimulus)) return false;
 const stimulus=value.stimulus,keysForKind:Record<string,string[]>={navigation:value.recipient==='guide'?['rows','columns','start','goal','blocked','current','reveal']:['rows','columns','start','current','confirmedEdges','reveal'],missing_tile:['rows','columns','cells','options','rule','promptAr','reveal'],memory:['rows','columns','palette','showSeconds','answerSeconds','instructionAr','cells','promptAr','answerSlots','reveal'],qatar_map:['mode','markers','optionIds','promptAr','namedPoints','reveal'],word_search:['rows','columns','grid','clueAr','reveal']};
 if(!allowed(stimulus,keysForKind[String(value.kind)]) || (value.paused && Object.keys(stimulus).length>0) || (stimulus.reveal!==undefined && (!value.solutionRevealed || !value.attemptsClosed))) return false;
 if(value.kind==='memory' && stimulus.cells!==undefined && value.stage!=='observation') return false;
 if((value.stage==='setup'||value.stage==='countdown') && !['memory','missing_tile'].includes(String(value.kind))) return false;
 if((value.stage==='setup'||value.stage==='countdown') && value.kind==='memory' && !allowed(stimulus,['rows','columns','palette','showSeconds','answerSeconds'])) return false;
 if((value.stage==='setup'||value.stage==='countdown') && value.kind==='missing_tile' && !allowed(stimulus,['rule'])) return false;
 if(value.kind==='qatar_map' && stimulus.mode!==undefined && (!exactEnum(stimulus.mode,['identify','direction','order']) || (stimulus.mode==='identify' && stimulus.namedPoints!==undefined))) return false;
 const revealKeys:Record<string,string[]>={navigation:['directions'],missing_tile:['correctOptionId'],memory:['answers'],qatar_map:['answerIds'],word_search:['paths']};
 if(stimulus.reveal!==undefined && !allowed(stimulus.reveal,revealKeys[String(value.kind)])) return false;
 const point=(x:unknown)=>allowed(x,['row','column']) && integer(x.row) && integer(x.column);
 for(const key of ['start','goal','current']) if(stimulus[key]!==undefined && !point(stimulus[key])) return false;
 if(stimulus.blocked!==undefined && (!Array.isArray(stimulus.blocked) || stimulus.blocked.some(x=>!point(x)))) return false;
 const listFields:Record<string,string[]>={cells:value.kind==='memory'?['row','column','colorAr','hex','shapeAr']:['row','column','id','labelAr','shape','hex','bitmask','missing'],options:['id','labelAr','shape','hex','bitmask'],palette:['nameAr','hex'],markers:['id','x','y'],namedPoints:['id','nameAr']};
 for(const [key,fields] of Object.entries(listFields)) if(stimulus[key]!==undefined && (!Array.isArray(stimulus[key]) || (stimulus[key] as unknown[]).some(x=>!allowed(x,fields)))) return false;
 for(const key of ['rows','columns','showSeconds','answerSeconds','answerSlots']) if(!optional(stimulus,key,integer)) return false;
 for(const key of ['rule','promptAr','instructionAr','mode','clueAr']) if(!optional(stimulus,key,str)) return false;
 for(const key of ['optionIds','confirmedEdges']) if(stimulus[key]!==undefined && (!Array.isArray(stimulus[key]) || (stimulus[key] as unknown[]).some(x=>!text(x)))) return false;
 if(stimulus.grid!==undefined && (!Array.isArray(stimulus.grid) || stimulus.grid.some(row=>!Array.isArray(row) || row.some(cell=>typeof cell!=='string')))) return false;
 for(const [key,fields] of Object.entries(listFields)) if(Array.isArray(stimulus[key])) for(const item of stimulus[key] as Record<string,unknown>[]) {
  const required=key==='cells'?(value.kind==='memory'?['row','column','colorAr','hex','shapeAr']:item.missing===true?['row','column','missing']:['row','column','id','labelAr','shape','hex']):key==='options'?['id','labelAr','shape','hex']:key==='palette'?['nameAr','hex']:key==='markers'?['id','x','y']:['id','nameAr'];
  if(!required.every(field=>Object.hasOwn(item,field)) || (key==='cells' && item.missing===true && Object.keys(item).length!==3)) return false;
  for(const [field,entry] of Object.entries(item)) {
   if(!fields.includes(field)) return false;
   if(['row','column','bitmask'].includes(field) && !integer(entry)) return false;
   if(['x','y'].includes(field) && (typeof entry!=='number' || !Number.isFinite(entry))) return false;
   if(field==='missing' && typeof entry!=='boolean') return false;
   if(!['row','column','bitmask','x','y','missing'].includes(field) && typeof entry!=='string') return false;
  }
 }
 if(record(stimulus.reveal)) {
  const reveal=stimulus.reveal;
  for(const key of ['directions','answers','answerIds']) if(reveal[key]!==undefined && (!Array.isArray(reveal[key]) || (reveal[key] as unknown[]).some(x=>typeof x!=='string'))) return false;
  if(reveal.correctOptionId!==undefined && typeof reveal.correctOptionId!=='string') return false;
  if(reveal.paths!==undefined && (!Array.isArray(reveal.paths) || reveal.paths.some(x=>!allowed(x,['start','end']) || !point(x.start) || !point(x.end)))) return false;
 }
 return true;
}
function validProjection(v: unknown, role: ClientRole, principal: string): v is ProjectionEnvelope['projection'] {
 if (!allowed(v,rootKeys) || !bounded(v) || !allowed(v.room,['roomCode','state','readyCount','memberCount','teams','members','matchSettings','audienceQuestionVisible','canStart','startBlockedReason'])) return false;
 if(v.challenge!==undefined && !validChallenge(v.challenge,role)) return false;
 const room=v.room;
 if (!text(room.roomCode) || !exactEnum(room.state,['LOBBY','ROUND_SETUP','CELL_SELECTION','LETTER_REVEAL','QUESTION_READING','FIRST_ANSWER','OPPONENT_CHANCE','QUESTION_FAILED','CELL_AWARDED','PATH_CHECK','ROUND_COMPLETE','MATCH_COMPLETE','PAUSED','CORRECTION']) || !Number.isSafeInteger(room.readyCount) || Number(room.readyCount)<0 || !Number.isSafeInteger(room.memberCount) || Number(room.memberCount)<0) return false;
 if (room.members !== undefined && (!Array.isArray(room.members) || room.members.length > 217 || room.members.some(m => !allowed(m,['uid','manualParticipantId','participation','displayName','team','ready','role']) || !text(m.displayName) || typeof m.ready !== 'boolean' || !exactEnum(m.role,['host','player','audience']) || !optional(m,'uid',text) || !optional(m,'manualParticipantId',text) || !optional(m,'team',team) || !optional(m,'participation',x=>x==='manual') || (role !== 'host' && ('uid' in m || 'manualParticipantId' in m))))) return false;
 if (v.self !== undefined && (!allowed(v.self,['uid','ready','team','canBuzz','isBuzzWinner']) || v.self.uid !== principal || typeof v.self.ready !== 'boolean' || typeof v.self.canBuzz !== 'boolean' || !optional(v.self,'team',team) || !optional(v.self,'isBuzzWinner',bool) || role === 'audience')) return false;
 if (v.question !== undefined) {
  if (!allowed(v.question,['occurrence','headerAr','promptAr','media','revealedAnswer','primaryAnswer','acceptedAnswers','sources'])) return false;
  if (role !== 'host' && ('primaryAnswer' in v.question || 'acceptedAnswers' in v.question || 'sources' in v.question)) return false;
  if (role==='player' && ('media' in v.question || 'revealedAnswer' in v.question)) return false;
  if (v.question.media !== undefined && (!allowed(v.question.media,['mediaId','assetSha256','altAr','type','contentType','audiencePresentation']) || !text(v.question.media.mediaId) || typeof v.question.media.assetSha256!=='string' || !/^[a-f0-9]{64}$/.test(v.question.media.assetSha256) || typeof v.question.media.altAr!=='string' || !optional(v.question.media,'type',x=>x==='image'||x==='video') || !optional(v.question.media,'contentType',str) || !optional(v.question.media,'audiencePresentation',x=>x==='clear'||x==='concealed'))) return false;
  for(const k of ['occurrence','headerAr','promptAr','revealedAnswer','primaryAnswer']) if(v.question[k]!==undefined && typeof v.question[k]!=='string') return false;
  if(v.question.acceptedAnswers!==undefined && (!Array.isArray(v.question.acceptedAnswers) || v.question.acceptedAnswers.some(x=>typeof x!=='string'))) return false;
  if (v.question.sources !== undefined && (!Array.isArray(v.question.sources) || v.question.sources.some(s => {
   if(!allowed(s,['title','url']) || (s.title!==undefined && typeof s.title!=='string') || (s.url!==undefined && typeof s.url!=='string')) return true;
   if(typeof s.url==='string') { try { const u=new URL(s.url); if(!['http:','https:'].includes(u.protocol) || u.username || u.password || [...u.searchParams.keys()].some(k=>/token|secret|credential|signature|key/i.test(k))) return true; } catch { return true; } }
   return false;
  }))) return false;
 }
 if (v.board !== undefined && (!Array.isArray(v.board) || v.board.length > 217 || v.board.some(c => !allowed(c,['id','q','r','kind','visibleValue','revealedLetter','categoryId','categoryLabelAr','categoryOccurrence','owner']) || !text(c.id) || !Number.isSafeInteger(c.q) || !Number.isSafeInteger(c.r) || !exactEnum(c.kind,['letter','surprise','category']) || typeof c.visibleValue!=='string' || !optional(c,'revealedLetter',str) || !optional(c,'categoryId',str) || !optional(c,'categoryLabelAr',str) || !optional(c,'categoryOccurrence',integer) || !optional(c,'owner',team)))) return false;
 if (room.teams !== undefined && (!allowed(room.teams,['horizontal','vertical']) || !text(room.teams.horizontal) || !text(room.teams.vertical))) return false;
 for(const k of ['audienceQuestionVisible','canStart']) if(!optional(room,k,bool)) return false;
 if(!optional(room,'startBlockedReason',str)) return false;
 if (room.matchSettings !== undefined) {
  if (!allowed(room.matchSettings,['demo','gameKind','questionSeconds','opponentSeconds','teams','categories','modality','difficulty','mode','showQuestionOnAudience','labelledColours','expectedRelease'])) return false;
  const settings=room.matchSettings;
  if(settings.teams!==undefined && (!allowed(settings.teams,['horizontal','vertical']) || !text(settings.teams.horizontal) || !text(settings.teams.vertical))) return false;
  for(const k of ['demo','showQuestionOnAudience','labelledColours']) if(!optional(settings,k,bool)) return false;
  for(const k of ['questionSeconds','opponentSeconds']) if(!optional(settings,k,integer)) return false;
  for(const k of ['gameKind','modality','difficulty','mode']) if(!optional(settings,k,str)) return false;
  if(settings.expectedRelease!==undefined && (!allowed(settings.expectedRelease,['releaseId','releaseRootSha256']) || !text(settings.expectedRelease.releaseId) || typeof settings.expectedRelease.releaseRootSha256!=='string' || !/^[a-f0-9]{64}$/.test(settings.expectedRelease.releaseRootSha256))) return false;
  if(settings.categories!==undefined && (!Array.isArray(settings.categories) || settings.categories.some(x=>!text(x)))) return false;
 }
 const nested:Record<string,string[]>={matchRule:['ruleSet','victoryAr'],questionScores:['horizontal','vertical'],roundWins:['horizontal','vertical'],currentStreak:['team','count'],contentHold:['reason','operation','cellId'],correction:['cellId','owner','priorOwner','reason'],buzzWinner:['displayName','team','method']};
 for(const [key,keys] of Object.entries(nested)) if(v[key]!==undefined && !allowed(v[key],keys)) return false;
 if(v.roundResults!==undefined && (!Array.isArray(v.roundResults) || v.roundResults.some(x=>!allowed(x,['round','winner']) || !integer(x.round) || !team(x.winner)))) return false;
 for(const k of ['messageAr','activeCellId','matchWinReason']) if(!optional(v,k,str)) return false;
 for(const k of ['demo','buzzOpen','endedWithoutWinner']) if(!optional(v,k,bool)) return false;
 for(const k of ['currentRound']) if(!optional(v,k,integer)) return false;
 for(const k of ['matchWinner','entitledTeam','answeringTeam']) if(!optional(v,k,team)) return false;
 if(v.deadlineAt!==undefined && (typeof v.deadlineAt!=='string' || !Number.isFinite(Date.parse(v.deadlineAt)))) return false;
 for(const k of ['questionScores','roundWins']) if(v[k]!==undefined && (!record(v[k]) || !integer((v[k] as Record<string,unknown>).horizontal) || !integer((v[k] as Record<string,unknown>).vertical))) return false;
 if(v.currentStreak!==undefined && (!record(v.currentStreak) || !integer(v.currentStreak.count) || !optional(v.currentStreak,'team',team))) return false;
 if(v.matchRule!==undefined && (!record(v.matchRule) || !exactEnum(v.matchRule.ruleSet,['v2','legacy-v1']) || !str(v.matchRule.victoryAr))) return false;
 if(v.correction!==undefined && (!record(v.correction) || !text(v.correction.cellId) || !str(v.correction.reason) || !optional(v.correction,'owner',team) || !optional(v.correction,'priorOwner',team))) return false;
 if(v.buzzWinner!==undefined && (!record(v.buzzWinner) || !str(v.buzzWinner.displayName) || !team(v.buzzWinner.team) || !exactEnum(v.buzzWinner.method,['host','player']))) return false;
 if(v.contentHold!==undefined && (!record(v.contentHold) || v.contentHold.reason!=='CONTENT_EXHAUSTED' || !exactEnum(v.contentHold.operation,['SELECT_CELL','START_NEXT_ROUND','CONTINUE']) || !optional(v.contentHold,'cellId',str))) return false;
 if(v.winningPath!==undefined && (!Array.isArray(v.winningPath) || v.winningPath.some(x=>!text(x)))) return false;
 return true;
}
/** Parse bytes before caching; no role can select a server projection. */
export function parsePgFrame(raw: string, expected: PgRoomContext, projectId: string): PgFrame {
 if (new TextEncoder().encode(raw).length > 524288) throw new Error('FRAME_TOO_LARGE');
 let v: unknown; try { v = JSON.parse(raw); } catch { throw new Error('INVALID_FRAME'); }
 if (!allowed(v,['schemaVersion','namespace','projectId','roomId','roomGeneration','memberGeneration','policyRevision','policyHash','principal','role','stage','revision','throughSequence','readAt','snapshot','terminal','replay']) || Object.keys(v).length !== 17 || v.schemaVersion !== 'huroof-realtime-v1' || v.namespace !== expected.namespace || v.projectId !== projectId || v.roomId !== expected.roomId || v.roomGeneration !== expected.roomGeneration || v.memberGeneration !== expected.memberGeneration || v.principal !== expected.principal || v.role !== expected.role || !exactEnum(v.stage,['SETUP','PAID']) || !counter(v.revision) || !counter(v.throughSequence) || !counter(v.policyRevision) || v.policyRevision==='0' || !counter(v.roomGeneration) || v.roomGeneration==='0' || !counter(v.memberGeneration) || v.memberGeneration==='0' || !text(v.namespace) || !text(v.projectId) || !text(v.roomId) || !text(v.principal) || typeof v.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.policyHash) || typeof v.readAt !== 'string' || !Number.isFinite(Date.parse(v.readAt))) throw new Error('INVALID_FRAME');
 if (new TextEncoder().encode(JSON.stringify(v.snapshot)).length > 262144 || !allowed(v.snapshot,['roomId','revision','serverTime','role','projection']) || v.snapshot.roomId !== v.roomId || v.snapshot.revision !== Number(v.revision) || v.snapshot.role !== v.role || v.snapshot.serverTime !== v.readAt || !validProjection(v.snapshot.projection,expected.role,expected.principal)) throw new Error('INVALID_SNAPSHOT');
 if ((v.stage==='SETUP' && (v.throughSequence!=='0' || v.snapshot.projection.room.state!=='LOBBY' || v.terminal!==null)) || (v.stage==='PAID' && (v.throughSequence==='0' || v.snapshot.projection.room.state==='LOBBY')) || (expected.locator && v.snapshot.projection.room.roomCode!==expected.locator.slice(3))) throw new Error('INVALID_SNAPSHOT');
 if (v.terminal !== null && (!allowed(v.terminal,['version','hash']) || !counter(v.terminal.version) || v.terminal.version==='0' || typeof v.terminal.hash !== 'string' || !/^[a-f0-9]{64}$/.test(v.terminal.hash) || v.snapshot.projection.room.state !== 'MATCH_COMPLETE')) throw new Error('INVALID_TERMINAL');
 if (v.snapshot.projection.room.state === 'MATCH_COMPLETE' && v.terminal === null) throw new Error('INVALID_TERMINAL');
 if (!allowed(v.replay,['mode','events']) || !exactEnum(v.replay.mode,['SNAPSHOT','REPLAY','RESET']) || !Array.isArray(v.replay.events) || v.replay.events.length > 64) throw new Error('INVALID_REPLAY');
 let previous = -1; for (const e of v.replay.events) { if (!allowed(e,['sequence','revision','kind']) || !counter(e.sequence) || !counter(e.revision) || e.kind !== 'CHANGED' || Number(e.sequence) <= previous || Number(e.sequence) > Number(v.throughSequence)) throw new Error('INVALID_REPLAY'); previous = Number(e.sequence); }
 if (v.replay.mode !== 'REPLAY' && v.replay.events.length) throw new Error('INVALID_REPLAY');
 return v as unknown as PgFrame;
}
/** Snapshot is current throughSequence; hints are never replayed onto it. */
export class PgRecovery {
 private current?: PgFrame;
 clear(): void { this.current = undefined; }
 cursor(): { afterSequence: string; afterRevision: string } | undefined { return this.current && { afterSequence:this.current.throughSequence, afterRevision:this.current.revision }; }
 install(frame: PgFrame): ProjectionEnvelope {
  const old=this.current;
  if (old && (Number(frame.revision)<Number(old.revision) || (old.stage==='PAID' && frame.stage!=='PAID') || (old.stage===frame.stage && Number(frame.throughSequence)<Number(old.throughSequence)))) throw new Error('STALE_SNAPSHOT');
  if (old && frame.replay.mode==='REPLAY') {
   if (frame.stage!==old.stage || Number(frame.throughSequence)<Number(old.throughSequence)) throw new Error('REPLAY_GAP');
   if (frame.stage==='SETUP') { if(frame.throughSequence!=='0' || frame.revision!==old.revision || frame.replay.events.length) throw new Error('REPLAY_GAP'); }
   else {
    let sequence=Number(old.throughSequence), revision=Number(old.revision);
    for(const event of frame.replay.events) { if(Number(event.sequence)!==++sequence || Number(event.revision)!==++revision) throw new Error('REPLAY_GAP'); }
    if(sequence!==Number(frame.throughSequence) || revision!==Number(frame.revision)) throw new Error('REPLAY_GAP');
   }
  }
  this.current=frame; return frame.snapshot;
 }
}



