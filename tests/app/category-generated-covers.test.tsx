import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { categoryCatalog } from '../../src/data/category-catalog';
import { catalogCategoryCovers } from '../../src/data/local-question-inventory';
import generated from '../../src/data/generated-category-covers.public.json';

describe('generated category covers', () => {
  it('uses the existing goals artwork by stable ID', () => {
    const [cover] = catalogCategoryCovers([{ id: 'goals-2026', labelAr: 'من سجل الهدف؟' }]);
    expect(cover.cover.web320).toBe('assets/categories/generated/goals-2026.webp');
  });

  it('keeps existing mapped covers and requires every override asset to exist', () => {
    const ids = new Set(generated.categories.map(entry => entry.categoryId));
    expect(ids.size).toBe(generated.categories.length);
    for (const entry of generated.categories) expect(existsSync(`public/${entry.web320}`)).toBe(true);
    const original = categoryCatalog.filter(entry => !ids.has(entry.id));
    expect(catalogCategoryCovers(original.map(entry => ({ id: entry.id, labelAr: entry.displayNameAr })))).toEqual(original);
  });
});
