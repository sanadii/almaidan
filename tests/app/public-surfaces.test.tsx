import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ThemeProvider} from '../../src/app/ThemeProvider';
import {HostNewRoute,HowToPlayRoute,NotFoundRoute} from '../../src/routes/GameRoutes';
import {MediaCreditsRoute} from '../../src/routes/MediaCredits';
const runtimeMock=vi.hoisted(()=>({createRoom:vi.fn()}));
vi.mock('../../src/features/game/runtime',()=>({gameRuntime:{kind:'local',createRoom:runtimeMock.createRoom,getChallengeAvailability:async()=>({enabledMechanics:[]})}}));
const inventory={source:'local_sqlite_import',huroofAvailable:true,categories:[{id:'tahadani-006',labelAr:'معلومات عامة',questionCount:40,huroofQuestionCount:40,heldQuestionCount:0,availability:'ready',categoryGameEligible:true},{id:'tahadani-007',labelAr:'عالم الحيوان',questionCount:40,huroofQuestionCount:40,heldQuestionCount:0,availability:'ready',categoryGameEligible:true}]};
const fetchMock=vi.fn();
beforeEach(()=>{fetchMock.mockImplementation(async()=>new Response(JSON.stringify(inventory)));runtimeMock.createRoom.mockResolvedValue({roomId:'v-test-room',roomCode:'VTEST1',token:'test-host-token'});vi.stubGlobal('fetch',fetchMock);});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();sessionStorage.clear();});
function mount(element:React.ReactNode,query='') {return render(<ThemeProvider><MemoryRouter initialEntries={['/host/new'+query]}><Routes><Route path="/host/new" element={element}/><Route path="/room/:roomCode/lobby" element={<h1>ردهة الاختبار</h1>}/><Route path="/" element={<h1>الرئيسية</h1>}/></Routes></MemoryRouter></ThemeProvider>);}
it('blocks creation on an unavailable local source and retries the actual source loader',async()=>{
 fetchMock.mockResolvedValueOnce(new Response('unavailable',{status:503}));mount(<HostNewRoute/>);expect(await screen.findByText('تعذر تحميل فهرس أسئلة التجربة المحلية.')).toBeVisible();expect(screen.getByTestId('create-room')).toBeDisabled();
 await userEvent.click(screen.getByRole('button',{name:'إعادة المحاولة',exact:true}));expect(await screen.findByRole('button',{name:/معلومات عامة/,pressed:false})).toBeVisible();expect(screen.getByTestId('create-room')).toBeEnabled();expect(document.title).toBe('إنشاء مباراة | الميدان');
});
it('retains selection, removable-tray focus, mode keyboard control and selected scope filtering',async()=>{
 mount(<HostNewRoute/>);const user=userEvent.setup();const general=await screen.findByRole('button',{name:/معلومات عامة/,pressed:false}),animals=screen.getByRole('button',{name:/عالم الحيوان/,pressed:false});await user.click(general);await user.click(animals);expect(screen.getByRole('complementary',{name:'الفئات المختارة'})).toHaveTextContent('2 / 10');
 await user.type(screen.getByRole('searchbox',{name:'تصفية الفئات'}),'عالم');expect(screen.queryByRole('button',{name:/معلومات عامة/,pressed:true})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'إزالة معلومات عامة'})).toBeVisible();
 const remove=screen.getByRole('button',{name:'إزالة معلومات عامة'});remove.focus();await user.keyboard('{Enter}');await waitFor(()=>expect(screen.getByRole('button',{name:'إزالة عالم الحيوان'})).toHaveFocus());
 const classic=screen.getByRole('radio',{name:'كلاسيكية'});classic.focus();await user.keyboard('{ArrowLeft}');expect(screen.getByRole('radio',{name:'سريعة'})).toHaveFocus();expect(screen.getByRole('radio',{name:'سريعة'})).toHaveAttribute('aria-checked','true');
});
it('keeps the two-category requirement and sends the existing create payload/capability',async()=>{
 mount(<HostNewRoute/>,'?kind=categories');const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:/معلومات عامة/,pressed:false}));await user.click(screen.getByTestId('create-room'));expect(screen.getByRole('alert')).toHaveTextContent('الفئات المختارة لا تكفي لتعبئة اللوح.');expect(screen.getByRole('searchbox',{name:'تصفية الفئات'})).toHaveFocus();
 await user.click(screen.getByRole('button',{name:/عالم الحيوان/,pressed:false}));await user.click(screen.getByTestId('create-room'));expect(await screen.findByRole('heading',{name:'ردهة الاختبار'})).toBeVisible();expect(runtimeMock.createRoom).toHaveBeenCalledWith(expect.objectContaining({gameKind:'categories',categories:['tahadani-006','tahadani-007'],demo:true}),undefined);expect(JSON.parse(sessionStorage.getItem('huroof:v-test-room')!)).toEqual({token:'test-host-token',role:'host'});
});
it('keeps static setup disabled while clearly labeling preview inventory',()=>{
 vi.stubEnv('VITE_STATIC_PREVIEW','true');mount(<HostNewRoute/>);expect(screen.getByTestId('create-room')).toBeDisabled();expect(screen.getByText('يعرض هذا الفهرس محتوى معاينة الواجهة فقط، ولا يثبت توفره للعب المنشور.')).toBeVisible();expect(fetchMock).not.toHaveBeenCalled();
});
it('guides shared setup and preserves each game’s rules and availability', async () => {
 mount(<HowToPlayRoute/>);
 expect(document.title).toBe('كيف تلعب | الميدان');
 expect(screen.getByRole('heading',{name:'كيف تلعب؟',level:1})).toBeVisible();
 const general=screen.getByRole('region',{name:'ابدأوا من هنا'});
 expect(within(general).getAllByRole('listitem')).toHaveLength(4);
 const nav=screen.getByRole('navigation',{name:'انتقل إلى قواعد اللعبة'});
 expect(within(nav).getByRole('link',{name:'الخلية'})).toHaveAttribute('href','#rules-khaliah');
 expect(within(nav).getByRole('link',{name:'إنت صح'})).toHaveAttribute('href','#rules-enta-sah');
 expect(within(nav).getByRole('link',{name:'الدخيل'})).toHaveAttribute('href','#rules-imposter');
 const khaliah=screen.getByRole('region',{name:'كيف تلعب الخلية؟'});
 expect(within(khaliah).getAllByRole('listitem')).toHaveLength(8);
 for (const step of ['جرّبوا البازر', 'الخلايا المرقّمة', 'الفرصة الثانية', 'الفوز بالمباراة']) expect(within(khaliah).getByText(step)).toBeVisible();
 expect(within(khaliah).getByText(/يوصل طرفيه على اللوح يفوز بالجولة/)).toBeVisible();
 expect(within(khaliah).getByRole('link',{name:'إعداد الخلية'})).toHaveAttribute('href','/host/new');
 const enta=screen.getByRole('region',{name:'كيف تلعب إنت صح؟'});
 expect(within(enta).getByText(/الإنهاء المبكر يحتاج تأكيداً/)).toBeVisible();
 await userEvent.click(within(enta).getByText('القوائم والتمثيل والرسم'));
 expect(within(enta).getByText(/تظهر للمضيف ولصاحبها فقط/)).toHaveTextContent('الإرسال لا يمنح نقاطاً تلقائياً');
 expect(within(enta).getByText(/تظهر للمضيف ولصاحبها فقط/)).toHaveTextContent('يُرفض تكرار الإجابة');
 await userEvent.click(within(enta).getByText('التحدّي'));
 expect(within(enta).getByText(/اللاعب الذي شاهد المهمة الخاصة/)).toBeVisible();
 expect(within(enta).getByText('إنت صح — قريباً')).toBeVisible();
 expect(within(enta).queryByRole('link',{name:'اختيار لعبة إنت صح'})).not.toBeInTheDocument();
 const imposter=screen.getByRole('region',{name:'كيف تلعب الدخيل؟'});
 expect(within(imposter).getByText(/المضيف لاعب معهم/)).toBeVisible();
 expect(within(imposter).getByText(/على جولتين/)).toBeVisible();
 expect(within(imposter).getByRole('link',{name:'اقرأ قواعد الدخيل كاملة'})).toHaveAttribute('href','/how-to-play/imposter');
 expect(within(imposter).queryByRole('link',{name:'ابدأ الدخيل'})).not.toBeInTheDocument();
});
it('preserves attribution and license links with the product title',()=>{
 mount(<MediaCreditsRoute/>);expect(document.title).toBe('اعتمادات الخطوط والصور | الميدان');expect(screen.getByRole('link',{name:'OpenMoji'})).toHaveAttribute('href','https://openmoji.org/');expect(screen.getByRole('link',{name:'CC BY-SA 4.0'})).toHaveAttribute('rel','license noreferrer');expect(screen.getByText(/حُوّلت الرسوم إلى PNG/)).toBeVisible();
});
it('keeps not-found recovery as real navigation to the homepage',async()=>{
 mount(<NotFoundRoute/>);expect(document.title).toBe('الصفحة غير موجودة | الميدان');await userEvent.click(within(screen.getByRole('main')).getByRole('link',{name:'الرئيسية',exact:true}));expect(screen.getByRole('heading',{name:'الرئيسية'})).toBeVisible();
});
