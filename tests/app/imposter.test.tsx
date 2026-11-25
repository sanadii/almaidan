import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { PrivateReveal } from '../../src/features/imposter/PrivateReveal';
import { ImposterNewRoute, ImposterRoomRoute, ImposterTutorialRoute } from '../../src/features/imposter/ImposterRoutes';
import { NameJoinRoute } from '../../src/routes/NameJoinRoute';
import type { Projection } from '../../src/features/imposter/contracts';
import type { Snapshot } from '../../src/features/imposter/runtime';

const mocks = vi.hoisted(() => ({
  verifiedHost: true,
  resume: vi.fn(), submit: vi.fn(), resolve: vi.fn(), join: vi.fn(), create: vi.fn(),
  receive: undefined as undefined | ((value: Snapshot) => void),
  connection: undefined as undefined | ((value: boolean) => void),
}));
vi.mock('../../src/features/auth/auth-context', () => ({ useFirebaseAuth: () => ({ status: 'password', user: { isAnonymous: false, emailVerified: mocks.verifiedHost } }) }));
vi.mock('../../src/design-system/InternalHeader', () => ({ InternalHeader: () => null }));
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: { kind: 'local' } }));
vi.mock('../../src/features/imposter/runtime', async original => ({
  ...await original<typeof import('../../src/features/imposter/runtime')>(),
  imposterRuntimeKind: () => 'local',
  createImposterRoom: mocks.create,
  loadSession: (code: string) => code === 'D1-ABCD1234' ? ({ roomId: 'test-room', roomCode: code, token: 'local-test-capability' }) : undefined,
  resumeImposterRoom: mocks.resume,
  submitImposterIntent: mocks.submit,
  resolveRoom: mocks.resolve,
  joinImposterRoom: mocks.join,
  subscribeImposterRoom: (_session: unknown, receive: (value: Snapshot) => void, connection: (value: boolean) => void) => { mocks.receive = receive; mocks.connection = connection; return () => {}; },
}));

function projection(overrides: Partial<Projection> = {}): Projection {
  return { gameKind: 'imposter', revision: 1, code: 'D1-ABCD1234', phase: 'reveal', phaseId: '1', round: 1, organizer: 'a', me: 'a', players: [{ uid: 'a', name: 'أحمد', connected: true, ready: true }, { uid: 'b', name: 'بدر', connected: true, ready: true }, { uid: 'c', name: 'خالد', connected: true, ready: true }], settings: { mode: 'typed', pace: 'default', categories: ['الفواكه'] }, deadline: Date.now() + 60_000, category: 'الفواكه', role: 'insider', word: 'تفاح', order: ['a', 'b', 'c'], turn: 0, clues: [], candidates: [], hasActed: false, contentExhausted: false, ...overrides };
}
function snapshot(p = projection()): Snapshot { return { roomId: 'test-room', serverTime: Date.now(), projection: p }; }
function room() { return render(<MemoryRouter initialEntries={['/room/D1-ABCD1234/imposter']}><Routes><Route path="/room/:roomCode/imposter" element={<ImposterRoomRoute />} /></Routes></MemoryRouter>); }
beforeEach(() => { mocks.verifiedHost = true; vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); mocks.resume.mockResolvedValue(snapshot()); mocks.submit.mockImplementation(async (_session, p) => snapshot(p)); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.receive = undefined; mocks.connection = undefined; sessionStorage.clear(); });

it('shows the Imposter picture in its setup and dedicated guide', () => {
  const view = render(<MemoryRouter><ImposterNewRoute /></MemoryRouter>);
  expect(view.container.querySelector('header.game-artwork-heading img')).toHaveAttribute('src', '/assets/games/imposter-art-v1-360.webp');
  view.rerender(<MemoryRouter><ImposterTutorialRoute /></MemoryRouter>);
  expect(view.container.querySelector('.status-panel__illustration img')).toHaveAttribute('src', '/assets/games/imposter-art-v1-360.webp');
});

