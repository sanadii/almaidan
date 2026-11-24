import {localCatalogueCompatibility} from './compatibility';
import {createLocalRematches,createLocalRematchRouter} from './rematches';
import {LocalRoomStore,createLocalRooms} from './rooms';
import {createLocalRoomsRouter,localRoomMutationGuard} from './rooms-router';
import {registerLocalContentAdmin} from './content-admin';
import { LocalRoundStore } from './round-store';
import { createLocalRoundService } from '../rounds/service';
import { createRoundOwnerRouter, createRoundCapabilityRouter } from '../rounds/router';
import express, { type Request, type RequestHandler } from 'express';
import { firebaseAdminVerifier } from '../firebase-verifier';
import { principalFromClaims, type Principal } from '../identity';
import { EntaError } from '../gameplay/types';
import { readReviewedEpisodeRelease, projectPublicEpisodes } from '../episodes/public-catalog';
import { assertLocalDevelopment, LOCAL_PROJECT } from './guard';
import { createLocalStore } from './store';
import { createLocalEntaService } from './service';
import { LocalCompetitionStore } from './competition-store';
import { createLocalCompetitionService } from '../rounds/competition-service';
import { createCompetitionOwnerRouter, createCompetitionCapabilityRouter } from '../rounds/competition-router';
import { firebasePinnedByteReader } from '../rounds/media';
import { createLocalHistory, legacyHistoryEntry, roundHistoryEntry } from './history';
import { createHistoryRouter } from '../history-rematch/history-router';
import {createFavoritesRouter} from '../favorites/router';
import {createLocalFavorites} from './favorites';
import {localFavoritesKey} from './favorites-key';

