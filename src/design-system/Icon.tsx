import type { ReactNode } from 'react';

const shapes = {
  arrow: <path d="M20 12H4m5-5-5 5 5 5" />,
  'arrow-up': <path d="M12 20V4m-5 5 5-5 5 5" />,
  'arrow-down': <path d="M12 4v16m-5-5 5 5 5-5" />,
  'arrow-up-right': <path d="M6 18 18 6M6 6h12v12" />,
  'arrows-horizontal': <path d="M3 12h18M8 7l-5 5 5 5m8-10 5 5-5 5" />,
  'arrows-vertical': <path d="M12 3v18M7 8l5-5 5 5m-10 8 5 5 5-5" />,
  check: <path d="m5 12 4 4 10-10" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  code: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h2v2h-2zm4 4h2v2h-2zm0-4h2m-6 6h2M6 6h.01M18 6h.01M6 18h.01" /></>,
  link: <path d="m10 14 4-4m-6 3-2 2a4 4 0 0 0 6 6l4-4m-8-7 4-4a4 4 0 1 1 6 6l-2 2" />,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5" /></>,
  screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  settings: <><path d="m12 2 2 3 4-1 1 4 3 2-2 3 1 4-4 1-2 3-3-2-4 1-1-4-3-2 2-3-1-4 4-1 2-3Z" /><circle cx="12" cy="12" r="3" /></>,
  sound: <path d="M11 4 5 9H2v6h3l6 5ZM15 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12" />,
  'sound-off': <path d="M11 4 5 9H2v6h3l6 5Zm5 5 5 6m0-6-5 6" />,
  wifi: <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-8 4a4 4 0 0 1 4 0" /><circle cx="12" cy="20" r=".5" fill="currentColor" /></>,
} satisfies Record<string, ReactNode>;

export function Icon({ kind, className }: { kind: keyof typeof shapes; className?: string }) {
  return <svg aria-hidden="true" className={className} focusable="false" viewBox="0 0 24 24"
    width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {shapes[kind]}
  </svg>;
}
