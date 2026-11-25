import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompetitionPlay } from '../../src/features/enta/CompetitionRoutes';

const shared = vi.hoisted(() => ({
  user: { uid: 'owner', getIdToken: async () => 'owner-token' },
  attempt: { id: 'attempt-one', roundId: 'current-round', itemId: null, teamId: 'team-one', playerId: 'player-one', phase: 'MAIN' },
  command: vi.fn(),
}));
vi.mock('../../src/lib/local-development', async original => ({ ...await original<typeof import('../../src/lib/local-development')>(), isAlmaidanLocalDevelopment: true }));
vi.mock('../../src/features/auth/auth-context', async original => ({ ...await original<typeof import('../../src/features/auth/auth-context')>(), useFirebaseAuth: () => ({ user: shared.user }) }));
vi.mock('../../src/features/enta/use-competition-match', () => ({ useCompetitionMatch: () => ({
  command: shared.command, privateEpoch: 0, clearIssuance: vi.fn(),
  match: {
    id: 'match-one', serverNow: Date.now(), version: 3, executionFormat: 'MIXED_BOARD',
    teams: [{ id: 'team-one', name: 'الشمس', score: 0, players: [{ id: 'player-one', name: 'المقعد 1' }] }],
    rounds: [{ id: 'current-round' }], allowances: [], grants: [], collections: { pending: 1 },
    currentRound: { id: 'current-round', generation: 1, phase: 'MAIN', format: 'ORDINARY_TIER', currentTeamId: 'team-one', prompt: 'سؤال الجولة', hints: [], graphemeHints: [], items: [], eligibleAids: [] },
  },
}) }));
vi.mock('../../src/features/enta/use-competition-page', () => ({ useCompetitionPage: ({ collection }: { collection: string }) => ({
  page: collection === 'pending' ? { rows: [shared.attempt], total: 1, offset: 0, returned: 1 } : null,
  ready: false, verdicts: [], pages: 1,
}) }));

const dialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeEach(() => Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (dialogClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', dialogClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('shows exact answer text beside its current judging attempt and lets the host admit a waiting guest', async () => {
  const room = {
    code: 'E1-ABCDEFGH', version: 10, phase: 'PLAYING', engine: 'competitive',
    teams: [{ id: 'team-one', name: 'الشمس', players: [{ id: 'player-one', name: 'المقعد 1' }] }],
    members: [
      { id: 'member-one', name: 'نور', teamIndex: 0, playerIndex: 0, status: 'ADMITTED' },
      { id: 'member-late', name: 'سارة', teamIndex: 0, playerIndex: 1, status: 'PENDING' },
    ],
    submissions: [
      { commandId: 'answer-one', memberId: 'member-one', roundId: 'current-round', attemptId: 'attempt-one', text: 'الإجابة المكتوبة' },
      { commandId: 'answer-old', memberId: 'member-one', roundId: 'old-round', attemptId: 'attempt-one', text: 'من جولة سابقة' },
      { commandId: 'answer-legacy', memberId: 'member-one', roundId: 'current-round', text: 'إجابة قديمة في هذه الجولة' },
    ],
  };
  const fetchRoom = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === 'POST') {
      room.members[1].status = 'ADMITTED';
      return { ok: true, json: async () => ({ room }) };
    }
    expect(url).toBe('/api/v1/enta/rooms/by-match/competitive/match-one');
    expect(options.headers).toHaveProperty('authorization', 'Bearer owner-token');
    return { ok: true, json: async () => ({ room }) };
  });
  vi.stubGlobal('fetch', fetchRoom);
  render(<MemoryRouter initialEntries={['/enta/competitive/matches/match-one']}><Routes><Route path="/enta/competitive/matches/:id" element={<CompetitionPlay />} /></Routes></MemoryRouter>);
  const answer = await screen.findByText('الإجابة المكتوبة');
  const row = within(answer.closest('.enta-attempt-row') as HTMLElement);
  expect(row.getByText('نور')).toBeInTheDocument();
  expect(row.getByRole('button', { name: 'المحاولة خاطئة — دون كشف' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'نور' })).toHaveValue('player-one');
  expect(screen.queryByText('من جولة سابقة')).not.toBeInTheDocument();
  expect(screen.getByText('إجابة قديمة في هذه الجولة').closest('.enta-attempt-row')).toBeNull();
  expect(screen.getByText('لاعب ينتظر القبول')).toHaveAttribute('role', 'status');

  fireEvent.click(screen.getByRole('button', { name: 'قبول اللاعب' }));
  await waitFor(() => expect(screen.queryByText('لاعب ينتظر القبول')).not.toBeInTheDocument());
  const admission = fetchRoom.mock.calls.find(([url]) => url.endsWith('/host'));
  expect(JSON.parse(String(admission?.[1].body))).toMatchObject({ type: 'ADMIT', memberId: 'member-late', expectedVersion: 10 });
});