describe('private reveal', () => {
  it('mounts secrets only during a deliberate pointer hold and hides on cancellation', () => {
    render(<PrivateReveal identity="round-one"><strong>سر تجريبي</strong></PrivateReveal>);
    const control = screen.getByRole('button');
    expect(screen.queryByText('سر تجريبي')).not.toBeInTheDocument();
    fireEvent.pointerDown(control, { button: 0 });
    // jsdom does not implement PointerEvent.button; keyboard verifies the same reveal state.
    fireEvent.keyDown(control, { key: ' ' });
    expect(screen.getByText('سر تجريبي')).toBeInTheDocument();
    fireEvent.pointerCancel(control);
    expect(screen.queryByText('سر تجريبي')).not.toBeInTheDocument();
  });
  it('supports keyboard hold and hides on release, blur and page visibility events', () => {
    render(<PrivateReveal identity="round-one">سر تجريبي</PrivateReveal>);
    const control = screen.getByRole('button');
    for (const conceal of [() => fireEvent.keyUp(control, { key: 'Enter' }), () => fireEvent(window, new Event('blur')), () => fireEvent(document, new Event('visibilitychange'))]) {
      fireEvent.keyDown(control, { key: 'Enter' });
      expect(screen.getByText('سر تجريبي')).toBeInTheDocument();
      conceal(); expect(screen.queryByText('سر تجريبي')).not.toBeInTheDocument();
    }
  });
  it('requires a fresh hold after disconnect and after changing rounds', () => {
    const view = render(<PrivateReveal identity="one">سر أول</PrivateReveal>);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    view.rerender(<PrivateReveal identity="one" disabled>سر أول</PrivateReveal>);
    view.rerender(<PrivateReveal identity="one">سر أول</PrivateReveal>);
    expect(screen.queryByText('سر أول')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    view.rerender(<PrivateReveal identity="two">سر ثان</PrivateReveal>);
    expect(screen.queryByText('سر ثان')).not.toBeInTheDocument();
  });
});

it('conceals an insider secret until held and again when connection is lost', async () => {
  room(); await screen.findByText('كل واحد وسرّه');
  await waitFor(() => expect(mocks.connection).toBeTypeOf('function'));
  await act(async () => mocks.connection!(true));
  const hold = screen.getByRole('button', { name: 'اضغط مطولاً لعرض سرك' });
  await waitFor(() => expect(hold).toBeEnabled());
  expect(screen.queryByText('تفاح')).not.toBeInTheDocument();
  fireEvent.keyDown(hold, { key: ' ' });
  expect(screen.getByText('تفاح')).toBeInTheDocument();
  act(() => mocks.connection?.(false));
  expect(screen.queryByText('تفاح')).not.toBeInTheDocument();
});

it('shows no word on the imposter final guess screen', async () => {
  mocks.resume.mockResolvedValue(snapshot(projection({ phase: 'guess', role: 'imposter', word: undefined })));
  room(); await screen.findByLabelText('تخمينك النهائي');
  expect(screen.queryByText('تفاح')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'اضغط مطولاً لعرض سرك' })).not.toBeInTheDocument();
});

it('locks a private vote without displaying submission counts or self as a target', async () => {
  mocks.resume.mockResolvedValue(snapshot(projection({ phase: 'vote', candidates: ['a', 'b', 'c'] })));
  room(); await screen.findByText('صوّت بسرية');
  expect(screen.queryByRole('button', { name: /أحمد/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /بدر/ }));
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد التصويت' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'vote', target: 'b' }));
  act(() => mocks.receive?.(snapshot(projection({ phase: 'vote', revision: 2, hasActed: true }))));
  expect(screen.getByText('تم تثبيت صوتك بسرية. ننتظر باقي الأصوات.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'تأكيد التصويت' })).not.toBeInTheDocument();
});

it.each(['a', 'c'])('offers early voting only to the organizer (%s)', async me => {
  mocks.resume.mockResolvedValue(snapshot(projection({ phase: 'discussion', me })));
  room();
  await screen.findByText('ناقشوا التلميحات');
  expect(screen.getByRole('timer')).toHaveTextContent(/^[0-9]+ ثانية$/);
  const begin = screen.queryByRole('button', { name: 'ابدأوا التصويت الآن' });
  if (me !== 'a') { expect(begin).not.toBeInTheDocument(); return; }
  expect(begin).toBeEnabled();
  fireEvent.click(begin!);
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'startVote' }));
});

