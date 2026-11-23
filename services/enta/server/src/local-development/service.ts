import {CURRENT_CATEGORY_PROJECTION,canonicalCategoryId} from './category-projection';
import {retainedClassicCatalogue} from './retained-classic-catalogue';
import {localFavoriteCatalog} from './favorites';
import { createHash, randomUUID } from 'node:crypto';
import type { Principal } from '../identity';
import { authorizeMatch, authorizeCommandChildren, parseStartCommand, parseMatchCommand, reduceMatchCommand, parseSetupName, foldSetupName } from '../gameplay/service';
import { parseSuccessor, parseHistoryQuery } from '../gameplay/successor';
import { projectMatch } from '../gameplay/projection';
import { fail, type EntaMode, type MatchRecord, type HistoryRow } from '../gameplay/types';
import {currentSupplement} from './supplement-overlay';
import { currentLocalCategories } from './catalogue';
import {realContentEnabled,realContent,selectLocalQuestions,realCategories} from './real-content';
import { LOCAL_PROJECT } from './guard';
import type { LocalStore, OwnerState } from './store';

const hash = (input:unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const own = <T>(record:Record<string,T>, key:string):T|undefined => Object.hasOwn(record,key) ? record[key] : undefined;
const put = <T>(record:Record<string,T>, key:string, value:T):void => { Object.defineProperty(record,key,{value,writable:true,enumerable:true,configurable:true}); };
function verified(p:Principal) { if (p.projectId !== LOCAL_PROJECT || !p.uid || !p.verifiedAccount || p.anonymous || !p.email) fail(403,'VERIFIED_ACCOUNT_REQUIRED'); }
function gameFor(state:OwnerState,p:Principal,id:string):MatchRecord { const game=own(state.matches,id) ?? null; authorizeMatch(game,p); return game; }
export function createLocalEntaService(store:LocalStore) {
  async function start(p:Principal,input:unknown,mode:EntaMode,predecessorId?:string) {
    verified(p);
    return store.transaction(p.uid,async state => {
      const predecessor=predecessorId ? gameFor(state,p,predecessorId) : undefined;
      if (predecessor) { mode=predecessor.mode!; if(predecessor.phase!=='FINISHED') fail(409,'PREDECESSOR_NOT_FINISHED'); }
      const parsed=mode==='CLASSIC' && !predecessor ? parseStartCommand(input) : parseSuccessor(input,mode,parseSetupName,foldSetupName,!!predecessor);
      const digest=hash({mode,predecessorId:predecessorId??null,parsed});
      const old=own(state.starts,parsed.requestKey);
      if(old) { if(old.hash!==digest) fail(409,'IDEMPOTENCY_KEY_CONFLICT'); return {idempotent:true,match:projectMatch(gameFor(state,p,old.id),Date.now())}; }
      if(own(state.logicalIds,parsed.logicalMatchId)) fail(409,'LOGICAL_MATCH_ALREADY_CHARGED');
      if(predecessor && predecessor.version!==(parsed as {predecessorVersion?:number}).predecessorVersion) fail(409,'PREDECESSOR_VERSION_CONFLICT');
      const localCategories=predecessor?retainedClassicCatalogue(predecessor):mode==='KIDS'?currentSupplement().kids:currentLocalCategories();const seen=new Set(Object.values(state.matches).flatMap(g=>g.questions.map(q=>q.sourceQuestionId)));const projectionVersion=predecessor?predecessor.localCategoryProjectionVersion:mode==='CLASSIC'&&realContentEnabled()?CURRENT_CATEGORY_PROJECTION:undefined;const categoryKeys=parsed.setup.categoryKeys.map(key=>canonicalCategoryId(key,projectionVersion));if(new Set(categoryKeys).size!==categoryKeys.length)fail(409,'DUPLICATE_CATEGORY');const categories=categoryKeys.map(key=>localCategories.find(c=>c.key===key)??fail(409,'CATEGORY_UNAVAILABLE'));
      const retainedPredecessorSource=!!predecessor;const id=randomUUID();
      const game:MatchRecord={id,mode,...(projectionVersion?{localCategoryProjectionVersion:projectionVersion}:{}),createdAt:new Date().toISOString(),identityId:p.uid,projectId:p.projectId,hostUid:p.uid,admissionId:'local-no-payment',releaseId:retainedPredecessorSource?predecessor!.releaseId:mode==='KIDS'?currentSupplement().releaseId:realContentEnabled()?realContent().source.releaseId:'local-practice-v1',releaseRootHash:retainedPredecessorSource?predecessor!.releaseRootHash:mode==='KIDS'?currentSupplement().root:realContentEnabled()?realContent().source.sha256:hash(localCategories),setup:parsed.setup,setupHash:hash(parsed.setup),version:1,phase:'BOARD',turnIndex:0,activeQuestionId:null,activeTeamId:null,deadlineAt:null,resultReason:null,unplayedCount:0,teams:parsed.setup.teams.map((t,i)=>({id:`team-${i}`,name:t.name,players:t.players,score:0})),categories:categories.map(({key,label,revisionId})=>({key,label,revisionId})),questions:categories.flatMap(c=>((realContentEnabled()||mode==='KIDS')&&c.questions.length>6?selectLocalQuestions(c as ReturnType<typeof realCategories>[number],seen):c.questions).map(q=>({...q,id:randomUUID(),isOpened:false,isCorrect:null,answeredByTeamId:null})))};
      state.matches[id]=game; put(state.starts,parsed.requestKey,{id,hash:digest}); put(state.logicalIds,parsed.logicalMatchId,id);
      return {idempotent:false,match:projectMatch(game,Date.now())};
    });
  }
  const catalogue=(p:Principal,mode:EntaMode)=>{verified(p);const localCategories=mode==='KIDS'?currentSupplement().kids:currentLocalCategories(),favoriteCatalog=localFavoriteCatalog();return Promise.resolve({mode,categoryCount:mode==='CLASSIC'?6:1,categories:localCategories.map(({key,label})=>{const favoriteKey=favoriteCatalog.keyFor(key,mode==='KIDS'?'authored-v1':'saved');return {key,label,...(favoriteKey?{favoriteKey}:{})};}),availableCredit:'999999'});};
  return {
    source:'local-development' as const,
    async historyGames(p:Principal) { verified(p); return store.transaction(p.uid,async state=>structuredClone(Object.values(state.matches))); },
    catalog:(p:Principal)=>catalogue(p,'CLASSIC'), kidsCatalog:(p:Principal)=>catalogue(p,'KIDS'),
    start:(p:Principal,input:unknown)=>start(p,input,'CLASSIC'), startKids:(p:Principal,input:unknown)=>start(p,input,'KIDS'), rematch:(p:Principal,id:string,input:unknown)=>start(p,input,'CLASSIC',id),
    async get(p:Principal,id:string) { verified(p); return store.transaction(p.uid,async state=>({match:projectMatch(gameFor(state,p,id),Date.now())})); },
    async command(p:Principal,id:string,input:unknown) {
      verified(p); const cmd=parseMatchCommand(input),digest=hash(cmd);
      return store.transaction(p.uid,async state=>{
        const game=gameFor(state,p,id); authorizeCommandChildren(game,cmd); const key=`${id}:${cmd.commandId}`,old=own(state.commands,key);
        if(old && old.hash!==digest) fail(409,'COMMAND_KEY_CONFLICT');
        if(!old) { const next=reduceMatchCommand(game,cmd,Date.now()); if(next.phase==='FINISHED') next.finishedAt=new Date().toISOString(); state.matches[id]=next; state.commands[key]={hash:digest,sequence:next.version}; }
        return {idempotent:!!old,receipt:{commandId:cmd.commandId,type:cmd.type,sequence:state.commands[key].sequence},match:projectMatch(state.matches[id],Date.now())};
      });
    },
    async history(p:Principal,input:Record<string,unknown>) { verified(p); const query=parseHistoryQuery(input); return store.transaction(p.uid,async state=>{
      const rows=Object.values(state.matches).filter(g=>(!query.mode||g.mode===query.mode)&&(!query.status||(g.phase==='FINISHED'?'FINISHED':'ACTIVE')===query.status)).sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')||b.id.localeCompare(a.id)).filter(g=>!query.cursor || (g.createdAt??'')<query.cursor.createdAt || g.createdAt===query.cursor.createdAt&&g.id<query.cursor.id);
      const matches:HistoryRow[]=rows.slice(0,query.limit).map(g=>({id:g.id,mode:g.mode!,status:g.phase==='FINISHED'?'FINISHED':'ACTIVE',createdAt:g.createdAt!,finishedAt:g.finishedAt??null,teams:g.teams.map(({name,score})=>({name,score})),resultReason:g.resultReason,unplayedCount:g.unplayedCount})); const last=matches.at(-1);
      return {matches,nextCursor:rows.length>query.limit&&last?Buffer.from(JSON.stringify({version:1,id:last.id,createdAt:last.createdAt,mode:query.mode,status:query.status})).toString('base64url'):null};
    }); },
    async rematchSetup(p:Principal,id:string) { verified(p);return store.transaction(p.uid,async state=>{const game=gameFor(state,p,id);if(game.phase!=='FINISHED')fail(409,'PREDECESSOR_NOT_FINISHED');return {predecessorVersion:game.version,mode:game.mode!,setup:{...game.setup,version:3 as const}};}); },
  };
}





