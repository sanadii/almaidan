import type { ReactNode } from "react";

/** Original, inline-vector identity for the public product surfaces. */
export function BrandMark({ className = "", suffix }: { className?: string; suffix?: ReactNode }) {
  return (
    <span className={`brand-mark brand-mark--maydan ${className}`.trim()} aria-label="الميدان" role="img">
      <svg aria-hidden="true" className="brand-mark__emblem" viewBox="0 0 48 48" fill="none">
        <path d="M12 12h12l6 10-6 10H12L6 22l6-10Z" fill="currentColor" />
        <path d="M29 24h9l5 8-5 8h-9l-5-8 5-8Z" fill="currentColor" opacity=".65" />
        <path d="M13 20h9m-4-4v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="brand-mark__word">الميدان</span>
      {suffix ? <small className="brand-mark__suffix">{suffix}</small> : null}
    </span>
  );
}
