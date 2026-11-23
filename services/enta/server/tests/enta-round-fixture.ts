// Explicit synthetic content/credit/identity/byte reader. Never ordinary app import.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { fail } from '../src/gameplay/types';
import { settleClock } from '../src/rounds/engine';
import { authorizeGrant } from '../src/rounds/grants';
import type { ExecutionFormat, FormatCatalog, MediaPin, PromptFormat, RoundGame, RoundRepository, RoundStart, RoundTransaction } from '../src/rounds/types';
import type { PinnedByteReader } from '../src/rounds/media';
import { fixturePrincipal, fixtureProject } from './enta-gameplay-fixture';
export { fixturePrincipal, fixtureProject };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const fixtureBytes = new Map<string, Uint8Array>([
  ['mask', readFileSync(resolve('public/assets/maydan/maydan-e-hex-320.webp'))],
  ['clear', readFileSync(resolve('public/assets/maydan/maydan-e-cloud-320.webp'))],
  ['video', readFileSync(resolve('output/int061e1-list-acting-drawing-20261007/fixtures/stimulus-01.mp4'))],
]);
export function fixtureMedia(id: string, role: MediaPin['role'], bytesKey = 'mask', itemId: string | null = null): MediaPin {
  const bytes = fixtureBytes.get(bytesKey)!;
  const chunks = Array.from({ length: Math.ceil(bytes.length / 262144) }, (_, ordinal) => { const part = bytes.subarray(ordinal * 262144, Math.min(bytes.length, (ordinal + 1) * 262144)); return { ordinal, byteLength: part.length, sha256: hash(part) }; });
  // Actual browser loadedmetadata:1280x720,1.201034s. Millisecond upper bound.
  fixtureBytes.set(id, bytes); return { id, objectKey: `enta-private/${id}`, objectVersion: '17600000000000001', sha256: hash(bytes), mime: bytesKey === 'video' ? 'video/mp4' : 'image/webp', bytes: bytes.length, width: bytesKey === 'video' ? 1280 : 320, height: bytesKey === 'video' ? 720 : 320, durationMs: bytesKey === 'video' ? 1202 : null, codec: bytesKey === 'video' ? 'h264' : null, chunks, role, itemId };
}
export function fixtureFormatCatalog(): FormatCatalog {
  const formats: PromptFormat[] = ['LIST_ITEMS', 'ACTING_ITEMS', 'DRAWING_TARGET', 'ORDINARY_TIER', 'ORDINARY_TIER', 'ORDINARY_TIER'];
  return { baseReleaseId: 'format-test-base', baseRoot: 'a'.repeat(64), receiptId: 'format-test-receipt', formatReleaseId: 'format-test-release', formatRoot: 'b'.repeat(64), mediaRoot: 'c'.repeat(64), policyVersion: 'enta-format-1', categories: formats.map((format, category) => {
    const key = `format_category_${category}`, list = ['LIST_ITEMS', 'ACTING_ITEMS'].includes(format);
    return { key, label: ['قوائم المعرفة', 'تمثيل ومواقف', 'ارسمها', 'صور وأسئلة', 'رياضة وفيديو', 'معرفة ومغامرة'][category], format, cover: fixtureMedia(`cover_${category}`, 'COVER'), prompts: Array.from({ length: list ? 5 : 6 }, (_, index) => {
      const itemId = (item: number) => `item_${category}_${index}_${item}`, items = list ? ['تفاحة — اختبار', 'موزة — اختبار', 'كرسي — فخ اختبار'].map((text, ordinal) => ({ id: itemId(ordinal), revisionId: `answer_${category}_${index}_${ordinal}`, hash: 'd'.repeat(64), ordinal, text, value: ordinal === 2 ? 150 : 100, trap: ordinal === 2, mediaIds: ordinal === 0 ? [`item_media_${category}_${index}`] : [] })) : [];
      const media: MediaPin[] = [fixtureMedia(`mask_${category}_${index}`, 'MASKED'), fixtureMedia(`clear_${category}_${index}`, format === 'DRAWING_TARGET' ? 'ACTOR' : 'CLEAR', 'clear')];
      if (list) media.push(fixtureMedia(`item_media_${category}_${index}`, 'ITEM', 'clear', itemId(0)));
      if (category === 4) media.push(fixtureMedia(`video_${category}_${index}`, 'PROMPT', 'video'));
      const pin = { ref: `prompt_${category}_${index}`, sourceNamespace: 'enta.test.question', sourceId: `source_${category}_${index}`, revisionId: `question_${category}_${index}`, hash: 'e'.repeat(64), formatId: `format_${category}_${index}`, formatHash: 'f'.repeat(64), categoryKey: key, format, prompt: list ? `اذكر من القائمة ${index + 1} — محتوى اختبار` : format === 'DRAWING_TARGET' ? 'ارسم الكلمة لفريقك — اختبار' : category === 4 ? 'شاهد المقطع ثم أجب — اختبار' : 'سؤال مصوّر — اختبار', target: list ? null : format === 'DRAWING_TARGET' ? 'قارب — هدف اختبار خاص' : 'إجابة سؤال مصوّر — اختبار', points: list ? null : [200, 400, 600][Math.floor(index / 2)] as 200 | 400 | 600, items, media, rules: { version: 1 as const, kind: format, target: list ? null : format === 'DRAWING_TARGET' ? 'قارب — هدف اختبار خاص' : 'إجابة سؤال مصوّر — اختبار' } };
      const { formatHash: previousHash, ...payload } = pin; void previousHash; pin.formatHash = admissionHash({ version: 1, pin: payload }); return pin;
    }) };
  }) };
}
export function fixtureRoundStart(format: ExecutionFormat = 'STANDALONE_LIST', suffix = '0001'): RoundStart {
  return { requestKey: `round-request-${suffix}`, logicalMatchId: `round-logical-${suffix}`, setup: { version: 4, categories: (format === 'MIXED_BOARD' ? [0, 1, 2, 3, 4, 5] : [format === 'STANDALONE_LIST' ? 0 : 1]).map(index => ({ key: `format_category_${index}`, promptRefs: format === 'MIXED_BOARD' && index < 2 ? [`prompt_${index}_0`, `prompt_${index}_1`] : [] })), teams: [{ name: 'الفريق الأول', players: ['سارة', 'نور'] }, { name: 'الفريق الثاني', players: ['علي'] }], rules: { turnSeconds: 30, overallSeconds: null, questionSeconds: 30 } } };
}
export class RoundFixtureRepository implements RoundRepository {
  readonly source = 'test-only' as const; readonly projectId = fixtureProject; available = 100n; debt = 0n; games = new Map<string, RoundGame>(); debitCount = 0; nowValue = Date.parse('2026-10-07T16:00:00.000Z'); catalogValue = fixtureFormatCatalog(); failAfterReserve = false; waitAdvance = 0; saveClockAdvance = 0; saves = 0; private tail: Promise<void> = Promise.resolve();
  async transaction<T>(work: (tx: RoundTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail; let release!: () => void; this.tail = new Promise<void>(done => { release = done; }); await previous;
    const snapshot = { games: structuredClone(this.games), available: this.available, debitCount: this.debitCount, saves: this.saves };
    try { return await work({
      lockWallet: async () => ({ identityId: 'fixture-host-identity', available: this.available, debt: this.debt }),
      findStart: async (principal, requestKey, logicalId) => structuredClone([...this.games.values()].find(game => game.hostUid === principal.uid && (game.request.requestKey === requestKey || game.id === logicalId)) ?? null),
      catalog: async (_principal, format) => { const catalog = structuredClone(this.catalogValue); if (format !== 'MIXED_BOARD') catalog.categories = catalog.categories.filter(category => category.format === (format === 'STANDALONE_LIST' ? 'LIST_ITEMS' : 'ACTING_ITEMS')); return catalog; },
      exposures: async (principal, format, categoryKey) => [...this.games.values()].filter(game => game.hostUid === principal.uid && game.request.executionFormat === format).flatMap(game => game.intent.selection.map(selection => ({ categoryKey: game.request.setup.categories[0].key, sourceNamespace: selection.sourceNamespace, sourceId: selection.sourceId, cycle: selection.cycle }))).filter(row => row.categoryKey === categoryKey),
      create: async (principal, request, intent, pins, catalog) => { this.available--; this.debitCount++; if (this.failAfterReserve) throw Error('fixture transaction failure'); const game: RoundGame = { id: request.logicalMatchId, identityId: 'fixture-host-identity', projectId: principal.projectId, hostUid: principal.uid, admissionId: randomUUID(), request, clientHash: admissionHash(request), intent, intentHash: admissionHash(intent), version: 1, finished: false, activeRoundId: null, turnIndex: 0, resultReason: null, teams: request.setup.teams.map(team => ({ ...team, id: randomUUID(), score: 0 })), categories: request.setup.categories.map(row => { const category = catalog.categories.find(category => category.key === row.key)!; return { key: category.key, label: category.label, format: category.format, cover: category.cover }; }), rounds: pins.map((pin, ordinal) => ({ id: randomUUID(), questionId: randomUUID(), ordinal, pin, state: 'READY', version: 0, scoringTeamId: null, turnDeadline: null, overallDeadline: null, remainingTurn: null, remainingOverall: null, revealed: false, assignment: null, consumed: [], reason: null })), events: [], postings: [], grants: [], grantScopes: [], canvases: [] }; this.games.set(game.id, structuredClone(game)); return game; },
      loadOwner: async (_principal, id) => { this.nowValue += this.waitAdvance; this.waitAdvance = 0; return structuredClone(this.games.get(id) ?? null); },
      locateGrant: async hash => { const game = [...this.games.values()].find(game => game.grants.some(grant => grant.tokenHash === hash)); return game ? { gameId: game.id } : null; },
      loadGrant: async id => { this.nowValue += this.waitAdvance; this.waitAdvance = 0; return structuredClone(this.games.get(id) ?? null); },
      save: async (before, next, command) => {
        const current = this.games.get(before.id) ?? fail(404, 'MATCH_NOT_FOUND'); if (current.version !== before.version) return fail(409, 'STALE_VERSION');
        // Synthetic later persistence clock, explicitly NOT a PostgreSQL race.
        const advance = this.saveClockAdvance; this.saveClockAdvance = 0; this.nowValue += advance;
        const acting = next.events.at(-1)?.authority;
        if (acting?.kind === 'GRANT') { const grant = current.grants.find(grant => grant.id === acting.grantId)!; authorizeGrant(current, grant.tokenHash, this.nowValue); }
        const settled = structuredClone(current);
        if (advance > 0 && settleClock(settled, this.nowValue)) { this.games.set(current.id, settled); this.saves++; return { game: settled, rejection: 'ROUND_TIME_EXPIRED' }; }
        if (advance > 0 && command) {
          const round = next.rounds.find(round => round.id === next.activeRoundId);
          if (round && ['OPEN_ROUND', 'NEXT_ROUND', 'RESUME_ROUND'].includes(command.type)) { if (round.turnDeadline !== null) round.turnDeadline += advance; if (round.overallDeadline !== null) round.overallDeadline += advance; }
          if (next.events.length) next.events.at(-1)!.at = this.nowValue;
        }
        this.games.set(next.id, structuredClone(next)); this.saves++; return { game: next, rejection: null };
      },
      now: async () => this.nowValue,
    }); } catch (error) { this.games = snapshot.games; this.available = snapshot.available; this.debitCount = snapshot.debitCount; this.saves = snapshot.saves; throw error; } finally { release(); }
  }
}
export function fixtureByteReader(): PinnedByteReader & { reads: number; corrupt: boolean; wrongVersion: boolean; beforeRead: (() => void) | null } {
  return { source: 'test-only', reads: 0, corrupt: false, wrongVersion: false, beforeRead: null, async read(pin, start, length) { this.reads++; this.beforeRead?.(); const bytes = fixtureBytes.get(pin.id) ?? fail(503, 'MEDIA_UNAVAILABLE'); const part = Uint8Array.from(bytes.subarray(start, start + length)); if (this.corrupt) part[0] ^= 255; return { objectVersion: this.wrongVersion ? '1' : pin.objectVersion, bytes: part }; } };
}
