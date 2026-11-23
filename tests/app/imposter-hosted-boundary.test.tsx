import { afterEach, expect, it, vi } from 'vitest';
import { createImposterRoom, joinImposterRoom, subscribeImposterRoom } from '../../src/features/imposter/runtime';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: false }));
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it('keeps hosted creation and joining closed before any admission or network effects', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(createImposterRoom('أحمد')).rejects.toThrow('IMPOSTER_LOCAL_ONLY');
  await expect(joinImposterRoom('D1-ABCD1234', 'بدر')).rejects.toThrow('IMPOSTER_LOCAL_ONLY');
  expect(fetch).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});

it('does not open a hosted private subscription outside the isolated local app', () => {
  const websocket = vi.fn(); vi.stubGlobal('WebSocket', websocket);
  const error = vi.fn(); const receive = vi.fn();
  subscribeImposterRoom({ roomId: 'example', roomCode: 'D1-ABCD1234' }, receive, vi.fn(), error)();
  expect(websocket).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled(); expect(error).toHaveBeenCalled();
});
