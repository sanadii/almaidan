import { CompetitionCommandRejection } from './competition-receipts';
import { Router, type Request, type RequestHandler } from 'express';
import { EntaError } from '../gameplay/types';
import type { Principal } from '../identity';
import { deliverMedia, type PinnedByteReader } from './media';
import type { CompetitionService } from './competition-service';
import { CompetitionReviewError } from './competition-corrections';
import { publicMedia } from './projection';
type OwnerRequest = Request & { principal?: Principal };
const handle = (work: (r: OwnerRequest) => Promise<unknown>, create = false): RequestHandler => async (r, response) => { try { const data = await work(r); if (Buffer.byteLength(JSON.stringify(data)) > 262144) throw new EntaError(503, 'PROJECTION_BOUND_EXCEEDED'); response.status(create && !(data as { idempotent?: boolean }).idempotent ? 201 : 200).json(data); } catch (e) { response.status(e instanceof EntaError ? e.status : 503).json({ error: e instanceof EntaError ? e.code : 'ENTA_UNAVAILABLE', ...(e instanceof CompetitionCommandRejection ? { ...(e.commandReceipt ? { commandReceipt: e.commandReceipt } : {}), ...(e.commandRejection ? { commandRejection: e.commandRejection } : {}) } : {}), ...(e instanceof CompetitionReviewError ? { blockingIds: e.blockingIds, truncated: e.truncated } : {}) }); } };
function cursor(r: Request) {
  if (Object.keys(r.query).some(k => !['snapshot', 'revision', 'cursor'].includes(k))) throw new EntaError(400, 'INVALID_CANVAS_CURSOR');
  const value = (v: unknown) => v === undefined ? null : typeof v === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(v) ? Number(v) : (() => { throw new EntaError(400, 'INVALID_CANVAS_CURSOR'); })();
  const token = r.query.cursor ?? null; if (token !== null && (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))) throw new EntaError(400, 'INVALID_CANVAS_CURSOR');
  return { snapshot: value(r.query.snapshot), revision: value(r.query.revision), cursor: token };
}
function binary(service: CompetitionService, reader: PinnedByteReader, capability = false, grading = false): RequestHandler { return async (r: OwnerRequest, response) => { try { await deliverMedia(response, reader, () => service.mediaAuthorization(capability ? null : r.principal!, capability ? r.get('x-enta-grant') ?? '' : null, capability ? null : r.params.id, r.params.media, grading ? r.params.round : undefined), r.get('range')); } catch (e) { if (response.headersSent) response.destroy(); else response.status(e instanceof EntaError ? e.status : 503).json({ error: e instanceof EntaError ? e.code : 'MEDIA_UNAVAILABLE' }); } }; }
export function createCompetitionOwnerRouter(service: CompetitionService, authentication: RequestHandler, reader: PinnedByteReader): Router {
  const router = Router(); router.use(authentication);
  for (const [path, format] of [['classic', 'TIER_BOARD'], ['mixed', 'MIXED_BOARD'], ['list', 'STANDALONE_LIST'], ['acting', 'STANDALONE_ACTING']] as const) { router.get(`/catalog/${path}`, handle(r => service.catalog(r.principal!, format))); router.post(`/catalog/${path}/pages`, handle(r => service.catalogPage(r.principal!, format, r.body))); router.post(`/matches/${path}`, handle(r => service.start(r.principal!, format, r.body), true)); }
  router.get('/matches/:id', handle(r => service.get(r.principal!, r.params.id)));
  router.post('/matches/:id/pages', handle(r => service.page(r.principal!, null, r.params.id, r.body)));
  router.post('/matches/:id/commands', handle(r => service.command(r.principal!, r.params.id, r.body)));
  router.get('/matches/:id/rounds/:round/grading', handle(r => service.grading(r.principal!, r.params.id, r.params.round)));
  router.get('/matches/:id/rounds/:round/grading/media/:media', binary(service, reader, false, true));
  router.get('/matches/:id/rounds/:round/grading/media/:media/metadata', handle(async r => { const first = await service.mediaAuthorization(r.principal!, null, r.params.id, r.params.media, r.params.round), current = await service.mediaAuthorization(r.principal!, null, r.params.id, r.params.media, r.params.round); if (first.epoch !== current.epoch) throw new EntaError(403, 'MEDIA_DENIED'); return publicMedia(current.pin); }));
  router.get('/matches/:id/rounds/:round/canvas', handle(r => service.canvas(r.principal!, null, r.params.id, r.params.round, cursor(r))));
  router.get('/matches/:id/media/:media', binary(service, reader)); return router;
}
export function createCompetitionCapabilityRouter(service: CompetitionService, reader: PinnedByteReader): Router {
  const router = Router(); router.use((r, response, next) => { response.setHeader('referrer-policy', 'no-referrer'); const canvasPath = /^\/rounds\/[A-Za-z0-9_-]{1,128}\/canvas\/?$/.test(r.path); if (r.get('authorization') || Object.keys(r.query).some(k => !canvasPath || !['snapshot', 'revision', 'cursor'].includes(k))) { response.status(403).json({ error: 'GRANT_DENIED' }); return; } next(); });
  const token = (r: Request) => r.get('x-enta-grant') ?? '';
  router.get('/view', handle(r => service.capability(token(r))));
  router.post('/pages', handle(r => service.page(null, token(r), null, r.body)));
  router.get('/rounds/:round/canvas', handle(r => service.canvas(null, token(r), null, r.params.round, cursor(r))));
  router.post('/rounds/:round/canvas', handle(r => service.canvas(null, token(r), null, r.params.round, {}, r.body)));
  router.get('/media/:media', binary(service, reader, true));
  router.get('/media/:media/metadata', handle(async r => { const first = await service.mediaAuthorization(null, token(r), null, r.params.media), current = await service.mediaAuthorization(null, token(r), null, r.params.media); if (first.epoch !== current.epoch) throw new EntaError(403, 'MEDIA_DENIED'); return publicMedia(current.pin); }));
  router.use((_r, response) => { response.status(404).json({ error: 'GRANT_DENIED' }); });
  return router;
}
