import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Local visual-review aid: create an indexed sheet from already imported covers.
const root = path.resolve(import.meta.dirname, '..');
const start = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 30);
if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 1 || count > 30) throw Error('INVALID_REVIEW_RANGE');
const receipts = JSON.parse(await readFile(path.join(root, 'local/almaidan/category-generated-receipts-20261113.json'), 'utf8'));
const batch = receipts.slice(start, start + count);
if (batch.length !== count) throw Error('INCOMPLETE_REVIEW_BATCH');
const width = 200, height = 230, cols = 5, rows = Math.ceil(count / cols);
const composite = [];
for (let i = 0; i < batch.length; i++) {
  const entry = batch[i];
  if (!/^[a-z0-9-]+$/.test(entry.id)) throw Error('INVALID_ID');
  const left = (i % cols) * width, top = Math.floor(i / cols) * height;
  const image = await sharp(path.join(root, 'public/assets/categories/generated-20261113/320', `${entry.id}.webp`)).resize(width, width).png().toBuffer();
  composite.push({ input: image, left, top });
  const label = Buffer.from(`<svg width="200" height="30"><rect width="200" height="30" fill="white"/><text x="8" y="21" font-family="sans-serif" font-size="15" fill="#14213d">${entry.id}</text></svg>`);
  composite.push({ input: label, left, top: top + width });
}
const dir = path.join(root, 'local/almaidan/category-cover-qa');
await mkdir(dir, { recursive: true });
const label = `${String(start + 1).padStart(4, '0')}-${String(start + count).padStart(4, '0')}`;
const out = await sharp({ create: { width: cols * width, height: rows * height, channels: 3, background: '#fff' } }).composite(composite).png().toBuffer();
await writeFile(path.join(dir, `sheet-${label}.png`), out, { flag: 'wx' });
await writeFile(path.join(dir, `sheet-${label}.json`), JSON.stringify(batch.map(({ id, name }) => ({ id, name })), null, 2) + '\n', { flag: 'wx' });
console.log(`Created review sheet ${label} for ${count} imported covers.`);
