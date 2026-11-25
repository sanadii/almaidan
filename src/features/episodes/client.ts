export interface PublicEpisode {
  id: string;
  number: number;
  title: string;
  description: string | null;
  airDate: string | null;
  youtubeId?: string;
}

export class EpisodeCatalogError extends Error {
  constructor(public readonly kind: 'unavailable' | 'malformed') {
    super(kind === 'malformed' ? 'Invalid episode catalogue' : 'Episode catalogue unavailable');
  }
}

const fields = ['id', 'number', 'title', 'description', 'airDate'];
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const linkPattern = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:https?|javascript|data):)/i;
const malformed = (): never => { throw new EpisodeCatalogError('malformed'); };

export function isEpisodeCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function publicText(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && value === value.trim() && value.length <= max
    && !hasControlCharacters(value) && !linkPattern.test(value);
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 10) || code === 127) return true;
  }
  return false;
}

export function parseEpisodeCatalog(value: unknown): PublicEpisode[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return malformed();
  const catalog = value as Record<string, unknown>;
  if (Object.keys(catalog).length !== 1 || !Array.isArray(catalog.episodes) || catalog.episodes.length > 250) return malformed();
  const ids = new Set<string>();
  const numbers = new Set<number>();
  let characters = 0;
  const episodes = catalog.episodes.map((input): PublicEpisode => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return malformed();
    const row = input as Record<string, unknown>;
    const hasVideo = Object.hasOwn(row, 'youtubeId');
    const youtubeId = hasVideo ? row.youtubeId : undefined;
    if (Object.keys(row).length !== fields.length + Number(hasVideo) || fields.some(field => !Object.hasOwn(row, field))
      || typeof row.id !== 'string' || !idPattern.test(row.id) || ids.has(row.id)
      || typeof row.number !== 'number' || !Number.isSafeInteger(row.number) || row.number < 1 || row.number > 100_000 || numbers.has(row.number)
      || !publicText(row.title, 160) || (row.description !== null && !publicText(row.description, 2_000))
      || (hasVideo && (typeof youtubeId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)))
      || (row.airDate !== null && !isEpisodeCalendarDate(row.airDate))) return malformed();
    characters += row.id.length + row.title.length + (typeof row.description === 'string' ? row.description.length : 0);
    if (characters > 32_000) return malformed();
    ids.add(row.id);
    numbers.add(row.number);
    return { id: row.id, number: row.number, title: row.title, description: row.description as string | null, airDate: row.airDate as string | null, ...(typeof youtubeId === 'string' ? { youtubeId } : {}) };
  });
  return episodes.sort((left, right) => left.number - right.number || left.id.localeCompare(right.id, 'en'));
}

/** Public, same-origin read: no identity token or client-selected source. */
export async function loadEpisodeCatalog(signal: AbortSignal): Promise<PublicEpisode[]> {
  const response = await fetch('/api/v1/episodes', { signal, headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new EpisodeCatalogError('unavailable');
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) return malformed();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) { await reader.cancel(); return malformed(); }
      try { body += decoder.decode(chunk.value, { stream: true }); } catch { return malformed(); }
    }
    try { body += decoder.decode(); } catch { return malformed(); }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(body); } catch { return malformed(); }
  return parseEpisodeCatalog(value);
}

const dateFormatter = new Intl.DateTimeFormat('ar-KW', { numberingSystem: 'latn', calendar: 'gregory', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
export function formatEpisodeDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}
