import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FirebaseAuthProvider } from '../../src/features/auth/AuthProvider';
import { useFirebaseAuth } from '../../src/features/auth/auth-context';
import { capabilityFor, saveCapability, saveRoomCode } from '../../src/features/game/runtime/huroof-session';
import { NameJoinRoute } from '../../src/routes/NameJoinRoute';
import { RoomRoute } from '../../src/routes/GameRoutes';

const auth = vi.hoisted(() => ({
  currentUser: { uid: 'test-owner', isAnonymous: false, providerData: [{ providerId: 'password' }], getIdToken: async () => 'identity-fixture' },
  authStateReady: async () => {},
}));
vi.mock('../../src/lib/firebase/client', () => ({ getOptionalFirebaseAuth: () => auth }));
vi.mock('firebase/auth', async (original) => ({
  ...await original<typeof import('firebase/auth')>(),
  onAuthStateChanged: () => () => {},
  signOut: async () => {},
}));
vi.mock('../../src/design-system/InternalHeader', () => ({ InternalHeader: () => null }));
vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true, isAlmaidanRealContent: false }));
const runtime = vi.hoisted(() => ({ kind: 'fixture', subscribeProjection: vi.fn() }));
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: runtime }));

const fetcher = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  runtime.kind = 'fixture';
  runtime.subscribeProjection.mockReset();
  sessionStorage.clear();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('VITE_STATIC_PREVIEW', 'false');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function openJoin() {
  return render(<MemoryRouter initialEntries={['/room/ABC123/join']}><Routes>
    <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
    <Route path="/room/:roomCode/lobby" element={<h1>غرفة الانتظار</h1>} />
  </Routes></MemoryRouter>);
}

function join(name: string) {
  fireEvent.change(screen.getByLabelText('اسم اللاعب'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'دخول الغرفة' }));
}

function openLobby(withOwner = false) {
  const routes = <MemoryRouter initialEntries={['/room/ABC123/lobby']}><Routes>
    <Route path="/room/:roomCode/lobby" element={<RoomRoute surface="lobby" />} />
    <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
  </Routes></MemoryRouter>;
  return render(withOwner ? <FirebaseAuthProvider>{routes}</FirebaseAuthProvider> : routes);
}

function savePlayer() {
  saveRoomCode('ABC123', 'first-room');
  saveCapability('first-room', { role: 'player', token: 'original-token' });
}

it('opens the lobby with the existing player capability without acquiring a second seat', async () => {
  savePlayer();
  openJoin();
  expect(await screen.findByRole('heading', { name: 'غرفة الانتظار' })).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  expect(capabilityFor('first-room')?.token).toBe('original-token');
});

it('provides a direct join action when a guest opens a lobby without a seat', async () => {
  openLobby();
  const action = await screen.findByRole('link', { name: 'ادخل الغرفة باسمك' });
  expect(action).toHaveAttribute('href', '/room/ABC123/join');
  fireEvent.click(action);
  expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
});

it('restores a signed-in owner in a fresh tab by room code and opens their host projection', async () => {
  const roomId = '12345678-aaaa-4444-8888-123456789abc';
  const ownerToken = 'test-fixture-host-capability';
  vi.stubGlobal('WebSocket', class { static CLOSING = 2; readyState = 1; close() {} });
  fetcher.mockImplementation(async (path, options) => {
    if (String(path).endsWith('/owner-access')) {
      expect(path).toBe('/api/rooms/ABC123/owner-access');
      expect(options?.method).toBe('POST');
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer identity-fixture');
      return reply({ roomId, roomCode: 'ABC123', token: ownerToken, audienceToken: 'test-fixture-audience-capability', revision: 1 });
    }
    expect(String(path)).toContain('/api/rooms/' + roomId + '?');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer ' + ownerToken);
    return reply({ roomId, revision: 1, serverTime: new Date().toISOString(), role: 'host', projection: { room: {
      roomCode: 'ABC123', state: 'LOBBY', teams: { horizontal: 'الأحمر', vertical: 'الأخضر' }, members: [], readyCount: 0, memberCount: 0,
    } } });
  });
  openLobby(true);
  expect(await screen.findByRole('heading', { name: 'غرفة الانتظار' })).toBeVisible();
  expect(capabilityFor(roomId)).toEqual({ role: 'host', token: ownerToken });
  expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/owner-access'))).toHaveLength(1);
});

