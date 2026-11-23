import type { Router, Request, RequestHandler } from 'express';
import type { Principal } from '../identity';
import { E3Error } from './core';
import { EntaError } from '../gameplay/types';
import type { EntaSuccessorHandler } from './successor';
export function mountEntaSuccessor(router: Router, authenticate: RequestHandler, service: EntaSuccessorHandler): Router {
 router.post('/successor', authenticate, async (request, response) => {
  const principal=(request as Request & {principal?: Principal}).principal;
  if (!principal) { response.status(401).json({error:'AUTHENTICATION_REQUIRED'}); return; }
  try { const result=await service(principal,request.body); response.status(result.idempotent?200:201).json(result); }
  catch (error) { if (error instanceof E3Error || error instanceof EntaError) response.status(error.status).json({error:error.code}); else response.status(503).json({error:'ENTA_UNAVAILABLE'}); }
 });
 return router;
}