it('shares the lobby room code and requires a dialog to close the room', async () => {
  mocks.resume.mockResolvedValue(snapshot(projection({ phase: 'lobby', deadline: null })));
  room();
  expect(await screen.findByRole('heading', { name: 'غرفة الانتظار' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'انسخ الرمز' })).toBeEnabled();
  const close = screen.getByRole('button', { name: 'إغلاق الغرفة' });
  close.focus();
  fireEvent.click(close);
  expect(screen.getByRole('dialog', { name: 'إغلاق الغرفة' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'تراجع' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'تراجع' }));
  expect(close).toHaveFocus();
  expect(mocks.submit).not.toHaveBeenCalled();
  fireEvent.click(close);
  fireEvent.click(screen.getByRole('button', { name: 'أغلق الغرفة' }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), { type: 'close' }));
});

it('routes generic code joining to الدخيل using room metadata', async () => {
  mocks.resolve.mockResolvedValue({ gameKind: 'imposter', joinable: true });
  mocks.join.mockResolvedValue({ roomId: 'test-room', roomCode: 'D1-ABCD1234' });
  render(<Suspense fallback={<p>تحميل</p>}><MemoryRouter initialEntries={['/room/D1-ABCD1234/join']}><Routes><Route path="/room/:roomCode/join" element={<NameJoinRoute />} /><Route path="/room/:roomCode/imposter" element={<p>وصلنا للدخيل</p>} /></Routes></MemoryRouter></Suspense>);
  const name = await screen.findByRole('textbox', { name: 'اسم اللاعب' });
  expect(screen.getByRole('link', { name: 'غيّر الرمز' })).toHaveAttribute('href', '/');
  fireEvent.change(name, { target: { value: 'سارة\u202e' } });
  fireEvent.click(screen.getByRole('button', { name: 'دخول الغرفة' }));
  expect(screen.getByRole('alert')).toHaveTextContent('اكتب اسمك (حتى 30 حرفاً).');
  expect(mocks.join).not.toHaveBeenCalled();
  fireEvent.change(await screen.findByLabelText('اسم اللاعب'), { target: { value: 'سارة' } });
  fireEvent.click(screen.getByRole('button', { name: 'دخول الغرفة' }));
  expect(await screen.findByText('وصلنا للدخيل')).toBeInTheDocument();
  expect(mocks.join).toHaveBeenCalledWith('D1-ABCD1234', 'سارة');
});

it('blocks creating live rooms in static preview', () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  render(<MemoryRouter><ImposterNewRoute /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'أنشئ الغرفة' })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('explains both objectives and the final-guess exception in Arabic', () => {
  render(<MemoryRouter><ImposterTutorialRoute /></MemoryRouter>);
  expect(screen.getByText('إذا أنت الدخيل.')).toBeInTheDocument();
  expect(screen.getByText('لا تفضحون الكلمة في النهاية!')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'كيف تلعب الدخيل؟' })).toHaveTextContent('المضيف يقدر يبدأ التصويت فوراً');
});

it('requires the existing verified Almaidan host account for room creation', () => {
  mocks.verifiedHost = false;
  render(<MemoryRouter><ImposterNewRoute /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'أنشئ الغرفة' })).toBeDisabled();
  // A signed-in but unverified host is offered verification, not a /login link that bounces back.
  expect(screen.getByTestId('verify-email-notice')).toBeVisible();
  expect(screen.getByRole('button', { name: 'أعد إرسال رابط التأكيد' })).toBeEnabled();
  expect(screen.queryByRole('link', { name: 'سجّل الدخول للاستضافة' })).not.toBeInTheDocument();
});

it('clears the prior private room immediately when the URL changes to another room', async () => {
  function Jump() { const navigate = useNavigate(); return <button onClick={() => navigate('/room/D1-ZZZZ1234/imposter')}>غرفة أخرى</button>; }
  let finishResume!: (value: Snapshot) => void;
  mocks.resume.mockReturnValueOnce(new Promise<Snapshot>(resolve => { finishResume = resolve; }));
  render(<MemoryRouter initialEntries={['/room/D1-ABCD1234/imposter']}><Jump /><Routes><Route path="/room/:roomCode/imposter" element={<ImposterRoomRoute />} /></Routes></MemoryRouter>);
  await act(async () => finishResume(snapshot()));
  const reveal = screen.getByRole('button', { name: 'اضغط مطولاً لعرض سرك' });
  expect(reveal).toBeEnabled();
  fireEvent.keyDown(reveal, { key: ' ' });
  expect(screen.getByText('تفاح')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'غرفة أخرى' }));
  expect(screen.queryByText('تفاح')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'اضغط مطولاً لعرض سرك' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'الانضمام إلى الغرفة' })).toHaveAttribute('href', '/room/D1-ZZZZ1234/join');
});
