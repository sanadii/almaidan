import {writeFile,rename} from 'node:fs/promises';
import {archiveOverlayBytes} from './content-overlay-archive';
import {createHash,randomUUID} from 'node:crypto';
import {assertLocalDevelopment} from './guard';
import {originalRealContent,applyLocalContentOverlays} from './real-content';
import {validateContentDraft,type ContentOverlay} from './content-admin-store';
export const localOverlaySnapshotPath='D:/projects/huroof_wa_oloof/local/almaidan/content-overlays.json';
export async function publishContentOverlays(overlays:ContentOverlay[]){
 assertLocalDevelopment();for(const row of overlays)validateContentDraft(row.entity,row.entityId,row.payload);
 const body={schemaVersion:1,sourceSha256:originalRealContent().source.sha256,revision:createHash('sha256').update(JSON.stringify(overlays)).digest('hex'),overlays};
 await archiveContentOverlays(overlays);
 const temporary=`${localOverlaySnapshotPath}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(body),{flag:'wx',mode:0o600});await rename(temporary,localOverlaySnapshotPath);
 applyLocalContentOverlays(overlays);return body.revision;
}

/** Immutable archive shared with Huroof; does not change any active content head. */
export async function archiveContentOverlays(overlays:ContentOverlay[]){
 assertLocalDevelopment();for(const row of overlays)validateContentDraft(row.entity,row.entityId,row.payload);
 if(!overlays.length)return createHash('sha256').update('[]').digest('hex');
 return archiveOverlayBytes('D:/projects/huroof_wa_oloof/local/almaidan/overlay-history',JSON.stringify(overlays));
}
