import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({user:null as any,observer:null as null|((u:any)=>void),ready:Promise.resolve(),failLogout:false,fetch:vi.fn(),auth:{emulatorConfig:null as any,authStateReady:()=>state.ready},setPersistence:vi.fn(async()=>{})}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('firebase/app',()=>({getApps:()=>[],initializeApp:()=>({})}));
vi.mock('firebase/auth',()=>({
 getAuth:()=>state.auth,connectAuthEmulator:()=>{state.auth.emulatorConfig={host:'127.0.0.1',port:19099}},browserSessionPersistence:{kind:'session'},
 setPersistence:state.setPersistence,
 onAuthStateChanged:(_:unknown,cb:(user:any)=>void)=>{state.observer=cb;queueMicrotask(()=>cb(state.user));return()=>{state.observer=null}},
 signInWithEmailAndPassword:async()=>{state.user=admin;state.observer?.(admin);return {user:admin}},
 signOut:async()=>{if(state.failLogout)throw Error('failed');state.user=null;state.observer?.(null)}
}));
import {LocalAdminRoute} from '../../src/features/local-admin/LocalAdminRoute';
const admin={uid:'fixture-admin',getIdToken:async()=> 'fixture-token'};
const response=(value:unknown,status=200)=>({ok:status<400,status,json:async()=>value});
const renderRoute=()=>render(<MemoryRouter><LocalAdminRoute/></MemoryRouter>);
beforeEach(()=>{vi.stubEnv('VITE_ALMAIDAN_LOCAL_ONLY','true');vi.stubEnv('VITE_FIREBASE_PROJECT_ID','demo-almaidan-local');state.user=null;state.failLogout=false;state.ready=Promise.resolve();state.fetch.mockReset();state.fetch.mockImplementation((url:string)=>Promise.resolve(response(url.endsWith('/session')?{email:'admin@example.test'}:{categories:[]})));vi.stubGlobal('fetch',state.fetch)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs()});
describe('local admin session',()=>{
 it('restores a session on mount and remount, then logout remains signed out',async()=>{
  state.user=admin;const view=renderRoute();
  expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحقق');
  expect(screen.queryByRole('heading',{name:'الدخول بحساب الإدارة المحلي'})).not.toBeInTheDocument();
  expect(await screen.findByRole('button',{name:'خروج الإدارة'})).toBeInTheDocument();
  view.unmount();renderRoute();expect(await screen.findByRole('button',{name:'خروج الإدارة'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'خروج الإدارة'}));
  expect(await screen.findByRole('heading',{name:'الدخول بحساب الإدارة المحلي'})).toBeInTheDocument();
  cleanup();renderRoute();expect(await screen.findByRole('heading',{name:'الدخول بحساب الإدارة المحلي'})).toBeInTheDocument();
 });
 it('signs in and requires server authorization before showing content',async()=>{
  renderRoute();await screen.findByRole('heading',{name:'الدخول بحساب الإدارة المحلي'});
  fireEvent.change(screen.getByLabelText('البريد الإلكتروني'),{target:{value:'admin@example.test'}});
  fireEvent.change(screen.getByLabelText('كلمة المرور'),{target:{value:'example-password'}});
  fireEvent.click(screen.getByRole('button',{name:'الدخول'}));
  expect(await screen.findByRole('button',{name:'خروج الإدارة'})).toBeInTheDocument();
  expect(state.fetch.mock.calls.some(([url])=>String(url).endsWith('/session'))).toBe(true);
 });
 it('rejects unauthorized restored identities without exposing the editor',async()=>{
  state.user=admin;state.fetch.mockResolvedValue(response({error:'LOCAL_ADMIN_REQUIRED'},403));renderRoute();
  expect(await screen.findByRole('alert')).toHaveTextContent('لا يملك صلاحية');
  expect(screen.queryByRole('heading',{name:'تصفح المحتوى'})).not.toBeInTheDocument();
 });
 it('ignores an old response after the identity changes',async()=>{
  state.user=admin;let finish!:(v:any)=>void;
  state.fetch.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
  renderRoute();await waitFor(()=>expect(finish).toBeTypeOf('function'));
  act(()=>{state.user=null;state.observer?.(null)});
  await act(async()=>{finish(response({email:'old@example.test'}));});
  expect(screen.queryByText('old@example.test')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'تصفح المحتوى'})).not.toBeInTheDocument();
 });
 it('allows retry when local admin sign-out fails',async()=>{
  state.user=admin;renderRoute();await screen.findByRole('button',{name:'خروج الإدارة'});
  state.failLogout=true;fireEvent.click(screen.getByRole('button',{name:'خروج الإدارة'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تسجيل الخروج');
  expect(screen.queryByRole('heading',{name:'تصفح المحتوى'})).not.toBeInTheDocument();
  state.failLogout=false;fireEvent.click(screen.getByRole('button',{name:'إعادة محاولة خروج الإدارة'}));
  await waitFor(()=>expect(state.user).toBeNull());
 });
 it('does not dispatch a request if the identity changes while a token is pending',async()=>{
  let token!:(value:string)=>void;state.user={uid:'old',getIdToken:()=>new Promise(resolve=>{token=resolve})};
  renderRoute();await waitFor(()=>expect(token).toBeTypeOf('function'));
  act(()=>{state.user=null;state.observer?.(null)});
  await act(async()=>{token('old-token');});
  expect(state.fetch).not.toHaveBeenCalled();
 });

 it('closes an open editor when the admin token expires',async()=>{
  const identity={uid:'expiring',getIdToken:vi.fn().mockResolvedValue('ok')};state.user=identity;
  renderRoute();await screen.findByRole('heading',{name:'تصفح المحتوى'});
  identity.getIdToken.mockRejectedValue({code:'auth/user-token-expired'});
  const before=state.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole('button',{name:'بحث'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('انتهت الجلسة');
  expect(screen.queryByRole('heading',{name:'تصفح المحتوى'})).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(before);
 });

 it('stops a chained selection after its original identity changes',async()=>{
  const pending:Array<(value:string)=>void>=[];
  const identity={uid:'old-admin',getIdToken:vi.fn().mockResolvedValue('old-token')};
  const row={id:'old-question',promptAr:'سؤال خاص',canonicalAnswer:'جواب',challenge:{kind:'memory'},media:{type:'image',mediaId:'m',assetSha256:'hash'}};
  state.user=identity;
  state.fetch.mockImplementation((url:string)=>{
   if(url.includes('/questions?'))return Promise.resolve(response({questions:[row],total:1}));
   if(url.includes('/challenge-definition')){identity.getIdToken.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));return Promise.resolve(response({publicData:{},privateGrading:{}}));}
   return Promise.resolve(response(url.endsWith('/session')?{email:'old@example.test'}:{categories:[]}));
  });
  renderRoute();await screen.findByRole('heading',{name:'تصفح المحتوى'});
  fireEvent.click(screen.getByRole('button',{name:'بحث'}));
  fireEvent.click(await screen.findByRole('button',{name:/سؤال خاص/}));
  await waitFor(()=>expect(pending).toHaveLength(2));
  act(()=>{state.user=null;state.observer?.(null)});
  await act(async()=>{pending.forEach(resolve=>resolve('old-token'));});
  expect(state.fetch.mock.calls.some(([url])=>String(url).includes('/media-options'))).toBe(false);
  expect(screen.queryByText('سؤال خاص')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('بيانات التقييم الخاصة')).not.toBeInTheDocument();
 });

});
