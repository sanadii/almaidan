import { assertLocalDevelopment, LOCAL_PROJECT } from '../local-development/guard';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import type { Principal } from '../identity';
import { fail } from '../gameplay/types';
import { hostedGameplayRuntime } from '../gameplay/service';
import { authorizeChildren, event, reduceHost, settleClock } from './engine';
import { authorizeGrant, issueGrant, parseToken, tokenHash } from './grants';
import { canvasPage, newCanvas, reduceCanvas } from './canvas';
import { allowedMedia, projectCapability, projectFormatCatalog, projectGrading, projectRoundGame } from './projection';
import { productionFormatPolicy, selectRoundPins, sourceKey, validateFormatCatalog } from './selection';
import { exact, id, integer, parseCanvasCommand, parseGrantCommand, parseHostCommand, parseRoundStart, requestHash } from './validation';
import type { ExecutionFormat, FormatCatalog, Grant, MediaPin, RoundGame, RoundRepository, RoundTransaction } from './types';
function verified(principal: Principal, projectId: string) { if (principal.projectId !== projectId || !principal.verifiedAccount || principal.anonymous || !principal.email || !principal.uid) return fail(403, 'VERIFIED_ACCOUNT_REQUIRED'); }
function owner(game: RoundGame | null, principal: Principal): asserts game is RoundGame { if (!game || game.projectId !== principal.projectId || game.hostUid !== principal.uid) return fail(404, 'MATCH_NOT_FOUND'); }
function stored(game: RoundGame): void {
  if (game.clientHash !== requestHash(game.request) || game.intentHash !== admissionHash(game.intent) || admissionHash(game.intent.request) !== game.clientHash || game.intent.roundCount !== game.rounds.length || game.intent.pinsHash !== admissionHash(game.rounds.map(round => round.pin)) || game.intent.selection.length !== game.rounds.length || game.rounds.some((round, index) => round.pin.sourceNamespace !== game.intent.selection[index].sourceNamespace || round.pin.sourceId !== game.intent.selection[index].sourceId || round.pin.revisionId !== game.intent.selection[index].revisionId || round.ordinal !== index) || new Set(game.rounds.map(round => sourceKey(round.pin))).size !== game.rounds.length) return fail(503, 'MATCH_DATA_UNAVAILABLE');
}
function service(repository: RoundRepository, policy: (catalog: FormatCatalog) => void, source: 'production' | 'test-only' | 'local-development') {
  async function liveGrant(tx: RoundTransaction, token: string) {
    const hash = tokenHash(parseToken(token)), location = await tx.locateGrant(hash);
    const game = location ? await tx.loadGrant(location.gameId, hash) : null, now = await tx.now();
    const authorized = authorizeGrant(game, hash, now); stored(authorized.game); return { ...authorized, now };
  }
  async function settle(tx: RoundTransaction, game: RoundGame, now: number): Promise<boolean> { const next = structuredClone(game); if (!settleClock(next, now)) return false; await tx.save(game, next, null); return true; }
  async function mediaAuthorization(principal: Principal | null, token: string | null, gameId: string | null, mediaId: string, gradingRoundId?: string): Promise<{ gameId: string; pin: MediaPin; epoch: string }> {
    id(mediaId); if (gradingRoundId) id(gradingRoundId); if (principal) verified(principal, repository.projectId);
    const result = await repository.transaction(async tx => {
      let game: RoundGame, grant: Grant | undefined, now: number;
      if (token) { const authorized = await liveGrant(tx, token); game = authorized.game; grant = authorized.grant; now = authorized.now; }
      else { if (!principal || !gameId) return fail(403, 'MEDIA_DENIED'); const loaded = await tx.loadOwner(principal, id(gameId), true); owner(loaded, principal); game = loaded; stored(game); now = await tx.now(); }
      if (await settle(tx, game, now)) return { rejected: true as const };
      if (game.finished) return fail(403, 'MEDIA_DENIED');
      const round = game.rounds.find(round => round.id === game.activeRoundId), cover = !grant ? game.categories.map(category => category.cover).find(pin => pin?.id === mediaId) : null;
      if (gradingRoundId && (!principal || grant || !round || round.id !== gradingRoundId || round.state !== 'RUNNING' || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format))) return fail(403, 'MEDIA_DENIED');
      const pin = gradingRoundId ? round!.pin.media.find(pin => pin.id === mediaId && pin.role === 'ITEM') : cover ?? (round ? allowedMedia(round, grant?.role ?? 'HOST', grant).find(pin => pin.id === mediaId) : null);
      if (!pin) return fail(403, 'MEDIA_DENIED');
      return { rejected: false as const, gameId: game.id, pin, epoch: `${game.id}:${round?.id ?? 'board'}:${round?.version ?? game.version}:${grant?.id ?? 'host'}:${grant?.generation ?? 0}:${mediaId}` };
    });
    if (result.rejected) return fail(409, 'ROUND_TIME_EXPIRED'); return { gameId: result.gameId, pin: result.pin, epoch: result.epoch };
  }
  return Object.freeze({ source,
    async catalog(principal: Principal, format: ExecutionFormat) { verified(principal, repository.projectId); return repository.transaction(async tx => { const wallet = await tx.lockWallet(principal), catalog = await tx.catalog(principal, format); validateFormatCatalog(catalog); policy(catalog); if (wallet.debt > 0n) return fail(409, 'WALLET_DEBT_BLOCKS_START'); const projected=projectFormatCatalog(catalog,wallet.available);return repository.source==='local-development'?{...projected,categories:projected.categories.map(c=>['ORDINARY_TIER','DRAWING_TARGET'].includes(c.format)?{...c,prompts:[]}:c)}:projected; }); },
    async start(principal: Principal, format: ExecutionFormat, input: unknown) {
      verified(principal, repository.projectId); const request = parseRoundStart(input, format), clientHash = requestHash(request);
      return repository.transaction(async tx => {
        const wallet = await tx.lockWallet(principal), existing = await tx.findStart(principal, request.requestKey, request.logicalMatchId);
        if (existing) { owner(existing, principal); stored(existing); if (existing.request.requestKey !== request.requestKey || existing.id !== request.logicalMatchId || existing.clientHash !== clientHash) return fail(409, 'IDEMPOTENCY_KEY_CONFLICT'); return { match: projectRoundGame(existing, await tx.now()), idempotent: true }; }
        if (wallet.debt > 0n) return fail(409, 'WALLET_DEBT_BLOCKS_START'); if (wallet.available < 1n) return fail(402, 'INSUFFICIENT_CREDIT');
        const catalog = await tx.catalog(principal, format); validateFormatCatalog(catalog); policy(catalog);
        const exposures = format === 'MIXED_BOARD' ? [] : await tx.exposures(principal, format, request.setup.categories[0].key), selection = selectRoundPins(request, catalog, exposures);
        const game = await tx.create(principal, request, selection.intent, selection.pins, catalog); owner(game, principal); stored(game);
        return { match: projectRoundGame(game, await tx.now()), idempotent: false };
      });
    },
    async get(principal: Principal, gameId: string) { verified(principal, repository.projectId); const result = await repository.transaction(async tx => { const game = await tx.loadOwner(principal, id(gameId), true); owner(game, principal); stored(game); const now = await tx.now(); let next = structuredClone(game); if (settleClock(next, now)) next = (await tx.save(game, next, null)).game; return projectRoundGame(next, now); }); return result; },
    async command(principal: Principal, gameId: string, input: unknown) {
      verified(principal, repository.projectId); const command = parseHostCommand(input), hash = admissionHash(command);
      const result = await repository.transaction(async tx => {
        const game = await tx.loadOwner(principal, id(gameId), true); owner(game, principal); stored(game); authorizeChildren(game, command);
        const duplicate = game.events.find(event => event.commandId === command.commandId), now = await tx.now();
        if (duplicate) { if (duplicate.hash !== hash) return fail(409, 'COMMAND_KEY_CONFLICT'); return { rejected: false as const, match: projectRoundGame(game, now), idempotent: true }; }
        if (await settle(tx, game, now)) return { rejected: true as const };
        const saved = await tx.save(game, reduceHost(game, command, now), command); if (saved.rejection) return { rejected: true as const }; return { rejected: false as const, match: projectRoundGame(saved.game, now), idempotent: false };
      });
      if (result.rejected) return fail(409, 'ROUND_TIME_EXPIRED'); return { match: result.match, idempotent: result.idempotent };
    },
    async grading(principal: Principal, gameId: string, roundId: string) { verified(principal, repository.projectId); const result = await repository.transaction(async tx => { const game = await tx.loadOwner(principal, id(gameId), true); owner(game, principal); const round = game.rounds.find(round => round.id === id(roundId)) ?? fail(404, 'MATCH_NOT_FOUND'), now = await tx.now(); if (await settle(tx, game, now)) return null; if (game.finished || game.activeRoundId !== round.id || round.state !== 'RUNNING' || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format)) return fail(409, 'INVALID_PHASE'); return projectGrading(round); }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result; },
    async grant(principal: Principal, gameId: string, input: unknown) { verified(principal, repository.projectId); const command = parseGrantCommand(input); const result = await repository.transaction(async tx => { const game = await tx.loadOwner(principal, id(gameId), true); owner(game, principal); if (!game.rounds.some(round => round.id === command.roundId)) return fail(404, 'MATCH_NOT_FOUND'); const now = await tx.now(); if (!game.events.some(event => event.commandId === command.commandId) && await settle(tx, game, now)) return null; const issued = issueGrant(game, command, now); const saved = issued.idempotent ? { game: issued.next, rejection: null } : await tx.save(game, issued.next, command); if (saved.rejection) return null; const storedEvent = saved.game.events.find(event => event.commandId === command.commandId); const storedGrant = saved.game.grants.find(grant => grant.id === storedEvent?.id); if (!storedGrant || storedGrant.tokenHash !== issued.next.grants.find(grant => grant.id === issued.data.id)?.tokenHash) return fail(503, 'GRANT_DATA_UNAVAILABLE'); return { issuance: { ...issued.data, ...(storedGrant ? { id: storedGrant.id, scopeId: storedGrant.scopeId, expiresAt: storedGrant.expiresAt, generation: storedGrant.generation } : {}) }, match: projectRoundGame(saved.game, now), idempotent: issued.idempotent }; }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result; },
    async capability(token: string) { const result = await repository.transaction(async tx => { const authorized = await liveGrant(tx, token); if (await settle(tx, authorized.game, authorized.now)) return null; return projectCapability(authorized.game, authorized.round, authorized.grant, authorized.now); }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result; },
    async canvas(principal: Principal | null, token: string | null, gameId: string | null, roundId: string, query: unknown, input?: unknown) {
      id(roundId); if (principal) verified(principal, repository.projectId); const command = input === undefined ? null : parseCanvasCommand(input);
      const result = await repository.transaction(async tx => {
        let game: RoundGame, authority: Parameters<typeof event>[5], now: number;
        if (token) { const allowed = await liveGrant(tx, token); if (allowed.grant.role !== 'ACTOR' || allowed.round.id !== roundId || allowed.round.pin.format !== 'DRAWING_TARGET') return fail(403, 'GRANT_DENIED'); game = allowed.game; now = allowed.now; authority = { kind: 'GRANT', grantId: allowed.grant.id, generation: allowed.grant.generation, assignmentId: allowed.grant.assignmentId! }; }
        else { if (!principal || !gameId) return fail(403, 'CANVAS_DENIED'); const loaded = await tx.loadOwner(principal, id(gameId), true); owner(loaded, principal); game = loaded; now = await tx.now(); authority = { kind: 'HOST', identityId: game.identityId }; }
        const round = game.rounds.find(round => round.id === roundId) ?? fail(404, 'MATCH_NOT_FOUND');
        if (round.pin.format !== 'DRAWING_TARGET' || game.activeRoundId !== round.id || round.state !== 'RUNNING' || game.finished || command && authority.kind === 'HOST') return fail(403, 'CANVAS_DENIED');
        if (await settle(tx, game, now)) return null;
        const canvas = game.canvases.find(canvas => canvas.roundId === roundId) ?? newCanvas(roundId);
        if (!command) { const row = exact(query, ['revision', 'offset']); return { page: canvasPage(canvas, row.revision === null ? null : integer(row.revision, 0), integer(row.offset, 0, 128)), idempotent: false }; }
        const reduced = reduceCanvas(canvas, command); let savedCanvas = reduced.canvas; if (!reduced.idempotent) { const next = structuredClone(game), index = next.canvases.findIndex(canvas => canvas.roundId === roundId); if (index < 0) next.canvases.push(reduced.canvas); else next.canvases[index] = reduced.canvas; event(next, command.commandId, admissionHash(command), `CANVAS_${command.type}`, roundId, authority, now); const saved = await tx.save(game, next, command); if (saved.rejection) return null; savedCanvas = saved.game.canvases.find(canvas => canvas.roundId === roundId) ?? fail(503, 'CANVAS_UNAVAILABLE'); }
        return { page: canvasPage(savedCanvas, savedCanvas.revision, 0), idempotent: reduced.idempotent };
      }); if (!result) return fail(409, 'ROUND_TIME_EXPIRED'); return result;
    },
    mediaAuthorization,
  });
}
export type RoundService = ReturnType<typeof service>;
export function createRoundService(repository: RoundRepository): RoundService { if (repository.source !== 'postgres') throw new Error('TEST_GAMEPLAY_FORBIDDEN'); return service(repository, productionFormatPolicy, 'production'); }
export function createRoundServiceForTest(repository: RoundRepository, policy: (catalog: FormatCatalog) => void): RoundService { if (repository.source !== 'test-only' || hostedGameplayRuntime()) throw new Error('TEST_GAMEPLAY_FORBIDDEN'); return service(repository, policy, 'test-only'); }


export function createLocalRoundService(repository: RoundRepository): RoundService { assertLocalDevelopment(); if(repository.source !== 'local-development' || repository.projectId !== LOCAL_PROJECT) throw new Error('LOCAL_SERVICE_REQUIRED'); return service(repository,catalog=>{assertLocalDevelopment();if(catalog.receiptId !== 'local-content-binding-not-production') throw new Error('LOCAL_CONTENT_REQUIRED');validateFormatCatalog(catalog);},'local-development'); }




