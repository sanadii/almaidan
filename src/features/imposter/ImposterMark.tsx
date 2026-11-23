/** Small, code-native game symbol; no secret or gameplay state is encoded here. */
export function ImposterMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 120 96" fill="none" aria-hidden="true">
    <path d="M12 32c16-10 30-5 48 2 18-7 32-12 48-2l-7 30c-4 16-25 20-41 5-16 15-37 11-41-5L12 32Z" fill="currentColor" />
    <path d="m27 47 20 5c-6 9-16 6-20-5Zm66 0-20 5c6 9 16 6 20-5Z" fill="var(--surface-paper, white)" />
    <path d="m20 17 9-8m62 0 9 8M60 6v12" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
  </svg>;
}
