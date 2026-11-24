import competitiveFixture from './fixtures/enta-competition.json';
import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {FirebaseAuthProvider} from '../../src/features/auth/AuthProvider';
import {useFirebaseAuth} from '../../src/features/auth/auth-context';
import {ownerEpoch,isOwnerEpoch,invalidateOwner} from '../../src/features/enta/auth-epoch';
import {EntaCompetitionNewRoute} from '../../src/features/enta/CompetitionSetup';
import {ThemeProvider} from '../../src/app/ThemeProvider';
import {EntaNewRoute,EntaKidsRoute} from '../../src/routes/EntaRoutes';
import {EntaRoundNewRoute} from '../../src/features/enta/RoundRoutes';
import {pendingStartStorageKey} from '../../src/features/enta/client';
const seam=vi.hoisted(()=>({auth:{currentUser:null as any,authStateReady:()=>Promise.resolve()},observe:null as any,onError:null as any,signIn:vi.fn(),signOut:vi.fn()}));
vi.mock('firebase/auth',async importOriginal=>({...await importOriginal<any>(),onAuthStateChanged:(_auth:any,next:any,error:any)=>{seam.observe=next;seam.onError=error;return vi.fn();}}));
vi.mock('../../src/lib/firebase/client',()=>({getOptionalFirebaseAuth:()=>seam.auth}));
vi.mock('../../src/features/auth/auth-service',()=>({authErrorMessage:()=>({code:'test',message:'test'}),createEmailPasswordAccount:()=>seam.signIn(),signInOrLinkGoogle:()=>seam.signIn(),signInWithEmailPassword:()=>seam.signIn(),signOutFirebaseUser:()=>seam.signOut()}));
let context:any;
function Probe(){context=useFirebaseAuth();return <span data-testid="uid">{context.user?.uid??'none'}</span>;}
function fakeUser(uid:string){return {uid,emailVerified:true,isAnonymous:false,providerData:[{providerId:'password'}],getIdToken:vi.fn(async()=> 'fixture-token')};}
const A=fakeUser('security-owner-a'),B=fakeUser('security-owner-b');
function transition(user:any){seam.auth.currentUser=user;seam.observe(user);}
function mountUI(){return render(<FirebaseAuthProvider><Probe/><ThemeProvider><MemoryRouter><EntaCompetitionNewRoute format="STANDALONE_LIST"/></MemoryRouter></ThemeProvider></FirebaseAuthProvider>);}
const palette=[['CORAL','مرجاني','#ff7a4d'],['SKY','سماوي','#3fc6ff'],['VIOLET','بنفسجي','#7c5cff'],['MINT','نعناعي','#34d399'],['GOLD','ذهبي','#ffc94d'],['ROSE','وردي','#ff5c72']].map(([key,label,color])=>({key,label,color}));
const catalog={version:5,rulesVersion:'enta-competitive-1',availableCredit:'1',palette,categories:[{key:'review_category',label:'فئة الاختبار',format:'LIST_ITEMS',prompts:[{ref:'review_prompt',label:'قائمة الاختبار'}],cover:null}]};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{invalidateOwner();seam.auth.currentUser=A;seam.signIn.mockReset();seam.signOut.mockReset();A.getIdToken.mockReset().mockResolvedValue('fixture-token');B.getIdToken.mockReset().mockResolvedValue('fixture-token');sessionStorage.clear();});
afterEach(()=>{cleanup();invalidateOwner();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function prepareStart(){await userEvent.click(await screen.findByRole('button',{name:/فئة الاختبار/}));const players=screen.getAllByLabelText('اللاعبون — اسم في كل سطر');await userEvent.type(players[0],'أحمد');await userEvent.type(players[1],'خالد');}
describe('mounted actual provider observation',()=>{
 it('provider A-B-A immediately fences original epoch even if React batches state',async()=>{render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(screen.getByTestId('uid').textContent).toBe(A.uid));const original=ownerEpoch(A.uid);act(()=>{transition(B);transition(A);});expect(isOwnerEpoch(original)).toBe(false);expect(()=>ownerEpoch(A.uid)).not.toThrow();});
 it('late auth action cannot reactivate owner authority after provider unmount',async()=>{let finish!:()=>void;seam.signIn.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));const view=render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(screen.getByTestId('uid').textContent).toBe(A.uid));let work!:Promise<void>;act(()=>{work=context.signInWithGoogle();});await waitFor(()=>expect(seam.signIn).toHaveBeenCalled());view.unmount();expect(()=>ownerEpoch(A.uid)).toThrow();await act(async()=>{finish();await work;});expect(()=>ownerEpoch(A.uid)).toThrow();});
 it.each([401,403,'network'])('mounted POST %s preserves exact original request',async outcome=>{let posted:any;vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{if(init?.method==='POST'){posted=JSON.parse(init.body as string);if(outcome==='network')throw Error('offline');return json({error:'INVALID_ID_TOKEN'},outcome as number);}return json(catalog);}));mountUI();await prepareStart();await userEvent.click(screen.getByRole('button',{name:'ابدأوا جولات القوائم'}));await waitFor(()=>expect(posted).toBeDefined());await screen.findByRole('button',{name:'تأكيد بدء المباراة'});expect(JSON.parse(sessionStorage.getItem(pendingStartStorageKey(A.uid))!).command).toEqual(posted);});
 it('A-B-A while token pending leaves original attempt retryable in mounted UI',async()=>{let finish!:(v:string)=>void;const fetcher=vi.fn(async()=>json(catalog));vi.stubGlobal('fetch',fetcher);mountUI();await prepareStart();A.getIdToken.mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;}));await userEvent.click(screen.getByRole('button',{name:'ابدأوا جولات القوائم'}));await waitFor(()=>expect(finish).toBeDefined());const raw=sessionStorage.getItem(pendingStartStorageKey(A.uid));act(()=>{transition(B);transition(A);});await act(async()=>{finish('old-token');await Promise.resolve();});expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);expect(fetcher.mock.calls.filter(([,init]:any)=>init?.method==='POST')).toHaveLength(0);await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());});
 it.each(['','{','x'.repeat(16001),'{"version":6}'])('mounted unreadable occupancy is preserved and blocks POST %#',async raw=>{sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);const fetcher=vi.fn(async()=>json(catalog));vi.stubGlobal('fetch',fetcher);const view=mountUI();await screen.findByRole('button',{name:/فئة الاختبار/});fireEvent.submit(view.container.querySelector('form')!);await act(async()=>{await Promise.resolve();});expect(fetcher.mock.calls.filter(([,init]:any)=>init?.method==='POST')).toHaveLength(0);expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);});
});


