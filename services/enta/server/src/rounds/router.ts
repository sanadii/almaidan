import { Router, type Request, type RequestHandler } from 'express';
import type { Principal } from '../identity';
import { EntaError } from '../gameplay/types';
import type { RoundService } from './service';
import { deliverMedia, type PinnedByteReader } from './media';
type OwnerRequest = Request & { principal?: Principal };
const handle = (work: (request: OwnerRequest) => Promise<unknown>, created = false): RequestHandler => async (request, response) => { try { const data = await work(request); if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 262144) throw new EntaError(503, 'PROJECTION_BOUND_EXCEEDED'); response.status(created && !(data as { idempotent?: boolean }).idempotent ? 201 : 200).json(data); } catch (error) { response.status(error instanceof EntaError ? error.status : 503).json({ error: error instanceof EntaError ? error.code : 'ENTA_UNAVAILABLE' }); } };
function cursor(request: Request) { if (Object.keys(request.query).some(key => !['revision', 'offset'].includes(key))) throw new EntaError(400, 'INVALID_CANVAS_CURSOR'); const number = (value: unknown, fallback: number | null) => value === undefined ? fallback : typeof value === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(value) ? Number(value) : (() => { throw new EntaError(400, 'INVALID_CANVAS_CURSOR'); })(); return { revision: number(request.query.revision, null), offset: number(request.query.offset, 0) }; }
export function createRoundOwnerRouter(service: RoundService, authentication: RequestHandler, reader: PinnedByteReader): Router {
  const router = Router(); router.use(authentication);
  for (const [name, format] of [['list', 'STANDALONE_LIST'], ['acting', 'STANDALONE_ACTING'], ['mixed', 'MIXED_BOARD']] as const) { router.get(`/catalog/${name}`, handle(request => service.catalog(request.principal!, format))); router.post(`/matches/${name}`, handle(request => service.start(request.principal!, format, request.body), true)); }
  router.get('/round-matches/:id', handle(request => service.get(request.principal!, request.params.id)));
  router.post('/round-matches/:id/commands', handle(request => service.command(request.principal!, request.params.id, request.body)));
  router.get('/round-matches/:id/rounds/:round/grading', handle(request => service.grading(request.principal!, request.params.id, request.params.round)));
  router.get('/round-matches/:id/rounds/:round/grading/media/:media', async (request: OwnerRequest, response) => { try { await deliverMedia(response, reader, () => service.mediaAuthorization(request.principal!, null, request.params.id, request.params.media, request.params.round), request.get('range')); } catch (error) { if (response.headersSent) response.destroy(); else response.status(error instanceof EntaError ? error.status : 503).json({ error: error instanceof EntaError ? error.code : 'MEDIA_UNAVAILABLE' }); } });
  router.post('/round-matches/:id/grants', handle(request => service.grant(request.principal!, request.params.id, request.body), true));
  router.get('/round-matches/:id/rounds/:round/canvas', handle(request => service.canvas(request.principal!, null, request.params.id, request.params.round, cursor(request))));
  router.get('/round-matches/:id/media/:media', async (request: OwnerRequest, response) => { try { await deliverMedia(response, reader, () => service.mediaAuthorization(request.principal!, null, request.params.id, request.params.media), request.get('range')); } catch (error) { if (response.headersSent) response.destroy(); else response.status(error instanceof EntaError ? error.status : 503).json({ error: error instanceof EntaError ? error.code : 'MEDIA_UNAVAILABLE' }); } });
  return router;
}
/** Dedicated capability router. A grant is never accepted as Firebase identity;
 * no general anonymous host endpoints or auth/category fallback are mounted. */
export function createRoundCapabilityRouter(service: RoundService, reader: PinnedByteReader): Router {
  const router = Router(); router.use((request, response, next) => { response.setHeader('referrer-policy', 'no-referrer'); if (request.get('authorization') || Object.keys(request.query).some(key => !['revision', 'offset'].includes(key))) { response.status(403).json({ error: 'GRANT_DENIED' }); return; } next(); });
  const token = (request: Request) => request.get('x-enta-grant') ?? '';
  router.get('/view', handle(request => service.capability(token(request))));
  router.get('/rounds/:round/canvas', handle(request => service.canvas(null, token(request), null, request.params.round, cursor(request))));
  router.post('/rounds/:round/canvas', handle(request => service.canvas(null, token(request), null, request.params.round, {}, request.body)));
  router.get('/media/:media', async (request, response) => { try { await deliverMedia(response, reader, () => service.mediaAuthorization(null, token(request), null, request.params.media), request.get('range')); } catch (error) { if (response.headersSent) response.destroy(); else response.status(error instanceof EntaError ? error.status : 503).json({ error: error instanceof EntaError ? error.code : 'MEDIA_UNAVAILABLE' }); } });
  return router;
}
