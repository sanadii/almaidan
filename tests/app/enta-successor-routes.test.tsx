import { ObservedFirebaseAuthProvider } from './fixtures/observed-firebase-auth';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { loadingAuthContext, type FirebaseAuthContextValue } from '../../src/features/auth/auth-context';
import { EntaKidsRoute } from '../../src/routes/EntaRoutes';
import { EntaHistoryRoute, EntaRematchRoute } from '../../src/features/enta/HistoryRoutes';
import { pendingStartStorageKey, type MatchProjection } from '../../src/features/enta/client';
import { parsePendingIntent, persistPendingIntent, readPendingIntent, type PendingIntent } from '../../src/features/enta/pending-intent';
import { parseHistory } from '../../src/features/enta/history';
// These tests exercise Enta history in isolation; Huroof history has its own route tests.
const huroofFixture = vi.hoisted(()=>({entries:[] as import('../../src/features/game/MatchHistoryList').MatchHistoryEntry[],feedback:null,paging:null,ready:true}));
vi.mock('../../src/features/game/HuroofHistory', () => ({ HuroofHistory: ({children}: Required<import('../../src/features/game/MatchHistoryList').HistoryChildren>) => children(huroofFixture) }));
vi.mock('../../src/features/game/PublicHuroofHistory', () => ({ PublicHuroofHistory: ({children}: Required<import('../../src/features/game/MatchHistoryList').HistoryChildren>) => children(huroofFixture) }));
const user = { uid: 'e2-ui-host', isAnonymous: false, emailVerified: true, getIdToken: async () => 'host' } as User;
const auth: FirebaseAuthContextValue = { ...loadingAuthContext, status: 'password', isAvailable: true, user };
const categories = [{ key: 'kids_one', label: 'ألوان وأشكال' }, { key: 'kids_two', label: 'حيوانات وطبيعة' }];
const setup = { version: 3 as const, categoryKeys: ['kids_one'], teams: [{ name: 'الفريق الأول', players: ['سارة'], lifelines: [] as [] }, { name: 'الفريق الثاني', players: ['علي'], lifelines: [] as [] }], rules: { questionSeconds: 30 } };
const catalog = { mode: 'KIDS', categoryCount: 1, categories, availableCredit: '1' };
const pending: PendingIntent = { version: 3, mode: 'KIDS', operation: 'PAID_ENTA_KIDS', startKind: 'REMATCH', predecessor: { gameId: 'parent-game', version: 5 }, endpoint: '/matches/parent-game/rematch', command: { requestKey: 'rematch-original-key', logicalMatchId: 'rematch-logical-key', predecessorVersion: 5, setup } };
function board(): MatchProjection { return { id: 'kids-game', mode: 'KIDS', phase: 'BOARD', version: 1, serverNow: 1800000000000, rules: { questionSeconds: 30 }, teams: setup.teams.map((team, i) => ({ id: `team_${i}`, name: team.name, players: team.players, score: 0 })), categories: [categories[0]], tiles: [200, 200, 400, 400, 600, 600].map((points, i) => ({ id: `tile_${i}`, categoryKey: 'kids_one', points, active: false, used: false, answeredByTeamId: null, isCorrect: null })), turnTeamId: 'team_0', currentQuestion: null, result: null }; }
const row = { id: 'parent-game', admissionProtocol: 3 as const, mode: 'KIDS', executionFormat: 'TIER_BOARD', retainedRulesProfile: 'enta-kids-3', status: 'FINISHED' as const, createdAt: '2026-10-07T15:00:00.123Z', finishedAt: '2026-10-07T15:15:00.456Z', teams: [{ name: 'الفريق الأول', score: 200 }, { name: 'الفريق الثاني', score: 0 }], summary: { reason: 'HOST_ENDED', unplayedCount: 5, isTie: false }, route: 'LEGACY' as const };
const historyPage = (matches: typeof row[] = [], nextCursor: string | null = null) => ({ registryVersion: 1, queryVersion: 2, matches, nextCursor });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); const fetchMock = vi.fn();
function LocationProbe(){return <output data-testid="actual-path">{useLocation().pathname}</output>;}
function surface(path: string, value = auth) { return <ThemeProvider><ObservedFirebaseAuthProvider value={value}><MemoryRouter initialEntries={[path]}><LocationProbe/><Routes><Route path="/enta/new/kids" element={<EntaKidsRoute />} /><Route path="/enta/history" element={<EntaHistoryRoute />} /><Route path="/enta/matches/:id/rematch" element={<EntaRematchRoute />} /><Route path="/enta/matches/:id" element={<h1>مباراة الاختبار المستعادة</h1>} /></Routes></MemoryRouter></ObservedFirebaseAuthProvider></ThemeProvider>; }
beforeEach(() => { huroofFixture.entries=[]; fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); localStorage.clear(); });

