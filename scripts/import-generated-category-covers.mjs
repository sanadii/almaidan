import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Explicit local import only: consumes generated receipts and never edits game data.
const root = path.resolve(import.meta.dirname, '..');
const auditPath = path.join(root, 'local/almaidan/category-cover-generation-audit-20261113.json');
const receiptFile = process.argv[2] === '--supplemental'
  ? 'category-alternative-supplemental-20261113.json'
  : 'category-generated-receipts-20261113.json';
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--supplemental')) throw Error('INVALID_IMPORT_ARGUMENT');
const receiptPath = path.join(root, 'local/almaidan', receiptFile);
const registryPath = path.join(root, 'src/data/generated-category-covers.public.json');
const archiveRoot = path.join(root, 'output/category-covers-20261113');
const assetRoot = path.join(root, 'public/assets/categories/generated-20261113');
const hash = data => createHash('sha256').update(data).digest('hex');
const audit = JSON.parse(await readFile(auditPath, 'utf8'));
const receipts = JSON.parse(await readFile(receiptPath, 'utf8'));
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
if (!Array.isArray(receipts) || audit.schemaVersion !== 1 || registry.schemaVersion !== 1) throw Error('INVALID_IMPORT_INPUT');
const candidates = new Map(audit.entries.filter(e => e.action.startsWith('generate_')).map(e => [e.id, e]));
const allowedRoots = [path.resolve(process.env.USERPROFILE, '.codex/generated_images'), path.join(root, 'local/almaidan/category-cover-generation-v1/source')];
const within = (file, dir) => { const relative = path.relative(dir, file); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const seen = new Set();
for (const receipt of receipts) {
  const candidate = candidates.get(receipt.id);
  if (!candidate || candidate.name !== receipt.name || !/^[a-z0-9-]+$/.test(receipt.id) || seen.has(receipt.id) || typeof receipt.source !== 'string') throw Error('INVALID_RECEIPT');
  if (receipt.reusedFromCategoryId && !receipts.some(other => other.id === receipt.reusedFromCategoryId && other.source === receipt.source)) throw Error('INVALID_REUSED_SOURCE');
  seen.add(receipt.id);
  const source = await realpath(receipt.source);
  if (!allowedRoots.some(dir => within(source, dir)) || path.extname(source).toLowerCase() !== '.png') throw Error('INVALID_SOURCE_PATH');
  const original = await readFile(source);
  const metadata = await sharp(original).metadata();
  if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw Error('INVALID_SOURCE_IMAGE');
  const buffers = await Promise.all([320, 640].map(size => sharp(original).resize(size, size, { fit: 'cover' }).webp({ quality: 86 }).toBuffer()));
  const archive = path.join(archiveRoot, 'source', `${receipt.id}.png`);
  const outputPaths = [320, 640].map(size => path.join(assetRoot, String(size), `${receipt.id}.webp`));
  for (const dir of [path.dirname(archive), ...outputPaths.map(p => path.dirname(p)), path.join(archiveRoot, 'metadata')]) await mkdir(dir, { recursive: true });
  async function writeIdenticalOrNew(file, data) {
    try { await writeFile(file, data, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || hash(await readFile(file)) !== hash(data)) throw error; }
  }
  await writeIdenticalOrNew(archive, original);
  for (let i = 0; i < outputPaths.length; i++) await writeIdenticalOrNew(outputPaths[i], buffers[i]);
  const provenance = { id: receipt.id, name: receipt.name, sourceFile: path.basename(source), sourceSha256: hash(original), prompt: receipt.prompt ?? null, generatedBy: 'image generation', ...(receipt.reusedFromCategoryId ? { reusedFromCategoryId: receipt.reusedFromCategoryId } : {}), outputs: Object.fromEntries([320, 640].map((size, i) => [size, { path: `assets/categories/generated-20261113/${size}/${receipt.id}.webp`, sha256: hash(buffers[i]) }])) };
  await writeIdenticalOrNew(path.join(archiveRoot, 'metadata', `${receipt.id}.json`), Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
  const web320 = provenance.outputs[320].path;
  const existing = registry.categories.find(entry => entry.categoryId === receipt.id);
  if (existing && existing.web320 !== web320) throw Error('REGISTRY_COLLISION');
  if (!existing) registry.categories.push({ categoryId: receipt.id, web320 });
}
registry.categories.sort((a, b) => a.categoryId.localeCompare(b.categoryId));
const temp = `${registryPath}.${process.pid}.tmp`;
await writeFile(temp, JSON.stringify(registry, null, 2) + '\n', { flag: 'wx' });
await rename(temp, registryPath);
console.log(`Imported ${receipts.length} generated category cover receipts.`);
