import {realContentEnabled,realContent} from '../local-development/real-content';
import { CompetitionCommandRejection } from './competition-receipts';
import { assertLocalDevelopment, LOCAL_PROJECT } from '../local-development/guard';
import { readCompetitionNativeMatch, readCompetitionNativeScope, readCompetitionNativeCapability, readCompetitionNativeCanvasRows } from './competition-native';
import { reconcileCapacity } from './competition-capacity';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { randomBytes } from 'node:crypto';
import { EntaError, fail } from '../gameplay/types';
import { hostedGameplayRuntime } from '../gameplay/service';
import type { Principal } from '../identity';
import { reduceCanvas } from './canvas';
import { parseToken, tokenHash } from './grants';
import { authorizeCompetitiveGrant } from './competition-grants';
import { addEffect, competitiveEvent, hasCompetitiveReview, sealEffect } from './competition-effects';
import { reduceCompetitionCommand, scopeCompetitionCommand } from './competition-engine';
import { settleCompetitiveClock } from './competition-clock';
import { competitionMedia, projectCompetition, projectCompetitionCapability, projectCompetitionCatalog, projectCompetitionGrading } from './competition-projection';
import { parseCompetitionCommand, parseCompetitionStart, productionCompetitionPolicy, standaloneCompetition, TEAM_PALETTE, validateCompetitionCatalog } from './competition-rules';
import { selectCompetition } from './competition-selection';
import { PIN_MATERIAL, pinReference, pinReferencesHash, START_MATERIAL, startIntentHash } from './competition-material';
import { boundedValue, LIVE_WINDOW_BYTES } from './competition-content';
import { competitionPageRows, createCompetitionPager, pageVisibility, parseCompetitionPageRequest } from './competition-pages';
import { CompetitionReviewError } from './competition-corrections';
import { exact, id, integer, parseCanvasCommand } from './validation';
import type { Grant, MediaPin } from './types';
import type { CompetitionCatalog, CompetitionFormat, CompetitionGame, CompetitionRepository, CompetitionTransaction } from './competition-types';

