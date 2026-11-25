import { ObservedFirebaseAuthProvider, renderObservedOwnerHook } from './fixtures/observed-firebase-auth';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { CategorySourceContext } from '../../src/features/enta/CategorySourceContext';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { loadingAuthContext, type FirebaseAuthContextValue } from '../../src/features/auth/auth-context';
import { EntaAccess, EntaMatchRoute, EntaNewRoute } from '../../src/routes/EntaRoutes';
import { matchEnvelope, pendingStartStorageKey, readPendingStart, type MatchProjection, type StartCommand } from '../../src/features/enta/client';
import { useEntaMatch } from '../../src/features/enta/use-match';

const user = { uid: 'controlled-ui-host', isAnonymous: false, emailVerified: true, getIdToken: async () => 'host' } as User;
const auth: FirebaseAuthContextValue = { ...loadingAuthContext, status: 'password', isAvailable: true, user };
const categories = Array.from({ length: 6 }, (_, i) => ({ key: `category_${i}`, label: `فئة ${i + 1}` }));
const catalog = { mode: 'CLASSIC', categoryCount: 6, categories, availableCredit: '1' };
const intent: StartCommand = { requestKey: 'controlled-request-0001', logicalMatchId: 'controlled-logical-0001', setup: { version: 2, categoryKeys: categories.map(c => c.key), teams: [{ name: 'الفريق الأول', players: ['سارة'], lifelines: [] }, { name: 'الفريق الثاني', players: ['علي'], lifelines: [] }], rules: { questionSeconds: 30 } } };
function board(): MatchProjection { return { id: 'controlled-game', mode: 'CLASSIC', phase: 'BOARD', version: 1, serverNow: 1800000000000, rules: { questionSeconds: 30 }, teams: [{ id: 'team_a', name: 'الفريق الأول', players: ['سارة'], score: 0 }, { id: 'team_b', name: 'الفريق الثاني', players: ['علي'], score: 0 }], categories, tiles: categories.flatMap(c => [200, 200, 400, 400, 600, 600].map((points, i) => ({ id: `${c.key}_${i}`, categoryKey: c.key, points: points as 200 | 400 | 600, active: false, used: false, answeredByTeamId: null, isCorrect: null }))), turnTeamId: 'team_a', currentQuestion: null, result: null }; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn();
function LocationProbe(){return <output data-testid="actual-path">{useLocation().pathname}</output>;}
function surface(value = auth) { return <ThemeProvider><ObservedFirebaseAuthProvider value={value}><MemoryRouter initialEntries={['/enta/new']}><LocationProbe/><Routes><Route path="/enta/new" element={<EntaNewRoute />} /><Route path="/enta/matches/:id" element={<EntaMatchRoute />} /></Routes></MemoryRouter></ObservedFirebaseAuthProvider></ThemeProvider>; }
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); localStorage.clear(); });

it('static preview and unavailable/unverified auth perform no catalogue request', () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true'); const view = render(surface()); expect(screen.getByText('إنت صح غير متاحة في المعاينة')).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled();
  expect(view.container.querySelector('.enta-heading .game-artwork img')).toHaveAttribute('src', '/assets/games/enta-art-v1-360.webp');
  vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); view.rerender(surface({ ...auth, status: 'unavailable', isAvailable: false })); expect(screen.getByText('تسجيل الدخول غير متاح الآن')).toBeVisible();
  view.rerender(surface({ ...auth, user: { ...user, emailVerified: false } as User })); expect(screen.getByText('أكّد بريدك للاستضافة')).toBeVisible(); expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves the requested Enta setup and query through sign-in', () => {
 const signedOut={...auth,user:null,status:'signedOut' as const};
 render(<ThemeProvider><ObservedFirebaseAuthProvider value={signedOut}><MemoryRouter initialEntries={['/enta/new/drawing?mode=local']}><EntaAccess><p>محتوى المضيف</p></EntaAccess></MemoryRouter></ObservedFirebaseAuthProvider></ThemeProvider>);
 expect(screen.getByRole('link',{name:'تسجيل الدخول'})).toHaveAttribute('href','/login?returnTo=%2Fenta%2Fnew%2Fdrawing%3Fmode%3Dlocal');
 expect(screen.queryByText('محتوى المضيف')).not.toBeInTheDocument();
});

