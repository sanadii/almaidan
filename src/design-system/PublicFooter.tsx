import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';
import './public-shell.css';

export function PublicFooter({ home = false }: { home?: boolean }) {
  return (
    <footer className={home ? 'maydan-footer' : 'public-footer'} data-home-region={home ? 'footer' : undefined}>
      <p>{home ? 'الميدان' : <BrandMark />} · المعرفة تحلى بالجمعة.</p>
      <nav aria-label="معلومات إضافية">
        <Link to="/how-to-play">قواعد اللعب</Link>
        <Link to="/media-credits">اعتمادات الخطوط والصور</Link>
        <Link to="/contact">تواصل معنا</Link>
        {home && <a className="maydan-footer__back-top" href="#maydan-hero-title">للأعلى <Icon kind="arrow-up" /></a>}
      </nav>
    </footer>
  );
}
