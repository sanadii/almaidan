import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation,useNavigate} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThemeProvider} from '../../src/app/ThemeProvider';
const mocks=vi.hoisted(()=>({create:vi.fn(),token:vi.fn(async()=>'demo-token'),signedIn:true}));
vi.mock('../../src/features/game/runtime',()=>({gameRuntime:{kind:'local',createRoom:mocks.create}}));
vi.mock('../../src/lib/local-development',()=>({isAlmaidanLocalDevelopment:true,isAlmaidanRealContent:true,localContentNote:'محتوى محلي'}));
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>({user:mocks.signedIn?{uid:'owner-one',isAnonymous:false,getIdToken:mocks.token}:null,status:'ready'})}));
import {HostNewRoute} from '../../src/routes/GameRoutes';
import {beginOwnerProvider,observeProviderOwner,invalidateProviderOwner,invalidateOwner} from '../../src/features/enta/auth-epoch';
import {localCreationKey,parseLocalCreationPending} from '../../src/features/game/runtime/local-creation-pending';
import {LocalRoomCreationFailure} from '../../src/features/game/runtime/local-realtime-game-adapter';

const uid='owner-one';let lease:ReturnType<typeof beginOwnerProvider>;
const inventory=(count=2)=>({source:'local_saved_release',huroofAvailable:true,recommendedHuroofCategoryIds:['category-0'],categories:Array.from({length:count},(_,i)=>({id:`category-${i}`,labelAr:`فئة محفوظة ${i}`,sourceOnly:false,questionCount:i<520?30:5,sourceQuestionCount:30,heldQuestionCount:0,huroofQuestionCount:i<520?30:0,categoryGameEligible:i<520,availability:i<520?'ready':'insufficient_questions',...(i>=520?{unavailableReason:'لا توجد إجابات مختلفة كافية لإنشاء اللوحة'}:{})}))});
const pending=()=>({uid,request:{requestKey:'owned-request-01',displayName:'المضيف',demo:true,gameKind:'huroof',modality:'classic',mode:'classic',questionSeconds:20,opponentSeconds:10,teams:{horizontal:'الأحمر',vertical:'الأخضر'},categories:['category-0'],labelledColours:false,mapPresentation:'ordinary'}});
function mount(){return render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?demo=true&category=category-0']}><Routes><Route path="/host/new" element={<HostNewRoute/>}/><Route path="/room/:code/lobby" element={<p>الغرفة جاهزة</p>}/></Routes></MemoryRouter></ThemeProvider>);}
beforeEach(()=>{lease=beginOwnerProvider();observeProviderOwner(lease,uid);sessionStorage.clear();localStorage.clear();mocks.signedIn=true;mocks.create.mockReset();mocks.token.mockReset().mockResolvedValue('demo-token');vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response(JSON.stringify(inventory())));});
afterEach(()=>{cleanup();invalidateOwner();vi.restoreAllMocks();});
async function ready(){const category=await screen.findByRole('button',{name:/^فئة محفوظة 0 —/});if(category.getAttribute('aria-pressed')!=='true')fireEvent.click(category);expect(screen.getByTestId('create-room')).toBeEnabled();}

it('shows the 520 playable categories first and reveals ten unavailable cards under one note',async()=>{
  vi.mocked(fetch).mockImplementation(async()=>new Response(JSON.stringify(inventory(530))));
  mount();
  await ready();
  expect(document.querySelectorAll('.category-choice')).toHaveLength(520);
  expect(screen.queryByText('فئة محفوظة 529')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'أظهر غير المتاحة (10)'}));
  const buttons = document.querySelectorAll<HTMLButtonElement>('.category-choice');
  expect(buttons).toHaveLength(530);
  expect([...buttons].filter(button=>button.disabled)).toHaveLength(10);
  expect(buttons[529]).toHaveAccessibleName('فئة محفوظة 529 — غير متاحة');
  expect(screen.getAllByText('هالفئات ما فيها أسئلة كافية للوح اللي اخترتوه.')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'أخفِ غير المتاحة'}));
  expect(screen.queryByText('فئة محفوظة 529')).not.toBeInTheDocument();
});

