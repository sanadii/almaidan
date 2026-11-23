import {Router,type Request,type RequestHandler} from 'express';
import type {Principal} from '../identity';
import {E3Error} from '../history-rematch/core';
import {FavoritesError,type FavoritesService} from './service';
type OwnerRequest=Request&{principal?:Principal};
export function createFavoritesRouter(authenticate:RequestHandler,service?:FavoritesService){
 const router=Router();router.use(authenticate);
 const handle=(work:(p:Principal,r:Request)=>Promise<unknown>):RequestHandler=>async(req,res)=>{res.setHeader('cache-control','no-store');const p=(req as OwnerRequest).principal;if(!p){res.status(401).json({error:'AUTHENTICATION_REQUIRED'});return;}if(!p.verifiedAccount||p.anonymous){res.status(403).json({error:'VERIFIED_ACCOUNT_REQUIRED'});return;}if(!service){res.status(503).json({error:'FAVORITES_UNAVAILABLE'});return;}try{res.json(await work(p,req));}catch(e){res.status(e instanceof FavoritesError||e instanceof E3Error?e.status:503).json({error:e instanceof FavoritesError||e instanceof E3Error?e.code:'FAVORITES_UNAVAILABLE'});}};
 router.get('/',handle(async(p,req)=>{const q=req.query;if(Object.keys(q).some(k=>!['limit','cursor'].includes(k))||(q.limit!==undefined&&(typeof q.limit!=='string'||!/^(?:[1-9]|[1-4][0-9]|50)$/.test(q.limit)))||(q.cursor!==undefined&&typeof q.cursor!=='string'))throw new FavoritesError(400,'INVALID_FAVORITES_QUERY');return service!.list(p,{limit:q.limit===undefined?25:Number(q.limit),cursor:q.cursor===undefined?null:q.cursor as string});}));
 for(const [method,wanted] of [['put',true],['delete',false]] as const)router[method]('/:categoryKey',handle(async(p,req)=>{if(Object.keys(req.query).length||req.body&&Object.keys(req.body).length)throw new FavoritesError(400,'INVALID_FAVORITE');return service!.set(p,req.params.categoryKey,wanted,req.get('idempotency-key'));}));
 return router;
}