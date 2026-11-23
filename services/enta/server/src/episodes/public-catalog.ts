import { reviewedEpisodeRelease } from "./reviewed-release";

export interface PublicEpisode {
  id: string;
  number: number;
  title: string;
  description: string | null;
  /** Calendar date, never a timezone-dependent instant. */
  airDate: string | null;
}

export type EpisodeReleaseReader = () => Promise<unknown>;
export const readReviewedEpisodeRelease: EpisodeReleaseReader = async () => reviewedEpisodeRelease;

const MAX_RECORDS = 250;
const MAX_TEXT_CHARACTERS = 32_000;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LINK = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:https?|javascript|data):)/i;

function unavailable(): never { throw new Error("EPISODE_CATALOG_UNAVAILABLE"); }

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return unavailable();
  return record;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max
    || hasControlCharacters(value) || LINK.test(value)) return unavailable();
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 10) || code === 127) return true;
  }
  return false;
}

function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return unavailable();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value
    || Number(value.slice(0, 4)) < 1900) return unavailable();
  return value;
}

/** Whole-release validation fails closed; never silently drops invalid rows. */
export function projectPublicEpisodes(input: unknown): { episodes: PublicEpisode[] } {
  const release = object(input, ["schemaVersion", "releaseId", "approval", "reviewedOn", "episodes"]);
  if (release.schemaVersion !== 1 || release.approval !== "reviewed-public-descriptions"
    || typeof release.releaseId !== "string" || !ID.test(release.releaseId)) return unavailable();
  calendarDate(release.reviewedOn);
  if (!Array.isArray(release.episodes) || release.episodes.length > MAX_RECORDS) return unavailable();
  const ids = new Set<string>();
  const numbers = new Set<number>();
  let characters = 0;
  const episodes = release.episodes.map((inputEpisode): PublicEpisode => {
    const row = object(inputEpisode, ["id", "number", "title", "description", "airDate"]);
    if (typeof row.id !== "string" || !ID.test(row.id) || ids.has(row.id)
      || typeof row.number !== "number" || !Number.isSafeInteger(row.number)
      || row.number < 1 || row.number > 100_000 || numbers.has(row.number)) return unavailable();
    const title = text(row.title, 160);
    const description = row.description === null ? null : text(row.description, 2_000);
    const airDate = row.airDate === null ? null : calendarDate(row.airDate);
    characters += row.id.length + title.length + (description?.length ?? 0);
    if (characters > MAX_TEXT_CHARACTERS) return unavailable();
    ids.add(row.id);
    numbers.add(row.number);
    // Explicit public projection: no ORM row, source, URL, or release metadata.
    return { id: row.id, number: row.number, title, description, airDate };
  });
  episodes.sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, "en"));
  return { episodes };
}
