import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './enta-mode-choices.css';

const modes = [
  { label: 'أسئلة', art: 'questions', standard: '#enta-classic-setup', withAids: '/enta/competitive/new/classic' },
  { label: 'قوائم', art: 'lists', standard: '/enta/new/list', withAids: '/enta/competitive/new/list' },
  { label: 'تمثيل', art: 'acting', standard: '/enta/new/acting', withAids: '/enta/competitive/new/acting' },
  { label: 'رسم', art: 'drawing', standard: '/enta/new/drawing', withAids: null },
] as const;

function ModeLink({ to, children }: { to: string | null; children: ReactNode }) {
  if (!to) return <span className="enta-mode-choice" role="link" aria-disabled="true">{children}</span>;
  if (to.startsWith('#')) return <a className="enta-mode-choice" href={to}>{children}</a>;
  return <Link className="enta-mode-choice" to={to}>{children}</Link>;
}

export function EntaModeChoices() {
  const [variant, setVariant] = useState<'standard' | 'aids' | 'kids'>('standard');
  return <div className="enta-mode-picker">
    <section aria-labelledby="enta-mode-heading">
      <h2 id="enta-mode-heading">نوع اللعب</h2>
      <div className="enta-mode-switches">
        <label><input type="checkbox" role="switch" checked={variant === 'aids'} onChange={event => setVariant(event.target.checked ? 'aids' : 'standard')} />مع المساعدات</label>
        <label><input type="checkbox" role="switch" checked={variant === 'kids'} onChange={event => setVariant(event.target.checked ? 'kids' : 'standard')} />للأطفال</label>
      </div>
      {variant === 'kids' && <p role="status">وضع الأطفال متاح للأسئلة.</p>}
      {variant === 'aids' && <p role="status">المساعدات متاحة للأسئلة والقوائم والتمثيل.</p>}
      <nav className="enta-mode-options" aria-labelledby="enta-mode-heading">
        {modes.map((mode, index) => {
          const path = variant === 'kids' ? (index === 0 ? '/enta/new/kids' : null) : variant === 'aids' ? mode.withAids : mode.standard;
          const art = `/assets/games/enta-mode-${mode.art}-v1-320`;
          return <ModeLink key={mode.label} to={path}>
            <picture><source type="image/avif" srcSet={art + '.avif'} /><img alt="" src={art + '.webp'} width={320} height={214} decoding="async" /></picture>
            <span>{mode.label}</span>
          </ModeLink>;
        })}
      </nav>
      {variant !== 'kids' && <Link className="enta-mode-picker__link" to={variant === 'aids' ? '/enta/competitive/new/mixed' : '/enta/new/mixed'}>لوحة متنوعة</Link>}
    </section>
    <Link className="enta-mode-picker__link" to="/enta/history">مبارياتي</Link>
  </div>;
}
