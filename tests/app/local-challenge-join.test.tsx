import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LocalRealtimeGameAdapter} from '../../src/features/game/runtime/local-realtime-game-adapter';
import {CLIENT_CHALLENGE_CAPABILITY} from '../../src/features/game/runtime/contracts';
vi.mock('../../src/features/game/runtime',async()=>{const {LocalRealtimeGameAdapter}=await import('../../src/features/game/runtime/local-realtime-game-adapter');return {gameRuntime:new LocalRealtimeGameAdapter()};});
vi.mock('../../src/design-system/InternalHeader',()=>({InternalHeader:()=>null}));
import {NameJoinRoute} from '../../src/routes/NameJoinRoute';
const fetcher=vi.fn<typeof fetch>();
beforeEach(()=>{sessionStorage.clear();fetcher.mockReset();vi.stubGlobal('fetch',fetcher);vi.stubEnv('VITE_STATIC_PREVIEW','false');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const mount=()=>render(<MemoryRouter initialEntries={['/room/18C3FA/join']}><Routes><Route path="/room/:roomCode/join" element={<NameJoinRoute/>}/><Route path="/room/:roomCode/lobby" element={<h1>غرفة الانتظار للاختبار</h1>}/></Routes></MemoryRouter>);
it('normal guest form advertises supported challenge protocol before storing its guest credential',async()=>{
 fetcher.mockImplementation(async(url,init)=>{if(url==='/api/rooms/18C3FA/exists')return new Response(null,{status:204});expect(JSON.parse(String(init?.body))).toEqual({roomCode:'18C3FA',displayName:'دليل كروم',requestKey:expect.any(String),challenge:CLIENT_CHALLENGE_CAPABILITY});return new Response(JSON.stringify({roomId:'local-room',revision:4,token:'guest-capability'}));});mount();
 fireEvent.change(await screen.findByLabelText('اسم اللاعب'),{target:{value:'دليل كروم'}});fireEvent.click(screen.getByRole('button',{name:'دخول الغرفة'}));
 expect(await screen.findByRole('heading',{name:'غرفة الانتظار للاختبار'})).toBeInTheDocument();expect(JSON.parse(sessionStorage.getItem('huroof:local-room')!)).toEqual({token:'guest-capability',role:'player'});
});
it('adapter defaults its protocol and preserves an explicitly offered capability for server validation',async()=>{
 fetcher.mockResolvedValue(new Response(JSON.stringify({error:'CHALLENGE_PROTOCOL_REQUIRED'}),{status:400}));const adapter=new LocalRealtimeGameAdapter();await expect(adapter.joinRoom({roomCode:'18C3FA',displayName:'دليل'})).rejects.toThrow('CHALLENGE_PROTOCOL_REQUIRED');expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).challenge).toEqual(CLIENT_CHALLENGE_CAPABILITY);
 const incompatible={...CLIENT_CHALLENGE_CAPABILITY,mechanics:[]};fetcher.mockResolvedValue(new Response(JSON.stringify({error:'CHALLENGE_PROTOCOL_REQUIRED'}),{status:400}));await expect(adapter.joinRoom({roomCode:'18C3FA',displayName:'دليل',challenge:incompatible})).rejects.toThrow('CHALLENGE_PROTOCOL_REQUIRED');expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).challenge).toEqual(incompatible);
});
it.each([
 ['CHALLENGE_PROTOCOL_REQUIRED','أعد تحميل الصفحة'],['JOIN_NOT_ALLOWED','انتظر عودة المضيف'],['ROOM_NOT_FOUND','ما لقينا غرفة بهذا الرمز. تأكدوا منه مع المضيف.'],['PLAYER_CAPACITY_REACHED','الغرفة ممتلئة'],['INTERNAL_SECRET_DETAIL','تحقق من اتصال الخدمة'],
])('maps %s to actionable Arabic without leaking the raw response',async(code,message)=>{
 fetcher.mockResolvedValueOnce(new Response(null,{status:204})).mockResolvedValueOnce(new Response(JSON.stringify({error:code}),{status:400}));mount();fireEvent.change(await screen.findByLabelText('اسم اللاعب'),{target:{value:'دليل كروم'}});fireEvent.click(screen.getByRole('button',{name:'دخول الغرفة'}));const alert=await screen.findByRole('alert');expect(alert).toHaveTextContent(message);expect(alert).not.toHaveTextContent(code);expect(sessionStorage.getItem('huroof:code:18C3FA')).toBeNull();
});
