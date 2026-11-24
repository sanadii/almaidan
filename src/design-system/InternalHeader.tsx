import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AuthAccountControl } from '../features/auth/AuthAccountControl';
import { BrandMark } from './BrandMark';
import { ThemeToggle } from './ThemeToggle';
import { isAlmaidanLocalDevelopment } from '../lib/local-development';
import '../styles/shared-app.css';

/** Shared product navigation for all non-gameplay application surfaces. */
export function InternalHeader({ hideAccount = false, home = false, gameContext = false }: { hideAccount?: boolean; home?: boolean; gameContext?: boolean } = {}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => menuButton.current?.focus(), 0);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  // The header is portalled ahead of #root (see index.html) so keyboard and screen-reader order
  // reach the skip link and navigation before page content, while it stays outside page transforms.
  const chrome = typeof document === 'undefined' ? null : document.getElementById('app-chrome') ?? document.body;
  if (!chrome) return null;
  return <>
    <div className="stable-header-spacer" aria-hidden="true" data-home-region={home ? 'header' : undefined} />
    {createPortal(<>{home ? null : <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>}<header className={`app-header stable-header maydan-app-header${gameContext ? ' app-header--game-context' : ''}`}>
      <Link aria-label="الميدان — الرئيسية" className="wordmark" to="/"><BrandMark /></Link>
      {!gameContext && <><button aria-controls="internal-navigation" aria-expanded={menuOpen} className="app-header__menu-toggle" onClick={() => setMenuOpen(open => !open)} ref={menuButton} type="button">القائمة</button>
      <nav aria-label="التنقل الرئيسي" className={menuOpen ? 'is-open' : ''} id="internal-navigation">
        <NavLink end onClick={() => closeMenu()} to="/">الرئيسية</NavLink>
        <NavLink onClick={() => closeMenu()} to="/how-to-play">كيف تلعب؟</NavLink>
        <NavLink onClick={() => closeMenu()} to="/episodes">الحلقات</NavLink>
        {/* Content administration is local-only here; hosted admins use /admin directly. */}
        {isAlmaidanLocalDevelopment ? <NavLink onClick={() => closeMenu()} to="/local-admin">إدارة المحتوى</NavLink> : null}
      </nav></>}
      <div className="app-header__utilities">{!gameContext && <span className="stable-header__account" style={hideAccount ? { visibility: 'hidden' } : undefined}><AuthAccountControl iconOnly /></span>}<ThemeToggle compact iconOnly /></div>
    </header></>, chrome)}
  </>;
}
