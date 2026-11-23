/** Exact locator classification: PG values never fall back to a legacy backend. */
export type RoomLocator = { backend: 'pg' | 'legacy' | 'enta'; value: string };
export function parseRoomLocator(value: unknown): RoomLocator {
  if (typeof value !== 'string') throw new Error('INVALID_LOCATOR');
  if (/^D1-[A-Z0-9]{8}$/.test(value)) return { backend: 'legacy', value };
  if (/^D1-/i.test(value)) throw new Error('INVALID_LOCATOR');
  if (/^E1-[A-Z0-9]{8}$/.test(value)) return { backend: 'enta', value };
  if (/^E1-/i.test(value)) throw new Error('INVALID_LOCATOR');
  if (/^M2-[A-Za-z0-9]{8}$/.test(value)) return { backend: 'pg', value };
  if (/^[A-Za-z0-9-_]{2,32}$/.test(value)) return { backend: 'legacy', value };
  throw new Error('INVALID_LOCATOR');
}
