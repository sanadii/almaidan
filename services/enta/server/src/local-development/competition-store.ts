import {CURRENT_CATEGORY_PROJECTION} from './category-projection';
import {realContentEnabled} from './real-content';
import {type LocalRematchContext,type SavedSourceGame,type LocalSourceMetadata,localContentIdentity,requirePredecessor,rematchBinding,assertRematchReplay,retainedCompetitionCatalog} from './rematch-source';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { reconcileCapacity } from '../rounds/competition-capacity';
import { reduceCompetitionCommand } from '../rounds/competition-engine';
import { settleCompetitiveClock } from '../rounds/competition-clock';
import { authorizeCompetitiveGrant } from '../rounds/competition-grants';
import { addEffect, competitiveEvent, sealEffect } from '../rounds/competition-effects';
import { newCompetitionGame } from '../rounds/competition-selection';
import type { CompetitionGame, CompetitionRepository, CompetitionTransaction } from '../rounds/competition-types';
import { localCompetitionCatalogue } from './competition-catalogue';
import { assertLocalDevelopment, LOCAL_PROJECT } from './guard';
type Stored=CompetitionGame&LocalSourceMetadata&{localCreatedAt:number;localFinishedAt:number|null};
type State={games:Record<string,Stored>;audits:Record<string,{id:string;hash:string}>};
const own=<T>(map:Record<string,T>,key:string):T|undefined=>Object.hasOwn(map,key)?map[key]:undefined;
const put=<T>(map:Record<string,T>,key:string,value:T)=>{Object.defineProperty(map,key,{value,enumerable:true,writable:true,configurable:true});};
/** Local-only singleton locking intentionally favors simple durable serialization over production scale. */
export class LocalCompetitionStore implements CompetitionRepository {
 readonly source='local-development' as const;readonly projectId=LOCAL_PROJECT;
 private readonly prisma=new PrismaClient({datasourceUrl:assertLocalDevelopment()});
 async initialize(){await this.prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS local_development');await this.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.competition_state (id integer PRIMARY KEY CHECK(id=1),data jsonb NOT NULL)');await this.prisma.$executeRaw(Prisma.sql`INSERT INTO local_development.competition_state(id,data) VALUES (1,${JSON.stringify({games:{},audits:{}})}::jsonb) ON CONFLICT DO NOTHING`);}
 close(){return this.prisma.$disconnect();}
 async historyGames(p:{projectId:string;uid:string}){assertLocalDevelopment();const rows=await this.prisma.$queryRaw<{data:State}[]>(Prisma.sql`SELECT data FROM local_development.competition_state WHERE id=1`);return Object.values(rows[0]?.data.games??{}).filter(g=>g.projectId===p.projectId&&g.hostUid===p.uid);}
 async transaction<T>(work:(tx:CompetitionTransaction)=>Promise<T>,context?:LocalRematchContext):Promise<T>{assertLocalDevelopment();return this.prisma.$transaction(async db=>{
   const rows=await db.$queryRaw<{data:State}[]>(Prisma.sql`SELECT data FROM local_development.competition_state WHERE id=1 FOR UPDATE`);const state=rows[0]?.data??fail(503,'LOCAL_STORE_UNAVAILABLE');const beforeState=JSON.stringify(state);const games=()=>Object.values(state.games);const load=(id:string)=>structuredClone(own(state.games,id)??null);const save=(game:CompetitionGame)=>put(state.games,game.id,{...structuredClone(game),localCreatedAt:(game as Stored).localCreatedAt??game.events[0]?.at??Date.now(),localFinishedAt:game.finished?((game as Stored).localFinishedAt??Date.now()):null});
   const predecessor=context?requirePredecessor(load(context.predecessorId),context,true):null;
   if(predecessor&&!predecessor.localContentIdentity&&!realContentEnabled()){const original=load(predecessor.id)!;const previous=games().filter(g=>g.hostUid===predecessor.hostUid&&g.projectId===predecessor.projectId&&g.localCreatedAt<original.localCreatedAt);const reconstructed=localCompetitionCatalogue(new Set(previous.flatMap(g=>g.rounds.map(r=>r.pin.sourceId))));if(reconstructed.base.baseReleaseId===predecessor.intent.baseReleaseId&&reconstructed.base.baseRoot===predecessor.intent.baseRoot&&reconstructed.base.formatReleaseId===predecessor.intent.formatReleaseId&&reconstructed.base.formatRoot===predecessor.intent.formatRoot&&reconstructed.base.mediaRoot===predecessor.intent.mediaRoot&&reconstructed.proofRoot===(predecessor as CompetitionGame).intent.proofRoot)predecessor.localContentIdentity=localContentIdentity();}
   const result=await work({
    lockWallet:async p=>({identityId:p.uid,available:999999n,debt:0n}),
    findStart:async(p,key,logical)=>{const game=structuredClone(games().find(g=>g.projectId===p.projectId&&g.hostUid===p.uid&&(g.request.requestKey===key||g.id===logical))??null);if(context)assertRematchReplay(game,predecessor!,context);return game;},
    catalog:async p=>context&&rematchBinding(predecessor!,context).selection==='RETAINED_PINS'?retainedCompetitionCatalog(predecessor as CompetitionGame):localCompetitionCatalogue(new Set(games().filter(g=>g.hostUid===p.uid&&g.projectId===p.projectId).flatMap(g=>g.rounds.map(r=>r.pin.sourceId)))),
    exposures:async(p,format,category)=>games().filter(g=>g.projectId===p.projectId&&g.hostUid===p.uid&&g.request.executionFormat===format).flatMap(g=>g.intent.selection.map(s=>({categoryKey:s.categoryKey,sourceNamespace:s.sourceNamespace,sourceId:s.sourceId,cycle:s.cycle}))).filter(e=>e.categoryKey===category),
    create:async(p,request,intent,pins,catalog)=>{if(own(state.games,request.logicalMatchId))fail(409,'IDEMPOTENCY_KEY_CONFLICT');const game=newCompetitionGame(p,p.uid,request,intent,pins,catalog);game.admissionId='local-no-payment';Object.assign(game,{localContentIdentity:context?predecessor!.localContentIdentity:localContentIdentity(),...(context?predecessor!.localCategoryProjectionVersion?{localCategoryProjectionVersion:predecessor!.localCategoryProjectionVersion}:{}:realContentEnabled()?{localCategoryProjectionVersion:CURRENT_CATEGORY_PROJECTION}:{}),...(context?{localRematch:rematchBinding(predecessor!,context)}:{})});save(game);return game;},
    loadOwner:async(p,id)=>{const game=load(id);return game?.projectId===p.projectId&&game.hostUid===p.uid?game:null;},
    locateGrant:async hash=>{const game=games().find(g=>g.grants.some(grant=>grant.tokenHash===hash));return game?{gameId:game.id}:null;},
    loadGrant:async(id,hash)=>{const game=load(id);return game?.grants.some(g=>g.tokenHash===hash)?game:null;},
    save:async(before,proposed,command)=>{
      const current=load(before.id)??fail(404,'MATCH_NOT_FOUND');if(current.version!==before.version)fail(409,'STALE_VERSION');const now=Date.now();let next:CompetitionGame=structuredClone(current),rejection:'ROUND_TIME_EXPIRED'|'RESOURCE_LIMIT_REACHED'|null=null;
      const authority=proposed.events.at(-1)?.authority;if(authority?.kind==='GRANT'){const grant=current.grants.find(g=>g.id===authority.grantId)??fail(403,'GRANT_DENIED');authorizeCompetitiveGrant(current,grant.tokenHash,now);}
      if(command&&'expectedVersion' in command){const reduced=reduceCompetitionCommand(current,command,now);next=reduced.next;rejection=reduced.rejection;
        if(!rejection&&['CREATE_GRANT','ROTATE_GRANT','REVOKE_GRANT'].includes(command.type)){const proposedEvent=proposed.events.find(e=>e.commandId===command.commandId),actualEvent=next.events.find(e=>e.commandId===command.commandId),proposedGrant=proposed.grants.find(g=>g.id===proposedEvent?.id),actualGrant=next.grants.find(g=>g.id===actualEvent?.id);if(!proposedGrant||!actualGrant)fail(503,'GRANT_DATA_UNAVAILABLE');actualGrant!.tokenHash=proposedGrant!.tokenHash;}
      }else if(settleCompetitiveClock(next,now))rejection=command?'ROUND_TIME_EXPIRED':null;else if(command)next=proposed;
      save(next);return {game:next,rejection};
    },
    disclose:async(game,hash)=>{const current=load(game.id)??fail(404,'MATCH_NOT_FOUND'),before=structuredClone(current),now=Date.now(),allowed=authorizeCompetitiveGrant(current,hash,now);if(allowed.grant.role!=='ACTOR'||allowed.round.pin.format!=='DRAWING_TARGET')return current;const assignment=allowed.round.assignment!,targetHash=admissionHash({revisionId:allowed.round.pin.revisionId,revisionHash:allowed.round.pin.hash,target:allowed.round.pin.target});if(current.disclosures.some(d=>d.roundId===allowed.round.id&&d.assignmentId===assignment.id&&d.grantId===allowed.grant.id&&d.playerId===assignment.playerId&&d.targetHash===targetHash))return current;const e=competitiveEvent(current,randomUUID(),admissionHash({hash,targetHash,assignmentId:assignment.id}),'TARGET_DELIVERY',allowed.round.id,now,{kind:'GRANT',grantId:allowed.grant.id,generation:allowed.grant.generation,assignmentId:assignment.id});current.disclosures.push({id:e.id,roundId:allowed.round.id,targetRevisionId:allowed.round.pin.revisionId,targetHash,playerId:assignment.playerId,assignmentId:assignment.id,assignmentGeneration:assignment.generation,at:now,grantId:allowed.grant.id,grantGeneration:allowed.grant.generation});const effect=addEffect(current,e,allowed.round,'DISCLOSURE');sealEffect(effect);reconcileCapacity(before,current,null);save(current);return current;},
    audit:async(_p,game,command)=>{const key=JSON.stringify([game.id,command.commandId]),hash=admissionHash(command),existing=own(state.audits,key);if(existing){if(existing.hash!==hash)fail(409,'COMMAND_KEY_CONFLICT');return {id:existing.id,idempotent:true};}if(game.events.some(e=>e.commandId===command.commandId))fail(409,'COMMAND_KEY_CONFLICT');if(own(state.games,game.id)?.version!==command.expectedVersion)fail(409,'STALE_VERSION');if(Object.keys(state.audits).filter(k=>JSON.parse(k)[0]===game.id).length>=128)fail(409,'AUDIT_BUDGET_EXCEEDED');const record={id:randomUUID(),hash};put(state.audits,key,record);return {id:record.id,idempotent:false};},
    hasAuditCommand:async(_p,gameId,commandId)=>!!own(state.audits,JSON.stringify([gameId,commandId])),now:async()=>Date.now(),
   });const afterState=JSON.stringify(state);if(afterState!==beforeState)await db.$executeRaw(Prisma.sql`UPDATE local_development.competition_state SET data=${afterState}::jsonb WHERE id=1`);return result;
 },{maxWait:10000,timeout:20000});}
}







