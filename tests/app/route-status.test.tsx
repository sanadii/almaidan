import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ThemeProvider} from '../../src/app/ThemeProvider';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RouteChunkBoundary,RouteLoading,StaticPreviewUnavailableRoute} from '../../src/app/App';
function BrokenRoute():never {throw new Error('chunk unavailable');}
function mount(children:React.ReactNode) {return render(<ThemeProvider><MemoryRouter>{children}</MemoryRouter></ThemeProvider>);}
describe('route status surfaces',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('renders route loading with its real busy and status semantics',()=>{
  mount(<RouteLoading/>);expect(screen.getByRole('main')).toHaveClass('maydan-public-page');expect(screen.getByRole('main')).toHaveAttribute('aria-busy','true');expect(screen.getByRole('heading',{name:'جارٍ تحميل الصفحة…'})).toBeVisible();expect(screen.getByText('يُرجى الانتظار بينما نجهّز الصفحة.')).toHaveAttribute('role','status');
 });
 it('preserves the failed chunk alert and enabled native reload action',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>undefined);mount(<RouteChunkBoundary><BrokenRoute/></RouteChunkBoundary>);expect(screen.getByRole('heading',{name:'تعذر تحميل الصفحة'})).toBeVisible();expect(screen.getByRole('alert')).toHaveTextContent('تحقق من الاتصال ثم أعد المحاولة.');expect(screen.getByRole('button',{name:'إعادة المحاولة'})).toBeEnabled();
 });
 it('retains the static unavailable boundary and honest service notice',()=>{
  mount(<StaticPreviewUnavailableRoute/>);expect(screen.getByRole('heading',{name:'هذه الخدمة غير متاحة في المعاينة'})).toBeVisible();expect(screen.getByText(/هذه معاينة منشورة للواجهة فقط/)).toHaveAttribute('role','status');expect(screen.queryByRole('button',{name:/إنشاء|دخول/})).not.toBeInTheDocument();
 });
});
