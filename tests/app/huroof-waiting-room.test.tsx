import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GameIntent, ProjectionEnvelope, SafeRoomSummary } from '../../src/features/game/runtime/contracts';
import { ThemeProvider } from '../../src/app/ThemeProvider';

const runtime = vi.hoisted(() => ({
  kind: 'local' as 'local' | 'firebase',
  subscribeProjection: vi.fn(),
  submitGameIntent: vi.fn(),
}));
const encodeQr = vi.hoisted(() => vi.fn());
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: runtime }));
vi.mock('../../src/design-system/InternalHeader', () => ({ InternalHeader: () => null }));
vi.mock('qrcode', () => ({ toDataURL: encodeQr }));

import { RoomRoute } from '../../src/routes/GameRoutes';

const members: NonNullable<SafeRoomSummary['members']> = [
  { uid: 'host', displayName: 'المضيف', role: 'host', ready: false },
  { uid: 'ready-red', displayName: 'نور', role: 'player', ready: true, team: 'horizontal' },
  { uid: 'ready-green', displayName: 'سارة', role: 'player', ready: true, team: 'vertical' },
  { uid: 'waiting', displayName: 'حمد', role: 'player', ready: false, team: 'horizontal' },
];

function projection(role: ProjectionEnvelope['role'], room: Partial<SafeRoomSummary> = {}, revision = 7, ready = false): ProjectionEnvelope {
  return {
    roomId: 'room-lobby',
    role,
    revision,
    serverTime: new Date().toISOString(),
    projection: {
      room: {
        roomCode: 'ABC123',
        state: 'LOBBY',
        readyCount: 2,
        memberCount: 3,
        teams: { horizontal: 'الأحمر', vertical: 'الأخضر' },
        members,
        canStart: false,
        startBlockedReason: 'READY_TEAMS_REQUIRED',
        ...room,
      },
      ...(role === 'player' && { self: { uid: 'waiting', ready, team: 'horizontal', canBuzz: false } }),
    },
  };
}

function mount(surface: 'lobby' | 'display' = 'lobby') {
  return render(
    <MemoryRouter initialEntries={[`/room/ABC123/${surface}`]}>
      <Routes>
        <Route path={`/room/:roomCode/${surface}`} element={<RoomRoute surface={surface} />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: ThemeProvider },
  );
}

class LobbySocket {
  static OPEN = 1;
  static CLOSING = 2;
  static latest: LobbySocket;
  readyState = LobbySocket.OPEN;
  onmessage?: (event: MessageEvent) => void;

  constructor() { LobbySocket.latest = this; }
  close() { this.readyState = LobbySocket.CLOSING; }
  deliver(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })); }
}

const fetcher = vi.fn<typeof fetch>();
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function storeCapability(role: ProjectionEnvelope['role']) {
  sessionStorage.setItem('huroof:code:ABC123', 'room-lobby');
  sessionStorage.setItem(`huroof:room-lobby${role === 'audience' ? ':audience' : ''}`, JSON.stringify({ token: 'test-token', role }));
}

function localRoom(snapshot: ProjectionEnvelope, respond: (intent: GameIntent) => Response = () => reply({})) {
  const intents: GameIntent[] = [];
  storeCapability(snapshot.role);
  fetcher.mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/intents')) return reply(snapshot);
    const intent = JSON.parse(String(init?.body)) as GameIntent;
    intents.push(intent);
    return respond(intent);
  });
  return intents;
}

function hostedRoom(snapshot: ProjectionEnvelope) {
  runtime.kind = 'firebase';
  storeCapability(snapshot.role);
  let push: (next: ProjectionEnvelope) => void;
  runtime.subscribeProjection.mockImplementation((_roomId, _role, _uid, callback: typeof push) => {
    push = callback;
    callback(snapshot);
    return () => undefined;
  });
  return (next: ProjectionEnvelope) => act(() => push(next));
}

