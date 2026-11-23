/** Exact wire classification. A PG result is never eligible for legacy fallback. */
export type Locator = { backend: "pg"; code: string } | { backend: "legacy"; code: string };
export function parseLocator(value: unknown): Locator {
  if (typeof value !== "string") throw new Error("INVALID_LOCATOR");
  if (/^M2-[A-Za-z0-9]{8}$/.test(value)) return { backend: "pg", code: value.slice(3) };
  if (/^[A-Za-z0-9]{8}$/.test(value)) return { backend: "legacy", code: value };
  throw new Error("INVALID_LOCATOR");
}
export interface LocatorRecord { namespace: string; code: string; roomId: string; locatorGeneration: number; roomGeneration: number }
export async function resolvePgLocator(namespace: string, locator: Locator, lookup: (namespace: string, code: string) => Promise<LocatorRecord | null>): Promise<LocatorRecord> {
  if (locator.backend !== "pg") throw new Error("PG_LOCATOR_REQUIRED");
  const record = await lookup(namespace, locator.code);
  if (!record || record.namespace !== namespace || record.code !== locator.code || record.locatorGeneration !== 2 || !Number.isSafeInteger(record.roomGeneration) || record.roomGeneration < 1 || !record.roomId) throw new Error("PG_LOCATOR_UNAVAILABLE");
  return record;
}

