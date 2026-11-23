import type { Router, RequestHandler } from 'express';
import { createEntaSuccessorService } from './successor';
import { createEntaSuccessorRepository, type EntaSuccessorDatabase, type SuccessorConfig } from './successor-postgres';
import { mountEntaSuccessor } from './router';
export interface EntaSuccessorCompositionOptions { database: EntaSuccessorDatabase; config: SuccessorConfig; router: Router; authenticate: RequestHandler }
/** Explicit opt-in only; the default application does not mount this factory. */
export function composeEntaSuccessor(options: EntaSuccessorCompositionOptions): Router {
 const repository=createEntaSuccessorRepository(options.database,options.config);
 return mountEntaSuccessor(options.router,options.authenticate,createEntaSuccessorService({projectId:options.config.firebaseProjectId,repository}));
}