beforeEach(() => {
  sessionStorage.clear();
  runtime.kind = 'local';
  runtime.submitGameIntent.mockReset();
  runtime.subscribeProjection.mockReset();
  encodeQr.mockReset();
  encodeQr.mockResolvedValue('data:image/png;base64,QR');
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('WebSocket', LobbySocket);
  vi.stubEnv('VITE_PUBLIC_JOIN_ORIGIN', 'https://play.example.test');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('lets the host move or remove absent players and start with a ready player on each team', async () => {
  const intents = localRoom(projection('host', { canStartWithoutWaiting: true }));
  mount();
  expect(await screen.findByRole('heading', { name: 'غرفة الانتظار' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'ابدأ المباراة' })).toBeDisabled();

  act(() => LobbySocket.latest.deliver({
    type: 'presence',
    serverTime: new Date().toISOString(),
    players: { 'ready-red': { state: 'connected' }, waiting: { state: 'disconnected' } },
  }));
  const absent = screen.getByRole('button', { name: /حمد.*غير متصل.*انقل إلى فريق الأخضر/ });
  expect(absent).toHaveAttribute('data-presence-state', 'disconnected');
  expect(screen.getByRole('button', { name: /نور.*متصل/ })).toHaveAttribute('data-presence-state', 'connected');
  expect(screen.getByRole('button', { name: /سارة.*حالة الاتصال غير معروفة/ })).toHaveAttribute('data-presence-state', 'unknown');
  fireEvent.click(absent);
  await waitFor(() => expect(intents[0]).toMatchObject({ type: 'LOBBY_ASSIGN_TEAM', payload: { memberUid: 'waiting', team: 'vertical' } }));

  const remove = screen.getByRole('button', { name: 'إزالة حمد من الغرفة' });
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);
  const confirmation = screen.getByRole('button', { name: 'تأكيد إزالة حمد' });
  expect(confirmation).toHaveFocus();
  fireEvent.click(confirmation);
  await waitFor(() => expect(intents[1]).toMatchObject({ type: 'LOBBY_REMOVE_PARTICIPANT', payload: { memberUid: 'waiting' } }));

  const start = screen.getByRole('button', { name: 'ابدأ بدون انتظار الباقين' });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  await waitFor(() => expect(intents[2]).toMatchObject({ type: 'START_MATCH', payload: { withoutWaiting: true } }));
});

it('keeps the ordinary empty-roster host start and existing empty payload', async () => {
  const intents = localRoom(projection('host', { memberCount: 0, readyCount: 0, members: [], canStart: true, startBlockedReason: undefined }));
  mount();
  const start = await screen.findByRole('button', { name: 'ابدأ المباراة' });
  expect(start).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'ابدأ بدون انتظار الباقين' })).not.toBeInTheDocument();
  fireEvent.click(start);
  await waitFor(() => expect(intents[0]).toMatchObject({ type: 'START_MATCH', payload: {} }));
});

it('exposes the same removal confirmation to a hosted room host', async () => {
  hostedRoom(projection('host'));
  runtime.submitGameIntent.mockResolvedValue({ revision: 8, replayed: false });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'إزالة حمد من الغرفة' }));
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد إزالة حمد' }));
  await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledWith('room-lobby', expect.objectContaining({
    type: 'LOBBY_REMOVE_PARTICIPANT', expectedRevision: 7, payload: { memberUid: 'waiting' },
  })));
});

it.each([true, false])('retries local readiness %s with a fresh projection, the same target value and a new intent ID', async (ready) => {
  const intents = localRoom(projection('player', {}, 7, !ready), (intent) =>
    intent.expectedRevision === 7
      ? reply({ stale: true, projection: projection('player', {}, 8, !ready) })
      : reply({ projection: projection('player', {}, 9, ready) }),
  );
  mount();
  const button = await screen.findByTestId('ready');
  fireEvent.click(button);
  await waitFor(() => expect(intents).toHaveLength(2));
  expect(intents).toMatchObject([
    { type: 'LOBBY_SET_READY', expectedRevision: 7, payload: { ready } },
    { type: 'LOBBY_SET_READY', expectedRevision: 8, payload: { ready } },
  ]);
  expect(intents[1].intentId).not.toBe(intents[0].intentId);
  await waitFor(() => expect(button).toHaveTextContent(ready ? 'إلغاء الجاهزية' : 'اختبر البازر وأنا جاهز'));
});

it('waits for a server-confirmed hosted revision after an explicit stale refusal', async () => {
  const push = hostedRoom(projection('player'));
  runtime.submitGameIntent
    .mockRejectedValueOnce(Object.assign(new Error('stale-revision'), { code: 'functions/aborted' }))
    .mockResolvedValueOnce({ revision: 9, replayed: false });
  mount();
  const ready = await screen.findByTestId('ready');
  fireEvent.click(ready);
  await waitFor(() => expect(ready).toBeDisabled());
  push({ ...projection('player', {}, 8), authoritative: false });
  expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);
  push({ ...projection('player', {}, 8), authoritative: true });
  await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledTimes(2));
  expect(runtime.submitGameIntent).toHaveBeenLastCalledWith('room-lobby', expect.objectContaining({
    type: 'LOBBY_SET_READY', expectedRevision: 8, payload: { ready: true },
  }));
  expect(runtime.submitGameIntent.mock.calls[1][1].intentId).not.toBe(runtime.submitGameIntent.mock.calls[0][1].intentId);
});

