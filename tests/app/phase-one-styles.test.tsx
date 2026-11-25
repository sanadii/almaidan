import { readFileSync } from 'node:fs';
import { parse, type Root } from 'postcss';
import { expect, it } from 'vitest';

function stylesheet(path: string) {
  return parse(readFileSync(path, 'utf8'), { from: path });
}

function declarations(sheet: Root, selector: string) {
  const properties: Record<string, string> = {};
  sheet.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(declaration => { properties[declaration.prop] = declaration.value; });
  });
  return properties;
}

const global = stylesheet('src/styles/global.css');
const khaliah = stylesheet('src/styles/khaliah.css');
const shared = stylesheet('src/styles/shared-app.css');
const publicShell = stylesheet('src/design-system/public-shell.css');
const layout = stylesheet('src/styles/page-layout.css');
const rooms = stylesheet('src/styles/rooms.css');
const imposter = stylesheet('src/features/imposter/imposter.css');
const tokens = stylesheet('design/tokens.css');

it('gives board layers a fill outside the arena, including both enclosure teams', () => {
  expect(declarations(global, '.game-board__cell-shell').fill).toBe('var(--spatial-face-muted)');
  expect(declarations(global, '.game-board__cell-side').fill).toBe('var(--spatial-board-shell)');
  expect(declarations(global, '.game-board__enclosure-section').fill).toBe('var(--arena-red)');
  expect(declarations(global, '.game-board__enclosure-section--vertical').fill).toBe('var(--arena-green)');
  expect(declarations(global, '.game-board__enclosure-groove').fill).toBe('none');
  expect(declarations(global, '.game-board-svg').fill).toBe('none');
  expect(declarations(global, '.game-board__cell-chamfer-highlight')).toMatchObject({
    fill: 'none', stroke: 'var(--arena-tile-highlight)',
  });
  expect(declarations(global, '.game-board__rail-depth').stroke).toBe('none');
  expect(declarations(global, '.game-board__rail-face').stroke).toBe('var(--arena-panel-deep)');
  for (const [axis, team] of [['horizontal', 'red'], ['vertical', 'green']]) {
    expect(declarations(global, `.game-board__rail--${axis} .game-board__rail-depth`).fill)
      .toBe(`var(--arena-${team}-deep)`);
    expect(declarations(global, `.game-board__rail--${axis} .game-board__rail-face`).fill)
      .toBe(`var(--board-tactile-${axis}-rail, var(--team-${axis}))`);
    expect(declarations(khaliah, `.game-board__cell-near-candidate-ring--${axis}`).stroke).toBeTruthy();
  }
  for (const layer of ['enclosure-groove', 'enclosure-outline', 'enclosure-rim-shadow', 'enclosure-rim',
    'enclosure-rim-groove', 'cell-near-candidate-ring', 'cell-award-sweep']) {
    expect(declarations(khaliah, `.game-board__${layer}`).fill).toBe('none');
  }
  expect(declarations(khaliah, '.game-board__ambient-cell-glint')).toMatchObject({ fill: expect.any(String), opacity: '0' });
});

it('keeps the audience out of both the product palette and the width cap', () => {
  for (const sheet of [shared, khaliah]) {
    sheet.walkDecls('--arena-ink', declaration => {
      const selector = declaration.parent && 'selector' in declaration.parent ? declaration.parent.selector : '';
      expect(selector === '.correction-dialog.app-confirm-dialog' || String(selector).includes('.game-arena--host')).toBe(true);
    });
  }
  expect(declarations(layout, 'html:has(main.spatial-stage.game-arena)')).toMatchObject({
    'background-color': 'var(--arena-canvas)',
    'scrollbar-gutter': 'auto',
  });
  layout.walkDecls('max-inline-size', declaration => {
    if (declaration.value !== 'var(--page-canvas-max)' || !declaration.parent || !('selector' in declaration.parent)) return;
    const selector = declaration.parent.selector;
    if (typeof selector === 'string' && selector.startsWith('main#main-content[data-page-layout="wide"]:not(')) {
      expect(selector).toContain(':not(:where(.spatial-stage.game-arena))');
    }
  });
});

it('uses the dark product palette for the lobby copy and QR controls', () => {
  expect(declarations(khaliah, 'html[data-theme="dark"] .spatial-shell--lobby .spatial-lobby :is(.copy-button, .lobby-join-qr__trigger)'))
    .toMatchObject({ background: 'var(--app-subtle)', color: 'var(--app-ink)', 'border-color': 'var(--app-border)' });
});

it('gives the host theme toggle the arena foreground and uses it for the border', () => {
  const toggle = '.game-arena--host .room-game-navigation .theme-toggle--compact';
  expect(declarations(khaliah, toggle).color).toBe('var(--arena-ink)');
  expect(declarations(khaliah, `${toggle} > summary`)).toMatchObject({ color: 'inherit', 'border-color': 'currentColor' });
});

it('changes both the background and text of the selected vote', () => {
  expect(declarations(imposter, '.imposter-votes button[aria-pressed="true"]'))
    .toMatchObject({ background: 'var(--app-action)', color: 'var(--app-on-action)' });
  expect(declarations(tokens, ':root')['--app-on-action']).toBe('var(--arena-ink)');
});

it('fills the horizontal host buzz chip with a red team surface and on-color ink', () => {
  expect(declarations(global, '.game-arena--host .host-controls .buzz-winner--horizontal'))
    .toMatchObject({ background: 'var(--semantic-team-red)', color: 'var(--semantic-team-on-color)' });
});

it('gives the Enta room code its own unbroken left-to-right line in the join heading', () => {
  expect(declarations(rooms, '.enta-join-code')).toMatchObject({
    display: 'block', 'white-space': 'nowrap', direction: 'ltr', 'unicode-bidi': 'isolate',
  });
});

it('lets the shared public footer wordmark occupy its intrinsic width without shrinking', () => {
  expect(declarations(publicShell, '.public-footer .brand-mark')).toMatchObject({ flex: 'none', 'inline-size': 'auto' });
});

it('defines the fixed-width font used by the room tools', () => {
  expect(declarations(tokens, ':root')['--font-mono']).toMatch(/\bmonospace\b/);
});

it('starts with an image-free body and keeps the gameplay image on stage surfaces', () => {
  expect(declarations(global, 'body')['background-image']).toBe('none');
  expect(declarations(global, '.stage')['background-image']).toBe('var(--gameplay-background-image)');
});

it('uses an interaction-only home glow and transitions named properties', () => {
  const card = 'html[data-theme] .maydan-home-page .maydan-showcase .maydan-game-card';
  expect(declarations(khaliah, '.maydan-game-card')).not.toHaveProperty('animation');
  expect(declarations(khaliah, '.maydan-button--primary')).not.toHaveProperty('animation');
  expect(declarations(khaliah, card)['box-shadow']).toBe('var(--shadow-compact)');
  expect(declarations(khaliah, `${card}:is(:hover, :has(:focus-visible))`)['box-shadow']).toBe('var(--shadow-interactive-glow)');
  for (const sheet of [khaliah, shared]) {
    sheet.walkDecls('transition', declaration => { expect(declaration.value).not.toMatch(/^all\b/); });
  }
});
