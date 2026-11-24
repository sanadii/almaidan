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
const question=(id:string,promptAr:string)=>({id,categoryId:'cat',promptAr,canonicalAnswer:'جواب',acceptedAnswers:['جواب'],points:200,sourceKind:'saved-release',releaseId:'release',releaseRootHash:'root'});
const rows=[question('q1','السؤال الأول'),question('q2','السؤال الثاني')];
type Handler=(url:string,init?:RequestInit)=>unknown;
let override:Handler|null=null;
function route(url:string,init?:RequestInit){
 const custom=override?.(url,init);if(custom)return Promise.resolve(custom);
 if(url.endsWith('/session'))return Promise.resolve(response({email:'admin@example.test'}));
 if(url.endsWith('/categories'))return Promise.resolve(response({categories:[{id:'cat',labelAr:'فئة',questionCount:2}]}));
 if(url.includes('/questions?'))return Promise.resolve(response({questions:rows,total:rows.length}));
 if(url.includes('/revisions?'))return Promise.resolve(response({revisions:[]}));
 if(url.endsWith('/drafts'))return Promise.resolve(response({id:'draft-1',status:'draft'}));
 return Promise.resolve(response({error:'UNEXPECTED'},500));
}
const calls=(fragment:string)=>state.fetch.mock.calls.filter(([url])=>String(url).includes(fragment));
async function openEditor(name:RegExp){
 render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('tab',{name:/مراجعة الأسئلة/}));await screen.findByRole('heading',{name:'تصفح المحتوى'});
 fireEvent.click(screen.getByRole('button',{name:'بحث'}));
 fireEvent.click(await screen.findByRole('button',{name}));
 return screen.findByLabelText('السؤال أو التعليمات');
}
beforeEach(()=>{vi.stubEnv('VITE_ALMAIDAN_LOCAL_ONLY','true');vi.stubEnv('VITE_FIREBASE_PROJECT_ID','demo-almaidan-local');state.user=admin;override=null;state.fetch.mockReset();state.fetch.mockImplementation(route);vi.stubGlobal('fetch',state.fetch);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('local admin editor flow',()=>{
 it('distinguishes an empty search result from the not-yet-searched hint',async()=>{
  override=url=>url.includes('/questions?')?response({questions:[],total:0}):null;
  render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab',{name:/مراجعة الأسئلة/}));await screen.findByRole('heading',{name:'تصفح المحتوى'});
  expect(screen.getByText('اختر فئة أو اكتب عبارة ثم ابحث.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'بحث'}));
  expect(await screen.findByText(/لا توجد أسئلة مطابقة لهذا البحث/)).toBeInTheDocument();
 });

 it('moves focus to the editor and marks the selected question',async()=>{
  await openEditor(/السؤال الأول/);
  await waitFor(()=>expect(document.activeElement).toHaveTextContent('معاينة وتحرير السؤال'));
  expect(screen.getByRole('button',{name:/السؤال الأول/})).toHaveAttribute('aria-current','true');
  expect(screen.getByRole('button',{name:/السؤال الثاني/})).not.toHaveAttribute('aria-current');
 });

 it('keeps unsaved edits when switching questions is cancelled, and stops asking once the draft is saved',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const prompt=await openEditor(/السؤال الأول/);
  fireEvent.change(prompt,{target:{value:'نص معدّل لم يُحفظ'}});
  fireEvent.click(screen.getByRole('button',{name:/السؤال الثاني/}));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('السؤال أو التعليمات')).toHaveValue('نص معدّل لم يُحفظ');
  expect(screen.getByText('q1',{selector:'.local-admin-id'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة جديدة'}));
  await waitFor(()=>expect(calls('/drafts')).toHaveLength(1));
  await screen.findByRole('status');
  confirm.mockClear();
  fireEvent.click(screen.getByRole('button',{name:/السؤال الثاني/}));
  await waitFor(()=>expect(screen.getByText('q2',{selector:'.local-admin-id'})).toBeInTheDocument());
  expect(confirm).not.toHaveBeenCalled();
 });

 it('switches questions after the admin confirms discarding edits',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);
  const prompt=await openEditor(/السؤال الأول/);
  fireEvent.change(prompt,{target:{value:'تعديل مهمل'}});
  fireEvent.click(screen.getByRole('button',{name:/السؤال الثاني/}));
  await waitFor(()=>expect(screen.getByLabelText('السؤال أو التعليمات')).toHaveValue('السؤال الثاني'));
 });

 it('drops blank accepted-answer lines instead of sending them to the server',async()=>{
  await openEditor(/السؤال الأول/);
  fireEvent.change(screen.getByLabelText('الإجابات المقبولة (إجابة في كل سطر)'),{target:{value:'جواب\nبديل\n\n'}});
  fireEvent.click(screen.getByRole('button',{name:'حفظ مسودة جديدة'}));
  await waitFor(()=>expect(calls('/drafts')).toHaveLength(1));
  const body=JSON.parse(String((calls('/drafts')[0][1] as RequestInit).body));
  expect(body.payload.acceptedAnswers).toEqual(['جواب','بديل']);
 });

 it('refreshes the revision list after an activation conflict instead of leaving the stale head on screen',async()=>{
  const revision={id:'rev-1',payload:{promptAr:'نسخة مراجعة'},reviewerUid:'fixture-admin',active:false,createdAt:'2026-11-01T00:00:00Z'};
  override=(url)=>url.includes('/revisions?')?response({revisions:[revision]}):url.endsWith('/revisions/rev-1/activate')?response({error:'ACTIVE_REVISION_CONFLICT'},409):null;
  await openEditor(/السؤال الأول/);
  fireEvent.click(await screen.findByRole('button',{name:'تفعيل للمباريات الجديدة'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('من جلسة أخرى');
  expect(calls('/revisions?').length).toBeGreaterThanOrEqual(2);
  expect(calls('/questions?category=cat&q=q1').length).toBe(1);
 });

 it('treats an expired bearer as an ended session rather than a missing admin role',async()=>{
  override=url=>url.endsWith('/session')?response({error:'AUTHENTICATION_REQUIRED'},401):null;
  render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('انتهت الجلسة');
 });

 it('reports a non-JSON proxy failure as an unavailable local service',async()=>{
  override=url=>url.includes('/questions?')?{ok:false,status:502,json:async()=>{throw new SyntaxError('Unexpected token <');}}:null;
  render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab',{name:/مراجعة الأسئلة/}));await screen.findByRole('heading',{name:'تصفح المحتوى'});
  fireEvent.click(screen.getByRole('button',{name:'بحث'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذرت خدمة الإدارة المحلية');
  expect(within(screen.getByRole('main')).getByRole('heading',{name:'تصفح المحتوى'})).toBeInTheDocument();
 });
});