it('does not replay readiness when a fresh snapshot already has the desired value', async () => {
  const push = hostedRoom(projection('player'));
  runtime.submitGameIntent.mockResolvedValueOnce({ revision: 8, replayed: false, stale: true });
  mount();
  const ready = await screen.findByTestId('ready');
  fireEvent.click(ready);
  await waitFor(() => expect(ready).toBeDisabled());
  push(projection('player', {}, 8, true));
  await waitFor(() => expect(ready).toBeEnabled());
  expect(ready).toHaveTextContent('إلغاء الجاهزية');
  expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);
});

it('does not retry a non-stale abort', async () => {
  const push = hostedRoom(projection('player'));
  runtime.submitGameIntent.mockRejectedValueOnce(Object.assign(new Error('other-abort'), { code: 'functions/aborted' }));
  mount();
  const ready = await screen.findByTestId('ready');
  fireEvent.click(ready);
  await screen.findByText(/تعذر إتمام العملية/);
  push(projection('player', {}, 8));
  expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);
});

it('copies the lobby code, uses a direct join QR and opens the audience display in a new tab', async () => {
  const user = userEvent.setup();
  localRoom(projection('host'));
  mount();
  expect(await screen.findByRole('img', { name: 'رمز QR للانضمام إلى الغرفة' })).toBeVisible();
  expect(encodeQr).toHaveBeenCalledWith('https://play.example.test/room/ABC123/join', expect.any(Object));
  await user.click(screen.getByRole('button', { name: 'انسخ الرمز' }));
  expect(await screen.findByText('تم النسخ')).toBeVisible();
  await expect(navigator.clipboard.readText()).resolves.toBe('ABC123');
  const display = screen.getByRole('link', { name: 'افتح شاشة العرض' });
  expect(display).toHaveAttribute('href', '/room/ABC123/display');
  expect(display).toHaveAttribute('target', '_blank');
});

it('shows the large code and live player names on the waiting display before showing the board', async () => {
  localRoom(projection('audience', { members: members.slice(0, 2) }));
  mount('display');
  expect(await screen.findByRole('heading', { name: 'ادخلوا من جوالاتكم' })).toBeVisible();
  expect(await screen.findByRole('img', { name: 'رمز QR للانضمام إلى الغرفة' })).toBeVisible();
  expect(screen.getByText('ABC123').closest('.room-code--large')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'انسخ الرمز' })).not.toBeInTheDocument();
  const roster = screen.getByRole('region', { name: 'اللاعبون' });
  expect(within(roster).getByText('نور')).toBeVisible();
  expect(within(roster).queryByText('المضيف')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'لوحة المباراة والنتيجة' })).not.toBeInTheDocument();

  act(() => LobbySocket.latest.deliver(projection('audience', { members }, 8)));
  expect(within(roster).getByText('سارة')).toBeVisible();
  act(() => LobbySocket.latest.deliver(projection('audience', { state: 'CELL_SELECTION' }, 9)));
  expect(screen.queryByRole('heading', { name: 'ادخلوا من جوالاتكم' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'لوحة المباراة والنتيجة' })).toBeVisible();
});

it('groups each lobby action with its own hint and shows a single label for each team', async () => {
  localRoom(projection('host', { canStartWithoutWaiting: true }));
  mount();
  const title = await screen.findByRole('heading', { name: 'غرفة الانتظار' });
  const header = title.closest('header')!;
  const actions = header.querySelector('.huroof-lobby__actions')!;
  expect(header.querySelector('.room-code')?.nextElementSibling).toBe(actions);
  for (const action of within(actions as HTMLElement).getAllByRole('button').concat(within(actions as HTMLElement).getAllByRole('link'))) {
    const hint = document.getElementById(action.getAttribute('aria-describedby') ?? '');
    expect(action.nextElementSibling).toBe(hint);
  }
  expect(screen.getAllByRole('heading', { name: 'فريق الأحمر' })).toHaveLength(1);
  expect(screen.getAllByRole('heading', { name: 'فريق الأخضر' })).toHaveLength(1);
});

it('isolates the names and marks the current seat by its public seat ID', async () => {
  const snapshot = projection('player', { members: members.map(({ uid, ...member }) => ({ ...member, seatId: `seat-${uid}` })) });
  snapshot.projection.self!.seatId = 'seat-waiting';
  localRoom(snapshot);
  mount();
  const own = await screen.findByText('حمد');
  expect(own.tagName).toBe('BDI');
  expect(own.closest('li')).toHaveTextContent('حمد (أنت)');
  expect(screen.getByText('نور').closest('li')).not.toHaveTextContent('(أنت)');
  expect(screen.getByRole('link', { name: 'كيف نلعب؟' })).toHaveAttribute('target', '_blank');
});
