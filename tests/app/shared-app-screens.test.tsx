import {act,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
import type {User} from 'firebase/auth';
import {ThemeProvider} from '../../src/app/ThemeProvider';
import {FirebaseAuthContext,loadingAuthContext,type FirebaseAuthContextValue} from '../../src/features/auth/auth-context';
import {AccountRoute,LoginRoute} from '../../src/routes/AuthRoutes';
import {NameJoinRoute} from '../../src/routes/NameJoinRoute';
import {InternalHeader} from '../../src/design-system/InternalHeader';
import {CLIENT_CHALLENGE_CAPABILITY} from '../../src/features/game/runtime/contracts';

vi.mock('../../src/features/game/runtime',()=>({gameRuntime:{kind:'fixture'}}));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();sessionStorage.clear();});
function mount(route:'login'|'account'|'join',overrides:Partial<FirebaseAuthContextValue>={}) {
  return render(<ThemeProvider><FirebaseAuthContext.Provider value={{...loadingAuthContext,status:'signedOut',isAvailable:true,...overrides}}><MemoryRouter initialEntries={[route==='join'?'/room/ab-12/join':`/${route}`]}><Routes><Route path="/login" element={<LoginRoute/>}/><Route path="/account" element={<AccountRoute/>}/><Route path="/room/:roomCode/join" element={<NameJoinRoute/>}/><Route path="/room/:roomCode/lobby" element={<h1>ردهة الغرفة</h1>}/><Route path="/" element={<h1>الرئيسية</h1>}/></Routes></MemoryRouter></FirebaseAuthContext.Provider></ThemeProvider>);
}
const identity={isAnonymous:false,displayName:'ليان',email:'lian@example.test',emailVerified:true} as User;
it('uses the product title and sends email credentials through the existing actions',async()=>{
  const signInWithEmailPassword=vi.fn().mockResolvedValue(undefined),createEmailPasswordAccount=vi.fn().mockResolvedValue(undefined);
  mount('login',{signInWithEmailPassword,createEmailPasswordAccount});const user=userEvent.setup();
  expect(document.title).toBe('تسجيل الدخول | الميدان');
  expect(screen.getByRole('link',{name:'الميدان — الرئيسية'})).toHaveAttribute('href','/');
  await user.type(screen.getByLabelText('البريد الإلكتروني'),'player@example.test');await user.type(screen.getByLabelText('كلمة المرور'),'password123');
  await user.click(screen.getByRole('button',{name:'تسجيل الدخول بالبريد'}));
  expect(signInWithEmailPassword).toHaveBeenCalledWith('player@example.test','password123');
  await user.click(screen.getByRole('button',{name:'إنشاء حساب جديد وإرسال رسالة التحقق'}));
  expect(createEmailPasswordAccount).toHaveBeenCalledWith('player@example.test','password123');
});
it('preserves the guest linking guidance and invokes Google sign in',async()=>{
  const signInWithGoogle=vi.fn().mockResolvedValue(undefined);mount('login',{status:'anonymous',user:{isAnonymous:true} as User,signInWithGoogle});
  expect(screen.getByText(/ربط Google يحافظ على جلسة الغرفة الحالية/)).toBeVisible();
  await userEvent.click(screen.getByRole('button',{name:'المتابعة مع Google'}));expect(signInWithGoogle).toHaveBeenCalledOnce();
});
it('disables duplicate actions and credential editing while sign in is pending',()=>{
  mount('login',{pendingAction:'signIn'});expect(screen.getAllByRole('button',{name:'جارٍ تسجيل الدخول…'}).every(button=>button.hasAttribute('disabled'))).toBe(true);expect(screen.getByLabelText('البريد الإلكتروني')).toBeDisabled();
});
it('renders the actual account verification state without adding commerce claims',()=>{
  mount('account',{status:'password',user:{...identity,emailVerified:false} as User});
  expect(document.title).toBe('الحساب | الميدان');expect(screen.getByRole('navigation',{name:'أقسام الحساب'})).toBeVisible();expect(screen.getByText('استضافة المباراة تتطلب حساباً موثقاً.')).toBeVisible();expect(screen.queryByText(/رصيد|محفظة/)).not.toBeInTheDocument();
});
it('renders the account restoration and signed out redirect',()=>{
  const view=mount('account',{status:'loading',isAvailable:false});expect(screen.getByText('جارٍ استعادة الحساب…')).toHaveAttribute('role','status');view.unmount();
  mount('account');expect(screen.getByRole('heading',{name:'سجّل دخولك'})).toBeVisible();
});
it('closes the navigation with Escape and restores keyboard focus',async()=>{
  mount('login');const user=userEvent.setup(),toggle=screen.getByRole('button',{name:'القائمة'});await user.click(toggle);expect(toggle).toHaveAttribute('aria-expanded','true');
  await user.keyboard('{Escape}');expect(toggle).toHaveAttribute('aria-expanded','false');await vi.waitFor(()=>expect(toggle).toHaveFocus());
});
it('retains pending, failed and successful join behavior with a normalized room code',async()=>{
  let settle:(response:Response)=>void=()=>undefined;const fetchMock=vi.fn(()=>new Promise<Response>(resolve=>{settle=resolve;}));vi.stubGlobal('fetch',fetchMock);mount('join');const user=userEvent.setup();
  expect(document.title).toBe('اسم اللاعب | الميدان');await user.type(screen.getByLabelText('اسم اللاعب'),' نور ');await user.click(screen.getByRole('button',{name:'دخول الغرفة'}));expect(screen.getByRole('button',{name:'جارٍ الدخول…'})).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledWith('/api/rooms/AB12/join',expect.objectContaining({method:'POST'}));
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({displayName:'نور',requestKey:expect.any(String),challenge:CLIENT_CHALLENGE_CAPABILITY});
  await act(async()=>settle(new Response('ROOM_UNAVAILABLE',{status:503})));expect(screen.getByRole('alert')).toHaveTextContent('تعذر الانضمام الآن. تحقق من اتصال الخدمة ثم حاول مرة أخرى.');expect(screen.getByRole('button',{name:'دخول الغرفة'})).toBeEnabled();
  await user.click(screen.getByRole('button',{name:'دخول الغرفة'}));await act(async()=>settle(new Response(JSON.stringify({roomId:'fixture-room',token:'fixture-token'}))));
  expect(await screen.findByRole('heading',{name:'ردهة الغرفة'})).toBeVisible();expect(JSON.parse(sessionStorage.getItem('huroof:fixture-room')!)).toEqual({token:'fixture-token',role:'player'});
});

it('keeps focused game navigation minimal while retaining the home and theme controls',()=>{
 render(<ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={{...loadingAuthContext,status:'signedOut',isAvailable:true}}><InternalHeader gameContext /></FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
 expect(screen.getByRole('link',{name:'الميدان — الرئيسية'})).toHaveAttribute('href','/');
 expect(screen.queryByRole('navigation',{name:'التنقل الرئيسي'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'القائمة'})).not.toBeInTheDocument();
 expect(screen.getByLabelText(/^المظهر:/)).toBeInTheDocument();
});
