import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Explicit post-batch correction: only reviewed semantic mismatches may be revised.
const root = path.resolve(import.meta.dirname, '..');
const review = JSON.parse(await readFile(path.join(root, 'local/almaidan/category-cover-qa/unresolved-20261113.json'), 'utf8'));
const receipts = JSON.parse(await readFile(path.join(root, 'local/almaidan/category-cover-revisions-20261113.json'), 'utf8'));
const registryPath = path.join(root, 'src/data/generated-category-covers.public.json');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));
if (review.schemaVersion !== 1 || registry.schemaVersion !== 1 || !Array.isArray(receipts)) throw Error('INVALID_REVISION_INPUT');
const allowed = new Map(review.entries.filter(e => e.status === 'semantic_mismatch').map(e => [e.id, e]));
const allowedRoot = path.resolve(process.env.USERPROFILE, '.codex/generated_images');
const archiveRoot = path.join(root, 'output/category-covers-20261113');
const assetRoot = path.join(root, 'public/assets/categories/generated-20261113');
const digest = data => createHash('sha256').update(data).digest('hex');
const seen = new Set();
for (const receipt of receipts) {
  const item = allowed.get(receipt.id);
  if (!item || item.name !== receipt.name || !/^[a-z0-9-]+$/.test(receipt.id) || seen.has(receipt.id) || typeof receipt.source !== 'string' || typeof receipt.prompt !== 'string') throw Error('INVALID_REVISION_RECEIPT');
  seen.add(receipt.id);
  const source = await realpath(receipt.source), relative = path.relative(allowedRoot, source);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || path.extname(source).toLowerCase() !== '.png') throw Error('INVALID_SOURCE_PATH');
  const original = await readFile(source), meta = await sharp(original).metadata();
  if (meta.format !== 'png' || !meta.width || !meta.height) throw Error('INVALID_SOURCE_IMAGE');
  const revisedId = `${receipt.id}-r2`, outputs = await Promise.all([320, 640].map(size => sharp(original).resize(size, size, { fit:'cover' }).webp({ quality:86 }).toBuffer()));
  const paths = [path.join(archiveRoot, 'source', `${revisedId}.png`), ...[320, 640].map(size => path.join(assetRoot, String(size), `${revisedId}.webp`))];
  const values = [original, ...outputs];
  const entry = registry.categories.find(e => e.categoryId === receipt.id);
  const prior = `assets/categories/generated-20261113/320/${receipt.id}.webp`, next = `assets/categories/generated-20261113/320/${revisedId}.webp`;
  if (!entry || ![prior, next].includes(entry.web320)) throw Error('REGISTRY_COLLISION');
  async function writeIdenticalOrNew(file, bytes) { await mkdir(path.dirname(file), { recursive:true }); try { await writeFile(file, bytes, { flag:'wx' }); } catch (error) { if (error.code !== 'EEXIST' || digest(await readFile(file)) !== digest(bytes)) throw error; } }
  for (let i = 0; i < paths.length; i++) await writeIdenticalOrNew(paths[i], values[i]);
  const provenance = { id:receipt.id, revision:2, name:receipt.name, reason:item.reason, sourceFile:path.basename(source), sourceSha256:digest(original), prompt:receipt.prompt, ...(receipt.mappingBasis ? { mappingBasis: receipt.mappingBasis, mappingEvidence: receipt.mappingEvidence } : {}), priorPath:prior, outputs:Object.fromEntries([320,640].map((size,i)=>[size,{path:`assets/categories/generated-20261113/${size}/${revisedId}.webp`,sha256:digest(outputs[i])}])) };
  await writeIdenticalOrNew(path.join(archiveRoot, 'metadata', `${revisedId}.json`), Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
  entry.web320 = next;
}
const temp = `${registryPath}.${process.pid}.tmp`;
await writeFile(temp, JSON.stringify(registry, null, 2) + '\n', { flag:'wx' });
await rename(temp, registryPath);
console.log(`Imported ${receipts.length} reviewed cover revisions.`);
