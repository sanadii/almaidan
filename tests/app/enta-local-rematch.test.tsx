import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import type {ReactNode} from 'react';
import fixture from './fixtures/enta-competition.json';
vi.mock('../../src/lib/local-development',()=>({isAlmaidanLocalDevelopment:true}));
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>({user,status:'ready'})}));
vi.mock('../../src/routes/EntaRoutes',()=>({EntaAccess:({children}:{children:ReactNode})=><>{children}</>,EntaShell:({children}:{children:ReactNode})=><main>{children}</main>}));
import {LocalRematchRoute} from '../../src/features/enta/LocalRematchRoute';
import {parseLocalRematchPending,parseLocalRematchSetup,type LocalRematchEngine} from '../../src/features/enta/local-rematch-client';
import {pendingOccupancy,persistPendingIntent,pendingIntentRoute} from '../../src/features/enta/pending-intent';
import {completePendingStart,pendingStartRetired} from '../../src/features/enta/pending-start';
import {beginOwnerProvider,observeProviderOwner,invalidateOwner} from '../../src/features/enta/auth-epoch';
const uid='local-rematch-owner',user={uid,getIdToken:vi.fn(async()=>'owner-token')};
const source=(engine:LocalRematchEngine)=>({baseReleaseId:'saved-v1',baseRoot:'a'.repeat(64),formatReleaseId:'formats-v1',formatRoot:'b'.repeat(64),mediaRoot:'c'.repeat(64),...(engine==='competitive'?{competitiveReleaseId:'competition-v1',proofRoot:'d'.repeat(64)}:{})});
function pending(engine:LocalRematchEngine){return parseLocalRematchPending({version:6,engine,executionFormat:'STANDALONE_LIST',startKind:'LOCAL_REMATCH',predecessor:{id:'parent-game',version:9},source:source(engine),endpoint:`/local-rematches/${engine}/parent-game`,command:{requestKey:'retry-rematch-request',logicalMatchId:'child-game',predecessorVersion:9}});}
const roundSetup={version:4,categories:[{key:'category-one',promptRefs:[]}],teams:[{name:'الفريق الأول',players:['علي']},{name:'الفريق الثاني',players:['نور']}],rules:{turnSeconds:30,overallSeconds:300,questionSeconds:60}};
function setup(engine:LocalRematchEngine){const s=engine==='round'?roundSetup:fixture.start.setup;return {engine,executionFormat:'STANDALONE_LIST',predecessor:{id:'parent-game',version:9},source:source(engine),setup:s,categories:s.categories.map(c=>({key:c.key,label:'الفئة الأصلية'}))};}
function match(engine:LocalRematchEngine){return engine==='competitive'?{...structuredClone(fixture.board),id:'child-game'}:{id:'child-game',version:1,executionFormat:'STANDALONE_LIST',finished:false,serverNow:1000,turnTeamId:'team-one',teams:roundSetup.teams.map((t,i)=>({...t,id:i?'team-two':'team-one',score:0})),categories:[{key:'category-one',label:'الفئة الأصلية',format:'LIST_ITEMS',cover:null}],rounds:Array.from({length:4},(_,i)=>({id:`round-${i}`,ordinal:i,categoryKey:'category-one',format:'LIST_ITEMS',points:null,state:'READY'})),currentRound:null,grants:[],result:null};}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{const lease=beginOwnerProvider();observeProviderOwner(lease,uid);sessionStorage.clear();user.getIdToken.mockReset().mockResolvedValue('owner-token');});
afterEach(()=>{cleanup();invalidateOwner();vi.unstubAllGlobals();sessionStorage.clear();});

