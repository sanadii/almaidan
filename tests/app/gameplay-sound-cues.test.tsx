import { expect, it } from 'vitest';
import { classicSoundCues, competitionSoundCues, roomSoundCues, roundSoundCues } from '../../src/features/enta/enta-sound';
import type { SafeProjection } from '../../src/features/game/runtime/contracts';
import { imposterSoundCues } from '../../src/features/imposter/ImposterRoutes';
import { huroofSoundCues } from '../../src/routes/GameRoutes';

const huroof = (revision: number, phase: SafeProjection['room']['state'], fields: Partial<SafeProjection> = {}) => ({
  roomId: 'room', revision, role: 'audience' as const, serverTime: '2026-11-25T00:00:04.000Z',
  projection: {
    room: { roomCode: 'ABC123', state: phase, memberCount: 2, readyCount: 2 },
    currentRound: 2, ...fields,
  },
});

it('uses authoritative Huroof judgments, cell awards and win without repeating or playing corrections', () => {
  const cell = { id: 'one', kind: 'letter' as const, q: 0, r: 0, visibleValue: 'أ' };
  const answering = huroof(5, 'FIRST_ANSWER', { activeCellId: 'one', board: [cell] });
  const expiresAt = '2026-11-25T00:00:06.000Z';
  const missed = huroof(6, 'OPPONENT_CHANCE', { answerFeedback: { outcome: 'incorrect', expiresAt } });
  expect(huroofSoundCues(answering, missed)).toEqual(['wrong']);
  expect(huroofSoundCues(missed, { ...missed, revision: 7 })).toEqual([]);
  expect(huroofSoundCues(answering, huroof(6, 'QUESTION_FAILED', { questionFailedReason: 'no-answer' }))).toEqual([]);
  const won = huroof(6, 'MATCH_COMPLETE', {
    answerFeedback: { outcome: 'correct', expiresAt }, board: [{ ...cell, owner: 'vertical' }], winningPath: ['one'],
  });
  expect(huroofSoundCues(answering, won)).toEqual(['correct', 'cell-claimed', 'win']);
  expect(huroofSoundCues(huroof(5, 'CORRECTION'), won)).toEqual([]);
});

it('plays classic Enta rulings from used tiles and only celebrates a winner', () => {
  type Match = Parameters<typeof classicSoundCues>[0];
  const answered = { id: 'enta', version: 1, currentQuestion: { id: 'question' }, tiles: [{ id: 'question', used: false }], result: null } as Match;
  const scored = { ...answered, version: 2, currentQuestion: null, tiles: [{ id: 'question', used: true, isCorrect: true }] } as Match;
  const missed = { ...scored, tiles: [{ ...scored.tiles[0], isCorrect: false }] };
  expect(classicSoundCues(answered, scored)).toEqual(['correct']);
  expect(classicSoundCues(answered, missed)).toEqual(['wrong']);
  expect(classicSoundCues(scored, { ...scored, version: 3, result: { isTie: false } } as Match)).toEqual(['win']);
  expect(classicSoundCues(scored, { ...scored, version: 3, result: { isTie: true } } as Match)).toEqual([]);
});

it('uses round settlement, competitive effect IDs and truthful Enta room feedback', () => {
  type Round = Parameters<typeof roundSoundCues>[0];
  const round = { id: 'round', version: 7, currentRound: { id: 'r1', format: 'ORDINARY_TIER' }, teams: [{ id: 'a', score: 0 }], rounds: [{ id: 'r1', state: 'RUNNING' }], result: null } as Round;
  const resolved = { ...round, version: 8, currentRound: null, rounds: [{ id: 'r1', state: 'RESOLVED' }] } as Round;
  expect(roundSoundCues(round, resolved)).toEqual(['wrong']);
  expect(roundSoundCues(round, { ...resolved, teams: [{ ...round.teams[0], score: 200 }] })).toEqual(['correct']);

  type Competition = Parameters<typeof competitionSoundCues>[0];
  const competition = { id: 'competitive', version: 1, latestEffect: null, result: null } as Competition;
  const ruling = { ...competition, version: 2, latestEffect: { id: 'effect', kind: 'RULING', postings: [{ teamId: 'a', delta: 200 }] } } as Competition;
  expect(competitionSoundCues(competition, ruling)).toEqual(['correct']);
  expect(competitionSoundCues(ruling, { ...ruling, version: 3 })).toEqual([]);
  expect(competitionSoundCues(ruling, { ...ruling, version: 3, latestEffect: { id: 'missed', kind: 'NO_SCORE', postings: [] } } as Competition)).toEqual(['wrong']);
  expect(competitionSoundCues(ruling, { ...ruling, version: 3, result: { payload: { outcome: 'DECISIVE' } } } as Competition)).toEqual(['win']);

  type Room = Parameters<typeof roomSoundCues>[0];
  const view = { code: 'ROOM', phase: 'PLAYING', version: 1, match: { serverNow: 1000 } } as Room;
  const live = { ...view, feedback: { roundId: 'r1', at: 1000, awards: [{ teamId: 'a', points: 200 }] } };
  expect(roomSoundCues(view, live)).toEqual(['correct']);
  expect(roomSoundCues(live, { ...live, version: 2 })).toEqual([]);
  expect(roomSoundCues(view, { ...live, match: { serverNow: 4500 } })).toEqual([]);
});

it('plays Imposter guess judgment and win once from the public result', () => {
  type Room = Parameters<typeof imposterSoundCues>[0];
  const guessing = { code: 'ROOM', round: 2, revision: 3, phase: 'guess' } as Room;
  const guess = { ...guessing, revision: 4, phase: 'results', result: { winner: 'imposter', guess: 'التفاح' } } as Room;
  expect(imposterSoundCues(guessing, guess)).toEqual(['correct', 'win']);
  expect(imposterSoundCues(guessing, { ...guess, result: { ...guess.result!, winner: 'insiders' } })).toEqual(['wrong', 'win']);
  expect(imposterSoundCues(guessing, { ...guess, result: { ...guess.result!, winner: 'insiders', guess: null } })).toEqual(['win']);
  expect(imposterSoundCues(guess, { ...guess, revision: 5 })).toEqual([]);
});
