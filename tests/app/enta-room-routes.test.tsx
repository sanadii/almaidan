import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {StrictMode} from 'react';
import {Link,MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const auth=vi.hoisted(()=>({user:{uid:'owner-one',getIdToken:vi.fn(async()=>'owner-token')} as {uid:string;getIdToken:()=>Promise<string>}|null,status:'ready'}));
vi.mock('../../src/features/auth/auth-context',()=>({useFirebaseAuth:()=>auth}));
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
vi.mock('../../src/features/enta/CanvasBoard',()=>({CanvasBoard:({writable}:{writable:boolean})=><div data-testid="canvas">{writable?'private drawing':'public drawing'}</div>}));
import {EntaRoomJoinRoute,EntaRoomRoute} from '../../src/features/enta/RoomRoutes';
import {roomTokenKey} from '../../src/features/enta/room-client';

const code='E1-ABCDEFGH',base=`/api/v1/enta/rooms/${code}`;
function room(phase='LOBBY') {return {code,version:1,phase,engine:'competitive',matchId:'match-one',locked:false,teams:[{id:'t1',name:'فريق الشمس',players:['نور','علي']},{id:'t2',name:'فريق القمر',players:['ريم']}],members:[{id:'m1',name:'نور',status:'ADMITTED',teamIndex:null,playerIndex:null,captain:false}],self:{id:'m1',role:'MEMBER'},match:phase==='LOBBY'?null:{id:'match-one',version:1,serverNow:1000,teams:[{id:'t1',name:'فريق الشمس',score:0}],currentRound:{id:'round-one',format:'DRAWING_TARGET',prompt:'ارسم لفريقك',canvas:{revision:0}}}};}
const response=(data:unknown,status=200)=>({ok:status<400,status,json:async()=>data}) as Response;
const fetcher=vi.fn<typeof fetch>();
function mount(surface:'host'|'play'|'display'|'join'='play'){
 return render(<MemoryRouter initialEntries={[`/enta/rooms/${code}/${surface}`]}><Routes><Route path="/enta/rooms/:code/join" element={<EntaRoomJoinRoute/>}/><Route path="/enta/rooms/:code/play" element={<EntaRoomRoute/>}/><Route path="/enta/rooms/:code/host" element={<EntaRoomRoute host/>}/><Route path="/enta/rooms/:code/display" element={<EntaRoomRoute display/>}/></Routes></MemoryRouter>);
}
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
const tick=(ms:number)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
beforeEach(()=>{vi.useFakeTimers();sessionStorage.clear();window.history.replaceState(null,'','/');auth.user={uid:'owner-one',getIdToken:vi.fn(async()=>'owner-token')};auth.status='ready';fetcher.mockReset();vi.stubGlobal('fetch',fetcher);});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('E1 room routes with actual client and mocked transport',()=>{
 it('joins once, stores the member capability only in this tab, and loads the guest lobby without owner auth',async()=>{
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/join')?response({token:'member-secret'}):response({room:room()}));mount('join');
  expect(screen.getByLabelText('اسم اللاعب')).toHaveAttribute('maxLength','30');fireEvent.change(screen.getByLabelText('اسم اللاعب'),{target:{value:'  نور  '}});fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();
  expect(sessionStorage.getItem(roomTokenKey(code))).toBe('member-secret');expect(localStorage.getItem(roomTokenKey(code))).toBeNull();expect(screen.getByText('بانتظار اللاعبين')).toBeInTheDocument();expect(screen.getByText('انتظر بدء المباراة وقبول المضيف.')).toBeInTheDocument();
  const [url,init]=fetcher.mock.calls[0];expect(url).toBe(base+'/join');expect(JSON.parse(String(init?.body))).toEqual({name:'نور',requestKey:expect.any(String)});expect(init?.headers).not.toHaveProperty('authorization');
  const view=fetcher.mock.calls.find(([u])=>u===base+'/view')!;expect(view[1]?.headers).toMatchObject({'x-enta-room-token':'member-secret'});expect(view[1]?.headers).not.toHaveProperty('authorization');expect(fetcher.mock.calls.some(([u])=>String(u).endsWith('/private'))).toBe(false);
 });
 it('preserves an uncertain join request key for retry instead of creating another member',async()=>{
  let calls=0;fetcher.mockImplementation(async(url)=>{if(String(url).endsWith('/join')&&calls++===0)throw Error('network disconnected');return String(url).endsWith('/join')?response({token:'retried-token'}):response({room:room()});});mount('join');fireEvent.change(screen.getByLabelText('اسم اللاعب'),{target:{value:'نور'}});fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();expect(screen.getByRole('alert')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();const requests=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/join')).map(([,i])=>JSON.parse(String(i?.body)));expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 });
 it('assigns a host member and retries an uncertain start with the same command identity',async()=>{
  let state=room(),starts=0;fetcher.mockImplementation(async(url,init)=>{if(String(url).endsWith('/host')){const body=JSON.parse(String(init?.body));if(body.type==='ASSIGN')state={...state,version:2,members:[{...state.members[0],teamIndex:body.teamIndex,playerIndex:body.playerIndex}]};if(body.type==='START'){if(starts++===0)throw Error('response lost');state={...state,phase:'PLAYING',version:3};}}return response({room:state});});mount('host');await flush();fireEvent.change(screen.getByLabelText('الفريق'),{target:{value:'0'}});await flush();const assignment=fetcher.mock.calls.find(([,i])=>i?.body&&JSON.parse(String(i.body)).type==='ASSIGN')!;expect(JSON.parse(String(assignment[1]?.body))).toMatchObject({memberId:'m1',teamIndex:0,playerIndex:0,expectedVersion:1});expect(assignment[1]?.headers).toMatchObject({authorization:'Bearer owner-token'});
  fireEvent.click(screen.getByRole('button',{name:'بدء المباراة'}));await flush();expect(screen.getByRole('button',{name:'بدء المباراة'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'إعادة المحاولة'}));await flush();const commands=fetcher.mock.calls.filter(([,i])=>i?.body&&JSON.parse(String(i.body)).type==='START').map(([,i])=>JSON.parse(String(i?.body)));expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(screen.getByText('المباراة جارية')).toBeInTheDocument();
 });
 it('keeps a rejected host command visible after successful background polling',async()=>{
  let rejected=true;fetcher.mockImplementation(async(url)=>String(url).endsWith('/host')&&rejected?response({error:'ROOM_VERSION_STALE'},409):response({room:{...room(),version:2}}));
  mount('host');await flush();fireEvent.click(screen.getByRole('button',{name:'إنشاء رابط شاشة العرض'}));await flush();
  expect(screen.getByRole('alert')).toBeInTheDocument();await tick(3000);expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'إعادة المحاولة'}));await flush();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rejected=false;fireEvent.click(screen.getByRole('button',{name:'إنشاء رابط شاشة العرض'}));await flush();
  const commands=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/host')).map(([,i])=>JSON.parse(String(i?.body)));
  expect(commands).toHaveLength(2);expect(commands[1].commandId).not.toBe(commands[0].commandId);expect(commands[1].expectedVersion).toBe(2);
 });
 it('assigns a second guest to the next free seat in the same team',async()=>{
  const initial=room();let state={...initial,members:[{...initial.members[0],teamIndex:0,playerIndex:0},{...initial.members[0],id:'m2',name:'علي'}]};
  fetcher.mockImplementation(async(url,init)=>{if(String(url).endsWith('/host')){const body=JSON.parse(String(init?.body));state={...state,version:state.version+1,members:state.members.map(m=>m.id===body.memberId?{...m,teamIndex:body.teamIndex,playerIndex:body.playerIndex}:m)};}return response({room:state});});
  mount('host');await flush();fireEvent.change(screen.getAllByLabelText('الفريق')[1],{target:{value:'0'}});await flush();
  const assignments=fetcher.mock.calls.filter(([,init])=>init?.body&&JSON.parse(String(init.body)).type==='ASSIGN');expect(assignments).toHaveLength(1);expect(JSON.parse(String(assignments[0][1]?.body))).toMatchObject({memberId:'m2',teamIndex:0,playerIndex:1,expectedVersion:1});expect(assignments[0][1]?.headers).toMatchObject({authorization:'Bearer owner-token'});
  const seats=screen.getAllByLabelText('مقعد اللاعب');expect(seats).toHaveLength(2);expect(seats[1]).toHaveValue('1');expect(within(seats[1]).getByRole('option',{name:'نور'})).toBeDisabled();expect(within(seats[1]).getByRole('option',{name:'علي'})).not.toBeDisabled();
 });
 it('disables full teams and occupied seats and does not dispatch invalid selections',async()=>{
  const initial=room(),state={...initial,members:[{...initial.members[0],teamIndex:0,playerIndex:0},{...initial.members[0],id:'m2',name:'علي',teamIndex:0,playerIndex:1},{...initial.members[0],id:'m3',name:'ريم'}]};fetcher.mockResolvedValue(response({room:state}));mount('host');await flush();
  const teams=screen.getAllByLabelText('الفريق');expect(within(teams[2]).getByRole('option',{name:'فريق الشمس — مكتمل'})).toBeDisabled();expect(within(teams[0]).getByRole('option',{name:'فريق الشمس',exact:true})).not.toBeDisabled();
  fireEvent.change(teams[2],{target:{value:'0'}});fireEvent.change(screen.getAllByLabelText('مقعد اللاعب')[0],{target:{value:'1'}});await flush();expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/host'))).toBe(false);
 });
 it('unmounts private actor content immediately after room capability denial',async()=>{
  sessionStorage.setItem(roomTokenKey(code),'actor-token');let denied=false;fetcher.mockImplementation(async(url)=>String(url).endsWith('/private')?response({capability:{target:'هدف سري',canvas:{revision:0},grant:{id:'g1',expiresAt:121000},serverNow:1000}}):denied?response({error:'ROOM_CAPABILITY_DENIED'},403):response({room:room('PLAYING')}));mount();await flush();expect(screen.getByText('هدف سري')).toBeInTheDocument();expect(screen.getByTestId('canvas')).toHaveTextContent('private drawing');denied=true;await tick(1000);expect(screen.queryByText('هدف سري')).not.toBeInTheDocument();expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'الدخول من جديد'})).toBeInTheDocument();
 });
 it('display fragments are removed from the URL and never request a private capability',async()=>{
  window.history.replaceState(null,'','/#token=display-secret');fetcher.mockResolvedValue(response({room:room('PLAYING')}));mount('display');await flush();expect(window.location.hash).toBe('');expect(sessionStorage.getItem(roomTokenKey(code)+':display')).toBe('display-secret');expect(screen.getByTestId('canvas')).toHaveTextContent('public drawing');await tick(3000);expect(fetcher.mock.calls.every(([u])=>u===base+'/view')).toBe(true);expect(fetcher.mock.calls.every(([,i])=>(i?.headers as Record<string,string>)['x-enta-room-token']==='display-secret')).toBe(true);expect(screen.queryByText('مهمتك الخاصة — لا تعرضها للفريق')).not.toBeInTheDocument();
 });
 it('strips a display fragment even if storage fails and keeps the display read-only',async()=>{
  window.history.replaceState(null,'','/#token=display-secret');vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage disabled');});fetcher.mockResolvedValue(response({room:room('PLAYING')}));mount('display');await flush();expect(window.location.hash).toBe('');expect(screen.getByTestId('canvas')).toHaveTextContent('public drawing');await tick(3000);expect(fetcher.mock.calls.length).toBeGreaterThan(0);expect(fetcher.mock.calls.every(([u])=>u===base+'/view')).toBe(true);expect(fetcher.mock.calls.every(([,i])=>(i?.headers as Record<string,string>)['x-enta-room-token']==='display-secret')).toBe(true);expect(screen.queryByText('مهمتك الخاصة — لا تعرضها للفريق')).not.toBeInTheDocument();
 });
 it('reconnects after transient transport failure without discarding the member capability',async()=>{
  sessionStorage.setItem(roomTokenKey(code),'member-token');let calls=0;fetcher.mockImplementation(async()=>{if(calls++===1)throw Error('offline');return response({room:room()});});mount();await flush();await tick(1000);expect(screen.getByRole('alert')).toBeInTheDocument();expect(screen.getByText('بانتظار اللاعبين')).toBeInTheDocument();await tick(2000);expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(sessionStorage.getItem(roomTokenKey(code))).toBe('member-token');
 });
 it('clears the previous owner room immediately on account change while new authorization is pending',async()=>{
  fetcher.mockResolvedValue(response({room:room()}));const view=mount('host');await flush();expect(screen.getByText('بانتظار اللاعبين')).toBeInTheDocument();auth.user={uid:'owner-two',getIdToken:vi.fn(async()=>'new-owner-token')};fetcher.mockImplementation(()=>new Promise(()=>{}));view.rerender(<MemoryRouter initialEntries={[`/enta/rooms/${code}/host`]}><Routes><Route path="/enta/rooms/:code/host" element={<EntaRoomRoute host/>}/></Routes></MemoryRouter>);await flush();expect(screen.queryByText('بانتظار اللاعبين')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'بدء المباراة'})).not.toBeInTheDocument();
 });
 it('aborts an outstanding owner command and forgets its retry identity on account change',async()=>{
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/host')?new Promise(()=>{}):response({room:room()}));const view=mount('host');await flush();fireEvent.click(screen.getByRole('button',{name:'بدء المباراة'}));await flush();const command=fetcher.mock.calls.find(([u])=>String(u).endsWith('/host'))!;expect(command[1]?.signal?.aborted).toBe(false);
  auth.user={uid:'owner-two',getIdToken:vi.fn(async()=>'new-owner-token')};fetcher.mockImplementation(()=>new Promise(()=>{}));view.rerender(<MemoryRouter initialEntries={[`/enta/rooms/${code}/host`]}><Routes><Route path="/enta/rooms/:code/host" element={<EntaRoomRoute host/>}/></Routes></MemoryRouter>);await flush();expect(command[1]?.signal?.aborted).toBe(true);expect(screen.queryByRole('button',{name:'بدء المباراة'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'إعادة المحاولة'})).not.toBeInTheDocument();
 });
 it('changes room capability with the route and discards a late private response from the previous room',async()=>{
  const next='E1-JKLMNPQR';sessionStorage.setItem(roomTokenKey(code),'first-token');sessionStorage.setItem(roomTokenKey(next),'second-token');let resolvePrivate!:(r:Response)=>void;
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/private')?new Promise(r=>{resolvePrivate=r;}):response({room:String(url).includes(next)?{...room(),code:next}:room('PLAYING')}));
  render(<MemoryRouter initialEntries={[`/enta/rooms/${code}/play`]}><Link to={`/enta/rooms/${next}/play`}>غرفة أخرى</Link><Routes><Route path="/enta/rooms/:code/play" element={<EntaRoomRoute/>}/></Routes></MemoryRouter>);await flush();fireEvent.click(screen.getByRole('link',{name:'غرفة أخرى'}));await flush();await act(async()=>resolvePrivate(response({capability:{target:'مهمة الغرفة القديمة'}})));expect(screen.queryByText('مهمة الغرفة القديمة')).not.toBeInTheDocument();expect(screen.getByText(next)).toBeInTheDocument();const nextRequest=fetcher.mock.calls.find(([u])=>String(u).includes(next))!;expect(nextRequest[1]?.headers).toMatchObject({'x-enta-room-token':'second-token'});
 });
 it('handles unavailable display storage without crashing or requesting private state',async()=>{
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('storage disabled');});fetcher.mockResolvedValue(response({error:'ROOM_CAPABILITY_DENIED'},403));mount('display');await flush();expect(screen.getByText('يلزم رابط عرض صالح أو الدخول باسمك.')).toBeInTheDocument();expect(fetcher.mock.calls.some(([u])=>String(u).endsWith('/private'))).toBe(false);
 });
 it('keeps the owner command transport usable after StrictMode effect replay',async()=>{
  fetcher.mockResolvedValue(response({room:room()}));render(<StrictMode><MemoryRouter initialEntries={[`/enta/rooms/${code}/host`]}><Routes><Route path="/enta/rooms/:code/host" element={<EntaRoomRoute host/>}/></Routes></MemoryRouter></StrictMode>);await flush();fireEvent.click(screen.getByRole('button',{name:'بدء المباراة'}));await flush();const command=fetcher.mock.calls.find(([u])=>String(u).endsWith('/host'))!;expect(command).toBeDefined();expect(command[1]?.signal?.aborted).toBe(false);
 });
});
describe('E1 room definite rejections, join recovery and captain aids',()=>{
 it('a definite START rejection releases the command, explains it and keeps other host controls working',async()=>{
  fetcher.mockImplementation(async(url,init)=>{if(String(url).endsWith('/host')){const body=JSON.parse(String(init?.body));return body.type==='START'?response({error:'ROOM_ASSIGNMENT_REQUIRED'},409):response({room:{...room(),version:2,locked:true}});}return response({room:room()});});
  mount('host');await flush();fireEvent.click(screen.getByRole('button',{name:'بدء المباراة'}));await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('وزّعوا كل اللاعبين المقبولين على الفرق قبل بدء المباراة');expect(screen.getByRole('button',{name:'بدء المباراة'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'قفل الانضمام'}));await flush();const types=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/host')).map(([,i])=>JSON.parse(String(i?.body)).type);expect(types).toEqual(['START','LOCK']);
 });
 it('explains the display link limit and can revoke every display link',async()=>{
  fetcher.mockImplementation(async(url,init)=>{if(String(url).endsWith('/host')){const body=JSON.parse(String(init?.body));return body.type==='DISPLAY'?response({error:'DISPLAY_LIMIT'},409):response({room:{...room(),version:2}});}return response({room:room()});});
  mount('host');await flush();fireEvent.click(screen.getByRole('button',{name:'إنشاء رابط شاشة العرض'}));await flush();expect(screen.getByRole('alert')).toHaveTextContent('الحد الأقصى لروابط شاشة العرض');
  fireEvent.click(screen.getByRole('button',{name:'إلغاء كل روابط شاشة العرض'}));await flush();const sent=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/host')).map(([,i])=>JSON.parse(String(i?.body)));expect(sent.map(c=>c.type)).toEqual(['DISPLAY','REVOKE_DISPLAY']);expect(sent[1].commandId).not.toBe(sent[0].commandId);
 });
 it('a lost join reply survives reload with the same request key and name, then clears after the token arrives',async()=>{
  let joins=0;fetcher.mockImplementation(async(url)=>{if(String(url).endsWith('/join')){if(joins++===0)throw Error('network disconnected');return response({token:'recovered-token'});}return response({room:room()});});
  const first=mount('join');fireEvent.change(screen.getByLabelText('اسم اللاعب'),{target:{value:'نور'}});fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();expect(screen.getByRole('alert')).toBeInTheDocument();first.unmount();
  mount('join');expect(screen.getByLabelText('اسم اللاعب')).toHaveValue('نور');fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();
  const bodies=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/join')).map(([,i])=>JSON.parse(String(i?.body)));expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);expect(sessionStorage.getItem(roomTokenKey(code))).toBe('recovered-token');expect(sessionStorage.getItem(roomTokenKey(code)+':pending-join')).toBeNull();
 });
 it('a definite name rejection starts a fresh join request for the next name',async()=>{
  fetcher.mockImplementation(async(url)=>String(url).endsWith('/join')?response({error:'ROOM_NAME_TAKEN'},409):response({room:room()}));
  mount('join');fireEvent.change(screen.getByLabelText('اسم اللاعب'),{target:{value:'نور'}});fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();expect(screen.getByRole('alert')).toHaveTextContent('يوجد لاعب بهذا الاسم');
  fireEvent.change(screen.getByLabelText('اسم اللاعب'),{target:{value:'نور ٢'}});fireEvent.click(screen.getByRole('button',{name:'الدخول'}));await flush();const bodies=fetcher.mock.calls.filter(([u])=>String(u).endsWith('/join')).map(([,i])=>JSON.parse(String(i?.body)));expect(bodies[1].requestKey).not.toBe(bodies[0].requestKey);
 });
 function aidRoom(currentTeamId:string){return {...room('PLAYING'),actionsVersion:2,teams:[{id:'t1',name:'فريق الشمس',players:[{id:'p1',name:'نور'}]},{id:'t2',name:'فريق القمر',players:[{id:'p2',name:'ريم'}]}],members:[{id:'m1',name:'نور',status:'ADMITTED',teamIndex:0,playerIndex:0,captain:true}],match:{id:'match-one',version:4,serverNow:1000,executionFormat:'MIXED_BOARD',teams:[{id:'t1',name:'فريق الشمس',score:0},{id:'t2',name:'فريق القمر',score:0}],allowances:[{id:'a1',teamId:'t1',aid:'DOUBLE_ANSWER',roundId:null,consumed:false},{id:'a2',teamId:'t2',aid:'DOUBLE_ANSWER',roundId:null,consumed:false}],currentRound:{id:'round-one',format:'LIST_ITEMS',phase:'SHARED',prompt:'قائمة',originalTeamId:'t1',currentTeamId,publicRevealed:false,pause:null,eligibleAids:['DOUBLE_ANSWER'],items:[{id:'i1',ordinal:0,consumed:false,revealed:false}],hints:[],graphemeHints:[]}}};}
 it('board captains see aids for the original team even after another scoring team is selected, and an unavailable aid unlocks the answer box',async()=>{
  sessionStorage.setItem(roomTokenKey(code),'captain-token');fetcher.mockImplementation(async(url)=>String(url).endsWith('/actions')?response({error:'AID_UNAVAILABLE'},409):String(url).endsWith('/private')?response({error:'ROOM_ACTION_DENIED'},403):response({room:aidRoom('t2')}));
  mount();await flush();const aid=screen.getByRole('button',{name:'إجابتان'});fireEvent.click(aid);await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('هذه المساعدة غير متاحة لفريقك الآن');expect(screen.getByLabelText('إجابتك')).toBeEnabled();expect(screen.queryByRole('button',{name:'تأكيد الإجراء نفسه'})).not.toBeInTheDocument();
 });
 it('a captain of the selected scoring team that is not the original team sees no board aids',async()=>{
  const view=aidRoom('t2');view.members[0].teamIndex=1;sessionStorage.setItem(roomTokenKey(code),'captain-token');fetcher.mockImplementation(async(url)=>String(url).endsWith('/private')?response({error:'ROOM_ACTION_DENIED'},403):response({room:view}));
  mount();await flush();expect(screen.getByText('قائمة')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'إجابتان'})).not.toBeInTheDocument();
 });
});