function verified(p: Principal, project: string): void { if (p.projectId !== project || !p.uid || p.anonymous || !p.verifiedAccount || !p.email) return fail(403, 'VERIFIED_ACCOUNT_REQUIRED'); }
function owned(game: CompetitionGame | null, p: Principal): asserts game is CompetitionGame { if (!game || game.hostUid !== p.uid || game.projectId !== p.projectId) return fail(404, 'MATCH_NOT_FOUND'); }
export function validateStoredCompetition(game: CompetitionGame): void {
  if (game.factContext) { exact(game.factContext, ['version', 'selectedRoundId', 'effectSequence', 'pendingTotal', 'rulingTotal', 'terminalValidated']); if (game.factContext.version !== 1 || game.request.version !== 5 || game.request.setup.rules.version !== 'enta-competitive-1' || game.requestHash !== admissionHash(game.request) || game.tournamentBinding !== null || game.factContext.selectedRoundId !== null && !game.rounds.some(r => r.id === game.factContext!.selectedRoundId) || game.attempts.length > 512 || game.effects.length > 5 || game.grants.length > 2 || !Number.isSafeInteger(game.factContext.effectSequence) || game.factContext.effectSequence > 64945 || !Number.isSafeInteger(game.factContext.pendingTotal) || !Number.isSafeInteger(game.factContext.rulingTotal)) return fail(503, 'MATCH_DATA_UNAVAILABLE'); boundedValue(game, LIVE_WINDOW_BYTES); return; }
  if (game.request.version !== 5 || game.request.setup.version !== 5 || game.request.setup.rules.version !== 'enta-competitive-1' || game.requestHash !== admissionHash(game.request) || game.intentHash !== startIntentHash(game.intent) || admissionHash(game.intent.request) !== game.requestHash || game.intent.version !== 5 || game.intent.domain !== START_MATERIAL || game.intent.pinMaterial !== PIN_MATERIAL || game.intent.tournamentBinding !== null || game.tournamentBinding !== null || game.intent.pinsHash !== pinReferencesHash(game.intent.selection) || game.intent.roundCount !== game.rounds.length || game.intent.selection.length !== game.rounds.length || game.rounds.some((r, n) => r.ordinal !== n || admissionHash(pinReference(r.pin, game.intent.selection[n])) !== admissionHash(game.intent.selection[n]))) return fail(503, 'MATCH_DATA_UNAVAILABLE');
}
function service(repository: CompetitionRepository, policy: (catalog: CompetitionCatalog) => void, source: 'production' | 'test-only' | 'local-development') {
  const pager = createCompetitionPager();
  const catalogScope = (p: Principal, format: CompetitionFormat, releaseId: string, snapshot: string, category: string | null) => ({ principal: p.uid, project: p.projectId, gameId: releaseId, collection: category === null ? 'catalog-categories' as const : 'catalog-prompts' as const, roundId: category, effectId: null, purpose: 'OWNER' as const, visibility: admissionHash({ format, snapshot }), snapshot });
  async function ownerLoad(tx: CompetitionTransaction, p: Principal, gameId: string) { const game = await tx.loadOwner(p, id(gameId), true); owned(game, p); validateStoredCompetition(game); return game; }
  async function live(tx: CompetitionTransaction, token: string) { const hash = tokenHash(parseToken(token)), location = await tx.locateGrant(hash), game = location ? await tx.loadGrant(location.gameId, hash) : null, now = await tx.now(), authorization = authorizeCompetitiveGrant(game, hash, now); validateStoredCompetition(authorization.game); return { ...authorization, hash, now }; }
  async function settle(tx: CompetitionTransaction, game: CompetitionGame, now: number) { if (repository.source === 'postgres') return fail(503, 'DRAFT5_OPERATION_RETIRED'); const next = structuredClone(game); return settleCompetitiveClock(next, now) ? (await tx.save(game, next, null)).game : game; }
  async function nativeScope(tx: CompetitionTransaction, p: Principal | null, token: string | null, gameId: string | null) {
    if (!tx.nativeScope) return fail(503, 'ENTA_UNAVAILABLE');
    const hash = token ? tokenHash(parseToken(token)) : null;
    const selectedId = hash ? (await tx.locateGrant(hash))?.gameId ?? fail(403, 'GRANT_DENIED') : gameId ?? fail(403, 'GRANT_DENIED');
    let raw = await tx.nativeScope(p, hash, id(selectedId)); if (!raw) return fail(404, 'MATCH_NOT_FOUND');
    if (hash) { if (!tx.nativeDisclose) return fail(503, 'ENTA_UNAVAILABLE'); raw = (await tx.nativeDisclose(hash, selectedId)).scope; }
    const scope = readCompetitionNativeScope(raw, selectedId, repository.projectId);
    if (p ? scope.purpose !== 'OWNER' || scope.principal !== p.uid : scope.purpose === 'OWNER') return fail(503, 'MATCH_DATA_UNAVAILABLE');
    return { scope, hash };
  }
  async function privateCapability(token: string) {
    if (repository.source === 'postgres') return repository.transaction(async tx => {
      const hash = tokenHash(parseToken(token)), gameId = (await tx.locateGrant(hash))?.gameId ?? fail(403, 'GRANT_DENIED');
      if (!tx.nativeDisclose) return fail(503, 'ENTA_UNAVAILABLE'); const result = await tx.nativeDisclose(hash, gameId), scope = readCompetitionNativeScope(result.scope, gameId, repository.projectId);
      return { epoch: `${scope.gameId}:${scope.snapshot}:${scope.visibility}`, data: readCompetitionNativeCapability(result.data, scope) };
    });
    return repository.transaction(async tx => { let allowed = await live(tx, token); const game = await tx.disclose(allowed.game, allowed.hash, allowed.now); allowed = { ...allowed, ...authorizeCompetitiveGrant(game, allowed.hash, await tx.now()) }; return { epoch: `${game.id}:${game.version}:${allowed.round.id}:${allowed.round.version}:${allowed.grant.id}:${allowed.grant.generation}:${allowed.round.assignment?.generation ?? 0}`, data: projectCompetitionCapability(game, allowed.round, allowed.grant, allowed.now) }; });
  }
  return Object.freeze({ source,
    async catalog(p: Principal, format: CompetitionFormat) { verified(p, repository.projectId); return repository.transaction(async tx => { const wallet = await tx.lockWallet(p); if (repository.source === 'postgres') { if (!tx.nativeCatalog) return fail(503, 'ENTA_UNAVAILABLE'); const source = await tx.nativeCatalog(p, format, null, null, 0); if (wallet.debt > 0n) return fail(409, 'WALLET_DEBT_BLOCKS_START'); const page = pager.window(catalogScope(p, format, source.releaseId, source.snapshot, null), null, source.total, source.rows); return { version: 5 as const, rulesVersion: 'enta-competitive-1' as const, availableCredit: wallet.available.toString(), palette: Object.entries(TEAM_PALETTE).map(([key, value]) => ({ key, ...value })), categories: source.rows as ReturnType<typeof projectCompetitionCatalog>['categories'], catalogPage: page }; } const catalog = await tx.catalog(p, format); validateCompetitionCatalog(catalog); policy(catalog); if (wallet.debt > 0n) return fail(409, 'WALLET_DEBT_BLOCKS_START'); const projected=projectCompetitionCatalog(catalog, wallet.available, format);if(repository.source==='local-development'){const snapshot=admissionHash({project:p.projectId,principal:p.uid,format,base:catalog.base.baseRoot,formatRoot:catalog.base.formatRoot,proofRoot:catalog.proofRoot});const page=pager.page(catalogScope(p,format,catalog.competitiveReleaseId,snapshot,null),null,projected.categories);return {...projected,categories:page.rows,catalogPage:page};}return projected; }); },
    async catalogPage(p: Principal, format: CompetitionFormat, input: unknown) {
      verified(p, repository.projectId); const q = exact(input, ['categoryKey', 'snapshot', 'cursor']);
      if (q.categoryKey !== null && (typeof q.categoryKey !== 'string' || Buffer.byteLength(q.categoryKey) > 1024) || typeof q.snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(q.snapshot) || q.cursor !== null && (typeof q.cursor !== 'string' || q.cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(q.cursor))) return fail(400, 'INVALID_PAGE_REQUEST');
      return repository.transaction(async tx => {
        if (repository.source === 'postgres') { if (!tx.nativeCatalog) return fail(503, 'ENTA_UNAVAILABLE'); const first = await tx.nativeCatalog(p, format, q.categoryKey as string | null, q.snapshot as string, 0), scope = catalogScope(p, format, first.releaseId, first.snapshot, q.categoryKey as string | null), offset = pager.start(scope, q.cursor as string | null, first.total), result = offset ? await tx.nativeCatalog(p, format, q.categoryKey as string | null, q.snapshot as string, offset) : first; if (result.snapshot !== first.snapshot || result.releaseId !== first.releaseId || result.total !== first.total) return fail(409, 'PAGE_SNAPSHOT_RESTART'); return pager.window(scope, q.cursor as string | null, result.total, result.rows); }
        const catalog = await tx.catalog(p, format); validateCompetitionCatalog(catalog); policy(catalog); const snapshot = admissionHash({ project: p.projectId, principal: p.uid, format, base: catalog.base.baseRoot, formatRoot: catalog.base.formatRoot, proofRoot: catalog.proofRoot }); if (snapshot !== q.snapshot) return fail(409, 'PAGE_SNAPSHOT_RESTART'); const categories = projectCompetitionCatalog(catalog, 0n, format).categories, rows = q.categoryKey === null ? categories : categories.find(c => c.key === q.categoryKey)?.prompts ?? fail(404, 'CATEGORY_UNAVAILABLE'); return pager.page<unknown>(catalogScope(p, format, catalog.competitiveReleaseId, snapshot, q.categoryKey as string | null), q.cursor as string | null, rows);
      });
    },
    async start(p: Principal, format: CompetitionFormat, input: unknown) {
      verified(p, repository.projectId); const request = parseCompetitionStart(input, format);
      return repository.transaction(async tx => {
        if (repository.source === 'postgres') { if (!tx.nativeStart) return fail(503, 'ENTA_UNAVAILABLE'); const saved = await tx.nativeStart(p, request, randomBytes(32).toString('hex')); return { match: readCompetitionNativeMatch(saved.match, request.logicalMatchId), idempotent: saved.idempotent }; }
        const wallet = await tx.lockWallet(p), existing = await tx.findStart(p, request.requestKey, request.logicalMatchId);
        if (existing) { owned(existing, p); validateStoredCompetition(existing); if (existing.requestHash !== admissionHash(request) || existing.request.requestKey !== request.requestKey || existing.id !== request.logicalMatchId) return fail(409, 'IDEMPOTENCY_KEY_CONFLICT'); return { match: projectCompetition(existing, await tx.now()), idempotent: true }; }
        if (wallet.debt > 0n) return fail(409, 'WALLET_DEBT_BLOCKS_START'); if (wallet.available < 1n) return fail(402, 'INSUFFICIENT_CREDIT');
        const catalog = await tx.catalog(p, format); validateCompetitionCatalog(catalog); policy(catalog);
        const exposures = standaloneCompetition(format) ? await tx.exposures(p, format, request.setup.categories[0].key) : [], selected = selectCompetition(request, catalog, exposures), game = await tx.create(p, request, selected.intent, selected.pins, catalog); owned(game, p); validateStoredCompetition(game); return { match: projectCompetition(game, await tx.now()), idempotent: false };
      });
    },
    async get(p: Principal, gameId: string) { verified(p, repository.projectId); id(gameId); return repository.transaction(async tx => { if (repository.source === 'postgres') { if (!tx.nativeGet) return fail(503, 'ENTA_UNAVAILABLE'); return readCompetitionNativeMatch((await tx.nativeGet(p, gameId)).match, gameId); } const game = await ownerLoad(tx, p, gameId), now = await tx.now(); return projectCompetition(await settle(tx, game, now), await tx.now()); }); },
    async page(p: Principal | null, token: string | null, gameId: string | null, input: unknown) {
      const request = parseCompetitionPageRequest(input); if (p) verified(p, repository.projectId);
      const result = await repository.transaction(async tx => {
        if (repository.source === 'postgres') {
          if (!tx.nativePage) return fail(503, 'ENTA_UNAVAILABLE'); const { scope: authority, hash } = await nativeScope(tx, p, token, gameId);
          if (request.snapshot !== authority.snapshot) return { restart: true as const };
          const scope = { principal: authority.principal, project: authority.projectId, gameId: authority.gameId, collection: request.collection, roundId: request.roundId, effectId: request.effectId, purpose: authority.purpose, visibility: authority.visibility, snapshot: authority.snapshot };
          const first = await tx.nativePage(p, hash, authority.gameId, request, 0); if (first.restart) return { restart: true as const }; const offset = pager.start(scope, request.cursor, first.total), result = offset ? await tx.nativePage(p, hash, authority.gameId, request, offset) : first; return result.restart || result.total !== first.total ? { restart: true as const } : pager.window(scope, request.cursor, result.total, result.rows);
        }
        let game: CompetitionGame, grant: Grant | undefined;
        if (token) { const authorization = await live(tx, token); game = await tx.disclose(authorization.game, authorization.hash, authorization.now); grant = authorizeCompetitiveGrant(game, authorization.hash, await tx.now()).grant; }
        else { if (!p || !gameId) return fail(403, 'GRANT_DENIED'); game = await ownerLoad(tx, p, gameId); }
        const referenceRows = repository.source === 'test-only' || repository.source === 'local-development' ? competitionPageRows(game, request, grant) : null;
        if (request.roundId && !game.rounds.some(r => r.id === request.roundId)) return fail(404, 'MATCH_NOT_FOUND');
        if (repository.source === 'test-only' || repository.source === 'local-development') game = await settle(tx, game, await tx.now());
        const scope = { principal: grant?.id ?? p!.uid, project: game.projectId, gameId: game.id, collection: request.collection, roundId: request.roundId, effectId: request.effectId, purpose: grant?.role ?? 'OWNER' as const, visibility: pageVisibility(game, grant), snapshot: game.version };
        if (request.snapshot !== game.version) return { restart: true as const };
        return pager.page<ReturnType<typeof competitionPageRows>[number]>(scope, request.cursor, referenceRows!);
      }); if ('restart' in result) return fail(409, 'PAGE_SNAPSHOT_RESTART'); return result;
    },
    async command(p: Principal, gameId: string, input: unknown) {
      verified(p, repository.projectId); const command = parseCompetitionCommand(input);
      const result = await repository.transaction(async tx => {
        if (repository.source === 'postgres') {
          if (!tx.nativeCommand) return fail(503, 'ENTA_UNAVAILABLE'); const token = ['CREATE_GRANT', 'ROTATE_GRANT', 'REVOKE_GRANT'].includes(command.type) ? randomBytes(32).toString('base64url') : null;
          const saved = await tx.nativeCommand(p, id(gameId), command, token ? { tokenHash: tokenHash(token) } : null), match = readCompetitionNativeMatch(saved.match, gameId);
          const grant = saved.issuance; if (saved.commandReceipt && (saved.commandReceipt.gameId !== gameId || saved.commandReceipt.commandId !== command.commandId || saved.commandReceipt.hash !== admissionHash(command) || saved.commandReceipt.expectedVersion !== command.expectedVersion)) return fail(503, 'COMMAND_RECEIPT_UNAVAILABLE');
          if (saved.commandRejection && (saved.commandRejection.version !== 1 || saved.commandRejection.state !== 'REJECTED' || saved.commandRejection.projectId !== p.projectId || saved.commandRejection.principalUid !== p.uid || saved.commandRejection.gameId !== gameId || saved.commandRejection.commandId !== command.commandId || saved.commandRejection.hash !== admissionHash(command) || saved.commandRejection.expectedVersion !== command.expectedVersion || saved.commandRejection.currentRevision !== command.expectedVersion || match.version !== command.expectedVersion || saved.commandRejection.reason !== saved.rejection || !['OPTIONAL_CAPACITY_EXHAUSTED', 'ATTEMPT_BUDGET_EXCEEDED'].includes(saved.commandRejection.reason) || saved.commandReceipt !== null)) return fail(503, 'COMMAND_RECEIPT_UNAVAILABLE');
          return { rejection: saved.rejection, blockingIds: saved.blockingIds, blockingTotal: saved.blockingTotal, commandReceipt: saved.commandReceipt, commandRejection: saved.commandRejection, ...(saved.auditId ? { auditId: saved.auditId } : {}), match, idempotent: saved.idempotent, ...(grant && ['CREATE_GRANT', 'ROTATE_GRANT', 'REVOKE_GRANT'].includes(command.type) ? { issuance: { id: grant.id, scopeId: grant.scopeId, roundId: grant.roundId, role: grant.role, generation: grant.generation, expiresAt: grant.expiresAt, revoked: grant.revoked, tokenUnavailable: saved.idempotent || !token || grant.revoked, ...(!saved.idempotent && token && !grant.revoked ? { token } : {}) } } : {}) };
        }
        const game = await ownerLoad(tx, p, gameId); scopeCompetitionCommand(game, command);
        if (command.type === 'REPORT_VAR') { const audit = await tx.audit(p, game, command); return { rejection: null, match: projectCompetition(game, await tx.now()), idempotent: audit.idempotent, auditId: audit.id, commandReceipt: { state: 'ACCEPTED' as const, gameId: game.id, commandId: command.commandId, expectedVersion: command.expectedVersion, hash: admissionHash(command), eventId: audit.id, revision: game.version } }; }
        if (await tx.hasAuditCommand(p, game.id, command.commandId)) return fail(409, 'COMMAND_KEY_CONFLICT');
        if (game.version > command.expectedVersion && !game.events.some(e => e.commandId === command.commandId)) return { rejection: 'STALE_VERSION' as const, match: projectCompetition(game, await tx.now()), idempotent: false, commandReceipt: { state: 'ABSENT' as const, gameId: game.id, commandId: command.commandId, expectedVersion: command.expectedVersion, hash: admissionHash(command), eventId: null, revision: game.version } };
        const reducerNow = await tx.now(); let reduced: ReturnType<typeof reduceCompetitionCommand>;
        try { reduced = reduceCompetitionCommand(game, command, reducerNow); }
        catch (error) { if (error instanceof EntaError && ['OPTIONAL_CAPACITY_EXHAUSTED', 'ATTEMPT_BUDGET_EXCEEDED'].includes(error.code) && game.version === command.expectedVersion && !game.events.some(e => e.commandId === command.commandId) && !settleCompetitiveClock(structuredClone(game), reducerNow)) return { rejection: error.code as 'OPTIONAL_CAPACITY_EXHAUSTED' | 'ATTEMPT_BUDGET_EXCEEDED', match: projectCompetition(game, reducerNow), idempotent: false, commandReceipt: null, commandRejection: { version: 1 as const, state: 'REJECTED' as const, projectId: game.projectId, principalUid: p.uid, gameId: game.id, commandId: command.commandId, hash: admissionHash(command), expectedVersion: command.expectedVersion, currentRevision: game.version, reason: error.code as 'OPTIONAL_CAPACITY_EXHAUSTED' | 'ATTEMPT_BUDGET_EXCEEDED' } }; throw error; } if (reduced.idempotent) { const current = await settle(tx, game, await tx.now()); return { rejection: null, match: projectCompetition(current, await tx.now()), idempotent: true, issuance: reduced.grantData, commandReceipt: { state: 'ACCEPTED' as const, gameId: game.id, commandId: command.commandId, expectedVersion: command.expectedVersion, hash: admissionHash(command), eventId: game.events.find(e => e.commandId === command.commandId)!.id, revision: game.events.find(e => e.commandId === command.commandId)!.sequence } }; }
        const saved = await tx.save(game, reduced.next, reduced.rejection ? null : command);
        const storedEvent = saved.game.events.find(e => e.commandId === command.commandId && e.authority.kind === 'HOST' && e.hash === admissionHash(command)), storedGrant = reduced.grantData ? saved.game.grants.find(g => g.id === storedEvent?.id) : null;
        const proposedGrant = reduced.next.grants.find(g => g.id === reduced.grantData?.id);
        if (!saved.rejection && !reduced.rejection && reduced.grantData && (!storedGrant || storedGrant.tokenHash !== proposedGrant?.tokenHash)) return fail(503, 'GRANT_DATA_UNAVAILABLE');
        return { rejection: saved.rejection ?? reduced.rejection, blockingIds: saved.blockingIds, match: projectCompetition(saved.game, await tx.now()), idempotent: false, commandReceipt: storedEvent ? { state: 'ACCEPTED' as const, gameId: game.id, commandId: command.commandId, expectedVersion: command.expectedVersion, hash: storedEvent.hash, eventId: storedEvent.id, revision: storedEvent.sequence } : saved.game.version > command.expectedVersion ? { state: 'ABSENT' as const, gameId: game.id, commandId: command.commandId, expectedVersion: command.expectedVersion, hash: admissionHash(command), eventId: null, revision: saved.game.version } : null, ...(reduced.grantData && storedGrant ? { issuance: { ...reduced.grantData, id: storedGrant.id, scopeId: storedGrant.scopeId, expiresAt: storedGrant.expiresAt, generation: storedGrant.generation } } : {}) };
      });
      if (result.rejection === 'CORRECTION_DEPENDENCY_REVIEW_REQUIRED') throw new CompetitionReviewError('blockingIds' in result ? result.blockingIds ?? [] : [], 'blockingTotal' in result ? result.blockingTotal : undefined); if (result.rejection) { if ('commandReceipt' in result && result.commandReceipt || 'commandRejection' in result && result.commandRejection) throw new CompetitionCommandRejection(result.rejection, 'commandReceipt' in result ? result.commandReceipt : null, 'commandRejection' in result ? result.commandRejection : undefined); return fail(409, result.rejection); } return result;
    },
    async grading(p: Principal, gameId: string, roundId: string) {
      verified(p, repository.projectId); id(roundId); const result = await repository.transaction(async tx => {
        if (repository.source === 'postgres') { const { scope } = await nativeScope(tx, p, null, gameId); if (scope.roundId !== roundId || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(scope.format ?? '')) return fail(409, 'INVALID_PHASE'); if (!tx.nativePage) return fail(503, 'ENTA_UNAVAILABLE'); const proof = await tx.nativePage(p, null, scope.gameId, { collection: 'grading', roundId, effectId: null, snapshot: scope.snapshot, cursor: null }, 0); if (proof.restart) return null; if (proof.total !== scope.itemTotal) return fail(503, 'MATCH_DATA_UNAVAILABLE'); return { roundId, version: scope.roundVersion!, format: scope.format as 'LIST_ITEMS' | 'ACTING_ITEMS', total: proof.total, items: [] as ReturnType<typeof projectCompetitionGrading>['items'] }; }
        const game = await ownerLoad(tx, p, gameId), round = game.rounds.find(r => r.id === roundId) ?? fail(404, 'MATCH_NOT_FOUND'), now = await tx.now(), settled = await settle(tx, game, now);
        if (settled.version !== game.version) return null;
        if (game.finished || hasCompetitiveReview(game) || game.activeRoundId !== round.id || round.pause || round.resourceStop || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format) || round.phase === 'READY' || round.phase === 'RESOLVED') return fail(409, 'INVALID_PHASE'); return projectCompetitionGrading(round);
      }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result;
    },
    async capability(token: string) { const first = await privateCapability(token), current = await privateCapability(token); if (first.epoch !== current.epoch) return fail(403, 'GRANT_DENIED'); return current.data; },
    async mediaAuthorization(p: Principal | null, token: string | null, gameId: string | null, mediaId: string, gradingRoundId?: string): Promise<{ pin: MediaPin; epoch: string }> {
      id(mediaId); if (gradingRoundId) id(gradingRoundId); if (p) verified(p, repository.projectId);
      const result = await repository.transaction(async tx => {
        if (repository.source === 'postgres') { const { scope, hash } = await nativeScope(tx, p, token, gameId); if (!tx.nativeMediaManifest) return fail(503, 'ENTA_UNAVAILABLE'); const selected = await tx.nativeMediaManifest(p, hash, scope.gameId, mediaId, gradingRoundId ?? null, scope.snapshot); if ('restart' in selected && selected.restart) return null; return { pin: selected.pin, epoch: `${scope.gameId}:${scope.snapshot}:${scope.visibility}:${mediaId}` }; }
        let game: CompetitionGame, grant: Grant | undefined;
        if (token) { const authorization = await live(tx, token); game = authorization.game; grant = authorization.grant; }
        else { if (!p || !gameId) return fail(403, 'MEDIA_DENIED'); game = await ownerLoad(tx, p, gameId); }
        if (game.finished || hasCompetitiveReview(game)) return fail(403, 'MEDIA_DENIED');
        const round = game.rounds.find(r => r.id === game.activeRoundId), cover = !grant && !gradingRoundId ? game.categories.map(c => c.cover).find(m => m?.id === mediaId) : null;
        if (round?.pause || round?.resourceStop) return fail(403, 'MEDIA_DENIED');
        if (gradingRoundId && (!p || grant || !round || round.id !== gradingRoundId || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format))) return fail(403, 'MEDIA_DENIED');
        const pin = gradingRoundId ? round!.pin.media.find(m => m.id === mediaId && m.role === 'ITEM') : cover ?? (round ? competitionMedia(game, round, grant?.role ?? 'HOST', grant).find(m => m.id === mediaId) : null); if (!pin) return fail(403, 'MEDIA_DENIED');
        const beforeVersion = game.version; game = await settle(tx, game, await tx.now()); if (game.version !== beforeVersion) return null;
        if (token) { const hash = tokenHash(parseToken(token)); game = await tx.disclose(game, hash, await tx.now()); grant = authorizeCompetitiveGrant(game, hash, await tx.now()).grant; }
        const selected = { pin };
        if ('restart' in selected && selected.restart) return null;
        return { pin: selected.pin, epoch: `${game.id}:${game.version}:${round?.id ?? 'board'}:${round?.version ?? 0}:${grant?.id ?? 'host'}:${grant?.generation ?? 0}:${round?.assignment?.generation ?? 0}:${mediaId}` };
      }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result;
    },
    async canvas(p: Principal | null, token: string | null, gameId: string | null, roundId: string, query: unknown, input?: unknown) {
      id(roundId); if (p) verified(p, repository.projectId); const command = input === undefined ? null : parseCanvasCommand(input);
      const result = await repository.transaction(async tx => {
        const q = command ? null : exact(query, ['snapshot', 'revision', 'cursor']);
        if (q) { if (q.snapshot !== null) integer(q.snapshot, 1, 64946); if (q.revision !== null) integer(q.revision, 0, 512); if (q.cursor !== null && (typeof q.cursor !== 'string' || q.cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(q.cursor) || q.snapshot === null || q.revision === null)) return fail(400, 'INVALID_CANVAS_CURSOR'); }
        if (repository.source === 'postgres') {
          const { scope: authority, hash } = await nativeScope(tx, p, token, gameId);
          if (command) {
            if (!hash || authority.purpose !== 'ACTOR' || authority.roundId !== roundId || authority.format !== 'DRAWING_TARGET' || !tx.nativeCanvasMutation) return fail(403, 'CANVAS_DENIED');
            const saved = await tx.nativeCanvasMutation(hash, authority.gameId, authority.snapshot, command); exact(saved, ['idempotent', 'canvasReceipt']); const receipt = exact(saved.canvasReceipt, ['gameId', 'roundId', 'commandId', 'hash', 'expectedRevision', 'revision', 'eventId']);
            if (typeof saved.idempotent !== 'boolean' || receipt.gameId !== authority.gameId || receipt.roundId !== roundId || receipt.commandId !== command.commandId || receipt.hash !== admissionHash(command) || receipt.expectedRevision !== command.expectedRevision || receipt.revision !== command.expectedRevision + 1) return fail(503, 'CANVAS_UNAVAILABLE'); id(receipt.eventId); return saved;
          }
          if (authority.purpose === 'JUDGE' || authority.roundId !== roundId || authority.format !== 'DRAWING_TARGET') return fail(403, 'CANVAS_DENIED'); if (!tx.nativeCanvasPage) return fail(503, 'ENTA_UNAVAILABLE');
          const first = await tx.nativeCanvasPage(p, hash, authority.gameId, roundId, q!.snapshot as number | null, q!.revision as number | null, 0); if ('restart' in first || 'denied' in first) return first;
          const bound = readCompetitionNativeScope(first.scope, authority.gameId, repository.projectId); if (bound.principal !== authority.principal || bound.purpose !== authority.purpose || bound.roundId !== roundId || bound.canvasRevision !== first.canvasRevision) return fail(503, 'CANVAS_UNAVAILABLE');
          const scope = { principal: bound.principal, project: bound.projectId, gameId: bound.gameId, collection: 'canvas' as const, roundId, effectId: null, purpose: bound.purpose, visibility: bound.visibility, snapshot: bound.snapshot, canvasRevision: first.canvasRevision };
          const offset = pager.start(scope, q!.cursor as string | null, first.total), selected = offset ? await tx.nativeCanvasPage(p, hash, bound.gameId, roundId, bound.snapshot, first.canvasRevision, offset) : first; if ('restart' in selected || 'denied' in selected) return selected;
          if (admissionHash(selected.scope) !== admissionHash(bound) || selected.canvasRevision !== first.canvasRevision || selected.total !== first.total) return { restart: true as const };
          const page = pager.window(scope, q!.cursor as string | null, selected.total, readCompetitionNativeCanvasRows(selected.rows));
          return { page: { roundId, revision: first.canvasRevision, gameVersion: bound.snapshot, total: selected.total, offset: page.offset, nextCursor: page.nextCursor, strokes: page.rows }, idempotent: false };
        }
        let game: CompetitionGame, grant: Grant | undefined;
        if (token) { const a = await live(tx, token); if (a.grant.role !== 'ACTOR' || a.round.id !== roundId || a.round.pin.format !== 'DRAWING_TARGET') return fail(403, 'GRANT_DENIED'); game = await tx.disclose(a.game, a.hash, a.now); grant = authorizeCompetitiveGrant(game, a.hash, await tx.now()).grant; }
        else { if (!p || !gameId || command) return fail(403, 'CANVAS_DENIED'); game = await ownerLoad(tx, p, gameId); }
        const round = game.rounds.find(r => r.id === roundId) ?? fail(404, 'MATCH_NOT_FOUND'); if (game.finished || hasCompetitiveReview(game) || round.pause || round.resourceStop || game.activeRoundId !== round.id || round.pin.format !== 'DRAWING_TARGET') return fail(403, 'CANVAS_DENIED');
        const before = game.version, settled = await settle(tx, game, await tx.now()); if (settled.version !== before) return null;
        const canvas = game.canvases.find(c => c.roundId === round.id) ?? fail(503, 'CANVAS_UNAVAILABLE');
        if (!command) {
          if (q!.snapshot !== null && q!.snapshot !== game.version || q!.revision !== null && q!.revision !== canvas.revision) return { restart: true as const };
          const scope = { principal: grant?.id ?? p!.uid, project: game.projectId, gameId: game.id, collection: 'canvas' as const, roundId, effectId: null, purpose: grant?.role ?? 'OWNER' as const, visibility: pageVisibility(game, grant), snapshot: game.version, canvasRevision: canvas.revision };
          const visible = canvas.visibleIds.map(id => canvas.strokes.find(stroke => stroke.id === id) ?? fail(503, 'CANVAS_UNAVAILABLE')), page = pager.page(scope, q!.cursor as string | null, visible);
          return { page: { roundId, revision: canvas.revision, gameVersion: game.version, total: visible.length, offset: page.offset, nextCursor: page.nextCursor, strokes: page.rows }, idempotent: false };
        }
        const reduced = reduceCanvas(canvas, command); if (reduced.idempotent) { const receipt = canvas.receipts.find(r => r.commandId === command.commandId)!, event = game.events.find(e => e.commandId === command.commandId && e.hash === receipt.hash && e.authority.kind === 'GRANT') ?? fail(503, 'CANVAS_UNAVAILABLE'); return { idempotent: true, canvasReceipt: { gameId: game.id, roundId, commandId: command.commandId, hash: receipt.hash, expectedRevision: command.expectedRevision, revision: receipt.revision, eventId: event.id } }; }
        const next = structuredClone(game); next.canvases[next.canvases.findIndex(c => c.roundId === round.id)] = reduced.canvas; const e = competitiveEvent(next, command.commandId, admissionHash(command), `CANVAS_${command.type}`, round.id, await tx.now(), { kind: 'GRANT', grantId: grant!.id, generation: grant!.generation, assignmentId: grant!.assignmentId! }); sealEffect(addEffect(next, e, round, 'TIMING'));
        reconcileCapacity(game, next, null); const saved = await tx.save(game, next, command); if (saved.rejection) return null; const persisted = saved.game.canvases.find(c => c.roundId === round.id) ?? fail(503, 'CANVAS_UNAVAILABLE'), receipt = persisted.receipts.find(r => r.commandId === command.commandId) ?? fail(503, 'CANVAS_UNAVAILABLE'), event = saved.game.events.find(e => e.commandId === command.commandId && e.hash === receipt.hash && e.authority.kind === 'GRANT') ?? fail(503, 'CANVAS_UNAVAILABLE'); return { idempotent: false, canvasReceipt: { gameId: game.id, roundId, commandId: command.commandId, hash: receipt.hash, expectedRevision: command.expectedRevision, revision: receipt.revision, eventId: event.id } };
      }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); if ('restart' in result) return fail(409, 'PAGE_SNAPSHOT_RESTART'); if ('denied' in result) return fail(403, 'CANVAS_DENIED'); return result;
    },
  });
}
export type CompetitionService = ReturnType<typeof service>;
export function createCompetitionService(repository: CompetitionRepository): CompetitionService { if (repository.source !== 'postgres') throw Error('TEST_GAMEPLAY_FORBIDDEN'); return service(repository, productionCompetitionPolicy, 'production'); }
export function createCompetitionServiceForTest(repository: CompetitionRepository, policy: (catalog: CompetitionCatalog) => void): CompetitionService { if (repository.source !== 'test-only' || hostedGameplayRuntime()) throw Error('TEST_GAMEPLAY_FORBIDDEN'); return service(repository, policy, 'test-only'); }
/** Deliberate standalone local composition, never accepted by the ordinary app factory. */
export function createLocalCompetitionService(repository: CompetitionRepository, retainedSource?:{baseReleaseId:string;baseRoot:string}): CompetitionService {
  assertLocalDevelopment();
  if (repository.source !== 'local-development' || repository.projectId !== LOCAL_PROJECT) throw Error('LOCAL_DEVELOPMENT_ONLY');
  return service(repository, catalog => { assertLocalDevelopment(); if (catalog.competitiveReleaseId !== 'local-competition-v1' || catalog.base.baseReleaseId !== (retainedSource?.baseReleaseId??(realContentEnabled()?realContent().source.releaseId:'local-practice-v1')) || retainedSource&&catalog.base.baseRoot!==retainedSource.baseRoot || catalog.base.receiptId !== 'local-content-binding-not-production') throw Error('LOCAL_CATALOG_REQUIRED'); validateCompetitionCatalog(catalog); }, 'local-development');
}



