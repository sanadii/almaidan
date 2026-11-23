import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {CategoryCompatibility} from '../../src/features/enta/CategoryCompatibility';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const ready={ready:true,count:18,reason:null};
it('keeps unavailable and duplicate-label source identities searchable without submitting setup',async()=>{
 const submit=vi.fn((event:Event)=>event.preventDefault()),fetcher=vi.fn(async()=>({ok:true,json:async()=>({version:1,revision:'revision',reasons:{KIDS_NOT_REVIEWED:'لم تُراجع للأطفال'},categories:[{id:'original-one',label:'العالم',source:'saved-release',revision:'one',inventory:{total:100},modes:{kids:{ready:false,count:0,reason:'KIDS_NOT_REVIEWED'}}},{id:'reviewed-two',label:'العالم',source:'local-authored',revision:'two',inventory:{total:18},modes:{kids:ready}}]})}));
 vi.stubGlobal('fetch',fetcher);const view=render(<form onSubmit={submit as any}><CategoryCompatibility mode="kids"/></form>);expect(fetcher).not.toHaveBeenCalled();
 const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 await screen.findByText('لم تُراجع للأطفال');expect(screen.getAllByRole('heading',{name:'العالم'})).toHaveLength(2);expect(screen.getByText('original-one')).toBeInTheDocument();
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'reviewed-two'}});expect(screen.getAllByRole('heading',{name:'العالم'})).toHaveLength(1);expect(screen.queryByText('original-one')).not.toBeInTheDocument();expect(submit).not.toHaveBeenCalled();
});
it('provides a non-submitting retry after the local endpoint fails',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true,json:async()=>({version:1,revision:'revision',reasons:{},categories:[]})});vi.stubGlobal('fetch',fetcher);
 const view=render(<form><CategoryCompatibility/></form>);const details=view.container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 const retry=await screen.findByRole('button',{name:'إعادة تحميل الجاهزية'});expect(retry).toHaveAttribute('type','button');fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());expect(fetcher).toHaveBeenCalledTimes(2);
});
