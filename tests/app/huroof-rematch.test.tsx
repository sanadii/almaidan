import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
const mocks=vi.hoisted(()=>{const token=vi.fn(async()=>'id-token');return {token,rematch:vi.fn(),carry:vi.fn(),user:{uid:'owner',isAnonymous:false,getIdToken:token}};});
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>({user:mocks.user})}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('../../src/features/game/runtime',()=>({gameRuntime:{kind:'local',rematchRoom:mocks.rematch,carryRematch:mocks.carry}}));
vi.mock('../../src/lib/local-development',async (importOriginal)=>({...await importOriginal<typeof import('../../src/lib/local-development')>(),isAlmaidanLocalDevelopment:true}));
import {HuroofRematch} from '../../src/features/game/HuroofRematch';
import {parseHuroofRematchResult} from '../../src/features/game/huroof-rematch-client';
import {beginOwnerProvider,observeProviderOwner,invalidateProviderOwner,invalidateOwner} from '../../src/features/enta/auth-epoch';
import { RoomRoute } from '../../src/routes/GameRoutes';
import { LocalRoomCreationFailure } from '../../src/features/game/runtime/local-realtime-game-adapter';
const id='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222',key=`almaidan:huroof-rematch:owner:${id}`;
const result=()=>({roomId:child,roomCode:'ABCDEF',revision:1,token:'child-capability'.repeat(3),predecessorRoomId:id,source:{snapshotId:'a'.repeat(64),selection:'UNSEEN_PREDECESSOR'}});
let lease:ReturnType<typeof beginOwnerProvider>;
beforeEach(()=>{lease=beginOwnerProvider();observeProviderOwner(lease,'owner');sessionStorage.clear();sessionStorage.setItem(`huroof:${id}`,JSON.stringify({role:'host',token:'host-capability'.repeat(3)}));mocks.token.mockReset().mockResolvedValue('id-token');mocks.rematch.mockReset();mocks.carry.mockReset();});
afterEach(()=>{cleanup();invalidateOwner();vi.unstubAllGlobals();vi.restoreAllMocks();});
const mount=()=>render(<MemoryRouter initialEntries={[`/huroof/rematch/${id}`]}><Routes><Route path="/huroof/rematch/:id" element={<HuroofRematch/>}/><Route path="/room/:code/lobby" element={<p>تمت الإعادة</p>}/></Routes></MemoryRouter>);
const click=()=>fireEvent.click(screen.getByRole('button',{name:'إنشاء غرفة الإعادة'}));
it('retries the identical request and uses explicit current-owner host capability',async()=>{
 mocks.rematch.mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce(result());mount();click();await screen.findByRole('alert');const pending=sessionStorage.getItem(key);expect(pending).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'حاولوا مرة ثانية'}));await screen.findByText('تمت الإعادة');expect(mocks.rematch.mock.calls[1][1]).toBe(mocks.rematch.mock.calls[0][1]);expect(mocks.rematch.mock.calls[0][2]).toMatchObject({idToken:'id-token',hostCapability:'host-capability'.repeat(3)});expect(sessionStorage.getItem(key)).toBeNull();expect(sessionStorage.getItem(`huroof:${child}`)).toContain('child-capability');
});
it.each([
  [409,'LOCAL_REMATCH_NOT_FINISHED','كمّلوا المباراة الحالية'],
  [422,'LOCAL_REMATCH_SOURCE_UNAVAILABLE','تعذّر استعادة أسئلة المباراة السابقة'],
  [422,'LOCAL_CREATE_SETUP_UNAVAILABLE','ما بقيت أسئلة كافية'],
] as const)('clears a definitive rematch failure %s %s and removes retry',async(status,code,message)=>{
  mocks.rematch.mockRejectedValueOnce(new LocalRoomCreationFailure(status,code));
  mount();click();
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(document.title).toBe('إعادة مباراة الخلية | الميدان');
});

