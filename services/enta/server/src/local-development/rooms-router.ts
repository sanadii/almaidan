import {CompetitionCommandRejection} from '../rounds/competition-receipts';
import {CompetitionReviewError} from '../rounds/competition-corrections';
import {Router,type Request,type RequestHandler} from 'express';
import type {Principal} from '../identity';
import {EntaError} from '../gameplay/types';
import type {LocalRooms,RoomEngine} from './rooms';
type OwnerRequest=Request&{principal:Principal};
const errorPayload=(error:unknown)=>({error:error instanceof EntaError?error.code:'LOCAL_ROOMS_UNAVAILABLE',...(error instanceof CompetitionCommandRejection?{...(error.commandReceipt?{commandReceipt:error.commandReceipt}:{}),...(error.commandRejection?{commandRejection:error.commandRejection}:{})}:{}),...(error instanceof CompetitionReviewError?{blockingIds:error.blockingIds,truncated:error.truncated}:{})});
const bounded=(value:unknown)=>{if(Buffer.byteLength(JSON.stringify(value))>262144)throw new EntaError(503,'PROJECTION_BOUND_EXCEEDED');return value;};
export function createLocalRoomsRouter(service:LocalRooms,authenticate:RequestHandler){
 const router=Router();const handle=(work:(req:OwnerRequest)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{res.json(bounded(await work(req as OwnerRequest)));}catch(error){res.status(error instanceof EntaError?error.status:503).json(errorPayload(error));}};
 router.use((_req,res,next)=>{res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');next();});
 router.post('/',authenticate,handle(req=>service.attach(req.principal,req.body)));
 router.post('/:code/join',handle(req=>service.join(req.params.code,req.body)));
 router.get('/:code/view',handle(req=>service.view(req.params.code,req.get('x-enta-room-token')??'')));
 router.post('/:code/actions',handle(req=>service.participantCommand(req.params.code,req.get('x-enta-room-token')??'',req.body)));
 router.get('/:code/public-canvas',handle(req=>service.publicCanvas(req.params.code,req.get('x-enta-room-token')??'',req.query)));
 router.get('/:code/private',handle(req=>service.privateView(req.params.code,req.get('x-enta-room-token')??'')));
 router.get('/:code/canvas',handle(req=>service.privateCanvas(req.params.code,req.get('x-enta-room-token')??'',req.query)));
 router.post('/:code/canvas',handle(req=>service.privateCanvas(req.params.code,req.get('x-enta-room-token')??'',{},req.body)));
 router.get('/:code',authenticate,handle(req=>service.hostView(req.principal,req.params.code)));
 router.post('/:code/host',authenticate,handle(req=>service.hostCommand(req.principal,req.params.code,req.body)));
 router.post('/:code/engine',authenticate,handle(req=>service.engineCommand(req.principal,req.params.code,req.body)));
 router.post('/:code/member-grant',authenticate,handle(req=>service.bindGrant(req.principal,req.params.code,req.body)));
 return router;
}
/** Executes original owner mutations under the room lock, including on client disconnect. */
export function localRoomMutationGuard(service:LocalRooms,authenticate:RequestHandler):RequestHandler{return (req,res,next)=>{
 if(req.method!=='POST')return next();let engine:RoomEngine|undefined,id:string|undefined;
 const competition=req.path.match(/^\/competition\/matches\/([^/]+)\/(commands|grants)\/?$/i),round=req.path.match(/^\/round-matches\/([^/]+)\/(commands|grants)\/?$/i),classic=req.path.match(/^\/matches\/([^/]+)\/commands\/?$/i);
 if(competition){engine='competitive';id=competition[1];}else if(round){engine='round';id=round[1];}else if(classic){engine='classic';id=classic[1];}else return next();
 try{id=decodeURIComponent(id!);}catch{res.status(400).json({error:'INVALID_ROOM_REQUEST'});return;}if(!/^[A-Za-z0-9_-]{1,128}$/.test(id!)){res.status(400).json({error:'INVALID_ROOM_REQUEST'});return;}
 authenticate(req,res,error=>{if(error)return next(error);void (async()=>{try{const isGrant=/\/grants\/?$/i.test(req.path);const result=await service.directEngineMutation((req as OwnerRequest).principal,engine!,id!,req.body,isGrant);if(!res.destroyed)res.status(isGrant&&!result.idempotent?201:200).json(bounded(result));}catch(failure){if(res.headersSent){res.destroy();return;}res.status(failure instanceof EntaError?failure.status:503).json(errorPayload(failure));}})();});
 };}