it('deep malformed and cross-user/project pending storage fails closed without crashing', () => {
  for (const value of [{ ...intent, setup: { ...intent.setup, teams: [{ name: 'x', players: {}, lifelines: [] }, intent.setup.teams[1]] } }, { ...intent, setup: { ...intent.setup, teams: [{ ...intent.setup.teams[0], name: 'aa\0bb' }, intent.setup.teams[1]] } }, { ...intent, setup: null }, { ...intent, score: 500 }]) {
    sessionStorage.setItem(pendingStartStorageKey(user.uid), JSON.stringify(value)); expect(readPendingStart(user.uid)).toBeNull();
  }
  sessionStorage.clear(); sessionStorage.setItem(pendingStartStorageKey('other-user'), JSON.stringify(intent)); sessionStorage.setItem('maydan:enta:pending-start:other-project:controlled-ui-host', JSON.stringify(intent)); expect(readPendingStart(user.uid)).toBeNull();
});

it('restored uncertain START retains exact keys through 401 and reload, then observes matching game', async () => {
  sessionStorage.setItem(pendingStartStorageKey(user.uid), JSON.stringify(intent));
  const bodies: unknown[] = []; let posts = 0;
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    if (url.endsWith('/catalog')) return Promise.resolve(json(catalog));
    if (url.endsWith('/matches/classic')) { bodies.push(JSON.parse(init.body as string)); posts++; return Promise.resolve(posts === 1 ? json({ error: 'INVALID_TOKEN' }, 401) : json({ match: board(), idempotent: true })); }
    return Promise.resolve(json({ match: board() }));
  });
  const view = render(surface()); await screen.findByText('الألعاب المتبقية في الحساب:');
  expect(screen.getByLabelText('اسم الفريق 1')).toBeDisabled(); await userEvent.click(screen.getByRole('button', { name: 'تأكيد بدء المباراة' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'تأكيد بدء المباراة' })).toBeEnabled()); expect(readPendingStart(user.uid)).toEqual(intent);
  view.unmount(); render(surface()); await screen.findByText('الألعاب المتبقية في الحساب:'); await userEvent.click(screen.getByRole('button', { name: 'تأكيد بدء المباراة' }));
  await screen.findByRole('heading', { name: 'لوحة إنت صح' }); expect(screen.getByTestId('actual-path')).toHaveTextContent('/enta/matches/'+board().id); expect(bodies).toEqual([intent, intent]); expect(readPendingStart(user.uid)).toBeNull();
});

it('fresh lost reply preserves pending intent; summary follows fields', async () => {
  fetchMock.mockImplementation((url: string) => url.endsWith('/catalog') ? Promise.resolve(json(catalog)) : Promise.reject(new TypeError('controlled lost response')));
  render(surface()); await screen.findByText('الألعاب المتبقية في الحساب:');
  const players = screen.getAllByLabelText('اللاعبون — اسم في كل سطر'); await userEvent.type(players[0], 'سارة'); await userEvent.type(players[1], 'علي');
  for (const category of categories) await userEvent.click(screen.getByRole('button', { name: category.label }));
  expect(document.querySelector('.enta-setup')?.lastElementChild).toHaveClass('enta-setup-summary');
  await userEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' })); await screen.findByRole('button', { name: 'تأكيد بدء المباراة' }); expect(readPendingStart(user.uid)?.setup).toEqual(intent.setup); expect(screen.getByLabelText('اسم الفريق 1')).toBeDisabled();
});

it('late in-flight poll cannot clear mutation busy, and unknown command retry keeps original id/version', async () => {
  vi.useFakeTimers(); const original = board(); let finishPoll!: (value: Response) => void, rejectCommand!: (reason: Error) => void; const requests: unknown[] = [];
  fetchMock.mockResolvedValueOnce(json({ match: original })).mockImplementationOnce(() => new Promise<Response>(resolve => { finishPoll = resolve; })).mockImplementationOnce((_url, init) => { requests.push(JSON.parse(init.body)); return new Promise<Response>((_resolve, reject) => { rejectCommand = reject; }); });
  const hook = renderObservedOwnerHook(user, () => useEntaMatch(user, original.id)); await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(hook.result.current.match?.version).toBe(1);
  await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
  let mutation!: Promise<void>; await act(async () => { mutation = hook.result.current.command({ type: 'OPEN_QUESTION', questionId: original.tiles[0].id }); await Promise.resolve(); });
  expect(hook.result.current.busy).toBe(true);
  await act(async () => { finishPoll(json({ match: original })); await Promise.resolve(); }); expect(hook.result.current.busy).toBe(true); expect(hook.result.current.uncertain).toBe(false);
  await act(async () => { rejectCommand(new TypeError('lost command reply')); await mutation; }); expect(hook.result.current.uncertain).toBe(true);
  const opened = structuredClone(original); opened.phase = 'QUESTION_OPEN'; opened.version = 2; opened.tiles[0].active = true; opened.currentQuestion = { id: original.tiles[0].id, points: 200, prompt: 'سؤال اختبار', answeringTeamId: 'team_a', deadlineAt: 1800000030000 };
  fetchMock.mockImplementationOnce((_url, init) => { requests.push(JSON.parse(init.body)); return Promise.resolve(json({ match: opened })); });
  await act(async () => { hook.result.current.retry(); await Promise.resolve(); await Promise.resolve(); }); expect(requests[1]).toEqual(requests[0]); expect(hook.result.current.match?.version).toBe(2);
});

