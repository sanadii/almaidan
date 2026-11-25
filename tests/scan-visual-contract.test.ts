import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { scanVisualContract } from '../scripts/scan-visual-contract.js';

const fixture = (name: string) => resolve('tests/fixtures/visual-contract', name);

test('visual scanner allows the scoped QR colors and designated semantic tokens', async () => {
  assert.deepEqual(await scanVisualContract(fixture('positive')), []);
});

test('visual scanner rejects raw CSS gradients', async () => {
  assert.match((await scanVisualContract(fixture('raw-gradient'))).join('\n'), /gradient/);
});

test('visual scanner rejects the QR color pair outside its one encoder call', async () => {
  const violations = await scanVisualContract(fixture('non-qr-colors'));
  assert.equal(violations.length, 2);
  assert.ok(violations.every(violation => /#\[0-9a-f\]/.test(violation)));
});

test('visual scanner rejects raw dimensions for component radii and shadows', async () => {
  assert.deepEqual(await scanVisualContract(fixture('raw-shape')), [
    'src/styles.css: non-tokenized border radius',
    'src/styles.css: non-tokenized box-shadow',
  ]);
});

test('visual scanner checks CSS variable fallbacks for literal colors', async () => {
  assert.match((await scanVisualContract(fixture('raw-fallback'))).join('\n'), /#\[0-9a-f\]/);
});

test('visual scanner checks compound and template literals in JSX styles', async () => {
  const violations = (await scanVisualContract(fixture('raw-style'))).join('\n');
  assert.match(violations, /#\[0-9a-f\]/);
  assert.match(violations, /gold/);
});

test('visual scanner rejects raw custom-property palette declarations in src', async () => {
  assert.match((await scanVisualContract(fixture('raw-palette'))).join('\n'), /#\[0-9a-f\]/);
});

