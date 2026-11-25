import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceDisabledCategories, setCategoryDisabledInMemory } from './category-availability';
import { localCompetitionCatalogue } from './competition-catalogue';
import { publicSetupCatalogue } from './setup-catalogue';

test('public setup catalogues only expose selectable category metadata for each mode', () => {
  const modes = ['classic', 'kids', 'roundList', 'roundActing', 'roundMixed', 'drawing', 'competitiveTier', 'competitiveList', 'competitiveActing', 'competitiveMixed'];
  for (const mode of modes) {
    const catalogue = publicSetupCatalogue(mode);
    assert.ok(catalogue?.categories.length, mode);
    for (const category of catalogue.categories) {
      const keys = mode === 'classic' || mode === 'kids' ? ['key', 'label'] : ['key', 'label', 'format'];
      assert.deepEqual(Object.keys(category), keys, mode);
    }
  }
  assert.equal(publicSetupCatalogue('constructor'), null);
  assert.deepEqual(new Set(publicSetupCatalogue('drawing')!.categories.map(category => 'format' in category && category.format)), new Set(['DRAWING_TARGET']));
});

test('disabling a category removes it from both public and owner catalogue sources', () => {
  const classic = publicSetupCatalogue('classic')!.categories[0].key;
  const kids = publicSetupCatalogue('kids')!.categories[0].key;
  assert.ok(publicSetupCatalogue('roundList')!.categories.some(category => category.key === 'local-list'));
  try {
    for (const key of [classic, kids, 'local-list']) setCategoryDisabledInMemory(key, true);
    assert.ok(!publicSetupCatalogue('classic')!.categories.some(category => category.key === classic));
    assert.ok(!publicSetupCatalogue('kids')!.categories.some(category => category.key === kids));
    for (const mode of ['roundList', 'roundMixed', 'competitiveList', 'competitiveMixed']) {
      assert.ok(!publicSetupCatalogue(mode)!.categories.some(category => category.key === 'local-list'));
    }
    assert.ok(!localCompetitionCatalogue().base.categories.some(category => category.key === 'local-list'));
    setCategoryDisabledInMemory('local-list', false);
    assert.ok(publicSetupCatalogue('roundList')!.categories.some(category => category.key === 'local-list'));
  } finally { replaceDisabledCategories([]); }
});
