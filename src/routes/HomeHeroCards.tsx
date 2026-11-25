import { Link } from 'react-router-dom';
import { Icon } from '../design-system/Icon';

const artworkSizes = '(max-width: 359px) calc((100vw - 88px) / 2), (max-width: 767px) calc((100vw - 104px) / 2), (max-width: 1199px) calc((100vw - 144px) / 5 - 22px), 190px';

const cards = [
  { art: "buzzer", label: "العبوا الخلية", target: "/host/new?kind=huroof", face: "coral" },
  { art: "trophy", label: "جهّزوا المباراة", target: "create-match-title", face: "gold" },
  { art: "questions", label: "طريقة اللعب", target: "how-it-works", face: "aqua" },
  { art: "hex", label: "استكشفوا الفئات", target: "category-chooser-title", face: "ivory" },
  { art: "cloud", label: "جمعة على كل جهاز", target: "gathering-title", face: "teal" },
] as const;

export function HomeHeroCards() {
  return (
    <nav className="maydan-hero-cards" aria-label="اكتشفوا الميدان">
      <ul className="maydan-hero-card-list">
      {cards.map(({ art, label, target, face }) => {
        const className = `maydan-hero-card maydan-hero-card--${face}`;
        const content = <>
          <picture>
            <source type="image/avif" srcSet={`/assets/maydan/maydan-e-${art}-320.avif 320w, /assets/maydan/maydan-e-${art}-640.avif 640w`} sizes={artworkSizes} />
            <source type="image/webp" srcSet={`/assets/maydan/maydan-e-${art}-320.webp 320w, /assets/maydan/maydan-e-${art}-640.webp 640w`} sizes={artworkSizes} />
            <img alt="" width={320} height={320} src={`/assets/maydan/maydan-e-${art}-320.webp`} loading="lazy" decoding="async" />
          </picture>
          <span className="maydan-hero-card__label">{label}<Icon kind="arrow" /></span>
        </>;
        return <li className="maydan-hero-card-slot" key={art}>
          {target.startsWith('/') ? <Link className={className} to={target}>{content}</Link> : <a className={className} href={`#${target}`}>{content}</a>}
        </li>;
      })}
      </ul>
    </nav>
  );
}
