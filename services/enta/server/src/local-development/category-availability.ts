/**
 * Local-only category availability. Admins can hide a category from new Enta setups without
 * touching its source records; matches already started (and their rematches) keep their pins.
 * The set is loaded from Postgres when the content admin registers and updated on each toggle.
 */
let disabled = new Set<string>();

export function replaceDisabledCategories(keys: Iterable<string>): void {
  disabled = new Set(keys);
}

export function setCategoryDisabledInMemory(key: string, value: boolean): void {
  const next = new Set(disabled);
  if (value) next.add(key);
  else next.delete(key);
  disabled = next;
}

export function isCategoryDisabled(key: string): boolean {
  return disabled.has(key);
}

export function disabledCategoryKeys(): string[] {
  return [...disabled].sort();
}

/** Keeps only categories that new setups may offer. */
export function enabledCategories<T extends { key: string }>(rows: readonly T[]): T[] {
  return disabled.size ? rows.filter(row => !disabled.has(row.key)) : [...rows];
}
