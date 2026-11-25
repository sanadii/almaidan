import { currentLocalCategories } from './catalogue';
import { enabledCategories } from './category-availability';
import { localCompetitionCatalogue } from './competition-catalogue';
import { currentSupplement } from './supplement-overlay';

const modeFormat = {
  classic: null,
  kids: null,
  roundList: 'LIST_ITEMS',
  roundActing: 'ACTING_ITEMS',
  roundMixed: null,
  drawing: 'DRAWING_TARGET',
  competitiveTier: 'ORDINARY_TIER',
  competitiveList: 'LIST_ITEMS',
  competitiveActing: 'ACTING_ITEMS',
  competitiveMixed: null,
} as const;

export function publicSetupCatalogue(mode: string) {
  if (!Object.hasOwn(modeFormat, mode)) return null;
  if (mode === 'classic' || mode === 'kids') {
    const categories = mode === 'classic' ? currentLocalCategories() : enabledCategories(currentSupplement().kids);
    return { categories: categories.map(({ key, label }) => ({ key, label })) };
  }
  const format = modeFormat[mode as keyof typeof modeFormat];
  return { categories: localCompetitionCatalogue().base.categories
    .filter(category => !format || category.format === format)
    .map(({ key, label, format }) => ({ key, label, format })) };
}
