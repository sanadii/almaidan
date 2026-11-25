import { readFileSync } from 'node:fs';
import { parse, type Root } from 'postcss';
import { expect, it } from 'vitest';

const style = (path: string) => parse(readFileSync(path, 'utf8'), { from: path });
const shared = style('src/styles/shared-app.css');
const global = style('src/styles/global.css');
const khaliah = style('src/styles/khaliah.css');
const enta = style('src/styles/enta.css');
const rooms = style('src/styles/rooms.css');
const imposter = style('src/features/imposter/imposter.css');
const tokens = style('design/tokens.css');

function values(sheet: Root, selector: string) {
  const result: Record<string, string> = {};
  sheet.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

it('defines the shared control sizes and keeps game-board tile geometry', () => {
  expect(values(shared, '.button')).toMatchObject({
    'min-block-size': '3rem',
    'border-radius': 'var(--spatial-radius-control)',
    font: expect.stringContaining('var(--weight-bold)'),
    cursor: 'pointer',
  });
  expect(values(shared, '.button--lg')['min-block-size']).toBe('3.5rem');
  expect(values(shared, '.button--primary').background).toBe('var(--app-action)');
  expect(values(shared, '.button--secondary').background).toBe('var(--app-surface)');
  expect(values(shared, '.button--quiet').background).toBe('transparent');
  expect(values(enta, '.enta-page .enta-board .enta-tile')['min-block-size']).toBe('4rem');
  expect(values(enta, '.enta-page .enta-board .enta-tile')['box-shadow']).toBe('var(--arena-plate-shadow)');
  expect(values(khaliah, '.maydan-button--primary')).toEqual({});
});

function luminance(hex: string) {
  const rgb = [...hex.matchAll(/[a-f\d]{2}/gi)].map(([channel]) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}

it('uses one focus token with at least 3:1 contrast on product surfaces and the stage', () => {
  const light = values(tokens, ':root');
  const dark = values(tokens, ':root[data-theme="dark"]');
  expect(values(shared, ':root')['--focus-ring-color']).toBe('var(--app-accent)');
  expect(values(shared, ':is(.game-arena:not(.game-arena--host), .enta-room-display, .maydan-final)')['--focus-ring-color'])
    .toBe('var(--arena-line)');
  for (const [foreground, background] of [
    [light['--app-accent'], light['--app-surface']],
    [dark['--app-accent'], dark['--app-surface']],
    [light['--arena-line'], light['--arena-panel']],
  ]) {
    const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    expect((levels[0] + .05) / (levels[1] + .05)).toBeGreaterThanOrEqual(3);
  }
});

it('provides 44 px summary and checkbox-label targets', () => {
  expect(values(shared, ':where(.maydan-app, .maydan-home-page, .spatial-shell, .game-arena) summary')['min-block-size'])
    .toBe('2.75rem');
  expect(values(imposter, '.imposter-category-grid label')['min-block-size']).toBe('2.75rem');
});

it('sizes the Huroof board by available height and keeps host score labels at 12 px', () => {
  const compact = khaliah.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params.includes('max-height: 899px'));
  expect(compact?.toString()).toContain('--arena-board-size: min(100%, max(15rem, calc(100svh - 22rem)), 40rem)');
  expect(values(global, '.game-arena--host .host-score :is(.team-score__rounds > small, .team-score__points-label)')['font-size'])
    .toBe('var(--text-xs)');
  expect(values(tokens, ':root')['--text-xs']).toBe('0.75rem');
});

it('shares the heading and supporting text weights', () => {
  expect(values(shared, ':where(.maydan-app, .maydan-home-page, .spatial-shell, .game-arena, .challenge-frame) :is(h1, h2)')['font-weight'])
    .toBe('var(--weight-bold)');
  expect(values(shared, ':where(.maydan-app, .spatial-shell) :is(.field-note, .form-message, .setup-kind-selector small, .setup-summary dd, .enta-summary-note, .enta-summary-hint, .imposter-muted)')['font-weight'])
    .toBe('var(--weight-regular)');
});

it('gives the Enta display the TV text floors without changing phone timer scale', () => {
  expect(values(rooms, '.enta-page.enta-room-display .enta-question .enta-timer')['font-size']).toMatch(/^clamp\(48px,/);
  expect(values(rooms, '.enta-room-display .enta-scores > li > :is(span, strong)')['font-size']).toMatch(/^clamp\(28px,/);
  expect(values(rooms, '.enta-room-display .enta-display-lobby .enta-room-names')['font-size']).toMatch(/^max\(24px,/);
  expect(values(rooms, '.enta-page .enta-room-play .enta-timer')['font-size']).toBe('var(--text-2xl)');
});
