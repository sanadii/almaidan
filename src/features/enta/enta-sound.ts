import type { SoundCue } from '../../lib/sound';
import type { MatchProjection } from './client';
import type { CompetitionMatch } from './competition-client';
import type { RoomView } from './room-client';
import type { RoundMatch } from './round-client';

export function classicSoundCues(before: MatchProjection, after: MatchProjection): SoundCue[] {
  if (before.id !== after.id || before.version >= after.version) return [];
  const cues: SoundCue[] = [];
  const questionId = before.currentQuestion?.id;
  const tile = questionId && after.tiles.find(row => row.id === questionId && row.used);
  if (tile && !before.tiles.some(row => row.id === questionId && row.used)) cues.push(tile.isCorrect ? 'correct' : 'wrong');
  if (!before.result && after.result && !after.result.isTie) cues.push('win');
  return cues;
}

export function roundSoundCues(before: RoundMatch, after: RoundMatch): SoundCue[] {
  if (before.id !== after.id || before.version >= after.version) return [];
  const cues: SoundCue[] = [];
  const previousRound = before.currentRound;
  if (previousRound) {
    const scored = after.teams.some(team => team.score > (before.teams.find(row => row.id === team.id)?.score ?? team.score));
    const consumed = after.currentRound?.id === previousRound.id
      && after.currentRound.items.some(item => item.consumed && !previousRound.items.find(row => row.id === item.id)?.consumed);
    if (scored || consumed) cues.push(scored ? 'correct' : 'wrong');
    else if (previousRound.format !== 'LIST_ITEMS' && previousRound.format !== 'ACTING_ITEMS' &&
      after.rounds.some(round => round.id === previousRound.id && round.state === 'RESOLVED')) cues.push('wrong');
  }
  if (!before.result && after.result && !after.result.isTie) cues.push('win');
  return cues;
}

export function competitionSoundCues(before: CompetitionMatch, after: CompetitionMatch): SoundCue[] {
  if (before.id !== after.id || before.version >= after.version) return [];
  const cues: SoundCue[] = [];
  const effect = after.latestEffect;
  if (effect && effect.id !== before.latestEffect?.id) {
    if (effect.kind === 'RULING') cues.push(effect.postings.some(row => row.delta > 0) ? 'correct' : 'wrong');
    else if (effect.kind === 'NO_SCORE') cues.push('wrong');
  }
  if (!before.result && after.result?.payload.outcome === 'DECISIVE') cues.push('win');
  return cues;
}

export function roomSoundCues(before: RoomView, after: RoomView): SoundCue[] {
  if (before.code !== after.code || before.version > after.version || !before.match || !after.match) return [];
  const cues: SoundCue[] = [];
  const feedback = after.feedback;
  const result = after.match.result as { isTie?: boolean; payload?: { outcome?: string } } | undefined;
  if (feedback && (feedback.at !== before.feedback?.at || feedback.roundId !== before.feedback.roundId) &&
      Number(after.match.serverNow) - feedback.at < 3000) {
    cues.push(feedback.awards.some(award => award.points > 0) ? 'correct' : 'wrong');
  }
  if (before.phase === 'PLAYING' && after.phase === 'FINISHED' && result && (result.payload?.outcome === 'DECISIVE' || result.isTie === false)) cues.push('win');
  return cues;
}