it('keeps an inventory-only category through loading and the sign-in return', async () => {
  mocks.signedIn = false;
  function SignIn() {
    const navigate = useNavigate();
    const returnTo = new URLSearchParams(useLocation().search).get('returnTo')!;
    return <button data-return-to={returnTo} onClick={() => { mocks.signedIn = true; navigate(returnTo); }}>تسجيل الدخول</button>;
  }
  let resolveInventory!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveInventory = resolve; }));
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&category=category-0']}><Routes>
    <Route path="/host/new" element={<HostNewRoute />} />
    <Route path="/login" element={<SignIn />} />
  </Routes></MemoryRouter></ThemeProvider>);
  expect(screen.getByTestId('create-room')).toBeDisabled();
  await act(async () => resolveInventory(new Response(JSON.stringify(inventory()))));
  expect(await screen.findByRole('button',{name:'فئة محفوظة 0 — محددة'})).toBeVisible();
  expect(screen.getByText('اختاروا فئة ثانية على الأقل لتكتمل اللوحة.')).toBeVisible();
  fireEvent.click(screen.getByTestId('create-room'));
  const signIn = await screen.findByRole('button', { name: 'تسجيل الدخول' });
  expect(signIn.getAttribute('data-return-to')).toContain('category=category-0');
  fireEvent.click(signIn);
  expect(await screen.findByRole('button',{name:'فئة محفوظة 0 — محددة'})).toBeVisible();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('updates the live answer coverage and clears a definitive rejection when another category is picked', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).startsWith('/api/question-inventory/coverage?')) {
      const selected = new URL(String(url), 'http://example.test').searchParams.getAll('category');
      return Response.json({ sufficient: selected.length >= 2 });
    }
    return Response.json(inventory());
  });
  mocks.create.mockRejectedValueOnce(new LocalRoomCreationFailure(422, 'QUESTION_SCOPE_INSUFFICIENT_COVERAGE'))
    .mockResolvedValueOnce({roomId:'owned-room',roomCode:'ABCDEF',token:'host-cap'});
  mount();
  await ready();
  expect(await screen.findByText('تحتاجون فئات أكثر')).toBeVisible();
  fireEvent.click(screen.getByTestId('create-room'));
  expect(await screen.findByRole('alert')).toHaveTextContent('الفئات المختارة لا تكفي لتعبئة اللوح.');
  expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus();
  expect(sessionStorage.getItem(localCreationKey(uid))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'فئة محفوظة 1 — أضف إلى الاختيار' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const sufficient = await screen.findByText('أسئلة كافية');
  expect(sufficient).toBeVisible();
  expect(sufficient.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  fireEvent.click(screen.getByTestId('create-room'));
  expect(await screen.findByText('الغرفة جاهزة')).toBeVisible();
  expect(mocks.create.mock.calls[1][0].categories).toEqual(['category-0', 'category-1']);
});

