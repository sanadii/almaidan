import { act, cleanup, renderHook } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntaClientError, requestEnta } from '../../src/features/enta/client';
import { useEntaMatch } from '../../src/features/enta/use-match';
import { useRoundMatch } from '../../src/features/enta/use-round-match';
import { useCompetitionMatch } from '../../src/features/enta/use-competition-match';
import { roundRequest } from '../../src/features/enta/round-client';
import { competitionRequest } from '../../src/features/enta/competition-client';

vi.mock('../../src/features/enta/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/enta/client')>(),
  requestEnta: vi.fn(),
  matchEnvelope: (response: unknown) => response,
}));
vi.mock('../../src/features/enta/round-client', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/enta/round-client')>(),
  roundRequest: vi.fn(), parseRoundMatch: (response: unknown) => response,
}));
vi.mock('../../src/features/enta/competition-client', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/features/enta/competition-client')>(),
  competitionRequest: vi.fn(), parseCompetitionMatch: (response: unknown) => response,
}));

const user = { uid: 'host' } as User;
const request = vi.mocked(requestEnta);
const board = { phase: 'BOARD', version: 1 };

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); request.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['FINISHED', '404'])('stops polling on %s until a different match is opened', async terminal => {
  if (terminal === '404') request.mockRejectedValueOnce(new EntaClientError('MATCH_NOT_FOUND', 404));
  else request.mockResolvedValueOnce({ ...board, phase: terminal });
  request.mockResolvedValue(board);
  const hook = renderHook(({ id }) => useEntaMatch(user, id), { initialProps: { id: 'first' } });
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); document.dispatchEvent(new Event('visibilitychange')); });
  expect(request).toHaveBeenCalledTimes(1);
  hook.rerender({ id: 'second' });
  await act(async () => {});
  expect(request).toHaveBeenCalledTimes(2);
  expect(hook.result.current.match?.phase).toBe('BOARD');
});

it('recovers after a stalled read without overlapping two requests', async () => {
  request.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(board);
  const page = renderHook(() => useEntaMatch(user, 'slow-match'));
  await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2001); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][2].aborted).toBe(true);
  expect(page.result.current.match?.phase).toBe('BOARD');
});

it('pauses while hidden, refreshes on return, and stops after a finish command', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  request.mockResolvedValue(board);
  const hook = renderHook(() => useEntaMatch(user, 'active'));
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(request).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(request).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(true);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(8000); });
  expect(request).toHaveBeenCalledTimes(2);
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  request.mockResolvedValueOnce({ phase: 'FINISHED', version: 2 });
  await act(async () => { await hook.result.current.command({ type: 'FINISH', confirmEarly: true }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(request).toHaveBeenCalledTimes(4);
  expect(hook.result.current.match?.phase).toBe('FINISHED');
});

it.each([
  { engine: 'round', read: vi.mocked(roundRequest), hook: useRoundMatch },
  { engine: 'competitive', read: vi.mocked(competitionRequest), hook: useCompetitionMatch },
])('pauses the $engine host and allows explicit retry after a missing match', async ({ read, hook }) => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  read.mockRejectedValueOnce(new EntaClientError('MATCH_NOT_FOUND', 404))
    .mockResolvedValue({ finished: true, version: 3, grants: [] });
  const page = renderHook(() => hook(user, 'host-match'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(read).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(page.result.current.error).toBeInstanceOf(EntaClientError);
  await act(async () => { page.result.current.retry(); });
  expect(page.result.current.match?.finished).toBe(true);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(6000); });
  expect(read).toHaveBeenCalledTimes(2);
});
