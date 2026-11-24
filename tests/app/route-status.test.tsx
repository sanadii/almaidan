import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ThemeProvider} from '../../src/app/ThemeProvider';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {RouteChunkBoundary,RouteLoading,StaticPreviewUnavailableRoute} from '../../src/app/App';
function BrokenRoute():never {throw new TypeError('Failed to fetch dynamically imported module: /assets/GameRoutes.js');}
function CrashingRoute():never {throw new Error('render failure');}
function mount(children:React.ReactNode) {return render(<ThemeProvider><MemoryRouter>{children}</MemoryRouter></ThemeProvider>);}
describe('route status surfaces',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('renders route loading with its real busy and status semantics',()=>{
  mount(<RouteLoading/>);expect(screen.getByRole('main')).toHaveClass('maydan-public-page');expect(screen.getByRole('main')).toHaveAttribute('aria-busy','true');expect(screen.getByRole('heading',{name:'جارٍ تحميل الصفحة…'})).toBeVisible();expect(screen.getByText('يُرجى الانتظار بينما نجهّز الصفحة.')).toHaveAttribute('role','status');
 });
 it('preserves the failed chunk alert and enabled native reload action',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>undefined);mount(<RouteChunkBoundary><BrokenRoute/></RouteChunkBoundary>);expect(screen.getByRole('heading',{name:'تعذر تحميل الصفحة'})).toBeVisible();expect(screen.getByRole('alert')).toHaveTextContent('تحقق من الاتصال ثم أعد المحاولة.');expect(screen.getByRole('button',{name:'إعادة المحاولة'})).toBeEnabled();
 });
 it('words a render failure honestly and clears it when the route changes',()=>{
  vi.spyOn(console,'error').mockImplementation(()=>undefined);
  const view=mount(<RouteChunkBoundary resetKey="/broken"><CrashingRoute/></RouteChunkBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('حدث خطأ غير متوقع في هذه الصفحة');
  view.rerender(<ThemeProvider><MemoryRouter><RouteChunkBoundary resetKey="/broken"><p>still broken route</p></RouteChunkBoundary></MemoryRouter></ThemeProvider>);
  expect(screen.queryByText('still broken route')).not.toBeInTheDocument();
  view.rerender(<ThemeProvider><MemoryRouter><RouteChunkBoundary resetKey="/home"><p>next page</p></RouteChunkBoundary></MemoryRouter></ThemeProvider>);
  expect(screen.getByText('next page')).toBeVisible();
 });
 it('retains the static unavailable boundary and honest service notice',()=>{
  mount(<StaticPreviewUnavailableRoute/>);expect(screen.getByRole('heading',{name:'هذه الخدمة غير متاحة في المعاينة'})).toBeVisible();expect(screen.getByText(/هذه معاينة منشورة للواجهة فقط/)).toHaveAttribute('role','status');expect(screen.queryByRole('button',{name:/إنشاء|دخول/})).not.toBeInTheDocument();
 });
});
