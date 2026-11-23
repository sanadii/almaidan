import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Offline extraction only: never imports a provider SDK or a production publisher.
const sourcePath=resolve('D:/projects/huroof_wa_oloof/output/t44-current-question-compare-20261002/CAPTURE-v4.json');
const destination=resolve('D:/projects/huroof_wa_oloof/local/almaidan/real-content.json');
const bytes=await readFile(sourcePath),sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a')throw Error('SAVED_CAPTURE_HASH_MISMATCH');
const capture=JSON.parse(bytes.toString('utf8'));
const rows=kind=>capture.children.filter(row=>row.path.split('/')[2]===kind).map(row=>row.data);
const categories=rows('catalogCategories'),questions=rows('questions'),media=rows('media');
if(categories.length!==530||questions.length!==115636||media.length!==4578||capture.pointer.data.demoFixture!==false)throw Error('SAVED_CAPTURE_COUNTS_MISMATCH');
for(const records of [categories,questions])if(new Set(records.map(row=>row.id)).size!==records.length)throw Error('DUPLICATE_SOURCE_ID');
const catalogIds=new Set(categories.map(row=>row.id));if(questions.some(row=>!catalogIds.has(row.categoryId)))throw Error('UNKNOWN_SOURCE_CATEGORY');
const content={schemaVersion:1,source:{path:sourcePath,sha256,capturedAt:capture.capturedAt,releaseId:capture.pointer.data.releaseId,documentRootSha256:capture.pointer.data.documentRootSha256},categories,questions,media};
await mkdir(resolve(destination,'..'),{recursive:true});
const encoded=JSON.stringify(content);
try{await writeFile(destination,encoded,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await readFile(destination,'utf8')!==encoded)throw error;}
console.log(JSON.stringify({destination,categories:categories.length,questions:questions.length,media:media.length,sourceSha256:sha256}));
