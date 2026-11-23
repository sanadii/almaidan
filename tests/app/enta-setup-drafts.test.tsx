import {act,renderHook} from '@testing-library/react';
import {beforeEach,describe,expect,it} from 'vitest';
import {useSetupDraft} from '../../src/features/enta/use-setup-draft';
import {categoryMatches,validSelectedCategories,validQuestionSeconds,validTurnSeconds,validOverallSeconds} from '../../src/features/enta/setup-options';
import {loadCategorySearchIndex} from '../../src/features/enta/catalog-search';
import type {CatalogPage,CatalogCategory} from '../../src/features/enta/competition-catalog-page';
beforeEach(()=>sessionStorage.clear());
describe('full setup drafts',()=>{
 it('restores categories with prompt selections and timing across remount, isolates owner and drawing mode',()=>{
  const useDraft=(scope:string)=>({categories:useSetupDraft(`${scope}:categories`,[] as {key:string;promptRefs:string[]}[],validSelectedCategories),question:useSetupDraft(`${scope}:questionSeconds`,30,validQuestionSeconds),turn:useSetupDraft<15|30|45>(`${scope}:turnSeconds`,30,validTurnSeconds),overall:useSetupDraft<null|300|600>(`${scope}:overallSeconds`,null,validOverallSeconds)});
  const first=renderHook(()=>useDraft('owner:round:MIXED_BOARD'));act(()=>{first.result.current.categories[1]([{key:'local-list',promptRefs:['prompt-1']}]);first.result.current.question[1](60);first.result.current.turn[1](45);first.result.current.overall[1](600);});first.unmount();
  const resumed=renderHook(()=>useDraft('owner:round:MIXED_BOARD'));expect(resumed.result.current.categories[0]).toEqual([{key:'local-list',promptRefs:['prompt-1']}]);expect(resumed.result.current.question[0]).toBe(60);expect(resumed.result.current.turn[0]).toBe(45);expect(resumed.result.current.overall[0]).toBe(600);
  expect(renderHook(()=>useDraft('other:round:MIXED_BOARD')).result.current.categories[0]).toEqual([]);expect(renderHook(()=>useDraft('owner:round:drawing')).result.current.question[0]).toBe(30);
 });
 it('rejects malformed categories and unsupported saved timing values',()=>{
  sessionStorage.setItem('almaidan:setup:categories',JSON.stringify([{key:'bad',promptRefs:null}]));sessionStorage.setItem('almaidan:setup:turn','999');sessionStorage.setItem('almaidan:setup:overall','-1');
  expect(renderHook(()=>useSetupDraft('categories',[],validSelectedCategories)).result.current[0]).toEqual([]);expect(renderHook(()=>useSetupDraft('turn',30,validTurnSeconds)).result.current[0]).toBe(30);expect(renderHook(()=>useSetupDraft('overall',null,validOverallSeconds)).result.current[0]).toBeNull();
 });
 it('matches Arabic without diacritics and does not invent unavailable categories',()=>{expect(categoryMatches({key:'history',label:'التّاريخ الإسلامي'},'التاريخ الاسلامي')).toBe(true);expect(categoryMatches({key:'science',label:'علوم'},'رياضة')).toBe(false);});
});
function page(offset:number):CatalogPage<CatalogCategory>{return {scope:{gameId:'catalog-test',collection:'catalog-categories',roundId:null,effectId:null,purpose:'OWNER'},revision:'a'.repeat(64),snapshot:'b'.repeat(64),total:34,returned:Math.min(32,34-offset),offset,nextCursor:offset===0?'cursor.signature':null,complete:offset!==0,rows:Array.from({length:Math.min(32,34-offset)},(_,i)=>({key:`category-${offset+i}`,label:offset+i===33?'التاريخ الإسلامي':`فئة ${offset+i}`,format:'ORDINARY_TIER',prompts:[],cover:null}))};}
describe('catalogue-wide search',()=>{
 it('finds a category beyond the first signed page',async()=>{const requests:(string|null)[]=[];const rows=await loadCategorySearchIndex(page(0),async cursor=>{requests.push(cursor);return page(32);});expect(rows).toHaveLength(34);expect(rows.filter(c=>categoryMatches(c,'التاريخ'))[0].key).toBe('category-33');expect(requests).toEqual(['cursor.signature']);});
 it('rejects mixed snapshots rather than showing partial search results',async()=>{await expect(loadCategorySearchIndex(page(0),async()=>({...page(32),revision:'c'.repeat(64)}))).rejects.toThrow();});
});
