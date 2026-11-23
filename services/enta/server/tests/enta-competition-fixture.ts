// Explicit synthetic identity/content/proof. Never ordinary composition import.
import { reconcileCapacity } from '../src/rounds/competition-capacity';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { randomUUID } from 'node:crypto';
import { fail } from '../src/gameplay/types';
import { reduceCompetitionCommand } from '../src/rounds/competition-engine';
import { settleCompetitiveClock } from '../src/rounds/competition-clock';
import { authorizeCompetitiveGrant } from '../src/rounds/competition-grants';
import { addEffect, competitiveEvent, sealEffect } from '../src/rounds/competition-effects';
import { competitionProofRoot, PALETTE_ROOT, parseCompetitionStart } from '../src/rounds/competition-rules';
import { newCompetitionGame, selectCompetition } from '../src/rounds/competition-selection';
import { fixtureFormatCatalog, fixturePrincipal } from './enta-round-fixture';
import type { Aid, CompetitionCatalog, CompetitionFormat, CompetitionGame, CompetitionRepository, CompetitionTransaction } from '../src/rounds/competition-types';
export { fixturePrincipal };
export function fixtureCompetitionCatalog(): CompetitionCatalog {
  const base = fixtureFormatCatalog();
  // Complete synthetic release includes six distinct CLASSIC categories.
  for (let n = 0; n < 6; n++) {
    const category = structuredClone(base.categories[3]); category.key = `competition_classic_${n}`; category.label = `أسئلة المنافسة ${n + 1}`;
    category.prompts = category.prompts.map((pin, ordinal) => { pin.ref = `classic_prompt_${n}_${ordinal}`; pin.sourceId = `classic_source_${n}_${ordinal}`; pin.revisionId = `classic_revision_${n}_${ordinal}`; pin.formatId = `classic_format_${n}_${ordinal}`; pin.categoryKey = category.key; const { formatHash, ...payload } = pin; void formatHash; pin.formatHash = admissionHash({ version: 1, pin: payload }); return pin; }); base.categories.push(category);
  }
  const catalog: CompetitionCatalog = { base, policyVersion: 'enta-competitive-1', competitiveReleaseId: 'test-competitive-release', paletteRoot: PALETTE_ROOT, proofRoot: '', prompts: [] };
  catalog.prompts = base.categories.flatMap(c => c.prompts).map(pin => {
    const hints = [0, 1].map(ordinal => ({ id: `hint_${pin.formatId}_${ordinal}`, revisionId: pin.revisionId, revisionHash: pin.hash, ordinal, text: ordinal ? 'تلميح إضافي معتمد للاختبار' : 'تلميح السؤال الأول للاختبار', contentHash: '', safeDrawing: true }));
    for (const h of hints) h.contentHash = admissionHash({ ordinal: h.ordinal, text: h.text });
    const graphemes = pin.items.filter(i => !i.trap).map(i => { const proof = { answerRevisionId: i.revisionId, answerHash: i.hash, segmentationVersion: `unicode-${process.versions.unicode}-icu-${process.versions.icu}`, grapheme: [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(i.text)][0].segment }; return { id: `grapheme_${i.id}`, ...proof, proofHash: admissionHash(proof) }; });
    const hintRoot = admissionHash({ hints, graphemes }), effectValue = pin.points ?? 200, effectValueSource = pin.points === null ? 'OWNER_EMBEDDED_200' as const : 'PINNED_TIER' as const;
    return { ...pin, hints, graphemes, hintRoot, effectValue, effectValueSource, proofHash: admissionHash({ version: 'enta-competitive-1', baseHash: admissionHash(pin), hints, graphemes, hintRoot, effectValue, effectValueSource }) };
  }); catalog.proofRoot = competitionProofRoot(catalog); return catalog;
}
export function fixtureCompetitionStart(format: CompetitionFormat = 'MIXED_BOARD', aids?: Aid[]) {
  const standalone = format.startsWith('STANDALONE'), chosenAids = aids ?? (standalone ? ['HINT', 'DOUBLE', 'PHONE'] : ['PHONE_A_FRIEND', 'DOUBLE_ANSWER', 'DOUBLE_POINTS']);
  return { requestKey: 'competition-request-0001', logicalMatchId: 'competition-logical-0001', setup: { version: 5, categories: (standalone ? [format === 'STANDALONE_LIST' ? 0 : 1] : [0, 1, 2, 3, 4, 5]).map(index => ({ key: format === 'TIER_BOARD' ? `competition_classic_${index}` : `format_category_${index}`, promptRefs: !standalone && format !== 'TIER_BOARD' && index < 2 ? [`prompt_${index}_0`] : [] })), teams: [{ name: 'الفريق الأول', colorKey: 'CORAL', players: ['سارة', 'نور'], aids: chosenAids }, { name: 'الفريق الثاني', colorKey: 'SKY', players: ['علي', 'ريم'], aids: chosenAids }], rules: { version: 'enta-competitive-1', paletteVersion: 'enta-team-palette-1', questionSeconds: 30, turnSeconds: 30, overallSeconds: standalone ? 300 : null, stealSeconds: 10, phoneSeconds: 60, embeddedStealCap: 200 } } };
}
export function fixtureCompetitionGame(format: CompetitionFormat = 'MIXED_BOARD', aids?: Aid[]): CompetitionGame { const request = parseCompetitionStart(fixtureCompetitionStart(format, aids), format), catalog = fixtureCompetitionCatalog(), selected = selectCompetition(request, catalog, [], '1'.repeat(64)); return newCompetitionGame(fixturePrincipal, 'fixture-host-identity', request, selected.intent, selected.pins, catalog); }
/** Serialized synthetic transaction, not proof of PG locks/ACL/races. It
 * shares explicit v4 exposure tuples to exercise source novelty compatibility. */