function mountResults(role: 'host' | 'player' = 'host') {
  sessionStorage.setItem('huroof:code:SOURCE', id);
  if (role === 'player') sessionStorage.setItem(`huroof:${id}`, JSON.stringify({ role, token: 'old-player-token' }));
  const snapshot = { roomId: id, revision: 9, serverTime: new Date().toISOString(), role, projection: {
    room: { roomCode: 'SOURCE', state: 'MATCH_COMPLETE', readyCount: 0, memberCount: 0,
      ...(role === 'player' ? { successor: { roomId: child, roomCode: 'ABCDEF' } } : {}) }, matchWinner: 'horizontal',
  } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot))));
  vi.stubGlobal('WebSocket', class { static CLOSING = 2; readyState = 1; close() { this.readyState = 2; } });
  return render(<MemoryRouter initialEntries={['/room/SOURCE/results']}><Routes>
    <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
    <Route path="/huroof/rematch/:id" element={<HuroofRematch />} />
    <Route path="/room/:code/lobby" element={<p>تمت الإعادة</p>} />
  </Routes></MemoryRouter>, { wrapper: ThemeProvider });
}

it('joins a successor from reopened Huroof results with the previous seat capability', async () => {
  mocks.carry.mockRejectedValueOnce(new Error('temporary network fault')).mockResolvedValueOnce({ token: 'carried-player-token' });
  mountResults('player');
  const button = await screen.findByRole('button', { name: 'المضيف بدأ مباراة جديدة — ادخلوا' });
  expect(mocks.carry).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(await screen.findByText('تعذّر الدخول للمباراة الجديدة. حاولوا مرة ثانية.')).toBeVisible();
  fireEvent.click(button);
  expect(await screen.findByText('تمت الإعادة')).toBeVisible();
  expect(mocks.carry).toHaveBeenLastCalledWith(id, child, 'old-player-token', expect.any(AbortSignal));
  expect(JSON.parse(sessionStorage.getItem(`huroof:${child}`)!)).toEqual({ role: 'player', token: 'carried-player-token' });
  expect(sessionStorage.getItem('huroof:code:ABCDEF')).toBe(child);
  expect(mocks.rematch).not.toHaveBeenCalled();
});

it('automatically follows a reopened Huroof display without an old saved token', async () => {
  const network = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/audience')
    ? { roomId: id, token: 'fresh-audience-token' }
    : {
      roomId: id, revision: 10, serverTime: new Date().toISOString(), role: 'audience',
      projection: { room: { roomCode: 'SOURCE', state: 'MATCH_COMPLETE', readyCount: 0, memberCount: 0, successor: { roomId: child, roomCode: 'ABCDEF' } } },
    })));
  vi.stubGlobal('fetch', network);
  vi.stubGlobal('WebSocket', class { static CLOSING = 2; readyState = 1; close() { this.readyState = 2; } });
  render(<MemoryRouter initialEntries={['/room/SOURCE/display']}><Routes>
    <Route path="/room/:roomCode/display" element={<RoomRoute surface="display" />} />
    <Route path="/room/ABCDEF/display" element={<p>شاشة المباراة الجديدة</p>} />
  </Routes></MemoryRouter>, { wrapper: ThemeProvider });
  expect(await screen.findByText('شاشة المباراة الجديدة')).toBeVisible();
  expect(network).toHaveBeenCalledWith('/api/rooms/SOURCE/audience', expect.objectContaining({ method: 'POST' }));
  expect(mocks.carry).not.toHaveBeenCalled();
});

it('creates the local rematch from one click on the results and opens the new lobby', async () => {
  mocks.rematch.mockResolvedValueOnce(result());
  mountResults();
  expect(mocks.rematch).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole('button', { name: 'العبوا مرة ثانية' }));
  expect(await screen.findByText('تمت الإعادة')).toBeVisible();
  expect(mocks.rematch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('heading', { name: 'إعادة مباراة الخلية' })).not.toBeInTheDocument();
});

