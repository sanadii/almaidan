import {CURRENT_CATEGORY_PROJECTION,canonicalCategoryId} from './category-projection';
import {randomUUID} from 'node:crypto';
import {createFavoritesService,FavoritesError,type FavoriteOwner,type FavoriteRecord,type FavoriteRegistry,type FavoritesRepository} from '../favorites/service';
import type {Keyring} from '../favorites/cursor';
import {currentLocalCategories} from './catalogue';
import {currentSupplement} from './supplement-overlay';
import {kidsCategories} from './content-pack';
import {originalRealContent,realContentEnabled} from './real-content';
import {LOCAL_PROJECT} from './guard';
import type {LocalStore} from './store';

const keyFor=(kind:'saved'|'authored-v1',id:string)=>`local.${kind}:${id}`;
const valid=(v:string)=>/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(v);
const safe=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=160&&!/[<>\p{Cc}\p{Cf}]/u.test(v);
/** Local immutable source identity, independent of a category revision or game engine. */
export function localFavoriteCatalog(){
 const originalSaved=realContentEnabled()?originalRealContent().categories:[];
 const saved=new Map(originalSaved.map(c=>[keyFor('saved',c.id),c]));
 const authored=new Map(kidsCategories.map(c=>[keyFor('authored-v1',c.key),c]));
 const liveSaved=new Map(realContentEnabled()?currentLocalCategories().map(c=>[keyFor('saved',c.key),c]):[]);
 // Verify/retain the original association key before resolving public metadata.
 const liveFor=(key:string)=>{if(!saved.has(key))return liveSaved.get(key);const id=key.slice('local.saved:'.length);return liveSaved.get(keyFor('saved',canonicalCategoryId(id,CURRENT_CATEGORY_PROJECTION)));};
 const liveAuthored=new Map(currentSupplement().kids.map(c=>[keyFor('authored-v1',c.key),c]));
 return {
  keyFor(categoryId:string,kind:'saved'|'authored-v1'){const key=keyFor(kind,categoryId);return valid(key)&&(kind==='saved'?liveSaved:liveAuthored).has(key)?key:null;},
  known(key:string){return valid(key)&&(saved.has(key)||authored.has(key));},
  eligible(key:string){return valid(key)&&(!!liveFor(key)||liveAuthored.has(key));},
  async metadata(key:string){const live=liveFor(key)??liveAuthored.get(key),original=saved.get(key)??authored.get(key);if(!original)return null;const label=live?.label??original.labelAr??original.label;return {label:safe(label)?label:null,available:!!live&&safe(label)};},
 };
}
type Receipt={categoryKey:string;wanted:boolean;active:boolean};
export function localFavoritesRepository(store:LocalStore,catalog:()=>ReturnType<typeof localFavoriteCatalog>,clock:()=>number):FavoritesRepository {
 return {
  async page(owner:FavoriteOwner,window){return store.transaction(owner.uid,async state=>{const rows=(state.favoriteCategories??[]).slice().sort((a,b)=>a.createdAt===b.createdAt?(a.associationId===b.associationId?0:a.associationId>b.associationId?-1:1):(a.createdAt>b.createdAt?-1:1));const equal=(a:{createdAt:string;id:string}|null)=>!a||rows.some(r=>r.createdAt===a.createdAt&&r.associationId===a.id);const anchorsValid=equal(window.upper)&&equal(window.before);const upper=window.upper??(rows[0]?{createdAt:rows[0].createdAt,id:rows[0].associationId}:null);const before=window.before;const selected=rows.filter(r=>(!upper||r.createdAt<upper.createdAt||r.createdAt===upper.createdAt&&r.associationId<=upper.id)&&(!before||r.createdAt<before.createdAt||r.createdAt===before.createdAt&&r.associationId<before.id));return {rows:structuredClone(selected.slice(0,window.limit)),upper,anchorsValid,hasMore:selected.length>window.limit};});},
  async mutate(owner:FavoriteOwner,categoryKey:string,wanted:boolean,operationId:string){return store.transaction(owner.uid,async state=>{const receipts=state.favoriteReceipts??{},old=Object.hasOwn(receipts,operationId)?receipts[operationId] as Receipt:undefined;if(old){if(old.categoryKey!==categoryKey||old.wanted!==wanted)throw new FavoritesError(409,'FAVORITE_OPERATION_CONFLICT');return {active:old.active};}const rows=state.favoriteCategories??[],existing=rows.find(r=>r.categoryKey===categoryKey);if(wanted&&!catalog().eligible(categoryKey))throw new FavoritesError(404,'CATEGORY_UNAVAILABLE');if(!wanted&&!existing&&!catalog().known(categoryKey))throw new FavoritesError(404,'CATEGORY_UNAVAILABLE');if(wanted&&!existing){if(rows.length>=1000)throw new FavoritesError(409,'FAVORITES_LIMIT');const value=clock();if(!Number.isSafeInteger(value)||value<0)throw Error('CLOCK_UNAVAILABLE');state.favoriteCategories=[...rows,{associationId:randomUUID(),categoryKey,createdAt:new Date(value).toISOString()}];}else if(!wanted&&existing)state.favoriteCategories=rows.filter(r=>r.categoryKey!==categoryKey);Object.defineProperty(receipts,operationId,{value:{categoryKey,wanted,active:wanted},writable:true,configurable:true,enumerable:true});state.favoriteReceipts=receipts;return {active:wanted};});},
 };
}
export function createLocalFavorites(store:LocalStore,keys:Keyring,clock:()=>number){const registry:FavoriteRegistry={metadata:key=>localFavoriteCatalog().metadata(key)};return createFavoritesService('local-almaidan',LOCAL_PROJECT,localFavoritesRepository(store,localFavoriteCatalog,clock),registry,keys,clock);}
