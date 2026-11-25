import { useEffect } from "react";
import { StatusArt, StatusHomeLink, StatusPage } from "../design-system/StatusPanel";

export function MediaCreditsRoute() {
  useEffect(() => { document.title = 'اعتمادات الخطوط والصور | الميدان'; }, []);
  return (
    <StatusPage title="اعتمادات الخطوط والصور" illustration={<StatusArt art="hex" />} action={<StatusHomeLink />}>
      <section className="media-credits__group">
        <h2 id="media-credits-fonts">الخطوط</h2>
        <ul aria-labelledby="media-credits-fonts">
          <li><bdi>Cairo</bdi> · <a href="/fonts/Cairo-OFL.txt" rel="license">رخصة SIL المفتوحة للخطوط 1.1</a></li>
          <li><bdi>Instrument Sans</bdi> · <a href="/fonts/InstrumentSans-OFL.txt" rel="license">رخصة SIL المفتوحة للخطوط 1.1</a></li>
        </ul>
      </section>
      <section className="media-credits__group">
        <h2 id="media-credits-illustrations">الرسوم التوضيحية</h2>
        <ul aria-labelledby="media-credits-illustrations">
          <li>رسمة جمعة الميدان وصور بطاقات الاكتشاف من رسومات الميدان.</li>
          <li>رسوم الخلية وإنت صح والدخيل ورسوم طرق اللعب في إنت صح أُنشئت للميدان باستخدام الذكاء الاصطناعي.</li>
        </ul>
      </section>
      <section className="media-credits__group">
        <h2 id="media-credits-questions">صور الأسئلة</h2>
        <ul aria-labelledby="media-credits-questions">
          <li>
            <a href="https://openmoji.org/" rel="noreferrer" target="_blank">OpenMoji</a> من <bdi>HfG Schwäbisch Gmünd</bdi> والمساهمين،
            برخصة <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noreferrer" target="_blank">CC BY-SA 4.0</a>.
            حُوّلت الرسوم إلى PNG، وقد تُقص لتناسب السؤال. تُشارك هذه النسخ بالرخصة نفسها. <a href="https://github.com/hfg-gmuend/openmoji/tree/aeb8bb3a59e2de39c754ac79180c8131c906acea/color/svg" rel="noreferrer" target="_blank">الرسوم الأصلية</a>.
          </li>
          <li>صور أعمال فنية مفتوحة بترخيص <bdi>CC0</bdi> من <a href="https://www.metmuseum.org/hubs/open-access">متحف المتروبوليتان للفنون</a> و<a href="https://www.clevelandart.org/open-access">متحف كليفلاند للفنون</a>.</li>
          <li>رسوم تشكيلات كرة القدم من الميدان. تُنسب صور ويكيميديا كومنز إلى أصحابها حسب رخصة كل ملف في سجل الإصدار.</li>
        </ul>
      </section>
    </StatusPage>
  );
}
