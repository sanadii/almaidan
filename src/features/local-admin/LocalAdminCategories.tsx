import {useMemo,useState} from 'react';
import {catalogCategoryCovers} from '../../data/local-question-inventory';

type Row=Record<string,any>;
type Status='all'|'enabled'|'disabled'|'no-image'|'unplayable';
type Kind='all'|'saved'|'KIDS'|'LIST_ITEMS'|'ACTING_ITEMS'|'DRAWING_TARGET';

const kindLabels:Record<Exclude<Kind,'all'>,string>={saved:'أسئلة الميدان',KIDS:'للأطفال',LIST_ITEMS:'القوائم',ACTING_ITEMS:'التمثيل',DRAWING_TARGET:'الرسم'};
const PAGE=48;

const kindOf=(row:Row):Exclude<Kind,'all'>=>row.sourceKind==='local-authored'?(row.format as Exclude<Kind,'all'|'saved'>):'saved';

/** Category cover exactly as players see it in game setup (same key and label resolution). */
function coverFor(row:Row){
 const cover=catalogCategoryCovers([{id:String(row.availabilityKey??row.id),labelAr:String(row.labelAr)}])[0]?.cover;
 const path=cover?.web320??'assets/categories/320/category-006.webp';
 return {src:path.startsWith('/')?path:`/${path}`,placeholder:!cover||cover.altAr.startsWith('صورة افتراضية')};
}

type Props={
 categories:readonly Row[];
 busy:boolean;
 onToggle:(row:Row,disabled:boolean)=>void;
 onReview:(row:Row)=>void;
 onRename:(row:Row)=>void;
};

/**
 * Category overview for the local admin: cover, size and game availability at a glance,
 * with filters for the rows that need attention (disabled, missing art, not playable).
 */
export function LocalAdminCategories({categories,busy,onToggle,onReview,onRename}:Props){
 const [query,setQuery]=useState(''),[status,setStatus]=useState<Status>('all'),[kind,setKind]=useState<Kind>('all'),[limit,setLimit]=useState(PAGE);
 const rows=useMemo(()=>categories.map(row=>({row,kind:kindOf(row),cover:coverFor(row)})),[categories]);
 const scoped=rows.filter(item=>kind==='all'||item.kind===kind);
 const matchesStatus=(item:typeof rows[number],value:Status)=>{
  if(value==='enabled')return item.row.playable!==false&&!item.row.disabled;
  if(value==='disabled')return Boolean(item.row.disabled);
  if(value==='no-image')return item.cover.placeholder;
  if(value==='unplayable')return item.row.playable===false;
  return true;
 };
 const counts:Record<Status,number>={all:scoped.length,enabled:0,disabled:0,'no-image':0,unplayable:0};
 for(const item of scoped)for(const value of ['enabled','disabled','no-image','unplayable'] as const)if(matchesStatus(item,value))counts[value]++;
 const needle=query.trim().toLocaleLowerCase();
 const visible=scoped.filter(item=>matchesStatus(item,status)&&(!needle||String(item.row.labelAr).toLocaleLowerCase().includes(needle)||String(item.row.id).includes(needle)));
 const statusOptions:[Status,string][]=[['all','الكل'],['enabled','متاحة للعب'],['disabled','معطّلة'],['no-image','بدون صورة'],['unplayable','غير جاهزة']];
 const resetPaging=()=>setLimit(PAGE);

 return <section className="local-admin-panel local-admin-categories" aria-labelledby="local-admin-categories-title">
  <div className="local-admin-section-head">
   <div><h2 id="local-admin-categories-title">الفئات</h2><p>أوقف أي فئة لتختفي من إعداد المباريات الجديدة، وأعدها متى شئت. المباريات الجارية لا تتأثر.</p></div>
  </div>
  <div className="local-admin-filters">
   <label className="local-admin-filters__search">ابحث عن فئة<input type="search" value={query} maxLength={100} onChange={e=>{setQuery(e.target.value);resetPaging();}} placeholder="اسم الفئة أو معرّفها"/></label>
   <label>النوع<select value={kind} onChange={e=>{setKind(e.target.value as Kind);resetPaging();}}><option value="all">كل الأنواع</option>{(Object.keys(kindLabels) as Exclude<Kind,'all'>[]).map(value=><option key={value} value={value}>{kindLabels[value]}</option>)}</select></label>
  </div>
  <div className="local-admin-chips" role="group" aria-label="تصفية حسب الحالة">
   {statusOptions.map(([value,label])=><button key={value} type="button" className="local-admin-chip" aria-pressed={status===value} onClick={()=>{setStatus(value);resetPaging();}}>{label}<span className="local-admin-chip__count">{counts[value]}</span></button>)}
  </div>
  <p className="local-admin-result-count" aria-live="polite">{visible.length?`${visible.length} فئة`:'لا توجد فئات مطابقة. غيّر البحث أو التصفية.'}</p>
  <ul className="local-admin-category-grid">
   {visible.slice(0,limit).map(({row,kind:rowKind,cover})=>{
    const playable=row.playable!==false,enabled=playable&&!row.disabled;
    return <li key={row.id} className="local-admin-category" data-state={!playable?'unplayable':row.disabled?'disabled':'enabled'}>
     <span className="local-admin-category__art"><img src={cover.src} alt="" width={320} height={320} loading="lazy" decoding="async"/></span>
     <div className="local-admin-category__body">
      <h3>{row.labelAr}</h3>
      <p className="local-admin-category__meta">{row.questionCount} سؤال · {kindLabels[rowKind]}</p>
      <p className="local-admin-category__flags">
       {row.disabled&&<span className="local-admin-flag local-admin-flag--off">معطّلة</span>}
       {cover.placeholder&&<span className="local-admin-flag local-admin-flag--warn">بدون صورة</span>}
       {!playable&&<span className="local-admin-flag" title="تحتاج سؤالين على الأقل لكل مستوى نقاط (200 و400 و600)">غير جاهزة</span>}
       {row.grouped&&<span className="local-admin-flag" title="تظهر للاعبين مع فئة مشابهة تحت اسم واحد؛ التفعيل يشمل الاثنتين">مدمجة</span>}
      </p>
     </div>
     <div className="local-admin-category__actions">
      <button type="button" role="switch" className="local-admin-switch" aria-checked={enabled} disabled={busy||!playable} aria-label={`إتاحة فئة ${row.labelAr} في المباريات الجديدة`} onClick={()=>onToggle(row,!row.disabled)}>
       <span className="local-admin-switch__track" aria-hidden="true"><span className="local-admin-switch__thumb"/></span>
       <span>{!playable?'غير جاهزة':enabled?'متاحة':'معطّلة'}</span>
      </button>
      <span className="local-admin-category__links">
       <button type="button" className="local-admin-link" disabled={busy} onClick={()=>onReview(row)}>مراجعة الأسئلة</button>
       <button type="button" className="local-admin-link" disabled={busy} onClick={()=>onRename(row)}>تعديل الاسم</button>
      </span>
     </div>
    </li>;
   })}
  </ul>
  {visible.length>limit&&<button type="button" className="button button--secondary local-admin-more" onClick={()=>setLimit(limit+PAGE)}>عرض المزيد ({visible.length-limit} متبقية)</button>}
 </section>;
}
