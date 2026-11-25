import {isAlmaidanLocalDevelopment} from '../../lib/local-development';
import { ownerEpoch, assertOwnerEpoch } from './auth-epoch';
import type { User } from 'firebase/auth';
import type { CatalogProjection, ClassicSetup, MatchCommand, MatchProjection, StartCommand, EntaMode, SuccessorSetup, SuccessorStart, RematchStart } from '../../../services/enta/server/src/gameplay/types';
export type { CatalogProjection, ClassicSetup, MatchCommand, MatchProjection, StartCommand, EntaMode, SuccessorSetup, SuccessorStart, RematchStart };
export interface HistoryProjection { registryVersion: 1; queryVersion: 2; matches: Array<{id:string; admissionProtocol:2|3|4|5; mode:string; executionFormat:string; retainedRulesProfile:string; status:'ACTIVE'|'FINISHED'; createdAt:string; finishedAt:string|null; teams:Array<{name:string;score:number}>; summary:null|{reason:string;unplayedCount:number;isTie:boolean}; route:'LEGACY'|'ROUND'|'COMPETITIVE'}>; nextCursor:string|null }

export class EntaClientError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); }
}
const id = /^[A-Za-z0-9_-]{1,128}$/;
const invalid = (): never => { throw new EntaClientError('MALFORMED_RESPONSE'); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return invalid();
  return row;
}
function safeText(value: unknown, max = 4000): value is string { return typeof value === 'string' && !!value.trim() && value.length <= max; }
function safeId(value: unknown): value is string { return typeof value === 'string' && id.test(value); }
export function parseCatalog(value: unknown, expectedMode?: EntaMode): CatalogProjection {
  const row = object(value, ['mode', 'categoryCount', 'categories', 'availableCredit']);
  const count = row.mode === 'KIDS' ? 1 : 6;
  if (!['CLASSIC', 'KIDS'].includes(row.mode as string) || (expectedMode && row.mode !== expectedMode) || row.categoryCount !== count || !Array.isArray(row.categories) || (!isAlmaidanLocalDevelopment && row.categories.length < count) || row.categories.length > 1000 || typeof row.availableCredit !== 'string' || !/^\d{1,18}$/.test(row.availableCredit)) return invalid();
  const categories = row.categories.map(value => { const hasFavorite=!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'favoriteKey');const category = object(value, ['key', 'label',...(hasFavorite?['favoriteKey']:[])]); if (!safeId(category.key) || !safeText(category.label, 160) || (hasFavorite&&(typeof category.favoriteKey!=='string'||!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(category.favoriteKey)))) return invalid(); return { key: category.key, label: category.label,...(hasFavorite?{favoriteKey:category.favoriteKey as string}:{}) }; });
  if (new Set(categories.map(category => category.key)).size !== categories.length) return invalid();
  return { mode: row.mode as EntaMode, categoryCount: count, categories, availableCredit: row.availableCredit };
}
export function parseMatch(value: unknown): MatchProjection {
  const row = object(value, ['id', 'mode', 'version', 'phase', 'serverNow', 'rules', 'teams', 'categories', 'tiles', 'turnTeamId', 'currentQuestion', 'result']);
  const categoryCount = row.mode === 'KIDS' ? 1 : 6, tileCount = categoryCount * 6;
  if (!safeId(row.id) || !['CLASSIC', 'KIDS'].includes(row.mode as string) || !Number.isSafeInteger(row.version) || (row.version as number) < 1 || !['BOARD', 'QUESTION_OPEN', 'REVEALED', 'FINISHED'].includes(row.phase as string) || typeof row.serverNow !== 'number' || !Number.isFinite(row.serverNow) || !Array.isArray(row.teams) || row.teams.length < 2 || row.teams.length > 4 || !Array.isArray(row.categories) || row.categories.length !== categoryCount || !Array.isArray(row.tiles) || row.tiles.length !== tileCount) return invalid();
  const rules = object(row.rules, ['questionSeconds']); if (!Number.isInteger(rules.questionSeconds) || (rules.questionSeconds as number) < 5 || (rules.questionSeconds as number) > 120) return invalid();
  const teams = row.teams.map(value => {
    const team = object(value, ['id', 'name', 'players', 'score']);
    if (!safeId(team.id) || !safeText(team.name, 22) || !Array.isArray(team.players) || (!isAlmaidanLocalDevelopment && team.players.length < 1) || team.players.length > 8 || !team.players.every(player => safeText(player, 30)) || !Number.isSafeInteger(team.score) || (team.score as number) < 0 || (team.score as number) > 21600) return invalid();
    return team as unknown as MatchProjection['teams'][number];
  });
  const categories = row.categories.map(value => { const category = object(value, ['key', 'label']); if (!safeId(category.key) || !safeText(category.label, 160)) return invalid(); return category as unknown as MatchProjection['categories'][number]; });
  const tiles = row.tiles.map(value => {
    const tile = object(value, ['id', 'categoryKey', 'points', 'used', 'active', 'answeredByTeamId', 'isCorrect']);
    if (!safeId(tile.id) || !categories.some(category => category.key === tile.categoryKey) || ![200, 400, 600].includes(tile.points as number) || typeof tile.used !== 'boolean' || typeof tile.active !== 'boolean' || (tile.isCorrect !== null && typeof tile.isCorrect !== 'boolean') || tile.used !== (tile.isCorrect !== null) || (tile.answeredByTeamId !== null && !teams.some(team => team.id === tile.answeredByTeamId))) return invalid();
    return tile as unknown as MatchProjection['tiles'][number];
  });
  if (new Set(teams.map(team => team.id)).size !== teams.length || new Set(tiles.map(tile => tile.id)).size !== tileCount || new Set(categories.map(category => category.key)).size !== categoryCount || !teams.some(team => team.id === row.turnTeamId) || categories.some(category => [200, 400, 600].some(points => tiles.filter(tile => tile.categoryKey === category.key && tile.points === points).length !== 2))) return invalid();
  let currentQuestion: MatchProjection['currentQuestion'] = null;
  const active = row.phase === 'QUESTION_OPEN' || row.phase === 'REVEALED';
  if (active) {
    const question = object(row.currentQuestion, ['id', 'prompt', 'points', 'answeringTeamId', 'deadlineAt', ...(row.phase === 'REVEALED' ? ['answers'] : [])]);
    if (!tiles.some(tile => tile.id === question.id && tile.active && !tile.used && tile.points === question.points) || tiles.filter(tile => tile.active).length !== 1 || !safeText(question.prompt) || !teams.some(team => team.id === question.answeringTeamId) || typeof question.deadlineAt !== 'number' || !Number.isFinite(question.deadlineAt)) return invalid();
    if (row.phase === 'REVEALED' && (!Array.isArray(question.answers) || question.answers.length < 1 || question.answers.length > 12 || !question.answers.every(answer => safeText(answer, 2000)))) return invalid();
    currentQuestion = question as unknown as MatchProjection['currentQuestion'];
  } else if (row.currentQuestion !== null || tiles.some(tile => tile.active)) return invalid();
  let result: MatchProjection['result'] = null;
  if (row.phase === 'FINISHED') {
    const resultRow = object(row.result, ['reason', 'unplayedCount', 'winnerTeamIds', 'isTie']);
    if (!['ALL_QUESTIONS_PLAYED', 'HOST_ENDED'].includes(resultRow.reason as string) || !Number.isInteger(resultRow.unplayedCount) || resultRow.unplayedCount !== tiles.filter(tile => !tile.used).length || !Array.isArray(resultRow.winnerTeamIds) || !resultRow.winnerTeamIds.length || !resultRow.winnerTeamIds.every(winner => teams.some(team => team.id === winner)) || resultRow.isTie !== (resultRow.winnerTeamIds.length > 1)) return invalid();
    result = resultRow as unknown as MatchProjection['result'];
  } else if (row.result !== null) return invalid();
  return { id: row.id, mode: row.mode as EntaMode, version: row.version as number, phase: row.phase as MatchProjection['phase'], serverNow: row.serverNow, rules: rules as unknown as MatchProjection['rules'], teams, categories, tiles, turnTeamId: row.turnTeamId as string, currentQuestion, result };
}
export async function requestEnta(path: string, user: Pick<User, 'getIdToken' | 'uid'>, signal: AbortSignal, body?: unknown, assertDispatch?: () => undefined): Promise<unknown> {
  if (path === '/matches/history' || path.startsWith('/matches/history?')) {
    if (body !== undefined || path.length > 1400) return invalid();
    const query = path.includes('?') ? path.slice(path.indexOf('?') + 1) : '';
    if (query && (!/^[A-Za-z0-9_.=&-]+$/.test(query) || query.split('&').some(part => !/^[A-Za-z]+=[A-Za-z0-9_.-]+$/.test(part)))) return invalid();
    const params = new URLSearchParams(query), seen = new Set<string>();
    for (const [key, value] of params) {
      if (seen.has(key)) return invalid();
      seen.add(key);
      if (key === 'mode' && ['CLASSIC', 'KIDS', 'LIST', 'ACTING'].includes(value)) continue;
      if (key === 'format' && ['TIER_BOARD', 'MIXED_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING'].includes(value)) continue;
      if (key === 'rules' && ['enta-classic-2', 'enta-classic-3', 'enta-kids-3', 'enta-format-1', 'enta-competitive-1'].includes(value)) continue;
      if (key === 'status' && ['ACTIVE', 'FINISHED'].includes(value)) continue;
      if (key === 'limit' && /^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) continue;
      if (key === 'cursor' && value.length <= 1024 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) continue;
      return invalid();
    }
  } else if (/^\/local-rematches\/(round|competitive)\/[A-Za-z0-9_-]{1,128}(?:\/setup)?$/.test(path)) {
    if(!isAlmaidanLocalDevelopment||(path.endsWith('/setup')?(body!==undefined):(body===undefined)))return invalid();
  } else if (!/^\/(?:catalog(?:\/(?:kids|list|acting|mixed))?|(?:matches|round-matches)\/[A-Za-z0-9_/?=&-]+)$/.test(path)) return invalid();
  const owner = ownerEpoch(user.uid); assertOwnerEpoch(owner, signal);
  const token = await user.getIdToken();
  assertOwnerEpoch(owner, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  // Captured start context must be asserted in this continuation, after the
  // final token await and synchronously adjacent to the actual dispatch.
  assertDispatch?.();
  const response = await fetch(`/api/v1/enta${path}`, { signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) return invalid();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', count = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.byteLength; if (count > 256 * 1024) { await reader.cancel(); return invalid(); } text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
  finally { reader.releaseLock(); }
  let value: unknown; try { value = JSON.parse(text); } catch { return invalid(); }
  assertOwnerEpoch(owner, signal);
  if (!response.ok) { const code = value && typeof value === 'object' ? (value as { error?: unknown }).error : ''; throw new EntaClientError(typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'ENTA_UNAVAILABLE', response.status); }
  return value;
}
export function matchEnvelope(value: unknown, expectedId?: string): MatchProjection {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'match')) return invalid();
  const row = value as Record<string, unknown>, keys = Object.keys(row);
  if (keys.some(key => !['match', 'idempotent', 'receipt'].includes(key)) || (Object.hasOwn(row, 'idempotent') && typeof row.idempotent !== 'boolean')) return invalid();
  if (row.receipt !== undefined) { const receipt = object(row.receipt, ['commandId', 'type', 'sequence']); if (typeof receipt.commandId !== 'string' || !Number.isInteger(receipt.sequence) || typeof receipt.type !== 'string') return invalid(); }
  const match = parseMatch(row.match); if (expectedId && match.id !== expectedId) return invalid(); return match;
}
export function entaErrorText(error: unknown): string {
  const code = error instanceof EntaClientError ? error.code : 'NETWORK';
  const messages: Record<string, string> = {
    INSUFFICIENT_CREDIT: 'لا توجد ألعاب متبقية لبدء المباراة.', VERIFIED_ACCOUNT_REQUIRED: 'الاستضافة تحتاج حساباً موثّقاً.', MATCH_NOT_FOUND: 'المباراة غير موجودة أو ليست مرتبطة بحسابك.',
    STALE_VERSION: 'تغيّرت المباراة من جهاز آخر. حدّثنا حالتها؛ راجعها قبل المحاولة.', COMMAND_KEY_CONFLICT: 'تعارضت هذه المحاولة مع إجراء سابق. حدّث الصفحة.', IDEMPOTENCY_KEY_CONFLICT: 'إعداد هذه المحاولة تغيّر. يلزم تأكيد المحاولة الأصلية أولاً.',
    REMATCH_SOURCE_UNAVAILABLE: 'نسخة محتوى المباراة السابقة غير متاحة للإعادة. أنشئ مباراة جديدة لاستخدام النسخة الحالية؛ تبقى النتيجة السابقة محفوظة.',
    REMATCH_CONTENT_EXHAUSTED: 'استهلكتم أسئلة هذه النسخة للفئات المختارة. اختاروا فئات أخرى في مباراة جديدة؛ تبقى المباراة السابقة محفوظة.', PREDECESSOR_VERSION_CONFLICT: 'تغيّرت المباراة السابقة. أعد تحميل إعدادات الإعادة قبل البدء.', LOCAL_REMATCH_UNAVAILABLE: 'تعذرت إعادة المباراة محلياً. تحقق من تشغيل الخدمات ثم حاول مجدداً.',
    INVALID_SETUP: 'راجع الفئات وأسماء الفرق واللاعبين.', INVALID_REQUEST: 'راجع إعداد المباراة ثم أعد المحاولة.', PREDECESSOR_NOT_FINISHED: 'المباراة السابقة ما زالت جارية. أنهِها قبل اللعب من جديد.', EARLY_FINISH_CONFIRMATION_REQUIRED: 'أكد إنهاء المباراة مع وجود أسئلة لم تُلعب.', MALFORMED_RESPONSE: 'تعذر عرض بيانات المباراة. أعد المحاولة.',
    PENDING_INTENT_UNREADABLE_OCCUPIED: 'توجد محاولة محفوظة تعذّر قراءتها. احتفظنا بها؛ استعد الإصدار المتوافق أو اطلب المساعدة قبل بدء محاولة أخرى.', PENDING_INTENT_STORAGE_UNAVAILABLE: 'تعذّر الوصول إلى المحاولة المحفوظة. أعد المحاولة في الجلسة نفسها.',
    ACCOUNT_NOT_READY: 'حساب اللعب غير جاهز بعد. أعد المحاولة لاحقاً.',
    INVALID_ID_TOKEN: 'جدّد تسجيل الدخول ثم أكّد المحاولة نفسها.', UNAUTHORIZED: 'جدّد تسجيل الدخول ثم أكّد المحاولة نفسها.',
    ROUND_TIME_EXPIRED: 'انتهى وقت الدور أو الجولة. راجع حالتها قبل الإجراء التالي.', ROUND_PAUSED: 'الجولة متوقفة مؤقتاً. استأنفها قبل اللعب.', GRANT_DENIED: 'انتهى رمز الجهاز أو أُلغي. اطلب رمزاً جديداً من المضيف.',
    PAGE_SNAPSHOT_RESTART: 'تغيّرت تفاصيل الجولة أثناء التحميل. أعد تحميل الحالة ثم راجع الإجابات والمحاولات قبل المتابعة.',
    GRANT_ALREADY_ACTIVE: 'يوجد رمز لهذا الجهاز. استخدم تجديد الرمز لعرض رمز جديد.', STALE_GRANT_GENERATION: 'تغيّر رمز الجهاز. راجع الأجهزة المرتبطة.', CANVAS_BUDGET_EXCEEDED: 'وصل الرسم إلى سعته المحددة. لا يعيد المسح أو التراجع سعة الرسم.', STALE_CANVAS_REVISION: 'تغيّر الرسم من جهاز آخر. أعد تحميله.', ITEM_RESOLVED: 'احتُسبت هذه الإجابة بالفعل.', MEDIA_DENIED: 'هذه الوسائط غير متاحة في حالة الجولة الحالية.',
    INVALID_PHASE: 'هذا الإجراء غير متاح في مرحلة الجولة الحالية. حدّثنا الحالة؛ راجعوها ثم اختاروا الإجراء المناسب.', ROUND_UNAVAILABLE: 'هذه الجولة غير متاحة الآن. أكملوا الجولة الجارية أولاً.', UNRESOLVED_ROUND: 'أكملوا الجولة الجارية قبل إنهاء المباراة.', UNRESOLVED_QUESTION: 'أكملوا السؤال المفتوح قبل إنهاء المباراة.', NO_MORE_ROUNDS: 'لا توجد جولات أخرى. أنهوا المباراة لعرض النتيجة.', MATCH_FINISHED: 'انتهت المباراة بالفعل.', ASSIGNMENT_UNAVAILABLE: 'تعذر تعيين هذا اللاعب أو الإجابة في الجولة الحالية.',
    ROOM_REQUIRES_NEW_MATCH: 'بدأ اللعب في هذه المباراة قبل ربطها بغرفة، فلا يمكن فتح غرفة لها الآن. تابعوها من «مبارياتي»، أو ابدأوا مباراة جديدة لاستخدام غرفة الانتظار.',
    ROOM_REMATCH_ALREADY_STARTED: 'بدأ المضيف مباراة جديدة من هذه الغرفة.',
    ROOM_REMATCH_IN_PROGRESS: 'طلب الإعادة قيد التأكيد. ارجعوا للتبويب اللي بدأتم منه الإعادة.',
  };
  if (messages[code]) return messages[code];
  // A definite server rejection is never a connection problem; say so plainly.
  if (error instanceof EntaClientError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) return 'تعذّر تنفيذ هذا الإجراء في حالة المباراة الحالية. حدّثنا الحالة؛ راجعوها ثم أعيدوا المحاولة.';
  return 'خدمة إنت صح غير متاحة الآن. تحقق من الاتصال وأعد المحاولة.';
}