it('opens the recovery page after a results rematch transport failure and keeps the request key', async () => {
  mocks.rematch.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(result());
  mountResults();
  fireEvent.click(await screen.findByRole('button', { name: 'العبوا مرة ثانية' }));
  expect(await screen.findByRole('heading', { name: 'إعادة مباراة الخلية' })).toBeVisible();
  expect(sessionStorage.getItem(key)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'حاولوا مرة ثانية' }));
  expect(await screen.findByText('تمت الإعادة')).toBeVisible();
  expect(mocks.rematch.mock.calls[0][1]).toBe(mocks.rematch.mock.calls[1][1]);
});
it.each(['broken',JSON.stringify({uid:'other',id,requestKey:child}),JSON.stringify({uid:'owner',id,requestKey:child,extra:true})])('never overwrites malformed pending intent',async raw=>{
 sessionStorage.setItem(key,raw);mount();click();await screen.findByRole('alert');expect(mocks.rematch).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(raw);
});
it('captures pending bytes before the auth await and refuses replacement during that await',async()=>{
 let resolve!:(v:string)=>void;mocks.token.mockImplementation(()=>new Promise(r=>{resolve=r;}));mount();click();await waitFor(()=>expect(mocks.token).toHaveBeenCalled());const replacement=JSON.stringify({uid:'owner',id,requestKey:child});sessionStorage.setItem(key,replacement);await act(async()=>resolve('id-token'));expect(mocks.rematch).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(replacement);
});
it('fences same-UID auth re-entry before capability dispatch',async()=>{
 let resolve!:(v:string)=>void;mocks.token.mockImplementation(()=>new Promise(r=>{resolve=r;}));mount();click();await waitFor(()=>expect(mocks.token).toHaveBeenCalled());const pending=sessionStorage.getItem(key);await act(async()=>{invalidateProviderOwner(lease);observeProviderOwner(lease,'owner');resolve('late-token');});expect(mocks.rematch).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).toBe(pending);
});
it('rejects mismatched child/predecessor/source projections before storing capabilities',async()=>{
 for(const change of [{roomId:id},{roomCode:'../bad'},{predecessorRoomId:child},{source:{snapshotId:'not-hash',selection:'UNSEEN_PREDECESSOR'}},{token:''}])expect(()=>parseHuroofRematchResult({...result(),...change},id)).toThrow();mocks.rematch.mockResolvedValue({...result(),predecessorRoomId:child});mount();click();await screen.findByRole('alert');expect(sessionStorage.getItem(`huroof:${child}`)).toBeNull();expect(sessionStorage.getItem(key)).toBeTruthy();
});
it('does not persist a late child capability after unmount',async()=>{
 let resolve!:(v:unknown)=>void;mocks.rematch.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=mount();click();await waitFor(()=>expect(mocks.rematch).toHaveBeenCalled());const pending=sessionStorage.getItem(key);view.unmount();await act(async()=>resolve(result()));expect(sessionStorage.getItem(`huroof:${child}`)).toBeNull();expect(sessionStorage.getItem(key)).toBe(pending);
});
it('retains idempotency bytes if saving child capability fails',async()=>{
 const original=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){if(k===`huroof:${child}`)throw Error('full');return original.call(this,k,v);});mocks.rematch.mockResolvedValue(result());mount();click();await screen.findByRole('alert');expect(sessionStorage.getItem(key)).toBeTruthy();expect(screen.queryByText('تمت الإعادة')).not.toBeInTheDocument();
});
it('does not accept owner-access recovery for a different predecessor',async()=>{
 sessionStorage.removeItem(`huroof:${id}`);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({roomId:child,roomCode:'ABCDEF',revision:1,token:'t'.repeat(40),audienceToken:'a'.repeat(40)}))));mount();click();await screen.findByRole('alert');expect(mocks.rematch).not.toHaveBeenCalled();expect(sessionStorage.getItem(`huroof:${id}`)).toBeNull();expect(sessionStorage.getItem(key)).toBeTruthy();
});