it('randomly fills the remaining category board choice with an available category', async () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&category=category-0']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(await screen.findByRole('button', { name: 'فئة محفوظة 0 — محددة' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'اختاروا لنا عشوائياً' }));
  expect(screen.getByRole('button', { name: 'فئة محفوظة 1 — محددة' })).toBeVisible();
  expect(screen.getByText('فئة محفوظة 0، فئة محفوظة 1', { selector: 'dd' })).toBeVisible();
});
it.each(['{broken',JSON.stringify({...pending(),uid:'someone-else'}),JSON.stringify({...pending(),request:{...pending().request,requestKey:'bad'}})])('blocks unreadable saved creation without overwriting it',async raw=>{
 sessionStorage.setItem(localCreationKey(uid),raw);mount();await screen.findByText(/تعذر قراءة طلب إنشاء الغرفة المحفوظ/);expect(screen.getByTestId('create-room')).toBeDisabled();fireEvent.click(screen.getByTestId('create-room'));expect(mocks.create).not.toHaveBeenCalled();expect(sessionStorage.getItem(localCreationKey(uid))).toBe(raw);
});
it('rejects malformed pending objects including dangerous scope and oversized input',()=>{
 const p=pending();for(const request of [{...p.request,demo:false},{...p.request,categories:['../category']},{...p.request,categories:[]},{...p.request,unexpected:true},{...p.request,teams:null}])expect(()=>parseLocalCreationPending(JSON.stringify({...p,request}),uid)).toThrow();expect(()=>parseLocalCreationPending(' '.repeat(32769),uid)).toThrow();expect(parseLocalCreationPending(JSON.stringify(p),uid)).toEqual(p);
});
it('retries identical saved creation after an uncertain failure and clears it only after saving capabilities',async()=>{
 mocks.create.mockRejectedValueOnce(Error('lost reply')).mockResolvedValueOnce({roomId:'owned-room',roomCode:'ABCDEF',token:'host-cap'});mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.create).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByTestId('create-room')).toBeEnabled());const raw=sessionStorage.getItem(localCreationKey(uid));expect(raw).toBeTruthy();fireEvent.click(screen.getByTestId('create-room'));expect(await screen.findByText('الغرفة جاهزة')).toBeInTheDocument();expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);expect(sessionStorage.getItem(localCreationKey(uid))).toBeNull();expect(sessionStorage.getItem('huroof:owned-room')).toContain('host-cap');
});
it('fences signout/signin to the same UID during the token await',async()=>{
 let resolve!:(s:string)=>void;mocks.token.mockImplementation(()=>new Promise(r=>{resolve=r;}));mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.token).toHaveBeenCalled());const raw=sessionStorage.getItem(localCreationKey(uid));invalidateProviderOwner(lease);observeProviderOwner(lease,uid);await act(async()=>resolve('late-token'));expect(mocks.create).not.toHaveBeenCalled();expect(sessionStorage.getItem(localCreationKey(uid))).toBe(raw);expect(screen.queryByText('الغرفة جاهزة')).not.toBeInTheDocument();
});
it('fences an unmounted creator before committing a late capability response',async()=>{
 let resolve!:(v:unknown)=>void;mocks.create.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.create).toHaveBeenCalled());const raw=sessionStorage.getItem(localCreationKey(uid));view.unmount();await act(async()=>resolve({roomId:'late-room',roomCode:'LATE11',token:'late-cap'}));expect(sessionStorage.getItem('huroof:late-room')).toBeNull();expect(sessionStorage.getItem(localCreationKey(uid))).toBe(raw);
});
it('retains pending on storage failure before capability persistence',async()=>{
 mocks.create.mockResolvedValue({roomId:'owned-room',roomCode:'ABCDEF',token:'host-cap'});const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(key,value){if(key==='huroof:owned-room')throw Error('storage full');return original.call(this,key,value);});mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.create).toHaveBeenCalled());await waitFor(()=>expect(screen.getByTestId('create-room')).toBeEnabled());expect(sessionStorage.getItem(localCreationKey(uid))).toBeTruthy();expect(screen.queryByText('الغرفة جاهزة')).not.toBeInTheDocument();
});
it('clears only its own captured pending bytes after a definitive no-effect rejection',async()=>{
 mocks.create.mockRejectedValue(new LocalRoomCreationFailure(422,'LOCAL_CREATE_SETUP_UNAVAILABLE'));mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.create).toHaveBeenCalled());await waitFor(()=>expect(screen.getByTestId('create-room')).toBeEnabled());expect(sessionStorage.getItem(localCreationKey(uid))).toBeNull();
});
it('does not clear a replaced pending request when the earlier request gets a definitive rejection',async()=>{
 let reject!:(e:Error)=>void;mocks.create.mockImplementation(()=>new Promise((_,r)=>{reject=r;}));mount();await ready();fireEvent.click(screen.getByTestId('create-room'));await waitFor(()=>expect(mocks.create).toHaveBeenCalled());const replacement=JSON.stringify({...pending(),request:{...pending().request,requestKey:'newer-request-02'}});sessionStorage.setItem(localCreationKey(uid),replacement);await act(async()=>reject(new LocalRoomCreationFailure(422,'LOCAL_CREATE_SETUP_UNAVAILABLE')));expect(sessionStorage.getItem(localCreationKey(uid))).toBe(replacement);expect(screen.getByTestId('create-room')).toBeDisabled();
});
