import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({user:{uid:'history-owner',getIdToken:vi.fn(async()=>'owner-token')}}));
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>auth}));
import {HuroofHistory} from '../../src/features/game/HuroofHistory';
import {parseHuroofHistory,parseHuroofOwnerAccess} from '../../src/features/game/huroof-history-client';
import {beginOwnerProvider,observeProviderOwner,invalidateOwner,invalidateProviderOwner} from '../../src/features/enta/auth-epoch';
import * as ownerAuthority from '../../src/features/enta/auth-epoch';
const id='11111111-1111-4111-8111-111111111111';
const row={id,code:'ABC123',revision:3,phase:'LOBBY',complete:false,teams:{horizontal:'فريق الشمس',vertical:'فريق القمر'},scores:{horizontal:0,vertical:1},roundWins:{horizontal:0,vertical:0},createdAt:'2026-11-05T00:00:00.000Z',completionReason:null,settings:{gameKind:'huroof'},source:{snapshot:'a'.repeat(64)}};
const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});const fetcher=vi.fn<typeof fetch>();let lease:ReturnType<typeof beginOwnerProvider>;
beforeEach(()=>{auth.user={uid:'history-owner',getIdToken:vi.fn(async()=>'owner-token')};lease=beginOwnerProvider();observeProviderOwner(lease,auth.user.uid);sessionStorage.clear();fetcher.mockReset();vi.stubGlobal('fetch',fetcher);});
afterEach(()=>{cleanup();invalidateOwner();vi.unstubAllGlobals();vi.restoreAllMocks();});
const mount=()=>render(<MemoryRouter><HuroofHistory/></MemoryRouter>);
it('recovers host access and navigates to an active room under StrictMode',async()=>{
 const active={...row,phase:'PAUSED'};
 fetcher.mockImplementation(async(url)=>String(url).includes('owner-access')?response({roomId:id,roomCode:row.code,revision:3,token:'t'.repeat(40),audienceToken:'a'.repeat(40)}):response({items:[active],nextOffset:null}));
 function Location(){return <output data-testid="location">{useLocation().pathname}</output>;}
 render(<StrictMode><MemoryRouter initialEntries={['/enta/history']}><HuroofHistory/><Location/></MemoryRouter></StrictMode>);
 fireEvent.click(await screen.findByRole('button',{name:'العودة إلى غرفة الخلية'}));
 await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/room/ABC123/host'));
 expect(JSON.parse(sessionStorage.getItem(`huroof:${id}`)!)).toEqual({token:'t'.repeat(40),role:'host'});
 expect(sessionStorage.getItem('huroof:code:ABC123')).toBe(id);
});
it('explains an unavailable owner lease without requesting or storing room access',async()=>{
 fetcher.mockResolvedValue(response({items:[row],nextOffset:null}));mount();const button=await screen.findByRole('button',{name:'العودة إلى غرفة الخلية'});
 vi.spyOn(ownerAuthority,'ownerEpoch').mockImplementation(()=>{throw new DOMException('Identity changed','AbortError');});
 fireEvent.click(button);expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تأكيد جلسة الحساب');
 expect(fetcher.mock.calls.some(([url])=>String(url).includes('owner-access'))).toBe(false);expect(sessionStorage.getItem(`huroof:${id}`)).toBeNull();expect(button).not.toBeDisabled();
});
it('shows access progress and an actionable room error while preserving loaded history',async()=>{
 let resolve!:(r:Response)=>void;fetcher.mockImplementation(async(url)=>String(url).includes('owner-access')?new Promise(r=>{resolve=r;}):response({items:[row],nextOffset:null}));mount();
 const button=await screen.findByRole('button',{name:'العودة إلى غرفة الخلية'});fireEvent.click(button);expect(await screen.findByRole('status')).toHaveTextContent('جارٍ فتح الغرفة');expect(button).toBeDisabled();
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('owner-access'))).toBe(true));await act(async()=>resolve(response({error:'OWNER_REQUIRED'},403)));
 expect(await screen.findByRole('alert')).toHaveTextContent('تعذر فتح الغرفة');expect(screen.getByText(/فريق الشمس/)).toBeInTheDocument();expect(button).not.toBeDisabled();expect(sessionStorage.getItem(`huroof:${id}`)).toBeNull();
});
it('strictly validates rows, uniqueness and bounded forward pagination',()=>{
 expect(parseHuroofHistory({items:[row],nextOffset:null},0).items[0]).toEqual(row);
 for(const change of [{id:'../secret'},{code:'../../host'},{phase:'UNKNOWN'},{complete:true},{scores:{horizontal:'0',vertical:1}},{teams:{horizontal:{name:'secret'},vertical:'x'}},{source:{snapshot:'bad'}}])expect(()=>parseHuroofHistory({items:[{...row,...change}],nextOffset:null},0)).toThrow();
 expect(()=>parseHuroofHistory({items:[row,row],nextOffset:null},0)).toThrow();expect(()=>parseHuroofHistory({items:[row],nextOffset:100},0)).toThrow();expect(()=>parseHuroofHistory({items:[],nextOffset:-1},0)).toThrow();
});
it('never accepts owner access for another room or malformed capabilities',()=>{
 const parsed=parseHuroofHistory({items:[row],nextOffset:null},0).items[0],value={roomId:id,roomCode:row.code,revision:3,token:'t'.repeat(40),audienceToken:'a'.repeat(40)};
 expect(parseHuroofOwnerAccess(value,parsed)).toEqual({token:value.token});for(const change of [{roomId:'22222222-2222-4222-8222-222222222222'},{roomCode:'OTHER1'},{token:''},{audienceToken:null},{revision:0}])expect(()=>parseHuroofOwnerAccess({...value,...change},parsed)).toThrow();
});
it('sends current owner auth and renders no capability from malformed projections',async()=>{
 fetcher.mockResolvedValue(response({items:[{...row,teams:null}],nextOffset:null}));mount();expect(await screen.findByRole('alert')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'العودة إلى غرفة الخلية'})).not.toBeInTheDocument();expect(fetcher.mock.calls[0][1]?.headers).toEqual({authorization:'Bearer owner-token'});
});
it('clears old owner history while the replacement owner response is pending',async()=>{
 fetcher.mockResolvedValue(response({items:[row],nextOffset:null}));const view=mount();await screen.findByText(/فريق الشمس/);auth.user={uid:'another-owner',getIdToken:vi.fn(async()=>'another-token')};await act(async()=>observeProviderOwner(lease,auth.user.uid));fetcher.mockImplementation(()=>new Promise(()=>{}));view.rerender(<MemoryRouter><HuroofHistory/></MemoryRouter>);await act(async()=>{});expect(screen.queryByText(/فريق الشمس/)).not.toBeInTheDocument();
});
it('does not save a late capability after unmounting the access request',async()=>{
 let resolve!:(r:Response)=>void;fetcher.mockImplementation(async(url)=>String(url).includes('owner-access')?new Promise(r=>{resolve=r;}):response({items:[row],nextOffset:null}));const view=mount();fireEvent.click(await screen.findByRole('button',{name:'العودة إلى غرفة الخلية'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));view.unmount();await act(async()=>resolve(response({roomId:id,roomCode:row.code,revision:3,token:'t'.repeat(40),audienceToken:'a'.repeat(40)})));expect(sessionStorage.getItem(`huroof:${id}`)).toBeNull();expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
});
it('fences same-UID signout/signin while access token retrieval is pending',async()=>{
 fetcher.mockResolvedValue(response({items:[row],nextOffset:null}));mount();await screen.findByRole('button',{name:'العودة إلى غرفة الخلية'});let resolve!:(t:string)=>void;auth.user.getIdToken.mockImplementation(()=>new Promise(r=>{resolve=r;}));fireEvent.click(screen.getByRole('button',{name:'العودة إلى غرفة الخلية'}));await act(async()=>{invalidateProviderOwner(lease);observeProviderOwner(lease,auth.user.uid);resolve('stale-token');});expect(fetcher.mock.calls.some(([u])=>String(u).includes('owner-access'))).toBe(false);expect(sessionStorage.getItem(`huroof:${id}`)).toBeNull();
});
it('requests the validated next page then returns to the first page',async()=>{
 const page=Array.from({length:100},(_,i)=>({...row,id:`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`,code:`A${String(i).padStart(5,'0')}`}));fetcher.mockImplementation(async(url)=>response(String(url).endsWith('offset=100')?{items:[],nextOffset:null}:{items:page,nextOffset:100}));mount();fireEvent.click(await screen.findByRole('button',{name:'التالي'}));await screen.findByText('لم تُسجّل مباريات خلية بهذا الحساب بعد.');expect(fetcher.mock.calls.some(([u])=>String(u).endsWith('offset=100'))).toBe(true);fireEvent.click(screen.getByRole('button',{name:'السابق'}));await screen.findByRole('button',{name:'التالي'});
});
