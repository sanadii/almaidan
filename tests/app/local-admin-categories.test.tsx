import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({user:null as any,observer:null as null|((u:any)=>void),fetch:vi.fn(),auth:{emulatorConfig:null as any,authStateReady:()=>Promise.resolve()}}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('firebase/app',()=>({getApps:()=>[],initializeApp:()=>({})}));
vi.mock('firebase/auth',()=>({
 getAuth:()=>state.auth,connectAuthEmulator:()=>{state.auth.emulatorConfig={host:'127.0.0.1',port:19099}},browserSessionPersistence:{kind:'session'},
 setPersistence:async()=>{},
 onAuthStateChanged:(_:unknown,cb:(user:any)=>void)=>{state.observer=cb;queueMicrotask(()=>cb(state.user));return()=>{state.observer=null}},
 signInWithEmailAndPassword:async()=>({user:state.user}),
 signOut:async()=>{state.user=null;state.observer?.(null)}
}));
import {LocalAdminRoute} from '../../src/features/local-admin/LocalAdminRoute';

const admin={uid:'fixture-admin',getIdToken:async()=>'fixture-token'};
const response=(value:unknown,status=200)=>({ok:status<400,status,json:async()=>value});
const category=(id:string,labelAr:string,extra:Record<string,unknown>={})=>({id,labelAr,questionCount:12,sourceKind:'saved-release',availabilityKey:id,playable:true,disabled:false,grouped:false,...extra});
const categories=[
 category('tahadani-001','دول العالم'),
 category('tahadani-002','أفلام قديمة',{disabled:true}),
 category('tahadani-003','فئة ناقصة',{playable:false}),
 category('alias-a','عملات',{availabilityKey:'shared-key',grouped:true}),
 category('alias-b','عملات',{availabilityKey:'shared-key',grouped:true}),
];
const questions=[
 {id:'q1',categoryId:'tahadani-001',promptAr:'ما عاصمة فرنسا؟',canonicalAnswer:'باريس',acceptedAnswers:['باريس'],points:200,modality:'classic',sourceKind:'saved-release',releaseId:'r',releaseRootHash:'h'},
 {id:'q2',categoryId:'tahadani-001',promptAr:'ما عاصمة مصر؟',canonicalAnswer:'القاهرة',acceptedAnswers:['القاهرة'],points:400,modality:'classic',sourceKind:'saved-release',releaseId:'r',releaseRootHash:'h'},
];
function route(url:string){
 if(url.endsWith('/session'))return Promise.resolve(response({email:'admin@example.test'}));
 if(url.endsWith('/categories'))return Promise.resolve(response({categories}));
 if(url.endsWith('/categories/availability'))return Promise.resolve(response({ok:true}));
 if(url.includes('/questions?'))return Promise.resolve(response({questions,total:questions.length}));
 if(url.includes('/revisions?'))return Promise.resolve(response({revisions:[]}));
 return Promise.resolve(response({error:'UNEXPECTED'},500));
}
const bodyOf=(fragment:string)=>state.fetch.mock.calls.filter(([url])=>String(url).includes(fragment)).map(([,init])=>JSON.parse(String((init as RequestInit).body)));
const renderAdmin=()=>render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);

beforeEach(()=>{vi.stubEnv('VITE_ALMAIDAN_LOCAL_ONLY','true');vi.stubEnv('VITE_FIREBASE_PROJECT_ID','demo-almaidan-local');state.user=admin;state.fetch.mockReset();state.fetch.mockImplementation(route);vi.stubGlobal('fetch',state.fetch);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('local admin categories board',()=>{
 it('opens on the categories tab with availability shown as switches',async()=>{
  renderAdmin();
  expect(await screen.findByRole('heading',{name:'الفئات'})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:/الفئات/})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('switch',{name:'إتاحة فئة دول العالم في المباريات الجديدة'})).toHaveAttribute('aria-checked','true');
  expect(screen.getByRole('switch',{name:'إتاحة فئة أفلام قديمة في المباريات الجديدة'})).toHaveAttribute('aria-checked','false');
  // A category without enough questions per tier cannot be offered, so its switch is inert.
  expect(screen.getByRole('switch',{name:'إتاحة فئة فئة ناقصة في المباريات الجديدة'})).toBeDisabled();
 });

 it('disables a category through the admin API and reflects it on every grouped row',async()=>{
  renderAdmin();
  const [first]=await screen.findAllByRole('switch',{name:'إتاحة فئة عملات في المباريات الجديدة'});
  fireEvent.click(first);
  await waitFor(()=>expect(bodyOf('/categories/availability')).toEqual([{categoryId:'alias-a',disabled:true}]));
  await waitFor(()=>screen.getAllByRole('switch',{name:'إتاحة فئة عملات في المباريات الجديدة'}).forEach(row=>expect(row).toHaveAttribute('aria-checked','false')));
  expect(screen.getByRole('status')).toHaveTextContent('لن تظهر في إعداد المباريات الجديدة');
 });

 it('filters by status with live counts',async()=>{
  renderAdmin();
  await screen.findByRole('heading',{name:'الفئات'});
  const filters=screen.getByRole('group',{name:'تصفية حسب الحالة'});
  fireEvent.click(within(filters).getByRole('button',{name:/معطّلة/}));
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  expect(screen.getByRole('heading',{name:'أفلام قديمة'})).toBeInTheDocument();
  fireEvent.click(within(filters).getByRole('button',{name:/غير جاهزة/}));
  expect(screen.getByRole('heading',{name:'فئة ناقصة'})).toBeInTheDocument();
 });

 it('reviews a category: switches to the question tab, searches it and steps through results',async()=>{
  renderAdmin();
  await screen.findByRole('heading',{name:'دول العالم'});
  const card=screen.getByRole('heading',{name:'دول العالم'}).closest('li')!;
  fireEvent.click(within(card).getByRole('button',{name:'مراجعة الأسئلة'}));
  expect(await screen.findByRole('heading',{name:'تصفح المحتوى'})).toBeInTheDocument();
  await waitFor(()=>expect(state.fetch.mock.calls.some(([url])=>String(url).includes('/questions?category=tahadani-001'))).toBe(true));
  fireEvent.click(await screen.findByRole('button',{name:/ما عاصمة فرنسا/}));
  expect(await screen.findByLabelText('السؤال أو التعليمات')).toHaveValue('ما عاصمة فرنسا؟');
  fireEvent.click(screen.getByRole('button',{name:'السؤال التالي'}));
  await waitFor(()=>expect(screen.getByLabelText('السؤال أو التعليمات')).toHaveValue('ما عاصمة مصر؟'));
  expect(screen.getByRole('button',{name:'السؤال التالي'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'السؤال السابق'})).toBeEnabled();
 });
});
