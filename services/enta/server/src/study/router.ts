import { Router, type Request, type Response } from 'express';
import { StudyError, type StudyService } from './service';

/** Mount only behind verified authentication; owner must come from the verified principal. */
export function createStudyRouter(service: StudyService | undefined, owner: (request: Request) => string | undefined) {
  const router = Router();
  const run = (fn: (req: Request, uid: string) => Promise<unknown>) => async (req: Request, res: Response) => {
    const uid = owner(req); if (!uid) { res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' }); return; }
    if (!service) { res.status(503).json({ error: 'STUDY_UNAVAILABLE' }); return; }
    try { res.json(await fn(req, uid)); } catch (error) {
      const code = error instanceof StudyError ? error.code : 'UNAVAILABLE';
      const status = code === 'NOT_FOUND' ? 404 : code === 'TOO_EARLY' || code === 'CONFLICT' ? 409 : code === 'INVALID_CHOICE' ? 400 : 503;
      res.status(status).json({ error: code });
    }
  };
  router.post('/sessions', run((req, uid) => service!.start(uid, req.body?.requestId)));
  router.get('/sessions/:id', run((req, uid) => service!.get(uid, req.params.id)));
  router.post('/sessions/:id/answers', run((req, uid) => {
    const { questionId, choiceId } = req.body ?? {};
    if (typeof questionId !== 'string' || typeof choiceId !== 'string' || questionId.length > 100 || choiceId.length > 100) throw new StudyError('INVALID_CHOICE');
    return service!.answer(uid, req.params.id, questionId, choiceId);
  }));
  return router;
}
