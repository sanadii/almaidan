import { ImposterMark } from "../features/imposter/ImposterMark";
import "../features/imposter/imposter.css";
import { CategoryCompatibility } from '../features/enta/CategoryCompatibility';
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HomeHeroCards } from "./HomeHeroCards";
import { HomePhonePreview } from "./HomePhonePreview";
import { HomeEmblem, HomeGraphicIcon, HomeSharingIllustration } from "./HomeIllustrations";
import { InternalHeader } from "../design-system/InternalHeader";
import { gameRuntime } from "../features/game/runtime";
import { useFirebaseAuth } from "../features/auth/auth-context";
import { catalogCategoryCovers, fetchLocalQuestionInventory, inventoryCategoryCovers, staticPreviewQuestionInventory, type LocalQuestionInventory } from "../data/local-question-inventory";
import type { ApprovedReleaseCatalog } from "../features/game/runtime/contracts";
import { approvedCategoryPlayable, localCategoryPlayable } from "../data/category-playability";
import { isAlmaidanLocalDevelopment } from "../lib/local-development";
import { VerifyEmailNotice } from "../features/auth/VerifyEmailNotice";

type HomeSurfaceProps = {
  joinForm: ReactNode;
  joinMessage: ReactNode;
  staticPreview?: boolean;
};