it('KIDS chooses exactly one category and dispatches strict v3 fixed endpoint without browser billing fields', async () => {
  fetchMock.mockImplementation((url: string) => Promise.resolve(json(url.endsWith('/catalog/kids') ? catalog : { match: board(), idempotent: false }))); render(surface('/enta/new/kids')); await screen.findByRole('heading', { name: 'اختاروا فئة واحدة' });
  await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[0], 'سارة'); await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[1], 'علي'); await userEvent.click(screen.getByRole('button', { name: categories[0].label })); expect(screen.getByRole('button', { name: categories[1].label })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' })); await screen.findByRole('heading', { name: 'مباراة الاختبار المستعادة' }); expect(screen.getByTestId('actual-path')).toHaveTextContent('/enta/matches/'+board().id); const post = fetchMock.mock.calls.find(call => call[1].method === 'POST'); expect(post[0]).toBe('/api/v1/enta/matches/kids'); expect(JSON.parse(post[1].body)).toEqual({ requestKey: expect.any(String), logicalMatchId: expect.any(String), setup }); expect(readPendingIntent(user.uid)).toBeNull();
});

it('one valid v2 unresolved occupancy cannot be replaced by KIDS or rematch intent', async () => {
  const legacy = { requestKey: 'classic-original-key', logicalMatchId: 'classic-logical-key', setup: { ...setup, version: 2, categoryKeys: Array.from({ length: 6 }, (_, i) => `classic_${i}`) } }; sessionStorage.setItem(pendingStartStorageKey(user.uid), JSON.stringify(legacy));
  expect(() => persistPendingIntent(user.uid, pending)).toThrow('PENDING_START_OCCUPIED'); expect(readPendingIntent(user.uid)?.command).toEqual(legacy);
  fetchMock.mockImplementation((url: string) => url.endsWith('/catalog/kids') ? Promise.resolve(json(catalog)) : Promise.reject(new TypeError('controlled unknown response'))); render(surface('/enta/new/kids')); await screen.findByText('الألعاب المتبقية في الحساب:'); expect(screen.getByLabelText('اسم الفريق 1')).toBeDisabled(); await userEvent.click(screen.getByRole('button', { name: 'تأكيد بدء المباراة' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(call => call[0] === '/api/v1/enta/matches/classic')).toBe(true)); const post = fetchMock.mock.calls.find(call => call[1].method === 'POST'); expect(JSON.parse(post[1].body)).toEqual(legacy); expect(readPendingIntent(user.uid)?.command).toEqual(legacy);
});

it('unknown rematch keeps original endpoint/IDs after401 and reload; matching response clears occupancy', async () => {
  sessionStorage.setItem(pendingStartStorageKey(user.uid), JSON.stringify(pending)); let posts = 0; const bodies: unknown[] = [];
  fetchMock.mockImplementation((url: string, init: RequestInit) => { if (url.endsWith('/rematch-setup')) return Promise.resolve(json({ mode: 'KIDS', predecessorVersion: 5, setup })); if (url.endsWith('/catalog/kids')) return Promise.resolve(json(catalog)); bodies.push(JSON.parse(init.body as string)); return Promise.resolve(++posts === 1 ? json({ error: 'INVALID_ID_TOKEN' }, 401) : json({ match: board(), idempotent: true })); });
  const view = render(surface('/enta/matches/parent-game/rematch')); await screen.findByRole('button', { name: 'تأكيد بدء المباراة' }); await userEvent.click(screen.getByRole('button', { name: 'تأكيد بدء المباراة' })); await waitFor(() => expect(screen.getByRole('button', { name: 'تأكيد بدء المباراة' })).toBeEnabled()); expect(readPendingIntent(user.uid)).toEqual(pending);
  view.unmount(); render(surface('/enta/matches/parent-game/rematch')); await screen.findByRole('button', { name: 'تأكيد بدء المباراة' }); await userEvent.click(screen.getByRole('button', { name: 'تأكيد بدء المباراة' })); await screen.findByRole('heading', { name: 'مباراة الاختبار المستعادة' }); expect(screen.getByTestId('actual-path')).toHaveTextContent('/enta/matches/'+board().id); expect(bodies).toEqual([pending.command, pending.command]); expect(readPendingIntent(user.uid)).toBeNull();
});

it('storage failure prevents any POST and malformed endpoints/cohort authority cannot dispatch', async () => {
  for (const changed of [{ ...pending, endpoint: 'https://evil.invalid' }, { ...pending, mode: 'CLASSIC' }, { ...pending, command: { ...pending.command, unlimited: true } }]) expect(() => parsePendingIntent(changed)).toThrow();
  fetchMock.mockResolvedValue(json(catalog)); render(surface('/enta/new/kids')); await screen.findByText('الألعاب المتبقية في الحساب:'); await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[0], 'سارة'); await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[1], 'علي'); await userEvent.click(screen.getByRole('button', { name: categories[0].label })); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('controlled storage denial'); }); await userEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' })); expect(fetchMock.mock.calls.filter(call => call[1].method === 'POST')).toHaveLength(0);
});