const coreTeams=[{name:'Team A',players:['A'],lifelines:[]},{name:'Team B',players:['B'],lifelines:[]}];
function pendingFixture(version:number){const command={requestKey:'security-request',logicalMatchId:'security-child',setup:{version,categoryKeys:version===2?['a','b','c','d','e','f']:['a'],teams:coreTeams,rules:{questionSeconds:20}}};if(version===2)return command;
if(version===3)return {version,mode:'KIDS',operation:'PAID_ENTA_KIDS',startKind:'START',predecessor:null,endpoint:'/matches/kids',command};
const setup=version===4?{version,categories:[{key:'a',promptRefs:[]}],teams:coreTeams.map(({name,players})=>({name,players})),rules:{questionSeconds:20,turnSeconds:30,overallSeconds:null}}:{version,categories:[{key:'a',promptRefs:[]}],teams:coreTeams.map(({name,players},i)=>({name,players,colorKey:i?'SKY':'CORAL',aids:['HINT','PASS','DOUBLE']})),rules:{version:'enta-competitive-1',paletteVersion:'enta-team-palette-1',questionSeconds:20,turnSeconds:30,overallSeconds:null,stealSeconds:10,phoneSeconds:60,embeddedStealCap:200}};
return {version,...(version===4?{mode:'LIST'}:{}),operation:'PAID_ENTA_LIST',executionFormat:'STANDALONE_LIST',startKind:'START',predecessor:null,endpoint:version===4?'/matches/list':'/competition/matches/list',command:{...command,setup}};}
function mountProtocol(version:number){const child=version===2?<EntaNewRoute/>:version===3?<EntaKidsRoute/>:version===4?<EntaRoundNewRoute format="STANDALONE_LIST"/>:<EntaCompetitionNewRoute format="STANDALONE_LIST"/>;return render(<FirebaseAuthProvider><Probe/><ThemeProvider><MemoryRouter>{child}</MemoryRouter></ThemeProvider></FirebaseAuthProvider>);}
describe('mounted protocol matrix',()=>{
 it.each([2,3,4,5].flatMap(version=>[401,403,'network'].map(outcome=>({version,outcome}))))('v$version retries exact restored identity after $outcome',async({version,outcome})=>{const fixture=pendingFixture(version),raw=JSON.stringify(fixture,null,2);sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);let posted:any;vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{if(init?.method==='POST'){posted=JSON.parse(init.body as string);if(outcome==='network')throw Error('offline');return json({error:'INVALID_ID_TOKEN'},outcome as number);}return json({error:'ENTA_UNAVAILABLE'},503);}));const view=mountProtocol(version);await waitFor(()=>expect(screen.getByTestId('uid').textContent).toBe(A.uid));await waitFor(()=>expect(view.container.querySelector('form')).not.toBeNull());fireEvent.submit(view.container.querySelector('form')!);await waitFor(()=>expect(posted).toBeDefined());expect(posted).toEqual(version===2?fixture:(fixture as any).command);await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);});
 it.each([2,3,4,5])('v%s refuses occupied unsupported6 before dispatch even with valid in-memory retry',async version=>{sessionStorage.setItem(pendingStartStorageKey(A.uid),JSON.stringify(pendingFixture(version)));const fetcher=vi.fn(async()=>json({error:'ENTA_UNAVAILABLE'},503));vi.stubGlobal('fetch',fetcher);const view=mountProtocol(version);await screen.findByRole('button',{name:'تأكيد بدء المباراة'});sessionStorage.setItem(pendingStartStorageKey(A.uid),'{"version":6}');fireEvent.submit(view.container.querySelector('form')!);await act(async()=>{await Promise.resolve();});expect(fetcher.mock.calls.filter(([,init]:any)=>init?.method==='POST')).toHaveLength(0);expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe('{"version":6}');});
});

