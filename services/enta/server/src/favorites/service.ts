import type {Principal} from '../identity';
import {contextValue} from '../history-rematch/core';
import {authenticate,advance,anchor,compareAnchor,issue,requireActiveKey,type Anchor,type CursorContext,type Keyring} from './cursor';
export type FavoriteOwner=CursorContext;
export type FavoriteRecord={associationId:string;categoryKey:string;createdAt:string};
export interface FavoriteMetadata {label:string|null;available:boolean}
export interface FavoritesRepository {
 /** Atomic owner-scoped snapshot. Implementations must prove upper/before are owned, extant anchors in that same snapshot. */
 page(owner:FavoriteOwner,window:{limit:number;upper:Anchor|null;before:Anchor|null}):Promise<{rows:FavoriteRecord[];upper:Anchor|null;anchorsValid:boolean;hasMore:boolean}>;
 /** Atomic receipt and mutation, including current approved discoverability check on first PUT. Replays return the original receipt even after retirement. Must bind operationId to owner, key and action, reject conflicting reuse, and never consult Wallet or Game locks. */
 mutate(owner:FavoriteOwner,categoryKey:string,wanted:boolean,operationId:string):Promise<{active:boolean}>;
}
/** Only approved public labels; null means no permitted label exists. */
export interface FavoriteRegistry {metadata(categoryKey:string):Promise<FavoriteMetadata|null>}
export class FavoritesError extends Error {constructor(readonly status:number,readonly code:string){super(code)}}
const fail=(status:number,code:string):never=>{throw new FavoritesError(status,code)};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const categoryKeyValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value);
const filters={mode:null,format:null,rules:null,status:null} as const;
function owner(p:Principal,namespaceId:string,projectId:string):FavoriteOwner {if(!p||p.projectId!==projectId||p.anonymous||!p.verifiedAccount)return fail(403,'VERIFIED_ACCOUNT_REQUIRED');contextValue(p.uid);return {namespaceId,projectId,uid:p.uid};}
const recAnchor=(row:FavoriteRecord):Anchor=>anchor({createdAt:row.createdAt,id:row.associationId});
export function createFavoritesService(namespaceId:string,projectId:string,repository:FavoritesRepository,registry:FavoriteRegistry,keys:Keyring|null,now:()=>number){
 contextValue(namespaceId);contextValue(projectId);if(typeof repository?.page!=='function'||typeof repository?.mutate!=='function'||typeof registry?.metadata!=='function'||typeof now!=='function')throw Error('FAVORITES_COMPOSITION_INVALID');
 return {
  async list(p:Principal,query:{limit:number;cursor:string|null}){
   const who=owner(p,namespaceId,projectId),at=now();if(!Number.isInteger(query.limit)||query.limit<1||query.limit>50||(query.cursor!==null&&typeof query.cursor!=='string'))return fail(400,'INVALID_FAVORITES_QUERY');
   requireActiveKey(keys,at);const cursor=query.cursor===null?null:authenticate(query.cursor,who,keys,at,filters,query.limit);const data=await repository.page(who,{limit:query.limit,upper:cursor?.upper??null,before:cursor?.before??null});
   const finished=now();requireActiveKey(keys,finished);if(cursor)authenticate(query.cursor,who,keys,finished,filters,query.limit);
   if(!data||!Array.isArray(data.rows)||data.rows.length>query.limit||typeof data.anchorsValid!=='boolean'||typeof data.hasMore!=='boolean'||(data.hasMore&&data.rows.length!==query.limit))return fail(503,'FAVORITES_UNAVAILABLE');if(!data.anchorsValid)return fail(cursor?400:503,cursor?'INVALID_CURSOR':'FAVORITES_UNAVAILABLE');
   const upper=data.upper===null?null:anchor(data.upper);if(cursor&&(!upper||compareAnchor(upper,cursor.upper)!==0))return fail(400,'INVALID_CURSOR');let previous=cursor?.before??null;const seen=new Set<string>(),seenCategories=new Set<string>();
   const records=data.rows.map(row=>{if(!row||Object.keys(row).sort().join(',')!=='associationId,categoryKey,createdAt'||!id(row.associationId)||!categoryKeyValid(row.categoryKey)||seen.has(row.associationId)||seenCategories.has(row.categoryKey))return fail(503,'FAVORITES_UNAVAILABLE');const a=recAnchor(row);if(!upper||compareAnchor(a,upper)>0||(previous&&compareAnchor(a,previous)>=0))return fail(503,'FAVORITES_UNAVAILABLE');seen.add(row.associationId);seenCategories.add(row.categoryKey);previous=a;return row;});
   const favorites=await Promise.all(records.map(async r=>{const m=await registry.metadata(r.categoryKey);if(m!==null&&(!m||typeof m.available!=='boolean'||!(m.label===null||typeof m.label==='string'&&m.label.trim().length>0&&m.label.length<=160&&!/[<>\p{Cc}\p{Cf}]/u.test(m.label))))return fail(503,'FAVORITES_UNAVAILABLE');return {categoryKey:r.categoryKey,label:m?.label??'فئة غير متاحة',available:m?.label?m.available:false,createdAt:r.createdAt};}));
   const end=now();requireActiveKey(keys,end);if(cursor)authenticate(query.cursor,who,keys,end,filters,query.limit);let nextCursor:string|null=null;if(data.hasMore){if(!upper||!previous)return fail(503,'FAVORITES_UNAVAILABLE');nextCursor=cursor?advance(cursor,previous,who,keys,end):issue(who,keys,end,filters,query.limit,upper,previous);}return {favorites,nextCursor};
  },
  async set(p:Principal,categoryKey:unknown,wanted:boolean,operationId:unknown){const who=owner(p,namespaceId,projectId);if(!categoryKeyValid(categoryKey)||!id(operationId)||typeof wanted!=='boolean')return fail(400,'INVALID_FAVORITE');const result=await repository.mutate(who,categoryKey,wanted,operationId);if(!result||typeof result.active!=='boolean'||Object.keys(result).join(',')!=='active'||result.active!==wanted)return fail(503,'FAVORITES_UNAVAILABLE');return {categoryKey,active:result.active,operationId};},
 };
}
export type FavoritesService=ReturnType<typeof createFavoritesService>;