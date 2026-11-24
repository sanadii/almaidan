import type { ReactNode } from "react";

const MEEM_OUTLINE = "M65 -332Q55 -275 47.5 -224Q40 -173 40 -137Q40 -72 62.5 -25.5Q85 21 127.5 46Q170 71 229 71Q246 71 279 71Q312 71 355 71Q398 71 444 71Q490 71 531 71L473 20L473 245Q473 315 457 355Q441 395 402.5 412Q364 429 298 429Q256 429 214.5 423Q173 417 150 407L197 455Q191 431 185 394.5Q179 358 175.5 316Q172 274 172 232Q172 189 175.5 148Q179 107 184 77Q189 47 192 35L118 14Q114 27 108.5 59Q103 91 98.5 136Q94 181 94 232Q94 281 98.5 327.5Q103 374 109.5 412Q116 450 122 473Q144 482 192 491Q240 500 298 500Q348 500 388.5 491.5Q429 483 459.5 464Q490 445 510.5 415.5Q531 386 541 343.5Q551 301 551 245L551 0Q509 0 460.5 0Q412 0 365.5 0Q319 0 282.5 0Q246 0 229 0Q213 0 194 -4.5Q175 -9 157.5 -22.5Q140 -36 129 -63.5Q118 -91 118 -137Q118 -175 125 -224Q132 -273 141 -332Z";

/**
 * Almaidan emblem: a large board cell carrying «م» (the first letter of الميدان) with a small
 * claimed cyan cell beside it, edge-parallel like neighbouring cells on the Huroof honeycomb.
 * Colours come from design tokens so the mark reads on light, dark and arena surfaces.
 */
export function BrandEmblem({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`brand-mark__emblem ${className}`.trim()} viewBox="0 0 48 48" fill="none">
      <path
        d="M24 2 40.02 11.25v18.5L24 39 7.98 29.75v-18.5Z"
        style={{ fill: "var(--app-action, var(--spatial-board-shell))", stroke: "var(--app-action, var(--spatial-board-shell))" }}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M35.49 34.9 40.25 37.65v5.5L35.49 45.9l-4.76-2.75v-5.5Z"
        style={{ fill: "var(--spatial-cyan)", stroke: "var(--spatial-cyan)" }}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* «م» from Cairo (SIL OFL), emboldened with a same-colour stroke to the brand weight. */}
      <path
        d={MEEM_OUTLINE}
        transform="translate(24 20) scale(0.0298 -0.0298) translate(-295.5 -84)"
        style={{ fill: "var(--spatial-face)", stroke: "var(--spatial-face)" }}
        strokeWidth="60"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Original, inline-vector identity for the public product surfaces. */
export function BrandMark({ className = "", suffix }: { className?: string; suffix?: ReactNode }) {
  return (
    <span className={`brand-mark brand-mark--maydan ${className}`.trim()} aria-label="الميدان" role="img">
      <BrandEmblem />
      <span className="brand-mark__word">الميدان</span>
      {suffix ? <small className="brand-mark__suffix">{suffix}</small> : null}
    </span>
  );
}
