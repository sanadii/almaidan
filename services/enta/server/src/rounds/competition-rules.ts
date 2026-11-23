import { admissionHash } from '../admission/huroof-protocol.cjs';
import { EntaError, fail } from '../gameplay/types';
import { exact, HASH, id, integer, KEY, text } from './validation';
import { validateFormatCatalog } from './selection';
import { validateNew5Descriptor } from './competition-content';
import type { Aid, ColorKey, CompetitionCatalog, CompetitionCommand, CompetitionFormat, CompetitionRequest, CompetitionRound, CompetitionSetup, CompetitionTeam } from './competition-types';
export const RULES = 'enta-competitive-1' as const;
/** New5 only: server-issued canonical UUIDv4 IDs substantiate the wire bound. */
export const ATTEMPT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function attemptUuid(value: unknown): string { if (typeof value !== 'string' || !ATTEMPT_UUID.test(value)) return fail(400, 'INVALID_COMMAND'); return value; }
export const PALETTE_VERSION = 'enta-team-palette-1' as const;
// Proper NewGameWizard source palette; use as bounded accents, normal ink labels.
export const TEAM_PALETTE: Record<ColorKey, { label: string; color: string }> = { CORAL: { label: 'مرجاني', color: '#ff7a4d' }, SKY: { label: 'سماوي', color: '#3fc6ff' }, VIOLET: { label: 'بنفسجي', color: '#7c5cff' }, MINT: { label: 'نعناعي', color: '#34d399' }, GOLD: { label: 'ذهبي', color: '#ffc94d' }, ROSE: { label: 'وردي', color: '#ff5c72' } };
export const PALETTE_ROOT = admissionHash({ version: PALETTE_VERSION, entries: Object.entries(TEAM_PALETTE).map(([key, value]) => ({ key, color: value.color })) });
export const BOARD_AIDS: Aid[] = ['PHONE_A_FRIEND', 'DOUBLE_ANSWER', 'MORE_HINT', 'TRAP', 'PICK_ANSWERER', 'STEAL_POINTS', 'DOUBLE_POINTS'];
export const EMBEDDED_AIDS: Aid[] = ['PHONE_A_FRIEND', 'MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS'];
export const LIST_AIDS: Aid[] = ['HINT', 'PASS', 'FREEZE', 'DOUBLE', 'PHONE'];
export const standaloneCompetition = (format: CompetitionFormat): boolean => format === 'STANDALONE_LIST' || format === 'STANDALONE_ACTING';
export function allowedAids(format: CompetitionFormat, prompt: CompetitionRound['pin']['format']): Aid[] {
  if (standaloneCompetition(format)) return prompt === (format === 'STANDALONE_LIST' ? 'LIST_ITEMS' : 'ACTING_ITEMS') ? LIST_AIDS : [];
  if (format === 'TIER_BOARD') return prompt === 'ORDINARY_TIER' ? BOARD_AIDS : [];
  return ['ORDINARY_TIER', 'DRAWING_TARGET'].includes(prompt) ? BOARD_AIDS : ['LIST_ITEMS', 'ACTING_ITEMS'].includes(prompt) ? EMBEDDED_AIDS : [];
}
export function parseCompetitionStart(input: unknown, format: CompetitionFormat): CompetitionRequest {
  if (!['TIER_BOARD', 'MIXED_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING'].includes(format)) return fail(400, 'INVALID_SETUP');
  const row = exact(input, ['requestKey', 'logicalMatchId', 'setup']), setup = exact(row.setup, ['version', 'categories', 'teams', 'rules']), rules = exact(setup.rules, ['version', 'paletteVersion', 'questionSeconds', 'turnSeconds', 'overallSeconds', 'stealSeconds', 'phoneSeconds', 'embeddedStealCap']);
  const standalone = standaloneCompetition(format);
  if (setup.version !== 5 || rules.version !== RULES || rules.paletteVersion !== PALETTE_VERSION || rules.stealSeconds !== 10 || rules.phoneSeconds !== 60 || rules.embeddedStealCap !== 200 || ![15, 30, 45].includes(rules.turnSeconds as number) || ![null, 300, 600].includes(rules.overallSeconds as number | null) || !Array.isArray(setup.categories) || setup.categories.length !== (standalone ? 1 : 6) || !Array.isArray(setup.teams) || setup.teams.length < 2 || setup.teams.length > (standalone ? 2 : 4) || typeof row.requestKey !== 'string' || !KEY.test(row.requestKey)) return fail(400, 'INVALID_SETUP');
  const categories = setup.categories.map(value => { const c = exact(value, ['key', 'promptRefs']); if (!Array.isArray(c.promptRefs) || c.promptRefs.length > 6) return fail(400, 'INVALID_SETUP'); const refs = c.promptRefs.map(id); if (new Set(refs).size !== refs.length || (standalone || format === 'TIER_BOARD') && refs.length) return fail(400, 'INVALID_SETUP'); return { key: id(c.key), promptRefs: refs }; });
  if (new Set(categories.map(c => c.key)).size !== categories.length) return fail(400, 'INVALID_SETUP');
  const teams = setup.teams.map(value => { const t = exact(value, ['name', 'colorKey', 'players', 'aids']); if (typeof t.colorKey !== 'string' || !Object.hasOwn(TEAM_PALETTE, t.colorKey) || !Array.isArray(t.players) || t.players.length < 1 || t.players.length > 8 || !Array.isArray(t.aids) || t.aids.length !== 3 || t.aids.some(aid => !(standalone ? LIST_AIDS : BOARD_AIDS).includes(aid)) || new Set(t.aids).size !== 3) return fail(400, 'INVALID_SETUP'); const players = t.players.map(p => text(p, 1, 30)); if (new Set(players).size !== players.length) return fail(400, 'INVALID_SETUP'); return { name: text(t.name, 2, 22), colorKey: t.colorKey as ColorKey, players, aids: t.aids as Aid[] }; });
  if (new Set(teams.map(t => t.name.replace(/[A-Z]/g, letter => letter.toLowerCase()))).size !== teams.length) return fail(400, 'DUPLICATE_TEAM_NAME');
  const normalized: CompetitionSetup = { version: 5, categories, teams, rules: { version: RULES, paletteVersion: PALETTE_VERSION, questionSeconds: integer(rules.questionSeconds, 5, 120), turnSeconds: rules.turnSeconds as 15 | 30 | 45, overallSeconds: rules.overallSeconds as null | 300 | 600, stealSeconds: 10, phoneSeconds: 60, embeddedStealCap: 200 } };
  return { version: 5, requestKey: row.requestKey, logicalMatchId: id(row.logicalMatchId), operation: format === 'STANDALONE_LIST' ? 'PAID_ENTA_LIST' : format === 'STANDALONE_ACTING' ? 'PAID_ENTA_ACTING' : 'PAID_ENTA_CLASSIC', executionFormat: format, predecessor: null, setup: normalized };
}
export function parseCompetitionCommand(input: unknown): CompetitionCommand {
  const type = input && typeof input === 'object' ? (input as Record<string, unknown>).type : null;
  const fields: Record<string, string[]> = { OPEN_ROUND: ['roundId'], NEXT_ROUND: [], USE_AID: ['roundId', 'teamId', 'aid'], RECORD_ATTEMPT: ['roundId', 'teamId', 'playerId', 'itemId'], INTERIM_WRONG: ['roundId', 'attemptId'], PUBLIC_REVEAL: ['roundId', 'itemId'], FINAL_RULING: ['roundId', 'itemId', 'classifications'], REVEAL_HINT: ['roundId'], END_ASSISTANCE: ['roundId'], RESUME_ROUND: ['roundId'], CLOSE_ROUND: ['roundId'], PAUSE_ROUND: ['roundId', 'reason'], SELECT_SCORING_TEAM: ['roundId', 'teamId'], ASSIGN_ACTOR: ['roundId', 'teamId', 'playerId', 'itemId'], CREATE_GRANT: ['roundId', 'role', 'durationSeconds'], ROTATE_GRANT: ['roundId', 'scopeId', 'expectedGeneration', 'durationSeconds'], REVOKE_GRANT: ['roundId', 'scopeId'], UNDO_EFFECT: ['effectId', 'effectHash'], CORRECT_RULING: ['effectId', 'rulingVersion', 'correctAttemptIds', 'reason'], RESOLVE_ITEM_REVIEW: ['reviewId', 'reviewHash', 'rulingVersion', 'mode', 'correctAttemptIds', 'reason'], REPORT_VAR: ['roundId', 'effectId', 'blockingIds', 'reason'], FINISH: ['confirmEarly'], RESOLVE_TIE: ['resultHash'] };
  if (typeof type !== 'string' || !Object.hasOwn(fields, type)) return fail(400, 'INVALID_COMMAND'); const row = exact(input, ['commandId', 'expectedVersion', 'type', ...fields[type]]);
  if (typeof row.commandId !== 'string' || !KEY.test(row.commandId)) return fail(400, 'INVALID_COMMAND'); integer(row.expectedVersion);
  for (const key of ['roundId', 'teamId', 'playerId', 'attemptId', 'scopeId', 'reviewId']) if (Object.hasOwn(row, key)) id(row[key]);
  if (Object.hasOwn(row, 'effectId') && row.effectId !== null) id(row.effectId); if (Object.hasOwn(row, 'itemId') && row.itemId !== null) id(row.itemId);
  if (type === 'USE_AID' && ![...BOARD_AIDS, ...LIST_AIDS].includes(row.aid as Aid)) return fail(400, 'INVALID_COMMAND');
  if (type === 'CREATE_GRANT' && !['JUDGE', 'ACTOR'].includes(row.role as string)) return fail(400, 'INVALID_COMMAND');
  if (['CREATE_GRANT', 'ROTATE_GRANT'].includes(type)) integer(row.durationSeconds, 1, 600); if (type === 'ROTATE_GRANT') integer(row.expectedGeneration);
  if (type === 'FINISH' && typeof row.confirmEarly !== 'boolean') return fail(400, 'INVALID_COMMAND');
  if (Object.hasOwn(row, 'reason')) row.reason = text(row.reason, 3, 240);
  if (type === 'UNDO_EFFECT' && (row.effectId === null || typeof row.effectHash !== 'string' || !HASH.test(row.effectHash))) return fail(400, 'INVALID_COMMAND');
  if (type === 'RESOLVE_TIE' && (typeof row.resultHash !== 'string' || !HASH.test(row.resultHash))) return fail(400, 'INVALID_COMMAND');
  if (type === 'FINAL_RULING') { if (!Array.isArray(row.classifications) || row.classifications.length > 512) return fail(400, 'INVALID_COMMAND'); row.classifications.forEach(value => { if (!Array.isArray(value) || value.length !== 2 || typeof value[1] !== 'boolean') return fail(400, 'INVALID_COMMAND'); attemptUuid(value[0]); }); if (new Set(row.classifications.map(c => c[0])).size !== row.classifications.length) return fail(400, 'INVALID_COMMAND'); }
  for (const key of ['correctAttemptIds', 'blockingIds']) if (Object.hasOwn(row, key)) { const list = row[key]; if (!Array.isArray(list) || list.length > (key === 'blockingIds' ? 32 : 512)) return fail(400, 'INVALID_COMMAND'); list.forEach(key === 'blockingIds' ? id : attemptUuid); if (new Set(list).size !== list.length) return fail(400, 'INVALID_COMMAND'); }
  if (type === 'CORRECT_RULING') { if (row.effectId === null) return fail(400, 'INVALID_COMMAND'); integer(row.rulingVersion); }
  if (type === 'RESOLVE_ITEM_REVIEW') { integer(row.rulingVersion); if (typeof row.reviewHash !== 'string' || !HASH.test(row.reviewHash) || !['RESTORE_ORIGINAL', 'REPLACE'].includes(row.mode as string) || row.mode === 'RESTORE_ORIGINAL' && (row.correctAttemptIds as unknown[]).length) return fail(400, 'INVALID_COMMAND'); }
  return row as unknown as CompetitionCommand;
}
export const competitionProofRoot = (catalog: Pick<CompetitionCatalog, 'base' | 'competitiveReleaseId' | 'paletteRoot' | 'prompts'>): string => admissionHash({ domain: 'maydan.enta.competitive-release.v1', version: RULES, competitiveReleaseId: catalog.competitiveReleaseId, formatReleaseId: catalog.base.formatReleaseId, formatRoot: catalog.base.formatRoot, mediaRoot: catalog.base.mediaRoot, paletteRoot: catalog.paletteRoot, promptProofs: catalog.prompts.map(p => ({ formatId: p.formatId, proofHash: p.proofHash })).sort((a, b) => a.formatId < b.formatId ? -1 : a.formatId > b.formatId ? 1 : 0) });
function validateCompetitionCatalogFacts(catalog: CompetitionCatalog): void {
  validateFormatCatalog(catalog.base);
  const originals = catalog.base.categories.flatMap(c => c.prompts); if (originals.length > 6000) return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE'); const byId = new Map(originals.map(pin => [pin.formatId, pin]));
  if (catalog.policyVersion !== RULES || catalog.paletteRoot !== PALETTE_ROOT || !HASH.test(catalog.proofRoot) || !Array.isArray(catalog.prompts) || catalog.prompts.length > 6000 || new Set(catalog.prompts.map(pin => pin.formatId)).size !== catalog.prompts.length || catalog.proofRoot !== competitionProofRoot(catalog)) return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE'); id(catalog.competitiveReleaseId);
  for (const pin of catalog.prompts) {
    validateNew5Descriptor(pin);
    const { hints, graphemes, hintRoot, effectValue, effectValueSource, proofHash, ...base } = pin;
    const original = byId.get(pin.formatId);
    if (!original || admissionHash(base) !== admissionHash(original) || proofHash !== admissionHash({ version: RULES, baseHash: admissionHash(base), hints, graphemes, hintRoot, effectValue, effectValueSource }) || hintRoot !== admissionHash({ hints, graphemes }) || !Array.isArray(hints) || hints.length > 4 || !Array.isArray(graphemes) || graphemes.length > 128 || effectValue !== (['LIST_ITEMS', 'ACTING_ITEMS'].includes(pin.format) ? 200 : pin.points) || effectValueSource !== (['LIST_ITEMS', 'ACTING_ITEMS'].includes(pin.format) ? 'OWNER_EMBEDDED_200' : 'PINNED_TIER')) return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE');
    hints.forEach((hint, ordinal) => { if (hint.ordinal !== ordinal || hint.revisionId !== pin.revisionId || hint.revisionHash !== pin.hash || text(hint.text, 1, 512) !== hint.text || hint.contentHash !== admissionHash({ ordinal, text: hint.text }) || typeof hint.safeDrawing !== 'boolean') return fail(503, 'HINT_PROOF_UNAVAILABLE'); id(hint.id); });
    for (const proof of graphemes) { const item = pin.items.find(item => item.revisionId === proof.answerRevisionId); if (!item || item.trap || proof.answerHash !== item.hash || text(proof.grapheme, 1, 64) !== proof.grapheme || proof.segmentationVersion !== `unicode-${process.versions.unicode}-icu-${process.versions.icu}` || proof.grapheme !== [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(item.text)][0]?.segment || proof.proofHash !== admissionHash({ answerRevisionId: proof.answerRevisionId, answerHash: proof.answerHash, segmentationVersion: proof.segmentationVersion, grapheme: proof.grapheme })) return fail(503, 'GRAPHEME_PROOF_UNAVAILABLE'); id(proof.id); }
  }
}
export function validateCompetitionCatalog(catalog: CompetitionCatalog): void { try { validateCompetitionCatalogFacts(catalog); } catch (error) { if (error instanceof EntaError && error.status === 503) throw error; return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE'); } }
export const productionCompetitionPolicy = (catalog: CompetitionCatalog): void => { void catalog; return fail(503, 'COMPETITIVE_RECEIPT_POLICY_UNAVAILABLE'); };
export function teamPlayer(team: CompetitionTeam, playerId: string): CompetitionTeam['players'][number] { return team.players.find(p => p.id === playerId) ?? fail(404, 'MATCH_NOT_FOUND'); }