// Appended verbatim to the retained Security harness after its original26 cases.
describe('R2 provider lifecycle leases',()=>{
 it.each(['resolve','reject'])('late action %s cannot alter replacement provider authority or pending state',async outcome=>{
  let finish!:()=>void,reject!:(e:Error)=>void;seam.signIn.mockImplementationOnce(()=>new Promise<void>((r,j)=>{finish=r;reject=j;}));
  const old=render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(A.uid));let work!:Promise<void>;act(()=>{work=context.signInWithGoogle();});await waitFor(()=>expect(finish).toBeDefined());old.unmount();
  seam.auth.currentUser=B;render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(B.uid));const current=ownerEpoch(B.uid),replacement=context;
  await act(async()=>{if(outcome==='resolve')finish();else reject(Error('late'));await work;});
  expect(isOwnerEpoch(current)).toBe(true);expect(context.user?.uid).toBe(B.uid);expect(context.status).toBe('password');expect(context.pendingAction).toBe(replacement.pendingAction);expect(()=>ownerEpoch(A.uid)).toThrow();
 });
 it.each(['resolve','reject'])('queued action is never started after unmount following %s',async outcome=>{
  let finish!:()=>void,reject!:(e:Error)=>void;seam.signIn.mockImplementationOnce(()=>new Promise<void>((r,j)=>{finish=r;reject=j;}));
  const old=render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(A.uid));let first!:Promise<void>,queued!:Promise<void>;act(()=>{first=context.signInWithGoogle();queued=context.signInWithGoogle();});await waitFor(()=>expect(finish).toBeDefined());old.unmount();
  await act(async()=>{if(outcome==='resolve')finish();else reject(Error('late'));await first;await queued;});expect(seam.signIn).toHaveBeenCalledTimes(1);expect(()=>ownerEpoch(A.uid)).toThrow();
 });
 it('queued stale method invoked after replacement cannot start auth side effects',async()=>{
  const old=render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(A.uid));const stale=context.signInWithGoogle;old.unmount();seam.auth.currentUser=B;render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(B.uid));const current=ownerEpoch(B.uid);await act(async()=>{await stale();});expect(seam.signIn).not.toHaveBeenCalled();expect(isOwnerEpoch(current)).toBe(true);
 });
 it('ordinary queued sign-in/sign-out retains serialized actions',async()=>{
  seam.signIn.mockImplementation(async()=>{seam.auth.currentUser=B;});seam.signOut.mockImplementation(async()=>{seam.auth.currentUser=null;});render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(A.uid));
  await act(async()=>{await context.signInWithGoogle();});expect(context.user?.uid).toBe(B.uid);expect(context.pendingAction).toBeNull();expect(()=>ownerEpoch(B.uid)).not.toThrow();
  await act(async()=>{await context.signOut();});expect(context.user).toBeNull();expect(context.status).toBe('signedOut');expect(seam.signIn).toHaveBeenCalledTimes(1);expect(seam.signOut).toHaveBeenCalledTimes(1);expect(()=>ownerEpoch(B.uid)).toThrow();
 });
 it('ordinary current action failure reports error and does not grant an owner epoch',async()=>{
  seam.signIn.mockRejectedValue(Error('current failure'));render(<FirebaseAuthProvider><Probe/></FirebaseAuthProvider>);await waitFor(()=>expect(context.user?.uid).toBe(A.uid));await act(async()=>{await context.signInWithGoogle();});expect(context.status).toBe('error');expect(context.pendingAction).toBeNull();expect(()=>ownerEpoch(A.uid)).toThrow();
 });
});

