import { Router, type Request, type RequestHandler } from 'express';
import type { Principal } from '../identity';
import { E3Error } from './core';
import type { HistoryRematchPage } from './service';
import type { OriginalResult } from './result';

type OwnerRequest = Request & { principal?: Principal };
export interface HistoryHandlers {
 page(principal: Principal, query: Record<string, unknown>): Promise<HistoryRematchPage>;
 original(principal: Principal, id: string): Promise<OriginalResult>;
}
/** Exact routes terminate even when the injected composition is unavailable. */
export function createHistoryRouter(authenticate: RequestHandler, handlers?: HistoryHandlers): Router {
 const router = Router();
 const handle = (work: (request: OwnerRequest, principal: Principal) => Promise<unknown>): RequestHandler => async (request,response) => {
  response.setHeader('cache-control','no-store');
  const principal = (request as OwnerRequest).principal;
  if (!principal) { response.status(401).json({error:'AUTHENTICATION_REQUIRED'}); return; }
  if (!principal.verifiedAccount) { response.status(403).json({error:'VERIFIED_ACCOUNT_REQUIRED'}); return; }
  if (!handlers) { response.status(503).json({error:'HISTORY_UNAVAILABLE'}); return; }
  try { response.status(200).json(await work(request as OwnerRequest,principal)); }
  catch (error) { if (error instanceof E3Error) response.status(error.status).json({error:error.code}); else response.status(503).json({error:'HISTORY_UNAVAILABLE'}); }
 };
 const noStore: RequestHandler = (_request,response,next) => { response.setHeader('cache-control','no-store'); next(); };
 router.get('/matches/history', noStore, authenticate, handle((r,p)=>handlers!.page(p,r.query)));
 router.get('/matches/:id/original-result', noStore, authenticate, handle((r,p)=>handlers!.original(p,r.params.id)));
 return router;
}
