import './game-artwork.css';

type Game = 'huroof' | 'enta' | 'imposter';

export function GameArtwork({ game, sizes = '17rem', lazy = false }: {
  game: Game;
  sizes?: string;
  lazy?: boolean;
}) {
  const asset = `/assets/games/${game}-art-v1`;
  const srcSet = (format: 'avif' | 'webp') => `${asset}-360.${format} 360w, ${asset}-720.${format} 720w`;

  return <picture className="game-artwork">
    <source type="image/avif" srcSet={srcSet('avif')} sizes={sizes} />
    <img src={`${asset}-360.webp`} srcSet={srcSet('webp')} sizes={sizes} alt=""
      width={360} height={240} loading={lazy ? 'lazy' : undefined} decoding="async" />
  </picture>;
}
