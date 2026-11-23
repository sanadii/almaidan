const cards = [
  { art: "buzzer", label: "العبوا الخلية", target: "game-choice-title", face: "coral" },
  { art: "trophy", label: "جهّزوا المباراة", target: "create-match-title", face: "gold" },
  { art: "questions", label: "طريقة اللعب", target: "how-it-works", face: "aqua" },
  { art: "hex", label: "استكشفوا الفئات", target: "category-chooser-title", face: "ivory" },
  { art: "cloud", label: "جمعة على كل جهاز", target: "gathering-title", face: "teal" },
] as const;

export function HomeHeroCards() {
  return (
    <nav className="maydan-hero-cards" aria-label="اكتشفوا الميدان">
      <ul className="maydan-hero-card-list">
      {cards.map(({ art, label, target, face }) => (
        <li className="maydan-hero-card-slot" key={art}>
        <a className={`maydan-hero-card maydan-hero-card--${face}`} href={`#${target}`}>
          <picture>
            <source type="image/avif" srcSet={`/assets/maydan/maydan-e-${art}-320.avif 320w, /assets/maydan/maydan-e-${art}-640.avif 640w`} sizes="(max-width: 767px) calc((100vw - 48px) / 2), 200px" />
            <source type="image/webp" srcSet={`/assets/maydan/maydan-e-${art}-320.webp 320w, /assets/maydan/maydan-e-${art}-640.webp 640w`} sizes="(max-width: 767px) calc((100vw - 48px) / 2), 200px" />
            <img alt="" width={640} height={640} src={`/assets/maydan/maydan-e-${art}-640.webp`} loading="lazy" decoding="async" />
          </picture>
          <span className="maydan-hero-card__label">{label}<span aria-hidden="true">←</span></span>
        </a>
        </li>
      ))}
      </ul>
    </nav>
  );
}