// Explicit local entry point only. Not imported by any production factory.
async function main() {
  assertLocalDevelopment();
  const store=createLocalStore(); await store.initialize();
  const competitionStore=new LocalCompetitionStore();await competitionStore.initialize();
  const competition=createLocalCompetitionService(competitionStore); const roundStore=new LocalRoundStore();await roundStore.initialize();const rounds=createLocalRoundService(roundStore);
  // Local practice pins contain no media. A null bucket fails closed without any storage IO.
  const noMedia=firebasePinnedByteReader(LOCAL_PROJECT,null);
  const service=createLocalEntaService(store), verify=firebaseAdminVerifier(LOCAL_PROJECT);
  const roomStore=new LocalRoomStore();await roomStore.initialize();
  const rooms=createLocalRooms(roomStore,{
    classic:{get:(p,id)=>service.get(p,id),command:(p,id,command)=>service.command(p,id,command)},
    kids:{get:(p,id)=>service.get(p,id),command:(p,id,command)=>service.command(p,id,command)},
    round:{get:(p,id)=>rounds.get(p,id),command:(p,id,command)=>rounds.command(p,id,command),issueGrant:(p,id,command)=>rounds.grant(p,id,command),publicCanvas:(p,id,roundId,query)=>rounds.canvas(p,null,id,roundId,query),capability:token=>rounds.capability(token),canvas:(token,roundId,query,input)=>rounds.canvas(null,token,null,roundId,query,input)},
    competitive:{get:(p,id)=>competition.get(p,id),command:(p,id,command)=>competition.command(p,id,command),issueGrant:(p,id,command)=>competition.command(p,id,command),publicCanvas:(p,id,roundId,query)=>competition.canvas(p,null,id,roundId,query),capability:token=>competition.capability(token),canvas:(token,roundId,query,input)=>competition.canvas(null,token,null,roundId,query,input)},
  });
  const history=createLocalHistory([async p=>(await service.historyGames(p)).map(legacyHistoryEntry),async p=>(await competitionStore.historyGames(p)).map(g=>roundHistoryEntry(g,true)),async p=>(await roundStore.historyGames(p)).map(g=>roundHistoryEntry(g,false))]);
  const app=express(); app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')) {res.status(403).json({error:'LOCAL_ONLY'});return;}
    if(req.headers.host!=='127.0.0.1:14001'&&req.headers.host!=='localhost:14001') {res.status(403).json({error:'LOCAL_HOST_REQUIRED'});return;}
    const origin=req.headers.origin;
    if(origin&&!['http://127.0.0.1:5174','http://localhost:5174','http://127.0.0.1:5175','http://localhost:5175','http://127.0.0.1:14001'].includes(origin)) {res.status(403).json({error:'LOCAL_ORIGIN_REQUIRED'});return;}
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');next();
  });
  app.use(express.json({limit:'32kb'}));
  type OwnerRequest=Request&{principal:Principal};
  const authenticate:RequestHandler=async(req,res,next)=>{try {const header=req.get('authorization');if(!header?.startsWith('Bearer ')){res.status(401).json({error:'AUTHENTICATION_REQUIRED'});return;} (req as OwnerRequest).principal=principalFromClaims(await verify(header.slice(7)),LOCAL_PROJECT);next();}catch{res.status(401).json({error:'INVALID_ID_TOKEN'});}};
  const handle=(work:(req:OwnerRequest)=>Promise<unknown>,created=false):RequestHandler=>async(req,res)=>{try {const data=await work(req as OwnerRequest);res.status(created&&!(data as {idempotent?:boolean}).idempotent?201:200).json(data);}catch(error){res.status(error instanceof EntaError?error.status:503).json({error:error instanceof EntaError?error.code:'LOCAL_SERVICE_UNAVAILABLE'});}};
  app.get('/api/v1/catalogue/compatibility',handle(async()=>localCatalogueCompatibility()));
  app.get('/api/v1/health',(_req,res)=>res.json({ok:true,service:'enta-local-development',apiVersion:1,localOnly:true,payments:false}));
  app.get('/api/v1/episodes',handle(async()=>projectPublicEpisodes(await readReviewedEpisodeRelease())));
  const account:RequestHandler=(req,res)=>{const p=(req as OwnerRequest).principal;res.json({uid:p.uid,projectId:p.projectId,account:p.verifiedAccount?'verified':p.anonymous?'anonymous':'unverified',capabilities:{canJoin:true,canHost:p.verifiedAccount,canClaimFreeGrant:false,canCheckout:false,adminScopes:[]}});};
  app.get(['/api/v1/account','/api/v1/me'],authenticate,account);
  app.post('/api/v1/account',authenticate,handle(async req=>{if(!req.principal.verifiedAccount)throw new EntaError(403,'VERIFIED_ACCOUNT_REQUIRED');await store.transaction(req.principal.uid,async()=>undefined);return {uid:req.principal.uid,projectId:LOCAL_PROJECT,identityRegistered:true};}));
  app.use('/api/v1/account/favorites',createFavoritesRouter(authenticate,createLocalFavorites(store,await localFavoritesKey(),Date.now)));
  app.use('/api/v1/enta/local-rematches',createLocalRematchRouter(createLocalRematches(roundStore,competitionStore),authenticate));
  app.use('/api/v1/enta/rooms',createLocalRoomsRouter(rooms,authenticate));
  app.use('/api/v1/enta',localRoomMutationGuard(rooms,authenticate));
  const router=express.Router();router.use(authenticate);
  router.get('/catalog',handle(req=>service.catalog(req.principal)));
  router.get('/catalog/kids',handle(req=>service.kidsCatalog(req.principal)));
  router.post('/matches/classic',handle(req=>service.start(req.principal,req.body),true));
  router.post('/matches/kids',handle(req=>service.startKids(req.principal,req.body),true));
  app.use('/api/v1/enta',createHistoryRouter(authenticate,history));
  router.get('/matches/:id/rematch-setup',handle(req=>service.rematchSetup(req.principal,req.params.id)));
  router.post('/matches/:id/rematch',handle(req=>service.rematch(req.principal,req.params.id,req.body),true));
  router.get('/matches/:id',handle(req=>service.get(req.principal,req.params.id)));
  router.post('/matches/:id/commands',handle(req=>service.command(req.principal,req.params.id,req.body)));
  app.use('/api/v1/enta/competition/capability',createCompetitionCapabilityRouter(competition,noMedia));
  app.use('/api/v1/enta/competition',createCompetitionOwnerRouter(competition,authenticate,noMedia));
  app.use('/api/v1/enta/capability',createRoundCapabilityRouter(rounds,noMedia));
  app.use('/api/v1/enta',createRoundOwnerRouter(rounds,authenticate,noMedia));
  app.use('/api/v1/enta',router);
  const contentAdmin=await registerLocalContentAdmin(app,authenticate);
  app.use((_req,res)=>res.status(404).json({error:'NOT_AVAILABLE_LOCALLY'}));
  const server=app.listen(14001,'127.0.0.1',()=>console.log('Almaidan local development API listening on 127.0.0.1:14001; practice content; payments disabled'));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close(()=>{void Promise.all([contentAdmin.close(),store.close(),competitionStore.close(),roundStore.close(),roomStore.close()]).then(()=>process.exit(0));}));
}
void main().catch((error:unknown)=>{
  // Report the cause without leaking connection strings or credentials.
  const code=typeof (error as {code?:unknown})?.code==='string'?` ${(error as {code:string}).code}`:'';
  const message=(error instanceof Error?error.message:String(error)).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,'<redacted-url>').slice(0,300);
  console.error(`LOCAL_STARTUP_FAILED${code}: ${message}`);process.exitCode=1;
});




