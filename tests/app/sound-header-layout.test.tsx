import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { expect, it } from 'vitest';

it('reserves a 12px gap after the brand and keeps 44px header targets on phones', () => {
  const css = parse(readFileSync('src/design-system/sound-toggle.css', 'utf8'));
  const tokens = readFileSync('design/tokens.css', 'utf8');
  const phone = css.nodes.find(rule => rule.type === 'atrule' && rule.name === 'media' && rule.params === '(max-width: 30rem)');
  const narrow = css.nodes.find(rule => rule.type === 'atrule' && rule.name === 'media' && rule.params === '(max-width: 25rem)');

  expect(tokens).toMatch(/--space-3:\s*0\.75rem;/);
  expect(phone?.toString()).toMatch(/:not\(\.app-header--game-context\)\s*\{[^}]*grid-template-columns:\s*minmax\(max-content,\s*1fr\) auto auto;[^}]*column-gap:\s*var\(--space-3\)/);
  expect(phone?.toString()).toMatch(/\.app-header__utilities\s*\{[^}]*gap:\s*var\(--space-1\)/);
  expect(phone?.toString()).toMatch(/\.app-header__menu-toggle\s*\{[^}]*min-inline-size:\s*44px;[^}]*padding-inline:\s*var\(--space-2\)/);
  expect(narrow?.toString()).toMatch(/\.brand-mark__word\s*\{\s*display:\s*none/);
  expect(narrow?.toString()).toMatch(/\.wordmark\s*\{\s*min-inline-size:\s*44px/);
});