function boardFor(version:number){
 const fixture:any=pendingFixture(version),setup=version===2?fixture.setup:fixture.command.setup,teams=setup.teams.map((t:any,n:number)=>({id:`team_${n}`,name:t.name,players:t.players,score:0}));
 if(version<=3){const categories=setup.categoryKeys.map((key:string)=>({key,label:key}));return {id:'native-generated-child',mode:version===2?'CLASSIC':'KIDS',version:1,phase:'BOARD',serverNow:1800000000000,rules:{questionSeconds:20},teams,categories,tiles:categories.flatMap((c:any,n:number)=>[200,200,400,400,600,600].map((points,i)=>({id:`tile_${n}_${i}`,categoryKey:c.key,points,used:false,active:false,answeredByTeamId:null,isCorrect:null}))),turnTeamId:'team_0',currentQuestion:null,result:null};}
 if(version===4)return {id:'security-child',version:1,executionFormat:'STANDALONE_LIST',finished:false,serverNow:1800000000000,turnTeamId:'team_0',teams,categories:[{key:'a',label:'Category',format:'LIST_ITEMS',cover:null}],rounds:Array.from({length:4},(_,ordinal)=>({id:`round_${ordinal}`,ordinal,categoryKey:'a',format:'LIST_ITEMS',points:null,state:'READY'})),currentRound:null,grants:[],result:null};
 return {...structuredClone(competitiveFixture.board),id:'security-child'};
}
describe('R2 all paid-start generation recovery',()=>{
 it.each([2,3,4,5].flatMap(version=>['token','response','body'].map(phase=>({version,phase}))))('v$version $phase A-B-A restores same attempt and fences late response/error/finally',async({version,phase})=>{
  const raw=JSON.stringify(pendingFixture(version),null,2);sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);let tokenFinish!:(s:string)=>void,responseFinish!:(r:Response)=>void,bodyFinish!:()=>void;let posts=0;
  const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{if(init?.method!=='POST')return json({error:'ENTA_UNAVAILABLE'},503);posts++;if(phase==='response')return new Promise<Response>(r=>{responseFinish=r;});if(phase==='body')return new Response(new ReadableStream({start(controller){bodyFinish=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({error:'INVALID_ID_TOKEN'})));controller.close();};}}),{status:401,headers:{'content-type':'application/json'}});return json({error:'INVALID_ID_TOKEN'},401);});vi.stubGlobal('fetch',fetcher);
  const view=mountProtocol(version);await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());
  if(phase==='token')A.getIdToken.mockImplementationOnce(()=>new Promise<string>(r=>{tokenFinish=r;}));
  fireEvent.submit(view.container.querySelector('form')!);await waitFor(()=>expect(phase==='token'?tokenFinish:phase==='response'?responseFinish:bodyFinish).toBeDefined());
  act(()=>{transition(B);transition(A);});await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());
  await act(async()=>{if(phase==='token')tokenFinish('old-token');else if(phase==='response')responseFinish(json({match:boardFor(version),idempotent:true}));else bodyFinish();await Promise.resolve();});
  expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);expect(posts).toBe(phase==='token'?0:1);expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled();
 });
 it.each([2,3,4,5])('v%s stale catch/finally cannot change a new retry in progress',async version=>{
  const raw=JSON.stringify(pendingFixture(version));sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);let oldFinish!:(r:Response)=>void,currentFinish!:(r:Response)=>void;let posts=0;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>init?.method==='POST'?new Promise<Response>(r=>{posts++;if(posts===1)oldFinish=r;else currentFinish=r;}):json({error:'ENTA_UNAVAILABLE'},503)));
  const view=mountProtocol(version);await screen.findByRole('button',{name:'تأكيد بدء المباراة'});fireEvent.submit(view.container.querySelector('form')!);await waitFor(()=>expect(oldFinish).toBeDefined());act(()=>{transition(B);transition(A);});await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());fireEvent.submit(view.container.querySelector('form')!);await waitFor(()=>expect(currentFinish).toBeDefined());const submit=view.container.querySelector('button[type="submit"]')!;expect(submit).toBeDisabled();await act(async()=>{oldFinish(json({error:'INVALID_ID_TOKEN'},401));await Promise.resolve();});expect(submit).toBeDisabled();expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);await act(async()=>{currentFinish(json({error:'INVALID_ID_TOKEN'},401));});await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());
 });
 it.each([2,3,4,5])('v%s separately rendered B then A preserves both occupied records',async version=>{
  const raw=JSON.stringify(pendingFixture(version),null,2),other=JSON.stringify(pendingFixture(version));sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);sessionStorage.setItem(pendingStartStorageKey(B.uid),other);vi.stubGlobal('fetch',vi.fn(async()=>json({error:'ENTA_UNAVAILABLE'},503)));mountProtocol(version);await screen.findByRole('button',{name:'تأكيد بدء المباراة'});act(()=>transition(B));await waitFor(()=>expect(screen.getByTestId('uid')).toHaveTextContent(B.uid));act(()=>transition(A));await waitFor(()=>expect(screen.getByTestId('uid')).toHaveTextContent(A.uid));await waitFor(()=>expect(screen.getByRole('button',{name:'تأكيد بدء المباراة'})).toBeEnabled());expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBe(raw);expect(sessionStorage.getItem(pendingStartStorageKey(B.uid))).toBe(other);
 });
 it.each([2,3,4,5])('v%s matching owned successful commit clears only original occupancy',async version=>{
  const raw=JSON.stringify(pendingFixture(version),null,2);sessionStorage.setItem(pendingStartStorageKey(A.uid),raw);sessionStorage.setItem(pendingStartStorageKey(B.uid),'foreign-preserved');
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>init?.method==='POST'?json({match:boardFor(version),idempotent:true}):json({error:'ENTA_UNAVAILABLE'},503)));
  const view=mountProtocol(version);await screen.findByRole('button',{name:'تأكيد بدء المباراة'});fireEvent.submit(view.container.querySelector('form')!);await waitFor(()=>expect(sessionStorage.getItem(pendingStartStorageKey(A.uid))).toBeNull());expect(sessionStorage.getItem(pendingStartStorageKey(B.uid))).toBe('foreign-preserved');
 });
});

