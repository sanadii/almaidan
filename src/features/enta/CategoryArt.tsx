import { catalogCategoryCovers } from '../../data/local-question-inventory';

const coverCache = new Map<string, string>();

/** Public cover path for a category, reusing the Huroof setup artwork (presentation only). */
export function categoryCoverPath(key: string, label: string): string {
  const cached = coverCache.get(key);
  if (cached) return cached;
  const path = catalogCategoryCovers([{ id: key, labelAr: label }])[0]?.cover.web320 ?? 'assets/categories/320/category-006.webp';
  const value = path.startsWith('/') ? path : `/${path}`;
  coverCache.set(key, value);
  return value;
}

/** Decorative category artwork; the card's text label stays the accessible name. */
export function CategoryArt({ categoryKey, label }: { categoryKey: string; label: string }) {
  return <span className="enta-category__art" aria-hidden="true"><img src={categoryCoverPath(categoryKey, label)} alt="" width={320} height={320} loading="lazy" decoding="async" /></span>;
}
