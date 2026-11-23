import {CURRENT_CATEGORY_PROJECTION} from './category-projection';
import {realContentEnabled} from './real-content';
import {type LocalRematchContext,type SavedSourceGame,type LocalSourceMetadata,localContentIdentity,requirePredecessor,rematchBinding,assertRematchReplay,retainedRoundCatalog} from './rematch-source';
import {PrismaClient,Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {admissionHash} from '../admission/huroof-protocol.cjs';
import {fail} from '../gameplay/types';
import {reduceHost,settleClock} from '../rounds/engine';
import {authorizeGrant,issueGrant} from '../rounds/grants';
import type {RoundGame,RoundRepository,RoundTransaction,HostCommand,GrantCommand} from '../rounds/types';
import {localCompetitionCatalogue} from './competition-catalogue';
import {assertLocalDevelopment,LOCAL_PROJECT} from './guard';
type Stored=RoundGame&LocalSourceMetadata&{localCreatedAt:number;localFinishedAt:number|null};
export class LocalRoundStore implements RoundRepository {
 readonly source='local-development' as const;readonly projectId=LOCAL_PROJECT;
 private readonly prisma=new PrismaClient({datasourceUrl:assertLocalDevelopment()});
 async initialize(){await this.prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS local_development');await this.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.round_state (id integer PRIMARY KEY CHECK(id=1),data jsonb NOT NULL)');await this.prisma.$executeRaw(Prisma.sql`INSERT INTO local_development.round_state(id,data) VALUES(1,${JSON.stringify({games:{}})}::jsonb) ON CONFLICT DO NOTHING`);}
 close(){return this.prisma.$disconnect();}
 async historyGames(p:{projectId:string;uid:string}){assertLocalDevelopment();const rows=await this.prisma.$queryRaw<{data:{games:Record<string,Stored>}}[]>(Prisma.sql`SELECT data FROM local_development.round_state WHERE id=1`);return Object.values(rows[0]?.data.games??{}).filter(g=>g.projectId===p.projectId&&g.hostUid===p.uid);}
 async transaction<T>(work:(tx:RoundTransaction)=>Promise<T>,context?:LocalRematchContext):Promise<T>{assertLocalDevelopment();return this.prisma.$transaction(async db=>{
 const rows=await db.$queryRaw<{data:{games:Record<string,Stored>}}[]>(Prisma.sql`SELECT data FROM local_development.round_state WHERE id=1 FOR UPDATE`),state=rows[0]?.data??fail(503,'LOCAL_STORE_UNAVAILABLE');const beforeState=JSON.stringify(state);
 const games=()=>Object.values(state.games),load=(id:string)=>structuredClone(Object.hasOwn(state.games,id)?state.games[id]:null),save=(game:Stored)=>{Object.defineProperty(state.games,game.id,{value:structuredClone(game),enumerable:true,writable:true,configurable:true});};
 const predecessor=context?requirePredecessor(load(context.predecessorId),context,true):null;
 if(predecessor&&!predecessor.localContentIdentity&&!realContentEnabled()){const original=load(predecessor.id)!;const previous=games().filter(g=>g.hostUid===predecessor.hostUid&&g.projectId===predecessor.projectId&&g.localCreatedAt<original.localCreatedAt);const reconstructed=localCompetitionCatalogue(new Set(previous.flatMap(g=>g.rounds.map(r=>r.pin.sourceId)))).base;if(reconstructed.baseReleaseId===predecessor.intent.baseReleaseId&&reconstructed.baseRoot===predecessor.intent.baseRoot&&reconstructed.formatReleaseId===predecessor.intent.formatReleaseId&&reconstructed.formatRoot===predecessor.intent.formatRoot&&reconstructed.mediaRoot===predecessor.intent.mediaRoot)predecessor.localContentIdentity=localContentIdentity();}
 const result=await work({
 lockWallet:async p=>({identityId:p.uid,available:999999n,debt:0n}),
 findStart:async(p,key,id)=>{const game=structuredClone(games().find(g=>g.projectId===p.projectId&&g.hostUid===p.uid&&(g.request.requestKey===key||g.id===id))??null);if(context)assertRematchReplay(game,predecessor!,context);return game;},
 catalog:async(p,format)=>{if(context&&rematchBinding(predecessor!,context).selection==='RETAINED_PINS')return retainedRoundCatalog(predecessor!);const catalog=localCompetitionCatalogue(new Set(games().filter(g=>g.hostUid===p.uid&&g.projectId===p.projectId).flatMap(g=>g.rounds.map(r=>r.pin.sourceId)))).base;return {...catalog,categories:catalog.categories.filter(c=>format==='MIXED_BOARD'||c.format===(format==='STANDALONE_LIST'?'LIST_ITEMS':'ACTING_ITEMS'))};},
 exposures:async(p,format,key)=>games().filter(g=>g.projectId===p.projectId&&g.hostUid===p.uid&&g.request.executionFormat===format).flatMap(g=>g.intent.selection.map((s,i)=>({categoryKey:g.rounds[i].pin.categoryKey,sourceNamespace:s.sourceNamespace,sourceId:s.sourceId,cycle:s.cycle}))).filter(e=>e.categoryKey===key),
 create:async(p,request,intent,pins,catalog)=>{if(load(request.logicalMatchId))fail(409,'IDEMPOTENCY_KEY_CONFLICT');const game:Stored={id:request.logicalMatchId,identityId:p.uid,projectId:p.projectId,hostUid:p.uid,admissionId:'local-no-payment',localContentIdentity:context?predecessor!.localContentIdentity:localContentIdentity(),...(context?predecessor!.localCategoryProjectionVersion?{localCategoryProjectionVersion:predecessor!.localCategoryProjectionVersion}:{}:realContentEnabled()?{localCategoryProjectionVersion:CURRENT_CATEGORY_PROJECTION}:{}),...(context?{localRematch:rematchBinding(predecessor!,context)}:{}),request,clientHash:admissionHash(request),intent,intentHash:admissionHash(intent),version:1,finished:false,activeRoundId:null,turnIndex:0,resultReason:null,localCreatedAt:Date.now(),localFinishedAt:null,teams:request.setup.teams.map(t=>({...t,id:randomUUID(),score:0})),categories:request.setup.categories.map(r=>{const c=catalog.categories.find(c=>c.key===r.key)!;return {key:c.key,label:c.label,format:c.format,cover:c.cover};}),rounds:pins.map((pin,ordinal)=>({id:randomUUID(),questionId:randomUUID(),ordinal,pin,state:'READY',version:0,scoringTeamId:null,turnDeadline:null,overallDeadline:null,remainingTurn:null,remainingOverall:null,revealed:false,assignment:null,consumed:[],reason:null})),events:[],postings:[],grants:[],grantScopes:[],canvases:[]};save(game);return game;},
 loadOwner:async(p,id)=>{const g=load(id);return g?.projectId===p.projectId&&g.hostUid===p.uid?g:null;},
 locateGrant:async hash=>{const g=games().find(g=>g.grants.some(x=>x.tokenHash===hash));return g?{gameId:g.id}:null;},
 loadGrant:async(id,hash)=>{const g=load(id);return g?.grants.some(x=>x.tokenHash===hash)?g:null;},
 save:async(before,proposed,command)=>{
 const current=load(before.id)??fail(404,'MATCH_NOT_FOUND');if(current.version!==before.version)fail(409,'STALE_VERSION');const now=Date.now();let next=structuredClone(current),rejection:'ROUND_TIME_EXPIRED'|null=null;
 const authority=proposed.events.at(-1)?.authority;if(authority?.kind==='GRANT'){const grant=current.grants.find(g=>g.id===authority.grantId)??fail(403,'GRANT_DENIED');authorizeGrant(current,grant.tokenHash,now);}
 if(settleClock(next,now))rejection=command?'ROUND_TIME_EXPIRED':null;
 else if(command&&'expectedVersion' in command){if(['CREATE_GRANT','ROTATE_GRANT','REVOKE_GRANT'].includes(command.type)){next=issueGrant(current,command as GrantCommand,now).next as Stored;const pe=proposed.events.find(e=>e.commandId===command.commandId),ne=next.events.find(e=>e.commandId===command.commandId),pg=proposed.grants.find(g=>g.id===pe?.id),ng=next.grants.find(g=>g.id===ne?.id);if(!pg||!ng)fail(503,'GRANT_DATA_UNAVAILABLE');ng!.tokenHash=pg!.tokenHash;}else next=reduceHost(current,command as HostCommand,now) as Stored;}
 else if(command)next=proposed as Stored;
 if(next.finished&&!next.localFinishedAt)next.localFinishedAt=now;save(next);return {game:next,rejection};},
 now:async()=>Date.now(),
 });const afterState=JSON.stringify(state);if(afterState!==beforeState)await db.$executeRaw(Prisma.sql`UPDATE local_development.round_state SET data=${afterState}::jsonb WHERE id=1`);return result;
 },{maxWait:10000,timeout:20000});}
}






