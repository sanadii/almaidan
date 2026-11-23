import { afterEach, expect, it, vi } from 'vitest';
import { loadSession, saveSession, subscribeImposterRoom } from '../../src/features/imposter/runtime';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true }));

class TestSocket extends EventTarget {
  static last: TestSocket;
  close = vi.fn();
  constructor(readonly url: string) { super(); TestSocket.last = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); });

it('keeps a reconnect concealed until an authoritative private snapshot arrives', () => {
  vi.stubEnv('VITE_GAME_RUNTIME', 'local');
  vi.stubGlobal('WebSocket', TestSocket);
  const receive = vi.fn(); const connection = vi.fn(); const failure = vi.fn();
  const dispose = subscribeImposterRoom({ roomCode: 'ABCDEFGH', roomId: 'room-one', token: 'test-only' }, receive, connection, failure);
  TestSocket.last.dispatchEvent(new Event('open'));
  expect(connection).not.toHaveBeenCalledWith(true);
  expect(receive).not.toHaveBeenCalled();
  const snapshot = { roomId: 'room-one', projection: { gameKind: 'imposter', revision: 1 }, serverTime: 1000 };
  TestSocket.last.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(snapshot) }));
  expect(receive).toHaveBeenCalledWith(snapshot);
  expect(failure).not.toHaveBeenCalled();
  dispose(); expect(TestSocket.last.close).toHaveBeenCalled();
});

it('rejects a snapshot for a different room instead of revealing stale or foreign data', () => {
  vi.stubEnv('VITE_GAME_RUNTIME', 'local'); vi.stubGlobal('WebSocket', TestSocket);
  const receive = vi.fn(); const connection = vi.fn(); const failure = vi.fn();
  const dispose = subscribeImposterRoom({ roomCode: 'ABCDEFGH', roomId: 'room-one' }, receive, connection, failure);
  TestSocket.last.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ roomId: 'room-two', projection: { gameKind: 'imposter', revision: 1 }, serverTime: 1000 }) }));
  expect(receive).not.toHaveBeenCalled(); expect(connection).toHaveBeenCalledWith(false); expect(failure).toHaveBeenCalled(); dispose();
});

it('stores only the reconnect capability, never role or secret-bearing response fields', () => {
  saveSession({ roomId: 'room-one', roomCode: 'ABCDEFGH', token: 'test-only', uid: 'test-user', word: 'اختبار سري', role: 'imposter' } as Parameters<typeof saveSession>[0]);
  expect(JSON.stringify(sessionStorage)).not.toContain('اختبار سري');
  expect(JSON.stringify(sessionStorage)).not.toContain('"role"');
  expect(loadSession('ABCDEFGH')).toEqual({ roomId: 'room-one', roomCode: 'ABCDEFGH', token: 'test-only', uid: 'test-user' });
});
