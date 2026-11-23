import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({token:vi.fn(async()=>'id-token'),rematch:vi.fn()}));
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>({user:{uid:'owner',isAnonymous:false,getIdToken:mocks.token}})}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('../../src/features/game/runtime',()=>({gameRuntime:{kind:'local',rematchRoom:mocks.rematch}}));
import {HuroofRematch} from '../../src/features/game/HuroofRematch';
import {parseHuroofRematchPending,parseHuroofRematchResult} from '../../src/features/game/huroof-rematch-client';
import {beginOwnerProvider,observeProviderOwner,invalidateProviderOwner,invalidateOwner} from '../../src/features/enta/auth-epoch';
const id='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222',key=`almaidan:huroof-rematch:owner:${id}`;
const result=()=>({roomId:child,roomCode:'ABCDEF',revision:1,token:'child-capability'.repeat(3),predecessorRoomId:id,source:{snapshotId:'a'.repeat(64),selection:'UNSEEN_PREDECESSOR'}});
let lease:ReturnType<typeof beginOwnerProvider>;
beforeEach(()=>{lease=beginOwnerProvider();observeProviderOwner(lease,'owner');sessionStorage.clear();sessionStorage.setItem(`huroof:${id}`,JSON.stringify({role:'host',token:'host-capability'.repeat(3)}));mocks.token.mockReset().mockResolvedValue('id-token');mocks.rematch.mockReset();});
afterEach(()=>{cleanup();invalidateOwner();vi.unstubAllGlobals();vi.restoreAllMocks();});
const mount=()=>render(<MemoryRouter initialEntries={[`/huroof/rematch/${id}`]}><Routes><Route path="/huroof/rematch/:id" element={<HuroofRematch/>}/><Route path="/room/:code/lobby" element={<p>تمت الإعادة</p>}/></Routes></MemoryRouter>);
const click=()=>fireEvent.click(screen.getByRole('button',{name:'إنشاء غرفة الإعادة'}));
it('retries the identical request and uses explicit current-owner host capability',async()=>{
 mocks.rematch.mockRejectedValueOnce(Error('lost response')).mockResolvedValueOnce(result());mount();click();await screen.findByRole('alert');const pending=sessionStorage.getItem(key);expect(pending).toBeTruthy();click();await screen.findByText('تمت الإعادة');expect(mocks.rematch.mock.calls[1][1]).toBe(mocks.rematch.mock.calls[0][1]);expect(mocks.rematch.mock.calls[0][2]).toMatchObject({idToken:'id-token',hostCapability:'host-capability'.repeat(3)});expect(sessionStorage.getItem(key)).toBeNull();expect(sessionStorage.getItem(`huroof:${child}`)).toContain('child-capability');
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