it.each([401, 403, 404])('stops retrying after a terminal HTTP %i response', async status => {
  vi.useFakeTimers();
  savePlayer();
  fetcher.mockImplementation(async () => reply({ error: 'FIXTURE_REFUSAL' }, status));
  openLobby();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'ادخل الغرفة باسمك' })).toHaveAttribute('href', '/room/ABC123/join');
});

it('aborts an eight-second room read and starts a new attempt', async () => {
  vi.useFakeTimers();
  savePlayer();
  let first: AbortSignal | undefined;
  fetcher.mockImplementationOnce(async (_path, options) => new Promise<Response>((_resolve, reject) => {
    first = options?.signal ?? undefined;
    first?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })).mockImplementation(async () => reply({ error: 'ROOM_NOT_FOUND' }, 404));
  openLobby();
  await act(async () => { await vi.advanceTimersByTimeAsync(7_999); });
  expect(first?.aborted).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(first?.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('backs off after consecutive transient failures and stops after a definitive refusal', async () => {
  vi.useFakeTimers();
  savePlayer();
  const times: number[] = [];
  const start = Date.now();
  fetcher.mockImplementation(async () => {
    times.push(Date.now() - start);
    return times.length < 4 ? reply({ error: 'TEMPORARY' }, 503) : reply({ error: 'ROOM_NOT_FOUND' }, 404);
  });
  openLobby();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(times).toEqual([0, 1_000, 3_000, 7_000]);
});

it('ignores a late room response after leaving the route', async () => {
  vi.useFakeTimers();
  savePlayer();
  let resolve!: (response: Response) => void;
  let pending: AbortSignal | null | undefined;
  fetcher.mockImplementationOnce(async (_path, options) => {
    pending = options?.signal;
    return new Promise<Response>(done => { resolve = done; });
  });
  const socket = vi.fn();
  vi.stubGlobal('WebSocket', socket);
  const lobby = openLobby();
  lobby.unmount();
  expect(pending?.aborted).toBe(true);
  await act(async () => {
    resolve(reply({ revision: 1, role: 'player' }));
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(socket).not.toHaveBeenCalled();
});

it('keeps a signed-in non-owner out of host controls after a refused ownership check', async () => {
  fetcher.mockImplementation(async () => reply({ error: 'LOCAL_OWNED_ROOM_NOT_FOUND' }, 404));
  openLobby(true);
  expect(await screen.findByRole('heading', { name: 'تعذر فتح الغرفة' })).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/api/rooms/ABC123/owner-access');
  expect(sessionStorage.getItem('huroof:code:ABC123')).toBeNull();
});

it('retries a transient hosted subscription error and clears a seat after a permission denial', async () => {
  vi.useFakeTimers();
  savePlayer();
  runtime.kind = 'firebase';
  const unsubscribe = vi.fn();
  runtime.subscribeProjection.mockReturnValue(unsubscribe);
  openLobby();
  const fail = (code: string) => {
    const latest = runtime.subscribeProjection.mock.lastCall;
    expect(latest).toBeDefined();
    latest![4](Object.assign(new Error('Firebase request failed'), { code }));
  };
  await act(async () => {
    fail('functions/unavailable');
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(runtime.subscribeProjection).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(capabilityFor('first-room')?.role).toBe('player');
  await act(async () => {
    fail('functions/permission-denied');
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(runtime.subscribeProjection).toHaveBeenCalledTimes(2);
  expect(capabilityFor('first-room')).toBeUndefined();
  expect(screen.getByRole('link', { name: 'ادخل الغرفة باسمك' })).toBeVisible();
});

it.each(['   ', 'ــــ\u202e', 'لاعب\u200b', '!!!', 'س'.repeat(31)])(
  'returns focus to the name field and prevents a join for %j', async (name) => {
    openJoin();
    join(name);
    expect(await screen.findByRole('alert')).toHaveTextContent('اكتب اسمك (حتى 30 حرفاً).');
    expect(screen.getByLabelText('اسم اللاعب')).toHaveFocus();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it.each([
  ['DUPLICATE_DISPLAY_NAME', 'في لاعب بهذا الاسم. اختاروا اسماً آخر.'],
  ['MATCH_COMPLETE', 'انتهت هذه المباراة'],
])('explains a %s refusal without saving a seat', async (error, message) => {
  fetcher.mockResolvedValueOnce(reply({ error }, 409));
  openJoin();
  join('نورة');
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(sessionStorage.getItem('huroof:code:ABC123')).toBeNull();
});

it('reuses a normalized name’s request key after a lost response and reload', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('Network interrupted'));
  fetcher.mockResolvedValueOnce(reply({ roomId: 'reclaimed-room', token: 'guest-token' }));
  const first = openJoin();
  join('  نورة  ');
  await screen.findByRole('alert');
  const initial = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(initial).toMatchObject({ displayName: 'نورة', requestKey: expect.any(String) });
  first.unmount();
  openJoin();
  expect(screen.getByLabelText('اسم اللاعب')).toHaveValue('نورة');
  join('نورة');
  expect(await screen.findByRole('heading', { name: 'غرفة الانتظار' })).toBeVisible();
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(initial);
  expect(capabilityFor('reclaimed-room')).toEqual({ token: 'guest-token', role: 'player' });
  expect(sessionStorage.getItem('almaidan:huroof-join:ABC123')).toBeNull();
});

function SignOutControl() {
  const { status, signOut } = useFirebaseAuth();
  return <button disabled={status !== 'password'} onClick={() => void signOut()}>تسجيل الخروج</button>;
}

it('clears saved room capabilities on sign-out and keeps a pending request identity', async () => {
  saveRoomCode('ABC123', 'room');
  saveCapability('room', { role: 'host', token: 'host-token' });
  sessionStorage.setItem('huroof:room:audience', 'audience-token');
  sessionStorage.setItem('almaidan:huroof-join:ABC123', 'pending-attempt');
  sessionStorage.setItem('preferences', 'retained');
  render(<FirebaseAuthProvider><SignOutControl /></FirebaseAuthProvider>);
  const button = screen.getByRole('button', { name: 'تسجيل الخروج' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(Object.keys(sessionStorage).sort()).toEqual(['almaidan:huroof-join:ABC123', 'preferences']));
});

it('invalidates the local adapter capability even when sign-out runs outside a room route', async () => {
  vi.stubEnv('VITE_GAME_RUNTIME', 'local');
  const { gameRuntime } = await vi.importActual<typeof import('../../src/features/game/runtime')>('../../src/features/game/runtime');
  expect(gameRuntime.kind).toBe('local');
  gameRuntime.setCapabilityToken?.('test-host-capability');
  fetcher.mockImplementation(async () => reply({ revision: 2 }));
  await gameRuntime.resumeRoom?.('room');
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer test-host-capability');
  render(<FirebaseAuthProvider><SignOutControl /></FirebaseAuthProvider>);
  const button = screen.getByRole('button', { name: 'تسجيل الخروج' });
  await waitFor(() => expect(button).toBeEnabled());
  await act(async () => fireEvent.click(button));
  await gameRuntime.resumeRoom?.('room');
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('authorization')).not.toContain('test-host-capability');
});
