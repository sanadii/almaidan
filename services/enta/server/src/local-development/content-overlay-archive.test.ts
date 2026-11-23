import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveOverlayBytes} from './content-overlay-archive';
test('overlay archive publishes complete bytes once and validates existing immutable content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'almaidan-archive-')),bytes=JSON.stringify([{revision:'test-only'}]),revision=createHash('sha256').update(bytes).digest('hex'),target=join(directory,`${revision}.json`);
 try{assert.equal(await archiveOverlayBytes(directory,bytes),revision);assert.equal(await readFile(target,'utf8'),bytes);assert.equal(await archiveOverlayBytes(directory,bytes),revision);assert.deepEqual(await readdir(directory),[`${revision}.json`]);}finally{await unlink(target);await rmdir(directory);}
});
test('a pre-existing truncated archive is preserved and temporary candidate is removed',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'almaidan-archive-')),bytes='[{"complete":true}]',revision=createHash('sha256').update(bytes).digest('hex'),target=join(directory,`${revision}.json`);await writeFile(target,'[{',{flag:'wx'});
 try{await assert.rejects(archiveOverlayBytes(directory,bytes),/LOCAL_OVERLAY_ARCHIVE_INVALID/);assert.equal(await readFile(target,'utf8'),'[{');assert.deepEqual(await readdir(directory),[`${revision}.json`]);}finally{await unlink(target);await rmdir(directory);}
});