it('renders Western digits for host point tiles, scores and category collection counts', async () => {
  const match = board();
  match.teams[0].score = 1600;
  fetchMock.mockResolvedValue(json({ match }));
  render(<ThemeProvider><ObservedFirebaseAuthProvider value={auth}><MemoryRouter initialEntries={[`/enta/matches/${match.id}`]}><Routes><Route path="/enta/matches/:id" element={<EntaMatchRoute />} /></Routes></MemoryRouter></ObservedFirebaseAuthProvider></ThemeProvider>);
  const tile = (await screen.findAllByRole('button', { name: /فئة 1، 200 نقطة/ }))[0];
  expect(within(tile).getByText('200')).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'نقاط الفرق' })).getByText('1600')).toBeInTheDocument();
  const names = [{ key: 'a', label: 'علوم' }, { key: 'b', label: 'علوم' }];
  render(<CategorySourceContext category={names[0]} categories={names} />);
  expect(screen.getByText('المجموعة 1 من 2')).toBeInTheDocument();
});

it('response validator rejects unrevealed answers and private URLs', () => {
  expect(() => matchEnvelope({ match: { ...board(), privateUrl: 'https://private.invalid' } })).toThrow('MALFORMED_RESPONSE');
  const match = board(); match.phase = 'QUESTION_OPEN'; match.tiles[0].active = true; match.currentQuestion = { id: match.tiles[0].id, points: 200, answeringTeamId: 'team_a', deadlineAt: 1800000030000, prompt: 'سؤال', answers: ['مخفية'] };
  expect(() => matchEnvelope({ match })).toThrow('MALFORMED_RESPONSE');
});

it('direct verified user switch remounts private setup and aborts prior pending start', async () => {
  let oldReply!: (value: Response) => void; let oldSignal!: AbortSignal;
  fetchMock.mockImplementation((url: string, init: RequestInit) => url.endsWith('/catalog') ? Promise.resolve(json(catalog)) : new Promise<Response>(resolve => { oldReply = resolve; oldSignal = init.signal as AbortSignal; }));
  const view = render(surface()); await screen.findByText('الألعاب المتبقية في الحساب:');
  await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[0], 'اسم خاص بالمستخدم الأول'); await userEvent.type(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[1], 'علي');
  for (const category of categories) await userEvent.click(screen.getByRole('button', { name: category.label }));
  await userEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' })); expect(screen.getByRole('button', { name: 'جارٍ تأكيد المباراة…' })).toBeDisabled();
  view.rerender(surface({ ...auth, user: { ...user, uid: 'second-user' } as User })); await screen.findByText('الألعاب المتبقية في الحساب:');
  expect(oldSignal.aborted).toBe(true); expect(screen.getAllByLabelText('اللاعبون — اسم في كل سطر')[0]).toHaveValue(''); expect(screen.getByLabelText('اسم الفريق 1')).toBeEnabled(); expect(screen.getByRole('button', { name: 'ابدأوا إنت صح' })).toBeEnabled();
  await act(async () => oldReply(json({ match: board() }))); expect(screen.getByRole('heading', { name: 'جهّزوا إنت صح' })).toBeVisible(); expect(readPendingStart('second-user')).toBeNull(); expect(readPendingStart(user.uid)).not.toBeNull();
});

it('fresh native2 start navigates using distinct actual Game ID', async()=>{
 fetchMock.mockImplementation((url:string)=>Promise.resolve(json(url.endsWith('/catalog')?catalog:url.endsWith('/matches/classic')?{match:board(),idempotent:false}:{match:board()})));
 render(surface());await screen.findByText('الألعاب المتبقية في الحساب:');const players=screen.getAllByLabelText('اللاعبون — اسم في كل سطر');await userEvent.type(players[0],'سارة');await userEvent.type(players[1],'علي');for(const category of categories)await userEvent.click(screen.getByRole('button',{name:category.label}));await userEvent.click(screen.getByRole('button',{name:'ابدأوا إنت صح'}));await screen.findByRole('heading',{name:'لوحة إنت صح'});expect(screen.getByTestId('actual-path')).toHaveTextContent('/enta/matches/'+board().id);const posted=JSON.parse(fetchMock.mock.calls.find(call=>call[1].method==='POST')![1].body);expect(posted.logicalMatchId).not.toBe(board().id);expect(readPendingStart(user.uid)).toBeNull();
});
