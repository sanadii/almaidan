import { type RefObject, useState } from 'react';
import { isAlmaidanLocalDevelopment } from '../../lib/local-development';
import { useFirebaseAuth } from '../auth/auth-context';
import { useSetupSignIn } from '../auth/setup-sign-in';
import { EntaClientError, foldEntaName, normalizeEntaName, pendingName } from './client';
import type { CatalogueMode } from './CategoryCompatibility';
import { validQuestionSeconds } from './setup-options';

export type SetupCategory = { key: string; label: string; format?: string };

export async function publicSetupCategories(mode: CatalogueMode, signal: AbortSignal): Promise<SetupCategory[]> {
  const response = await fetch(`/api/v1/enta/setup-catalogue/${mode}`, { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new EntaClientError('LOCAL_SERVICE_UNAVAILABLE', response.status);
  const { categories } = await response.json();
  if (!Array.isArray(categories) || categories.length > 1000 || categories.some(row => (
    !row || typeof row.key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.key) || typeof row.label !== 'string' || !row.label.trim() || row.label.length > 160
    || (row.format !== undefined && !['ORDINARY_TIER', 'LIST_ITEMS', 'ACTING_ITEMS', 'DRAWING_TARGET'].includes(row.format))
  )) || new Set(categories.map(row => row.key)).size !== categories.length) throw new EntaClientError('MALFORMED_RESPONSE');
  return categories.map(({ key, label, format }) => ({ key, label, format }));
}

export function useEntaSetupAccount() {
  const { user, status, isAvailable } = useFirebaseAuth();
  const signedIn = isAvailable && (status === 'password' || status === 'google') && user && !user.isAnonymous ? user : null;
  const host = signedIn?.emailVerified ? signedIn : null;
  return { user: host, unverified: signedIn && !host ? signedIn : null, ...useSetupSignIn(Boolean(host)) };
}

export function SetupStep({ number }: { number: number }) {
  return <span className="enta-step" aria-hidden="true">{number}</span>;
}

export const setupPlayersLabel = isAlmaidanLocalDevelopment ? 'أسماء اللاعبين (اختياري)' : 'اللاعبون — اسم في كل سطر';

export function setupPlayers(input: string) {
  return input.split(/\r?\n/).map(normalizeEntaName).filter(Boolean);
}

const localSeats = Array.from({ length: 8 }, (_, index) => `المقعد ${index + 1}`);

export function advancedSetupPlayers(input: string) {
  const players = setupPlayers(input);
  if (!isAlmaidanLocalDevelopment || players.length) return players;
  // Local advanced engines assign stable indexed player IDs; the room associates the guest with one of these seats.
  return [...localSeats];
}

export function restoredAdvancedPlayers(players: string[]) {
  if (isAlmaidanLocalDevelopment && players.length === localSeats.length && players.every((name, index) => name === localSeats[index])) return '';
  return players.join('\n');
}

type Team = { name: string; players: string };
type SetupIssue = { field: string; text: string };
export function validateEntaSetup({ selected, count, teams, seconds, available, teamLimit = 4, uniquePlayers = false }: {
  selected: string[];
  count: number;
  teams: Team[];
  seconds: number;
  available?: readonly SetupCategory[];
  teamLimit?: number;
  uniquePlayers?: boolean;
}): SetupIssue | null {
  if (available && available.length < count) return { field: 'categories', text: 'الفئات المتاحة ما تكفي لهالمباراة حالياً.' };
  if (selected.length !== count || new Set(selected).size !== count || selected.some(key => typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(key))) return { field: 'categories', text: count === 1 ? 'اختاروا فئة واحدة.' : 'اختاروا ست فئات مختلفة.' };
  if (available && selected.some(key => !available.some(category => category.key === key))) return { field: 'categories', text: 'بعض الفئات المختارة ما عادت متاحة. اختاروا فئات ثانية.' };
  if (teams.length < 2 || teams.length > teamLimit) return { field: 'teams', text: teamLimit === 2 ? 'خلّوا المباراة على فريقين.' : 'اختاروا من فريقين إلى 4 فرق.' };
  const teamNames = new Set<string>();
  for (const [index, team] of teams.entries()) {
    const name = normalizeEntaName(team.name);
    const field = `team-${index}`;
    const folded = foldEntaName(name);
    if (!pendingName(name, 2, 22)) return { field, text: 'اكتبوا اسم الفريق من 2 إلى 22 حرفاً بدون رموز خاصة.' };
    if (teamNames.has(folded)) return { field, text: 'خلّوا لكل فريق اسم مختلف.' };
    teamNames.add(folded);
    const players = setupPlayers(team.players);
    const playersField = `players-${index}`;
    if (players.length > 8 || (!isAlmaidanLocalDevelopment && players.length === 0)) return { field: playersField, text: isAlmaidanLocalDevelopment ? 'اكتبوا 8 أسماء لاعبين أو أقل لكل فريق.' : 'اكتبوا من اسم واحد إلى 8 أسماء لاعبين لكل فريق.' };
    if (players.some(player => !pendingName(player, 1, 30))) return { field: playersField, text: 'اكتبوا اسم كل لاعب حتى 30 حرفاً بدون رموز خاصة.' };
    if (uniquePlayers && new Set(players).size !== players.length) return { field: playersField, text: 'اكتبوا اسم كل لاعب مرة واحدة في فريقه.' };
  }
  if (!validQuestionSeconds(seconds)) return { field: 'seconds', text: 'اختاروا وقتاً من 5 إلى 120 ثانية كاملة.' };
  return null;
}

export function useSetupIssue(form: RefObject<HTMLFormElement | null>) {
  const [issue, setIssue] = useState<SetupIssue | null>(null);
  return {
    issue,
    clear: () => setIssue(null),
    show: (next: SetupIssue) => {
      setIssue(next);
      form.current?.querySelector<HTMLElement>(`[data-setup-field="${next.field}"]`)?.focus();
    },
  };
}
