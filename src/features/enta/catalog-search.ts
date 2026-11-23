import {EntaClientError} from './client';
import {parseCatalogPage,parseCatalogCategory,type CatalogCategory,type CatalogPage} from './competition-catalog-page';
/** Reads the signed snapshot in order. A changed page never produces a misleading partial search result. */
export async function loadCategorySearchIndex(first:CatalogPage<CatalogCategory>,request:(cursor:string|null)=>Promise<unknown>,progress?:(loaded:number,total:number)=>void){
 const binding={gameId:first.scope.gameId,revision:first.revision,snapshot:first.snapshot};
 let page=first.offset===0?first:parseCatalogPage(await request(null),null,parseCatalogCategory,binding);
 if(page.total>10000)throw new EntaClientError('MALFORMED_RESPONSE');
 const rows:CatalogCategory[]=[],keys=new Set<string>(),cursors=new Set<string>();
 while(true){
  if(page.offset!==rows.length||page.total!==first.total)throw new EntaClientError('PAGE_SNAPSHOT_RESTART',409);
  for(const row of page.rows){if(keys.has(row.key))throw new EntaClientError('MALFORMED_RESPONSE');keys.add(row.key);rows.push(row);}
  progress?.(rows.length,page.total);if(page.complete)return rows;
  if(!page.nextCursor||cursors.has(page.nextCursor))throw new EntaClientError('MALFORMED_RESPONSE');cursors.add(page.nextCursor);
  page=parseCatalogPage(await request(page.nextCursor),null,parseCatalogCategory,binding);
 }
}
