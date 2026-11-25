import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {Link,MemoryRouter,Route,Routes} from 'react-router-dom';
import {RouteAuthRuntime} from '../../src/app/App';
import {EntryRoute} from '../../src/routes/EntryRoute';
import {LoginRoute} from '../../src/routes/AuthRoutes';
import {FirebaseAuthProvider} from '../../src/features/auth/AuthProvider';
import {useFirebaseAuth} from '../../src/features/auth/auth-context';
import {invalidateOwner,isOwnerEpoch,ownerEpoch} from '../../src/features/enta/auth-epoch';

const seam=vi.hoisted(()=>({auth:{currentUser:null as any,authStateReady:vi.fn<()=>Promise<void>>()},observers:new Set<(user:any)=>void>(),subscribe:vi.fn(),signIn:vi.fn(),getAuth:vi.fn()}));
vi.mock('firebase/auth',async original=>({...await original<typeof import('firebase/auth')>(),
 onAuthStateChanged:(_auth:unknown,next:(user:any)=>void)=>{seam.subscribe();seam.observers.add(next);return()=>seam.observers.delete(next);},signInWithEmailAndPassword:seam.signIn,
}));
vi.mock('../../src/lib/firebase/client',()=>({getOptionalFirebaseAuth:()=>{seam.getAuth();return seam.auth;}}));
vi.mock('../../src/lib/local-development',()=>({isAlmaidanLocalDevelopment:true,isAlmaidanRealContent:true,localContentNote:'local'}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('../../src/routes/HomeSurface',()=>({HomeSurface:()=>{const auth=useFirebaseAuth();return <><h1>Home</h1><output data-testid="home-auth">{auth.status}</output><Link to="/login">Login</Link><Link to="/history">History</Link></>;}}));
function HistoryProbe(){const auth=useFirebaseAuth();return <><h1>History</h1><output data-testid="history-owner">{auth.user&&isOwnerEpoch(ownerEpoch(auth.user.uid))?auth.user.uid:'unavailable'}</output><Link to="/">Home</Link></>;}
beforeEach(()=>{invalidateOwner();seam.auth.currentUser=null;seam.auth.authStateReady.mockReset().mockResolvedValue();seam.observers.clear();seam.subscribe.mockClear();seam.getAuth.mockClear();seam.signIn.mockReset();});
afterEach(()=>{cleanup();invalidateOwner();});

it('keeps one owner provider from homepage through delayed login restoration and home/history navigation',async()=>{
 let restore!:()=>void;seam.auth.authStateReady.mockImplementation(()=>new Promise<void>(resolve=>{restore=resolve;}));
 render(<MemoryRouter><RouteAuthRuntime><Routes><Route path="/" element={<EntryRoute/>}/><Route path="/login" element={<LoginRoute/>}/><Route path="/history" element={<HistoryProbe/>}/></Routes></RouteAuthRuntime></MemoryRouter>);
 await waitFor(()=>expect(seam.subscribe).toHaveBeenCalledOnce());
 fireEvent.click(screen.getByRole('link',{name:'Login'}));
 expect(screen.getByLabelText('البريد الإلكتروني')).toBeDisabled();
 await act(async()=>restore());
 await waitFor(()=>expect(screen.getByLabelText('البريد الإلكتروني')).toBeEnabled());
 const user={uid:'composition-host',isAnonymous:false,providerData:[{providerId:'password'}],emailVerified:true,email:'host@example.test'};
 seam.signIn.mockImplementation(async()=>{seam.auth.currentUser=user;seam.observers.forEach(next=>next(user));return {user};});
 fireEvent.change(screen.getByLabelText('البريد الإلكتروني'),{target:{value:user.email}});fireEvent.change(screen.getByLabelText('كلمة المرور'),{target:{value:'local-test-only'}});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'تسجيل الدخول بالبريد'})));
 await waitFor(()=>expect(screen.getByTestId('home-auth')).toHaveTextContent('password'));
 expect(seam.signIn).toHaveBeenCalledWith(seam.auth,user.email,'local-test-only');
 const epoch=ownerEpoch(user.uid);
 fireEvent.click(screen.getByRole('link',{name:'History'}));expect(screen.getByTestId('history-owner')).toHaveTextContent(user.uid);
 fireEvent.click(screen.getByRole('link',{name:'Home'}));expect(isOwnerEpoch(epoch)).toBe(true);
 expect(seam.subscribe).toHaveBeenCalledOnce();expect(seam.observers.size).toBe(1);expect(seam.getAuth).toHaveBeenCalledOnce();
});

it('retains standalone EntryRoute auth and reuses an explicitly supplied provider',async()=>{
 const standalone=render(<MemoryRouter><EntryRoute/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByTestId('home-auth')).toHaveTextContent('signedOut'));
 expect(seam.subscribe).toHaveBeenCalledOnce();standalone.unmount();expect(seam.observers.size).toBe(0);
 seam.subscribe.mockClear();
 render(<MemoryRouter><FirebaseAuthProvider><EntryRoute/></FirebaseAuthProvider></MemoryRouter>);
 await waitFor(()=>expect(screen.getByTestId('home-auth')).toHaveTextContent('signedOut'));
 expect(seam.subscribe).toHaveBeenCalledOnce();expect(seam.observers.size).toBe(1);
});
