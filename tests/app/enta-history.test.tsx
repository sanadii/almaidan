import assert from 'node:assert/strict';
import { test } from 'vitest';
import { issue } from '../../services/enta/server/src/history-rematch/cursor';
import { beginOwnerProvider, endOwnerProvider, observeProviderOwner } from '../../src/features/enta/auth-epoch';
import { requestEnta } from '../../src/features/enta/client';

test('actual requestEnta dispatches MAC-dot history cursor and rejects malformed query', async () => {
 const lease = beginOwnerProvider(); observeProviderOwner(lease, 'user');
 const now = 1_700_000_000_000, cursor = issue({namespaceId:'ns',projectId:'project',uid:'user'}, {active:'k',keys:new Map([['k',{bytes:Buffer.alloc(32,7),issueUntil:now+1000,verifyUntil:now+1_000_000}]])}, now, {mode:null,format:null,rules:null,status:null}, 1, {createdAt:'2023-11-14T22:13:22.000Z',id:'u'}, {createdAt:'2023-11-14T22:13:21.000Z',id:'b'});
 const prior = globalThis.fetch; const paths: string[] = [];
 globalThis.fetch = async (input) => { paths.push(String(input)); return new Response('{}', {headers:{'content-type':'application/json'}}); };
 try {
  const user = {uid:'user',getIdToken:async () => 'token'}, signal = new AbortController().signal;
  await requestEnta(`/matches/history?limit=1&cursor=${cursor}`, user, signal);
  assert.equal(paths.length, 1); assert.ok(paths[0].includes(cursor));
  for (const query of ['cursor=legacy', 'mode=CLASSIC&mode=KIDS', 'cursor=a%2Eb', 'mode=CLASSIC&', 'unknown=1']) await assert.rejects(requestEnta(`/matches/history?${query}`, user, signal));
  assert.equal(paths.length, 1);
 } finally { globalThis.fetch = prior; endOwnerProvider(lease); }
});

test('history parser accepts only persisted tuple and exact route', async () => {
 const {parseHistory}=await import('../../src/features/enta/history');
 const row={id:'g',admissionProtocol:4,mode:'LIST',executionFormat:'STANDALONE_LIST',retainedRulesProfile:'enta-format-1',status:'ACTIVE',createdAt:'2023-11-14T22:13:20.000Z',finishedAt:null,teams:[{name:'Team A',score:0},{name:'Team B',score:0}],summary:null,route:'ROUND'};
 const page={registryVersion:1,queryVersion:2,matches:[row],nextCursor:null};assert.equal(parseHistory(page,{mode:'LIST'}).matches[0].route,'ROUND');
 assert.throws(()=>parseHistory({...page,matches:[{...row,route:'LEGACY'}]}));assert.throws(()=>parseHistory(page,{mode:'KIDS'}));
});

test('original result route renders a labelled loading state without runtime initialization', async () => {
 const React=await import('react'); (globalThis as unknown as {React:unknown}).React=React; const {JSDOM}=await import('jsdom'); const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'}); (globalThis as unknown as {document:Document}).document=dom.window.document; const {renderToString}=await import('react-dom/server');const {MemoryRouter,Route,Routes}=await import('react-router-dom');const {FirebaseAuthContext,loadingAuthContext}=await import('../../src/features/auth/auth-context');const {OriginalResultView}=await import('../../src/features/enta/OriginalResultRoute');
 const user={uid:'user',isAnonymous:false,emailVerified:true,getIdToken:async()=> 'token'};
 const html=renderToString(React.createElement(FirebaseAuthContext.Provider,{value:{...loadingAuthContext,status:'password',isAvailable:true,user:user as never}},React.createElement(MemoryRouter,{initialEntries:['/enta/history/g/original-result']},React.createElement(Routes,null,React.createElement(Route,{path:'/enta/history/:id/original-result',element:React.createElement(OriginalResultView)})))));
 assert.match(html,/جارٍ تحميل النتيجة الأصلية/);
});




test('history clears cursor across A to B to A identity transitions', async () => {
 const React=await import('react');(globalThis as unknown as {React:unknown}).React=React;const {JSDOM}=await import('jsdom');const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});(globalThis as unknown as {window:Window}).window=dom.window as unknown as Window;(globalThis as unknown as {document:Document}).document=dom.window.document;(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 dom.window.matchMedia=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as never;const {createRoot}=await import('react-dom/client');const {MemoryRouter}=await import('react-router-dom');const {ThemeProvider}=await import('../../src/app/ThemeProvider');const {FirebaseAuthContext,loadingAuthContext}=await import('../../src/features/auth/auth-context');const {HistoryView}=await import('../../src/features/enta/HistoryRoutes');
 const prior=globalThis.fetch, paths:string[]=[];const now=1_700_000_000_000;
 const cur=issue({namespaceId:'ns',projectId:'project',uid:'A'},{active:'k',keys:new Map([['k',{bytes:Buffer.alloc(32,7),issueUntil:now+1000,verifyUntil:now+1_000_000}]])},now,{mode:null,format:null,rules:null,status:null},25,{createdAt:'2023-11-14T22:13:20.000Z',id:'z'},{createdAt:'2023-11-14T22:13:20.000Z',id:'a'});
 const rows=Array.from({length:25},(_,i)=>({id:`g${String(25-i).padStart(2,'0')}`,admissionProtocol:3,mode:'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:'enta-classic-3',status:'ACTIVE',createdAt:'2023-11-14T22:13:20.000Z',finishedAt:null,teams:[{name:'Team A',score:0},{name:'Team B',score:0}],summary:null,route:'LEGACY'}));
 globalThis.fetch=async input=>{paths.push(String(input));return new Response(JSON.stringify({registryVersion:1,queryVersion:2,matches:rows,nextCursor:cur}),{headers:{'content-type':'application/json'}});};
 const root=createRoot(dom.window.document.getElementById('root')!), lease=beginOwnerProvider();const user=(uid:string)=>({uid,isAnonymous:false,emailVerified:true,getIdToken:async()=> 'token'});const render=(uid:string)=>React.createElement(FirebaseAuthContext.Provider,{value:{...loadingAuthContext,status:'password',isAvailable:true,user:user(uid) as never}},React.createElement(ThemeProvider,null,React.createElement(MemoryRouter,null,React.createElement(HistoryView))));
 try {
  await React.act(async()=>{observeProviderOwner(lease,'A');root.render(render('A'));});const more=[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='عرض المزيد');assert.ok(more);await React.act(async()=>{more.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});assert.ok(paths.at(-1)?.includes('cursor='));
  await React.act(async()=>{observeProviderOwner(lease,'B');root.render(render('B'));});assert.ok(!paths.at(-1)?.includes('cursor='));
  await React.act(async()=>{observeProviderOwner(lease,'A');root.render(render('A'));});assert.ok(!paths.at(-1)?.includes('cursor='));
 } finally {await React.act(async()=>root.unmount());endOwnerProvider(lease);globalThis.fetch=prior;dom.window.close();}
});