it('history private allowlist, empty/error/retry and owner switch ignore late obsolete pages', async () => {
  let oldReply!: (value: Response) => void; fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { oldReply = resolve; })).mockResolvedValueOnce(json(historyPage()));
  const view = render(surface('/enta/history')); expect(screen.getByText('جارٍ تحميل المباريات…')).toBeVisible(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  view.rerender(surface('/enta/history', { ...auth, user: { ...user, uid: 'second-host' } as User })); await screen.findByText('لا توجد مباريات هنا بعد'); expect(signal.aborted).toBe(true); await act(async () => oldReply(json(historyPage([row])))); expect(screen.queryByRole('link', { name: 'عرض النتيجة' })).not.toBeInTheDocument();
  expect(() => parseHistory(historyPage([{ ...row, route: 'INVALID' as unknown as 'LEGACY' }]))).toThrow('MALFORMED_RESPONSE'); expect(() => parseHistory(historyPage([{ ...row, createdAt: '2026-02-30T00:00:00.000Z' }]))).toThrow('MALFORMED_RESPONSE');
});

it('history filters/pagination use fixed scoped GET and malformed data is retryable', async () => {
  const cursorToken = 'anchor_token.' + 'a'.repeat(43);
  const rows25 = Array.from({ length: 25 }, (_, i) => ({ ...row, id: 'parent-game-' + String(25 - i).padStart(2, '0'), createdAt: new Date(Date.parse(row.createdAt) - i * 1000).toISOString(), finishedAt: new Date(Date.parse(row.finishedAt) - i * 1000).toISOString() }));
  fetchMock.mockResolvedValueOnce(json({ ...historyPage(rows25), badField: 'bad' })).mockResolvedValueOnce(json(historyPage(rows25, cursorToken))).mockResolvedValue(json(historyPage())); render(surface('/enta/history'));
  await screen.findByRole('button', { name: 'إعادة المحاولة' }); await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' })); await screen.findAllByRole('link', { name: 'عرض النتيجة' }); expect(document.querySelector('time')).toHaveAttribute('datetime', rows25[0].createdAt); await userEvent.click(screen.getByRole('button', { name: 'عرض المزيد' })); await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('cursor=' + cursorToken));
  await userEvent.selectOptions(screen.getByLabelText('نوع المباراة'), 'KIDS'); await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/enta/matches/history?mode=KIDS')); expect(fetchMock.mock.calls.every(call => call[1].method === 'GET')).toBe(true);
});

it('KIDS/history/rematch static preview and unverified auth never request or fake states', () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true'); const view = render(surface('/enta/history')); expect(screen.getByText('إنت صح غير متاحة في المعاينة')).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled(); view.unmount(); vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); render(surface('/enta/matches/parent-game/rematch', { ...auth, user: { ...user, emailVerified: false } as User })); expect(screen.getByText('أكّد بريدك للاستضافة')).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled();
});
it('merges games by date, filters by game and folds only old unfinished rooms',async()=>{
 const newer=new Date(Date.parse(row.createdAt)+86_400_000).toISOString();
 const older=new Date(Date.parse(row.createdAt)-86_400_000).toISOString();
 huroofFixture.entries=[
  {key:'room-1',game:'huroof',date:older,complete:true,title:'غرفة قديمة',details:null},
  {key:'room-2',game:'huroof',date:newer,complete:true,title:'غرفة أحدث',details:null},
  {key:'room-3',game:'huroof',date:'2020-01-01T00:00:00.000Z',complete:false,title:'غرفة متوقفة',details:null},
 ];
 fetchMock.mockResolvedValue(json(historyPage([row])));render(surface('/enta/history'));
 await screen.findByRole('link',{name:'عرض النتيجة'});
 expect([...document.querySelectorAll('ol.enta-history-list:first-of-type time')].slice(0,3).map(el=>el.getAttribute('datetime'))).toEqual([newer,row.createdAt,older]);
 const details=screen.getByText('غرف لم تكتمل').closest('details')!;
 expect(details.open).toBe(false);expect(details).toHaveTextContent('غرفة متوقفة');
 await userEvent.selectOptions(screen.getByLabelText('اللعبة'),'enta');
 expect(screen.queryByText('غرفة أحدث')).toBeNull();expect(screen.getByRole('link',{name:'عرض النتيجة'})).toBeVisible();
 await userEvent.selectOptions(screen.getByLabelText('اللعبة'),'huroof');
 expect(screen.getByText('غرفة أحدث')).toBeVisible();expect(screen.queryByRole('link',{name:'عرض النتيجة'})).toBeNull();
});
it('prompts a signed-out history visitor without requesting private records',()=>{
 render(surface('/enta/history',{...auth,user:null,status:'signedOut'}));
 expect(screen.getByRole('heading',{name:'سجّل دخولك لتشوف مبارياتك'})).toBeVisible();
 expect(fetchMock).not.toHaveBeenCalled();
});