export class CompetitionFixtureRepository implements CompetitionRepository {
  readonly source = 'test-only' as const; readonly projectId = fixturePrincipal.projectId;
  games = new Map<string, CompetitionGame>(); available = 100n; debt = 0n; debitCount = 0; failAfterReserve = false; nowValue = Date.parse('2026-10-07T20:00:00Z'); lockAdvance = 0; saveAdvance = 0; catalogValue = fixtureCompetitionCatalog(); audits = new Map<string, { id: string; hash: string }>();
  priorV4Exposures: { uid: string; format: CompetitionFormat; categoryKey: string; sourceNamespace: string; sourceId: string; cycle: number }[] = []; private tail: Promise<void> = Promise.resolve();
  async transaction<T>(work: (tx: CompetitionTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void; this.tail = new Promise<void>(done => { release = done; }); await previous;
    const snapshot = { games: structuredClone(this.games), available: this.available, debitCount: this.debitCount, audits: structuredClone(this.audits) };
    try { return await work({
      lockWallet: async () => ({ identityId: 'fixture-host-identity', available: this.available, debt: this.debt }),
      findStart: async (p, key, logical) => structuredClone([...this.games.values()].find(g => g.projectId === p.projectId && g.hostUid === p.uid && (g.request.requestKey === key || g.id === logical)) ?? null),
      catalog: async () => structuredClone(this.catalogValue),
      exposures: async (p, format, category) => [...this.priorV4Exposures.filter(e => e.uid === p.uid && e.format === format && e.categoryKey === category), ...[...this.games.values()].filter(g => g.projectId === p.projectId && g.hostUid === p.uid && g.request.executionFormat === format).flatMap(g => g.intent.selection.map(s => ({ categoryKey: g.request.setup.categories[0].key, sourceNamespace: s.sourceNamespace, sourceId: s.sourceId, cycle: s.cycle }))).filter(e => e.categoryKey === category)],
      create: async (p, request, intent, pins, catalog) => { if (this.available < 1n) return fail(402, 'INSUFFICIENT_CREDIT'); this.available--; this.debitCount++; if (this.failAfterReserve) throw Error('synthetic rollback'); const game = newCompetitionGame(p, 'fixture-host-identity', request, intent, pins, catalog); this.games.set(game.id, structuredClone(game)); return game; },
      loadOwner: async (_p, gameId) => { this.nowValue += this.lockAdvance; this.lockAdvance = 0; return structuredClone(this.games.get(gameId) ?? null); },
      locateGrant: async hash => { const game = [...this.games.values()].find(g => g.grants.some(grant => grant.tokenHash === hash)); return game ? { gameId: game.id } : null; },
      loadGrant: async gameId => { this.nowValue += this.lockAdvance; this.lockAdvance = 0; return structuredClone(this.games.get(gameId) ?? null); },
      save: async (before, proposed, command) => {
        const current = this.games.get(before.id) ?? fail(404, 'MATCH_NOT_FOUND'); if (current.version !== before.version) return fail(409, 'STALE_VERSION');
        this.nowValue += this.saveAdvance; this.saveAdvance = 0;
        let next = structuredClone(current), rejection: 'ROUND_TIME_EXPIRED' | 'RESOURCE_LIMIT_REACHED' | null = null;
        const grantAuthority = proposed.events.at(-1)?.authority;
        if (grantAuthority?.kind === 'GRANT') { const grant = current.grants.find(g => g.id === grantAuthority.grantId) ?? fail(403, 'GRANT_DENIED'); authorizeCompetitiveGrant(current, grant.tokenHash, this.nowValue); }
        if (command && 'expectedVersion' in command) { const reduced = reduceCompetitionCommand(current, command, this.nowValue); next = reduced.next; rejection = reduced.rejection;
          if (!rejection && ['CREATE_GRANT', 'ROTATE_GRANT', 'REVOKE_GRANT'].includes(command.type)) { const proposedEvent = proposed.events.find(e => e.commandId === command.commandId), actualEvent = next.events.find(e => e.commandId === command.commandId), proposedGrant = proposed.grants.find(g => g.id === proposedEvent?.id), actualGrant = next.grants.find(g => g.id === actualEvent?.id); if (!proposedGrant || !actualGrant) return fail(503, 'GRANT_DATA_UNAVAILABLE'); actualGrant.tokenHash = proposedGrant.tokenHash; }
        }
        else if (settleCompetitiveClock(next, this.nowValue)) rejection = command ? 'ROUND_TIME_EXPIRED' : null;
        else if (command) next = proposed;
        this.games.set(next.id, structuredClone(next)); return { game: next, rejection };
      },
      disclose: async (game, hash) => {
        const current = structuredClone(this.games.get(game.id)!), before = structuredClone(current); const allowed = authorizeCompetitiveGrant(current, hash, this.nowValue);
        if (allowed.grant.role !== 'ACTOR' || allowed.round.pin.format !== 'DRAWING_TARGET') return current;
        const assignment = allowed.round.assignment!, targetHash = admissionHash({ revisionId: allowed.round.pin.revisionId, revisionHash: allowed.round.pin.hash, target: allowed.round.pin.target });
        if (current.disclosures.some(d => d.roundId === allowed.round.id && d.assignmentId === assignment.id && d.grantId === allowed.grant.id && d.playerId === assignment.playerId && d.targetHash === targetHash)) return current;
        const e = competitiveEvent(current, randomUUID(), admissionHash({ hash, targetHash, assignmentId: assignment.id }), 'TARGET_DELIVERY', allowed.round.id, this.nowValue, { kind: 'GRANT', grantId: allowed.grant.id, generation: allowed.grant.generation, assignmentId: assignment.id });
        current.disclosures.push({ id: e.id, roundId: allowed.round.id, targetRevisionId: allowed.round.pin.revisionId, targetHash, playerId: assignment.playerId, assignmentId: assignment.id, assignmentGeneration: assignment.generation, at: this.nowValue, grantId: allowed.grant.id, grantGeneration: allowed.grant.generation }); const effect = addEffect(current, e, allowed.round, 'DISCLOSURE'); sealEffect(effect); reconcileCapacity(before, current, null); this.games.set(current.id, structuredClone(current)); return current;
      },
      audit: async (_p, game, command) => { const key = JSON.stringify([game.id, command.commandId]), hash = admissionHash(command), existing = this.audits.get(key); if (existing) { if (existing.hash !== hash) return fail(409, 'COMMAND_KEY_CONFLICT'); return { id: existing.id, idempotent: true }; } if (game.events.some(e => e.commandId === command.commandId)) return fail(409, 'COMMAND_KEY_CONFLICT'); if (this.games.get(game.id)!.version !== command.expectedVersion) return fail(409, 'STALE_VERSION'); if ([...this.audits.keys()].filter(k => JSON.parse(k)[0] === game.id).length >= 128) return fail(409, 'AUDIT_BUDGET_EXCEEDED'); const record = { id: randomUUID(), hash }; this.audits.set(key, record); return { id: record.id, idempotent: false }; },
      hasAuditCommand: async (_p, gameId, commandId) => this.audits.has(JSON.stringify([gameId, commandId])),
      now: async () => this.nowValue,
    }); } catch (error) { Object.assign(this, snapshot); throw error; } finally { release(); }
  }
}