/** Pending intent only; never a game, answer, score or permission cache. */
export function pendingStartStorageKey(uid: string): string { return `maydan:enta:pending-start:${import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'unconfigured'}:${uid}`; }
export const normalizeEntaName = (value: string) => value.replace(/^ +| +$/g, '').normalize('NFC');
export const foldEntaName = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
export function pendingName(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max || normalizeEntaName(value) !== value || /[<>\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u.test(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 32 || (unit >= 127 && unit <= 159) || (unit >= 0xdc00 && unit <= 0xdfff)) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) { const low = value.charCodeAt(++index); if (!(low >= 0xdc00 && low <= 0xdfff)) return false; }
  }
  return true;
}
export function parsePendingStart(input: unknown): StartCommand | null {
  try {
    const command = object(input, ['requestKey', 'logicalMatchId', 'setup']) as unknown as StartCommand;
    object(command.setup, ['version', 'categoryKeys', 'teams', 'rules']);
    object(command.setup.rules, ['questionSeconds']);
    if (!command || typeof command.requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(command.requestKey) || typeof command.logicalMatchId !== 'string' || !id.test(command.logicalMatchId) || command.setup?.version !== 2 || !Array.isArray(command.setup.categoryKeys) || command.setup.categoryKeys.length !== 6 || !command.setup.categoryKeys.every(safeId) || new Set(command.setup.categoryKeys).size !== 6 || !Array.isArray(command.setup.teams) || command.setup.teams.length < 2 || command.setup.teams.length > 4 || !command.setup.teams.every(team => team && safeText(team.name, 22) && Array.isArray(team.players) && (isAlmaidanLocalDevelopment || team.players.length >= 1) && team.players.length <= 8 && team.players.every(player => safeText(player, 30)) && Array.isArray(team.lifelines) && team.lifelines.length === 0) || !command.setup.rules || !Number.isInteger(command.setup.rules.questionSeconds) || command.setup.rules.questionSeconds < 5 || command.setup.rules.questionSeconds > 120) return null;
    for (const team of command.setup.teams) { object(team, ['name', 'players', 'lifelines']); if (!pendingName(team.name, 2, 22) || !team.players.every(player => pendingName(player, 1, 30))) return null; }
    const names = command.setup.teams.map(team => foldEntaName(normalizeEntaName(team.name)));
    if (new Set(names).size !== names.length) return null;
    return command;
  } catch { return null; }
}

export function readPendingStart(uid: string): StartCommand | null {
  try { const raw = sessionStorage.getItem(pendingStartStorageKey(uid)); if (raw === null || raw.length > 16000) return null; return parsePendingStart(JSON.parse(raw)); } catch { return null; }
}
