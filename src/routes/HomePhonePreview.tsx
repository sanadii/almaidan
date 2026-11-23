import { HomeGraphicIcon } from "./HomeIllustrations";

type PreviewKind = "evening" | "invite" | "host" | "join" | "board";
const letters = ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن"];

function ScenePhoto({ className = "" }: { className?: string }) {
  return <picture className={`maydan-phone__photo ${className}`}><img src="/assets/backgrounds/home-games-fantasy-v1.webp" alt="" width={1672} height={941} loading="lazy" decoding="async" /></picture>;
}

function PersonRoles() {
  return <div className="maydan-phone__roles"><span className="maydan-avatar maydan-avatar--peach"><HomeGraphicIcon kind="settings" /></span><span className="maydan-avatar maydan-avatar--lilac"><HomeGraphicIcon kind="people" /></span><span className="maydan-avatar maydan-avatar--mint"><HomeGraphicIcon kind="screen" /></span></div>;
}

/** Editable static editorial illustrations; no form fields, links, buttons or tab stops. */
export function HomePhonePreview({ kind }: { kind: PreviewKind }) {
  return <div className={`maydan-phone maydan-phone--${kind}`} data-phone-preview={kind}>
    <div className="maydan-phone__screen" aria-hidden="true">
      <div className="maydan-phone__status"><span>9:41</span><span><HomeGraphicIcon kind="wifi" /><i className="maydan-phone__battery" /></span></div><div className="maydan-phone__camera" />
      {kind === "evening" ? <>
        <ScenePhoto />
        <div className="maydan-phone__editorial"><span className="maydan-phone__kicker">اللعب يجمعنا</span><h3>جمعة في الميدان.<br />وحماس بين أصحابك.</h3><p>اختاروا حرفاً.<br />افتحوا باب السوالف.</p><span className="maydan-phone__mock-action">استكشفوا الميدان <HomeGraphicIcon kind="arrow" /></span></div>
        <div className="maydan-phone__bottom-nav"><span>الخلية</span><span>طريقة اللعب</span><HomeGraphicIcon kind="people" /></div>
      </> : kind === "invite" ? <>
        <div className="maydan-phone__nav"><HomeGraphicIcon kind="arrow" /><span>دعوة للجمعة</span><HomeGraphicIcon kind="link" /></div>
        <div className="maydan-phone__invitation"><ScenePhoto /><div><span className="maydan-phone__kicker">مكانك بين أصحابك</span><h3>خلّوا جمعتكم<br />في الميدان.</h3><PersonRoles /><p>مضيف يجهّز المباراة.<br />وأصحابه يدخلون برمز الغرفة.</p></div></div>
        <div className="maydan-phone__panel"><div className="maydan-phone__panel-title"><HomeGraphicIcon kind="code" /><strong>الانضمام للغرفة</strong></div><div className="maydan-phone__code" dir="ltr">••••••</div><p>الرمز يوصلكم لنفس المباراة</p><span className="maydan-phone__mock-action">من كل جهاز <HomeGraphicIcon kind="people" /></span></div>
      </> : kind === "host" ? <>
        <div className="maydan-phone__nav"><HomeGraphicIcon kind="arrow" /><span>إعداد المباراة</span><HomeGraphicIcon kind="settings" /></div>
        <h3>جهّزها على جوّكم.</h3><p className="maydan-phone__sub">من نوع اللوحة إلى إعداد التفاصيل</p>
        <div className="maydan-phone__host-feature"><span className="maydan-phone__letter">ح</span><div><strong>الخلية</strong><p>لوحة الحروف والمعلومات</p></div><HomeGraphicIcon kind="check" /></div>
        <div className="maydan-phone__panel"><strong>اختيار اللوحة</strong><div className="maydan-phone__options"><span className="is-selected">حروف <HomeGraphicIcon kind="check" /></span><span>فئات</span></div><div className="maydan-phone__line"><span>الفريقان</span><span className="maydan-phone__team-dots"><i /><i /></span></div><div className="maydan-phone__line"><span>الفئات</span><small>حسب المحتوى الجاهز</small></div></div>
        <div className="maydan-phone__panel"><div className="maydan-phone__panel-title"><HomeGraphicIcon kind="settings" /><strong>قبل البدء</strong></div><p>الاستضافة بحساب موثّق.<br />ترتيب الفرق من غرفة المضيف.</p></div><span className="maydan-phone__mock-action">إعداد الخلية <HomeGraphicIcon kind="arrow" /></span>
      </> : kind === "join" ? <>
        <div className="maydan-phone__nav"><HomeGraphicIcon kind="arrow" /><span>أصحابك ينتظرونك</span><HomeGraphicIcon kind="people" /></div>
        <div className="maydan-phone__guest-card"><span className="maydan-phone__kicker">الخلية من الميدان</span><h3>حياكم في<br /><em>جمعتكم.</em></h3><PersonRoles /><p>المضيف يشارك الرمز.<br />والكل يدخل من جهازه.</p><div className="maydan-phone__code-label">رمز الغرفة</div><div className="maydan-phone__code" dir="ltr">••••••</div><span className="maydan-phone__mock-action">رمز ثم اسم <HomeGraphicIcon kind="arrow" /></span><div className="maydan-phone__guest-note"><HomeGraphicIcon kind="people" />الدخول من جهازك</div></div>
        <div className="maydan-phone__journey"><span>رمز الغرفة</span><b>←</b><span>اسم اللاعب</span></div>
      </> : <>
        <div className="maydan-phone__nav"><HomeGraphicIcon kind="arrow" /><span>الخلية</span><HomeGraphicIcon kind="screen" /></div>
        <div className="maydan-phone__board-heading"><span className="maydan-phone__kicker">لوحة تجمع الفريقين</span><h3>كل حرف، فرصة.</h3><div className="maydan-phone__teams"><span>الفريق الأخضر</span><span>الفريق الأحمر</span></div></div>
        <div className="maydan-phone__board-panel"><div className="maydan-honeycomb" data-testid="huroof-honeycomb">{letters.map((letter,index)=><span className="maydan-honeycomb__cell" key={index}>{letter}</span>)}</div><div className="maydan-phone__axis-caption"><span>المسار العمودي</span><span>المسار الأفقي</span></div></div>
        <div className="maydan-phone__panel"><div className="maydan-phone__panel-title"><HomeGraphicIcon kind="screen" /><strong>اللوحة أمام الجميع</strong></div><p>المضيف يختار الحرف ويدير السؤال.<br />اللاعبون ينضمون من أجهزتهم.</p></div><span className="maydan-phone__mock-action">تحدّي ومنافسة <HomeGraphicIcon kind="people" /></span>
      </>}
      <div className="maydan-phone__home" />
    </div>
  </div>;
}