function CategoryChooser({ staticPreview }: { staticPreview: boolean }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [inventory, setInventory] = useState<LocalQuestionInventory>();
  const [inventoryError, setInventoryError] = useState("");
  const [inventorySettled, setInventorySettled] = useState(false);
  const [inventoryUnavailable, setInventoryUnavailable] = useState(false);
  const [inventoryAttempt, setInventoryAttempt] = useState(0);
  const [approvedCatalog, setApprovedCatalog] = useState<ApprovedReleaseCatalog>();
  const [approvedCatalogError, setApprovedCatalogError] = useState("");
  const [approvedCatalogAttempt, setApprovedCatalogAttempt] = useState(0);
  const previewCatalogue = !staticPreview && gameRuntime.kind === "local" && (inventoryUnavailable || Boolean(inventoryError));

  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "local") return;
    let active = true;
    setInventorySettled(false);
    setInventoryUnavailable(false);
    void fetchLocalQuestionInventory()
      .then((next) => {
        if (!active) return;
        setInventory(next);
        setInventoryError("");
        setInventoryUnavailable(!next);
        setInventorySettled(true);
      })
      .catch(() => {
        if (!active) return;
        setInventory(undefined);
        setInventoryUnavailable(false);
        setInventorySettled(true);
        setInventoryError("فهرس الفئات غير متاح حالياً. تأكد من تشغيل خدمة اللعبة ثم أعد المحاولة.");
      });
    return () => { active = false; };
  }, [inventoryAttempt, staticPreview]);

  useEffect(() => {
    if (staticPreview || gameRuntime.kind !== "firebase") return;
    let active = true;
    void (gameRuntime.getApprovedReleaseCatalog?.() ?? Promise.reject(new Error("APPROVED_RELEASE_CATALOG_UNAVAILABLE")))
      .then((catalog) => {
        if (!active) return;
        setApprovedCatalog(catalog);
        setApprovedCatalogError("");
      })
      .catch(() => {
        if (!active) return;
        setApprovedCatalog(undefined);
        setApprovedCatalogError("لا تتوفر حزمة فئات معتمدة للعب حالياً.");
      });
    return () => { active = false; };
  }, [approvedCatalogAttempt, staticPreview]);

  const categoryCatalogue = useMemo(() => {
    if (gameRuntime.kind === "firebase") return approvedCatalog
      ? catalogCategoryCovers(approvedCatalog.categories.map(({ id, labelAr }) => ({ id, labelAr })))
      : [];
    return inventory ? inventoryCategoryCovers(inventory) : previewCatalogue ? inventoryCategoryCovers(staticPreviewQuestionInventory) : [];
  }, [approvedCatalog, inventory, previewCatalogue]);

  const eligibleCategories = useMemo(() => categoryCatalogue.filter((category) => {
      if (gameRuntime.kind === "firebase") return approvedCategoryPlayable(
        approvedCatalog?.categories.find((candidate) => candidate.id === category.id),
        "categories",
        approvedCatalog?.challengeAvailability?.enabledMechanics ?? [],
      );
      return localCategoryPlayable(
        (previewCatalogue ? staticPreviewQuestionInventory : inventory)?.categories.find((candidate) => candidate.id === category.id),
        "categories",
        (previewCatalogue ? staticPreviewQuestionInventory : inventory)?.huroofAvailable ?? false,
      );
    }), [approvedCatalog, categoryCatalogue, inventory, previewCatalogue]);

  const categories = useMemo(() => {
    const visible=inventory?.source==='local_saved_release'?categoryCatalogue:eligibleCategories;
    const normalized = query.trim().toLocaleLowerCase("ar");
    return normalized
      ? visible.filter((category) => `${category.displayNameAr} ${category.id}`.toLocaleLowerCase("ar").includes(normalized))
      : visible;
  }, [eligibleCategories, categoryCatalogue, inventory, query]);

  const waiting = !staticPreview && (gameRuntime.kind === "firebase"
    ? !approvedCatalog && !approvedCatalogError
    : gameRuntime.kind === "local" && !inventorySettled && !inventoryError);

  return (
    <section className={`maydan-catalogue${eligibleCategories.length > 0 ? " maydan-catalogue--ready" : " maydan-catalogue--quiet"}`} data-home-region="category-chooser" aria-labelledby="category-chooser-title">
      <div className="maydan-section-heading">

        <h2 id="category-chooser-title" tabIndex={-1}>وش تعرفون أكثر؟</h2>
        <p>{previewCatalogue ? "تصفحوا نماذج الفئات من الفهرس المحفوظ. لا يمكن التحقق من جاهزيتها للعب الآن." : "تصفحوا الفئات الجاهزة للعب، واختاروا منها عند إعداد مباراة الفئات."}</p>
        {inventory?.source==='local_saved_release'?<p role="status">{inventory.categories.length.toLocaleString('ar')} فئة من الأسئلة الأصلية المحفوظة · {inventory.categories.reduce((sum,c)=>sum+(c.sourceQuestionCount??c.questionCount),0).toLocaleString('ar')} سؤال · {eligibleCategories.length.toLocaleString('ar')} فئة جاهزة للعب محلياً</p>:null}
      </div>
      {isAlmaidanLocalDevelopment && !staticPreview ? <CategoryCompatibility /> : null}
      {staticPreview ? <p className="maydan-status" role="status">معاينة الواجهة لا تحتوي على فئات لعب منشورة.</p> : null}
      {!staticPreview && gameRuntime.kind === "fixture" ? <p className="maydan-status" role="status">لا تتوفر فئات للعرض حالياً.</p> : null}
      {waiting ? <p className="maydan-status" role="status">جارٍ التحقق من الفئات المتاحة…</p> : null}
      {inventoryUnavailable ? <p className="maydan-status" role="status">فهرس الفئات المحلي غير متاح حالياً.</p> : null}
      {inventoryError ? (
        <p className="maydan-status" role="status">
          {inventoryError}{" "}
          <button className="maydan-inline-action" onClick={() => setInventoryAttempt((attempt) => attempt + 1)} type="button">أعد المحاولة</button>
        </p>
      ) : null}
      {gameRuntime.kind === "firebase" && approvedCatalogError ? (
        <p className="maydan-status" role="status">
          {approvedCatalogError}{" "}
          <button className="maydan-inline-action" onClick={() => setApprovedCatalogAttempt((attempt) => attempt + 1)} type="button">أعد المحاولة</button>
        </p>
      ) : null}
      {!staticPreview && !waiting && eligibleCategories.length === 0 && (gameRuntime.kind === "firebase" ? Boolean(approvedCatalog) : Boolean(inventory)) && !inventoryError && !approvedCatalogError ? (
        <p className="maydan-status" role="status">لا توجد فئات جاهزة للعرض حالياً.</p>
      ) : null}
      {eligibleCategories.length > 0 ? (
        <>
          <label className="maydan-filter">
            <span>تصفية الفئات</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الفئة" />
          </label>
          {categories.length === 0 ? <p className="maydan-status" role="status">لا توجد فئات تطابق البحث.</p> : (
            <ul className="maydan-categories">
              {categories.slice(0, showAll || query ? categories.length : 6).map((category) => (
                <li key={category.id}>
                  {previewCatalogue || !eligibleCategories.some(c=>c.id===category.id) ? <div className="maydan-category-preview maydan-category-card maydan-category-card--unavailable">
                    <span aria-hidden="true" className="maydan-category-card__art"><img src={`/${category.cover.web320}`} alt="" width={320} height={320} loading="lazy" decoding="async" /></span>
                    <strong>{category.displayNameAr}</strong>
                    <span className="maydan-category-card__hint">{previewCatalogue?'للمعاينة فقط':inventory?.categories.find(c=>c.id===category.id)?.unavailableReason??'تحتاج هذه الفئة أسئلة إضافية للعب'}</span>
                  </div> : <Link className="maydan-category-card" to={`/host/new?kind=categories&category=${encodeURIComponent(category.id)}`}>
                    <span aria-hidden="true" className="maydan-category-card__art"><img src={`/${category.cover.web320}`} alt="" width={320} height={320} loading="lazy" decoding="async" /></span>
                    <strong>{category.displayNameAr}</strong>
                    <span className="maydan-category-card__hint">العبوا بهذه الفئة</span>
                  </Link>}
                </li>
              ))}
            </ul>
          )}
          {!query && categories.length > 6 ? (
            <button className="maydan-inline-action" onClick={() => setShowAll((current) => !current)} type="button">
              {showAll ? "عرض الفئات المختصرة" : `عرض الفئات الأخرى (${categories.length - 6})`}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function hostStatusCopy(status: ReturnType<typeof useFirebaseAuth>["status"], staticPreview: boolean, canHost: boolean) {
  if (staticPreview) return "هذه معاينة واجهة. الاستضافة والانضمام غير متاحين هنا.";
  if (status === "loading") return "جارٍ التحقق من حالة الحساب…";
  if (canHost) return "حسابك جاهز للاستضافة. الانضمام متاح للضيوف أيضاً.";
  if (isAlmaidanLocalDevelopment && status !== "error") return "سجّل الدخول بحساب المضيف المحلي. اللاعبون يدخلون بالرمز والاسم على هذا الكمبيوتر.";
  if (status === "anonymous") return "حساب الضيف للانضمام. استضافة المباراة تتطلب Google أو بريداً موثقاً.";
  if (status === "password" || status === "google") return "استضافة المباراة تتطلب Google أو بريداً موثقاً.";
  if (status === "error") return "تعذر التحقق من الحساب الآن. أعد المحاولة قبل الاستضافة.";
  return "استضافة المباراة تتطلب Google أو بريداً موثقاً. يمكنك الانضمام كضيف.";
}

const homeFaqs = [
  ["هل أحتاج حساباً عشان ألعب؟", isAlmaidanLocalDevelopment ? "المضيف يستخدم حسابه المحلي، واللاعبون يدخلون برمز الغرفة وأسمائهم دون إنشاء حساب." : "يمكنك الانضمام كضيف برمز الغرفة ثم كتابة اسمك. أما الاستضافة فتتطلب تسجيل الدخول باستخدام Google أو بريد إلكتروني موثّق."],
  ["وين أحصل رمز الغرفة؟", "المضيف يشارك رمز الغرفة بعد إنشاء المباراة. اكتبه في خانة الانضمام، ثم أدخل اسمك في الخطوة التالية. ويمكنك استخدام رابط الانضمام الذي يشاركه المضيف."],
  ["كيف أختار الفئات؟", "تصفح الفئات الجاهزة هنا، أو افتح إعداد مباراة الفئات. يعرض الفهرس جميع الفئات مع سبب عدم توافق أي فئة مع النمط المختار."],
  ["هل أقدر أفتح اللعبة على شاشة أكبر؟", isAlmaidanLocalDevelopment ? "افتح رابط العرض الذي ينشئه المضيف في نافذة على هذا الكمبيوتر. هذه النسخة المحلية لا تستقبل أجهزة أخرى عبر الشبكة." : "نعم، لدى المضيف رابط شاشة العرض داخل الغرفة. افتح الرابط في متصفح على الشاشة التي تختارها؛ ويدخل اللاعبون إلى الغرفة من أجهزتهم برمزها."],
  ["كيف أبدأ إنت صح؟", "افتح إعداد إنت صح واختر الفرق والفئات. يظهر توفر البدء داخل صفحة الإعداد."],
  ["هل أقدر أشتري رصيد؟", "شراء الرصيد غير متاح حالياً. لا توجد باقات شراء مفعّلة في هذه النسخة."],
];

export function HomeSurface({ joinForm, joinMessage, staticPreview = false }: HomeSurfaceProps) {
  const { status, user } = useFirebaseAuth();
  const canHost = Boolean(!staticPreview && user && !user.isAnonymous && user.emailVerified);
  const hostStatus = hostStatusCopy(status, staticPreview, canHost);
  const disabledHost = staticPreview || status === "loading";

  return (
    <main data-page-layout="wide" className="maydan-home-page" id="main-content">
      <InternalHeader home hideAccount={staticPreview} />
      <a className="maydan-skip-link" href="#create-match-title">تجاوز إلى بدء مباراة</a>

      <section className="maydan-hero" data-home-region="hero" aria-labelledby="maydan-hero-title">
        <picture className="maydan-hero__photo">
          <img src="/assets/backgrounds/home-games-fantasy-v1.webp" alt="رسم لأصدقاء يتجمعون حول لوحة حروف في عالم خيالي" width={1672} height={941} fetchPriority="high" decoding="async" />
        </picture>
        <div className="maydan-hero__inner">
          <div className="maydan-hero__copy">
            <h1 id="maydan-hero-title"><span>أحلى جمعة تبدأ بلعبة.</span><span>واللعبة تحلى بأصحابكم.</span><span>في الميدان.</span></h1>
            <p className="maydan-hero__description">ألعاب عربية تجمعكم على التحدّي والمعرفة. المضيف يبدأها، والكل يدخل برمز واحد.</p>
            <div className="maydan-shortcuts"><a className="maydan-button maydan-button--primary" href="#game-choice-title">ابدأوا مباراة</a><a className="maydan-text-link" href="#room-code">معك رمز غرفة؟ <span aria-hidden="true">←</span></a></div>
          </div>
        </div>
        <svg className="maydan-hero__wave" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 48 Q720 0 1440 48 V100 H0 Z" /></svg>
      </section>

      <section className="maydan-setup" data-home-region="create-join-dock" aria-labelledby="setup-title">
        <div className="maydan-section maydan-setup__inner">
          <div className="maydan-setup__copy">
            <h2 id="setup-title">كل جمعة تبدأ<br />بواحد يجهّزها.</h2>
            <div className="maydan-setup__form" data-home-region="join-form">
              <div className="maydan-prompt-row"><h3 id="join-room-title">معكم رمز غرفة؟</h3><div className="maydan-join-form">{joinForm}{joinMessage}</div><p className="maydan-prompt-note">الانضمام متاح للضيف أيضاً.</p></div>
              <div className="maydan-prompt-row maydan-action maydan-action--create" role="region" aria-labelledby="create-match-title">
                <h3 id="create-match-title" tabIndex={-1}>ابدأوا مباراة الخلية</h3><p className="maydan-action__note" id="host-requirement">{hostStatus}</p>
                {canHost ? <Link aria-describedby="host-requirement" className="maydan-button maydan-button--primary" to="/host/new?kind=huroof">إنشاء مباراة</Link>
                  : disabledHost ? <button aria-busy={status === "loading" || undefined} aria-describedby="host-requirement" className="maydan-button maydan-button--primary" disabled type="button">{status === "loading" ? "جارٍ التحقق…" : "الاستضافة غير متاحة"}</button>
                    : user && !user.isAnonymous && !user.emailVerified ? <VerifyEmailNotice user={user} />
                    : <Link aria-describedby="host-requirement" className="maydan-text-link" to="/login?returnTo=%2Fhost%2Fnew%3Fkind%3Dhuroof">تسجيل الدخول للاستضافة <span aria-hidden="true">←</span></Link>}
              </div>
            </div>
          </div>
          <div className="maydan-setup__phone"><HomePhonePreview kind="invite" /></div>
        </div>
      </section>

      <section className="maydan-showcase maydan-section" data-home-region="game-choice" aria-labelledby="game-choice-title">
        <div className="maydan-section-heading"><h2 id="game-choice-title" tabIndex={-1}>ألعاب الميدان</h2><p>اختاروا اللعبة وتنافسوا على الفوز بالمعرفة والسرعة.</p><a className="maydan-button maydan-button--primary" href="#create-match-title">ابدأوا جمعتكم</a></div>
        <div className="maydan-game-cards-showcase">
          <div className="maydan-game-cards-grid">
            <article className="maydan-game-card maydan-game-card--khaliah" aria-labelledby="game-khaliah-title">
              <div className="maydan-game-card__content">
                <h3 className="maydan-game-card__title" id="game-khaliah-title">الخلية</h3>
                <span className="maydan-game-card__badge">لعبة استراتيجية</span><p className="maydan-game-card__description">أجيبوا عن أسئلة الحروف وصِلوا خلايا فريقكم للفوز.</p>
              </div>
              <div className="maydan-game-card__icon-wrap">
                <svg viewBox="0 0 100 100" fill="none" className="maydan-game-icon maydan-game-icon--khaliah" aria-hidden="true">
                  <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" stroke="#00f0ff" strokeWidth="4" />
                  <polygon points="50,26 72,39 72,61 50,74 28,61 28,39" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="50" y1="6" x2="50" y2="26" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="88" y1="28" x2="72" y2="39" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="88" y1="72" x2="72" y2="61" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="50" y1="94" x2="50" y2="74" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="12" y1="72" x2="28" y2="61" stroke="#00f0ff" strokeWidth="3" />
                  <line x1="12" y1="28" x2="28" y2="39" stroke="#00f0ff" strokeWidth="3" />
                </svg>
              </div>
              <div className="maydan-game-card__actions"><Link className="maydan-game-card__start" to="/host/new?kind=huroof">ابدأ الخلية</Link><Link className="maydan-game-card__rules" to="/how-to-play#rules-khaliah">طريقة اللعب</Link></div>
            </article>
            <article className="maydan-game-card maydan-game-card--enta" aria-labelledby="game-enta-title">
              <div className="maydan-game-card__content">
                <h3 className="maydan-game-card__title" id="game-enta-title">إنت صح</h3>
                <span className="maydan-game-card__badge maydan-game-card__badge--blue">تحدي وسرعة</span>
                <p className="maydan-game-card__description">اختاروا الفئات وتنافسوا في الأسئلة والجولات على النقاط.</p>
              </div>
              <div className="maydan-game-card__icon-wrap maydan-game-card__icon-wrap--blue">
                <svg viewBox="0 0 100 100" fill="none" className="maydan-game-icon maydan-game-icon--enta" aria-hidden="true">
                  <circle cx="50" cy="50" r="42" stroke="#2563eb" strokeWidth="4" />
                  <path d="M54 22 L32 52 L48 52 L44 78 L68 46 L52 46 Z" stroke="#3b82f6" fill="rgba(37,99,235,0.2)" strokeWidth="4" />
                </svg>
              </div>
              <div className="maydan-game-card__actions">{isAlmaidanLocalDevelopment ? <Link className="maydan-game-card__start" to="/enta/new">ابدأ إنت صح</Link> : <p className="maydan-game-status">إنت صح — قريباً</p>}<Link className="maydan-game-card__rules" to="/how-to-play#rules-enta-sah">طريقة اللعب</Link></div>
            </article>
            <article className="maydan-game-card maydan-game-card--imposter" aria-labelledby="game-imposter-title">
              <div className="maydan-game-card__content">
                <h3 className="maydan-game-card__title" id="game-imposter-title">الدخيل</h3>
                <span className="maydan-game-card__badge">تلميح وخداع</span>
                <p className="maydan-game-card__description">الكل يعرف الكلمة… إلا واحد! لمّحوا واكشفوا الدخيل.</p>
                
              </div>
              <div className="maydan-game-card__icon-wrap"><ImposterMark className="maydan-game-icon" /></div>
              <div className="maydan-game-card__actions">{isAlmaidanLocalDevelopment && !staticPreview ? <Link className="maydan-game-card__start" to="/host/new?kind=imposter">ابدأ الدخيل</Link> : <p className="maydan-game-status">الدخيل — اللعب المستضاف غير مفعّل</p>}<Link className="maydan-game-card__rules" to="/how-to-play/imposter">طريقة اللعب</Link></div>
            </article>
          </div>
        </div>

      </section>

      <section className="maydan-phone-showcase maydan-section" id="how-it-works" tabIndex={-1} data-home-region="guide" aria-label="كيف تبدأون اللعب">
          <ol className="maydan-showcase__examples">
            <li><HomePhonePreview kind="host" /><div className="maydan-showcase__caption"><div className="maydan-caption-heading"><span className="maydan-caption-icon maydan-caption-icon--mint"><HomeGraphicIcon kind="settings" /></span><h3>المضيف يجهّزها</h3></div><p>سجّل دخولك بحساب موثّق، وافتح إعداد الخلية لاختيار تفاصيل المباراة.</p></div></li>
            <li><HomePhonePreview kind="join" /><div className="maydan-showcase__caption"><div className="maydan-caption-heading"><span className="maydan-caption-icon maydan-caption-icon--violet"><HomeGraphicIcon kind="link" /></span><h3>شاركوا رمز الغرفة</h3></div><p>أرسلوا الرمز أو رابط الانضمام لأصحابكم، وخلّوهم يدخلون بأسمائهم.</p></div></li>
            <li><HomePhonePreview kind="board" /><div className="maydan-showcase__caption"><div className="maydan-caption-heading"><span className="maydan-caption-icon"><HomeGraphicIcon kind="screen" /></span><strong className="maydan-phone-heading" id="huroof-choice-title">الخلية في الغرفة</strong></div><p>المضيف يرتّب الفرق قبل اللعب، ثم تبدأ منافسة الحروف والمعلومات.</p><a className="maydan-text-link" href="#create-match-title">العبوا الخلية <span aria-hidden="true">←</span></a></div></li>
          </ol>
          <Link className="maydan-text-link" to="/how-to-play">شوفوا قواعد اللعب <span aria-hidden="true">←</span></Link>
      </section>

      <section className="maydan-discovery maydan-section" data-home-region="discovery" aria-labelledby="discovery-title"><div className="maydan-section-heading"><h2 id="discovery-title">خذوا لفة في الميدان.</h2><p>من إعداد المباراة إلى طريقة اللعب، اختاروا خطوتكم.</p></div><HomeHeroCards /></section>

      <CategoryChooser staticPreview={staticPreview} />

      <section className="maydan-gathering maydan-section" data-home-region="gathering" aria-labelledby="gathering-title">
        <div className="maydan-gathering__copy"><h2 id="gathering-title" tabIndex={-1}>شاركوا الرمز.<br />وافتحوا اللوحة.<br />واجتمعوا.</h2><p>{isAlmaidanLocalDevelopment ? "افتحوا شاشة العرض من رابط المضيف في نافذة مستقلة على هذا الكمبيوتر. ينضم كل لاعب باسمه ورمز الغرفة من جلسة متصفح مستقلة." : "في البيت أو مع الأصحاب، افتحوا شاشة العرض من رابط المضيف في المتصفح. اللاعبون ينضمون من أجهزتهم برمز الغرفة، وتبقى اللوحة أمام الجميع."}</p><p className="maydan-gathering__note">{isAlmaidanLocalDevelopment ? "الألعاب والمحتوى تعمل على هذا الكمبيوتر عبر الخدمات المحلية." : "تحتاجون متصفحاً واتصالاً بالإنترنت. رابط شاشة العرض يظهر للمضيف داخل الغرفة."}</p><Link className="maydan-text-link" to="/how-to-play">تعرّفوا على طريقة اللعب <span aria-hidden="true">←</span></Link><div className="maydan-account-note" data-home-region="account-note"><h3 id="account-note-title">ابدأها بحسابك، وافتحها لأصحابك.</h3><p>{isAlmaidanLocalDevelopment ? "الاستضافة بحساب المضيف المحلي؛ والضيوف يدخلون بالرمز والاسم دون حساب." : "الاستضافة تتطلب حساب Google أو بريداً موثّقاً. أما أصحابك فيقدرون ينضمون كضيوف برمز الغرفة."}</p>{!isAlmaidanLocalDevelopment ? <p className="maydan-credit-note">شراء الرصيد غير متاح حالياً. لا توجد باقات شراء مفعّلة في هذه النسخة.</p> : null}{!staticPreview ? <Link className="maydan-text-link" to={user && !user.isAnonymous ? "/account" : "/login"}>{user && !user.isAnonymous ? "افتح حسابك" : "سجّل دخولك"} <span aria-hidden="true">←</span></Link> : <p className="maydan-status">الحساب غير متاح في المعاينة.</p>}</div></div>
        <div className="maydan-gathering__art"><HomeSharingIllustration /></div>
      </section>

      <section className="maydan-faq maydan-section" data-home-region="faq" aria-labelledby="faq-title">
        <div className="maydan-section-heading"><h2 id="faq-title">عندكم سؤال؟</h2></div>
        <div className="maydan-faq__items">{homeFaqs.filter(([question]) => !isAlmaidanLocalDevelopment || question !== "هل أقدر أشتري رصيد؟").map(([question, answer]) => <details key={question}><summary>{question}<span className="maydan-faq-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="maydan-final" data-home-region="final-action" aria-labelledby="final-title">
        <HomeEmblem closing /><h2 id="final-title">خلّوا جمعتكم في الميدان.</h2><p>جمّع أصحابك على اللعب والتحدّي. وخلّوا الحماس يبدأ.</p>
        <div className="maydan-shortcuts"><a className="maydan-button maydan-button--primary" href="#game-choice-title">جهّزوا المباراة <span aria-hidden="true">←</span></a><a className="maydan-button maydan-button--secondary" href="#room-code">انضموا لأصحابكم</a></div>
      </section>
      <footer className="maydan-footer" data-home-region="footer">
        <p>الميدان · المعرفة تحلى بالجمعة.</p><nav aria-label="معلومات إضافية"><Link to="/how-to-play">قواعد اللعب</Link><Link to="/media-credits">اعتمادات الصور</Link><Link to="/contact">تواصل معنا</Link><a href="#maydan-hero-title">للأعلى ↑</a></nav>
      </footer>
    </main>
  );
}
