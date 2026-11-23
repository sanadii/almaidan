/** Missing version preserves historical match behaviour. */
export const CATEGORY_PROJECTION_V1 = "category-groups-v1" as const;
export const CATEGORY_PROJECTION_V2 = "category-groups-v2" as const;
export const CATEGORY_PROJECTION_V3 = "category-groups-v3" as const;
export const CURRENT_CATEGORY_PROJECTION = CATEGORY_PROJECTION_V3;
export type CategoryProjectionVersion = typeof CATEGORY_PROJECTION_V1 | typeof CATEGORY_PROJECTION_V2 | typeof CATEGORY_PROJECTION_V3;

const roundThreeAliases: Record<string, string> = {
  "tahadani-games-046": "tahadani-068",
  "tahadani-games-022": "tahadani-004",
  "tahadani-games-011": "tahadani-005",
  "tahadani-games-455": "tahadani-028",
  "tahadani-games-458": "tahadani-029",
};

const roundFiveAliases: Record<string, string> = {
  "tahadani-games-310": "tahadani-058",
  "tahadani-games-523": "tahadani-043",
  "tahadani-games-134": "tahadani-011",
  "tahadani-games-135": "tahadani-012",
  "tahadani-games-127": "tahadani-014",
  "tahadani-games-107": "tahadani-020",
};

export function canonicalCategoryId(id: string, version?: CategoryProjectionVersion): string {
  if (!version) return id;
  if (version !== CATEGORY_PROJECTION_V1 && version !== CATEGORY_PROJECTION_V2 && version !== CATEGORY_PROJECTION_V3) throw new Error(`Unknown category projection: ${version}`);
  if (id === "tahadani-games-272") return "tahadani-047";
  if (id === "tahadani-games-111") return "tahadani-019";
  if (version === CATEGORY_PROJECTION_V3) return roundFiveAliases[id] ?? roundThreeAliases[id] ?? id;
  if (version === CATEGORY_PROJECTION_V2) return roundThreeAliases[id] ?? id;
  return id;
}
export function canonicalizeCategoryIds(ids: readonly string[], version?: CategoryProjectionVersion): string[] {
  return [...new Set(ids.map((id) => canonicalCategoryId(id, version)))];
}
export function categoryMatches(selected: string, physical: string, version?: CategoryProjectionVersion): boolean {
  return canonicalCategoryId(selected, version) === canonicalCategoryId(physical, version);
}
/** Apply only after the favorite service has validated the original association. */
export function favoriteDisplayKey(key: string): string {
  const prefix = "local.saved:";
  return key.startsWith(prefix) ? prefix + canonicalCategoryId(key.slice(prefix.length), CURRENT_CATEGORY_PROJECTION) : key;
}
export function favoriteBackingKeys(keys: readonly string[], choice: string): string[] {
  return keys.filter((key) => favoriteDisplayKey(key) === favoriteDisplayKey(choice));
}