it.each(['round','competitive'] as const)('%s rematch setup preserves exact categories, rules, players and source metadata',engine=>{
 const original=setup(engine),parsed=parseLocalRematchSetup(original,engine,'parent-game');expect(parsed).toEqual(original);const intent=pending(engine);persistPendingIntent(uid,intent);expect(pendingOccupancy(uid)).toMatchObject({state:'VALID',intent});expect(pendingIntentRoute(intent)).toBe(`/enta/local-rematch/${engine}/parent-game`);
 expect(()=>parseLocalRematchSetup(original,engine,'different-parent')).toThrow();expect(()=>parseLocalRematchSetup({...original,categories:[]},engine,'parent-game')).toThrow();expect(()=>parseLocalRematchSetup({...original,setup:{...original.setup,rules:{}}},engine,'parent-game')).toThrow();
});
it('rejects forged rematch endpoint, predecessor version and source hashes',()=>{
 const value=pending('round');for(const change of [{endpoint:'/matches/classic'},{command:{...value.command,predecessorVersion:8}},{source:{...value.source,baseRoot:'invalid'}},{predecessor:{id:'../parent',version:9}},{engine:'classic'}])expect(()=>parseLocalRematchPending({...value,...change})).toThrow();
});
it.each(['round','competitive'] as const)('%s completion confirms original provenance before clearing durable intent and attaching local lobby',async engine=>{
 const intent=pending(engine);persistPendingIntent(uid,intent);const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/rooms')?json({room:{code:'E1-ABCDEFGH'}}):json({match:match(engine),idempotent:true,predecessor:intent.predecessor,source:intent.source}));vi.stubGlobal('fetch',fetcher);
 expect(await completePendingStart(user,intent,new AbortController().signal,()=>true)).toEqual({id:'child-game',roomCode:'E1-ABCDEFGH'});expect(pendingOccupancy(uid).state).toBe('EMPTY');expect(String(fetcher.mock.calls[0][0])).toBe(`/api/v1/enta${intent.endpoint}`);
});
it.each(['predecessor','source','match'] as const)('keeps exact pending intent when %s completion binding is wrong',async field=>{
 const intent=pending('round');persistPendingIntent(uid,intent);const result={match:match('round'),idempotent:false,predecessor:intent.predecessor,source:intent.source};if(field==='source')result.source={...result.source,baseRoot:'f'.repeat(64)};if(field==='predecessor')result.predecessor={...result.predecessor,id:'wrong-parent'};if(field==='match')result.match={...result.match,id:'wrong-child'};
 const fetcher=vi.fn(async()=>json(result));vi.stubGlobal('fetch',fetcher);await expect(completePendingStart(user,intent,new AbortController().signal,()=>true)).rejects.toThrow('MALFORMED_RESPONSE');expect(pendingOccupancy(uid)).toMatchObject({state:'VALID',intent});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retries an uncertain rematch using identical request bytes and does not replace it with a new start',async()=>{
 const intent=pending('round');persistPendingIntent(uid,intent);const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(Error('lost reply')).mockResolvedValueOnce(json({match:match('round'),idempotent:true,predecessor:intent.predecessor,source:intent.source})).mockResolvedValueOnce(json({room:{code:'E1-ABCDEFGH'}}));vi.stubGlobal('fetch',fetcher);
 await expect(completePendingStart(user,intent,new AbortController().signal,()=>true)).rejects.toThrow();expect(pendingOccupancy(uid)).toMatchObject({state:'VALID',intent});await completePendingStart(user,intent,new AbortController().signal,()=>true);expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
});
it.each([409,503])('retires an exhausted rematch only for the definite atomic 409 rejection (status %s)',async status=>{
 const intent=pending('round');persistPendingIntent(uid,intent);vi.stubGlobal('fetch',vi.fn(async()=>json({error:'REMATCH_CONTENT_EXHAUSTED'},status)));
 await expect(completePendingStart(user,intent,new AbortController().signal,()=>true)).rejects.toThrow('REMATCH_CONTENT_EXHAUSTED');
 expect(pendingOccupancy(uid).state).toBe(status===409?'EMPTY':'VALID');
});
it('offers different categories after confirmed exhaustion without leaving a permanently pending rematch',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/setup')?json(setup('round')):json({error:'REMATCH_CONTENT_EXHAUSTED'},409)));
 render(<MemoryRouter initialEntries={['/enta/local-rematch/round/parent-game']}><Routes><Route path="/enta/local-rematch/:engine/:id" element={<LocalRematchRoute/>}/></Routes></MemoryRouter>);
 await screen.findByText('الفئة الأصلية');fireEvent.click(screen.getByRole('button',{name:'بدء الإعادة'}));
 expect(await screen.findByRole('link',{name:'اختيار فئات أخرى لمباراة جديدة'})).toHaveAttribute('href','/enta/new/list');expect(pendingOccupancy(uid).state).toBe('EMPTY');
});
it('fences rematch completion when the owner changes while a response is pending',async()=>{
 const intent=pending('round');persistPendingIntent(uid,intent);let release!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;})));const promise=completePendingStart(user,intent,new AbortController().signal,()=>true);await Promise.resolve();await Promise.resolve();invalidateOwner();release(json({match:match('round'),idempotent:false,predecessor:intent.predecessor,source:intent.source}));await expect(promise).rejects.toThrow();expect(pendingOccupancy(uid)).toMatchObject({state:'VALID',intent});
});
it('renders retained settings and retries the same rematch from the review screen',async()=>{
 let posts=0;const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,options)=>{
  if(String(url).endsWith('/setup'))return json(setup('round'));
  if(String(url).endsWith('/rooms'))return json({room:{code:'E1-ABCDEFGH'}});
  if(posts++===0)throw Error('lost reply');const command=JSON.parse(String(options?.body));return json({match:{...match('round'),id:command.logicalMatchId},idempotent:true,predecessor:{id:'parent-game',version:9},source:source('round')});
 });vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter initialEntries={['/enta/local-rematch/round/parent-game']}><Routes><Route path="/enta/local-rematch/:engine/:id" element={<LocalRematchRoute/>}/><Route path="/enta/rooms/:code/host" element={<p>غرفة الإعادة جاهزة</p>}/></Routes></MemoryRouter>);
 expect(await screen.findByText('الفئة الأصلية')).toBeInTheDocument();expect(screen.getByText('الفريق الأول')).toBeInTheDocument();expect(screen.getByText(/وقت السؤال: 60 ثانية/)).toBeInTheDocument();expect(screen.getByText('saved-v1')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'بدء الإعادة'}));await waitFor(()=>expect(screen.getByRole('alert')).toBeInTheDocument());expect(pendingOccupancy(uid).state).toBe('VALID');fireEvent.click(screen.getByRole('button',{name:'تأكيد طلب الإعادة نفسه'}));expect(await screen.findByText('غرفة الإعادة جاهزة')).toBeInTheDocument();const sends=fetcher.mock.calls.filter(([url,options])=>String(url).includes('/local-rematches/')&&options?.method==='POST');expect(sends).toHaveLength(2);expect(sends[1][1]?.body).toBe(sends[0][1]?.body);
});
it.each([[409,'EMPTY'],[503,'VALID']] as const)('a started match the room service refuses with ROOM_REQUIRES_NEW_MATCH (%s) is retired only for the definite rejection',async(status,state)=>{
 const intent=pending('round');persistPendingIntent(uid,intent);vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/rooms')?json({error:'ROOM_REQUIRES_NEW_MATCH'},status):json({match:match('round'),idempotent:true,predecessor:intent.predecessor,source:intent.source})));
 const failure=await completePendingStart(user,intent,new AbortController().signal,()=>true).catch(e=>e);expect(failure.message).toBe('ROOM_REQUIRES_NEW_MATCH');expect(pendingStartRetired(failure)).toBe(status===409);expect(pendingOccupancy(uid).state).toBe(state);
});
