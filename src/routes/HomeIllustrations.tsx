export function HomeEmblem({ closing = false }: { closing?: boolean }) {
  return <span className={`maydan-emblem${closing ? " maydan-emblem--closing" : ""}`} aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M12 12h12l6 10-6 10H12L6 22l6-10Z" fill="currentColor" /><path d="M29 24h9l5 8-5 8h-9l-5-8 5-8Z" fill="currentColor" opacity=".65" /><path d="M13 20h9m-4-4v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></svg></span>;
}

export function HomeGraphicIcon({ kind }: { kind: "link" | "screen" | "people" | "code" | "arrow" | "check" | "wifi" | "settings" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "link" ? <><path d="m10 14 4-4m-6 3-2 2a4 4 0 0 0 6 6l4-4m-8-7 4-4a4 4 0 1 1 6 6l-2 2" /></> : kind === "screen" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></> : kind === "people" ? <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5" /></> : kind === "code" ? <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M15 15h2v2h-2zm4 4h2v2h-2zm0-4h2m-6 6h2M6 6h.01M18 6h.01M6 18h.01" /></> : kind === "arrow" ? <><path d="M20 12H4m5-5-5 5 5 5" /></> : kind === "check" ? <path d="m5 12 4 4 10-10" /> : kind === "wifi" ? <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-8 4a4 4 0 0 1 4 0" /><circle cx="12" cy="20" r=".5" fill="currentColor" /></> : <><path d="m12 2 2 3 4-1 1 4 3 2-2 3 1 4-4 1-2 3-3-2-4 1-1-4-3-2 2-3-1-4 4-1 2-3Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}

export function HomeSharingIllustration() {
  return <div className="maydan-sharing-illustration">
    <div className="maydan-sharing-illustration__panel" aria-hidden="true">
      <div className="maydan-sharing-illustration__tabs"><span><HomeGraphicIcon kind="link" />رابط الانضمام</span><span><HomeGraphicIcon kind="screen" />شاشة العرض</span></div>
      <p>رمز واحد. وكل واحد على جهازه.</p>
      <div className="maydan-sharing-illustration__tools">{(["arrow", "code", "link", "check"] as const).map(kind => <span key={kind}><HomeGraphicIcon kind={kind} /></span>)}</div>
      <strong>للمضيف ولأصحابه</strong>
      <div className="maydan-sharing-illustration__roles">{[
        { icon: "settings", title: "المضيف", copy: "حساب موثّق وإدارة المباراة", tone: "peach" },
        { icon: "people", title: "الضيف", copy: "رمز الغرفة ثم اسم اللاعب", tone: "lilac" },
        { icon: "screen", title: "شاشة العرض", copy: "اللوحة في متصفح الشاشة", tone: "mint" },
      ].map(role => <div className="maydan-sharing-illustration__role" key={role.title}><span className={`maydan-avatar maydan-avatar--${role.tone}`}><HomeGraphicIcon kind={role.icon as "settings" | "people" | "screen"} /></span><div><b>{role.title}</b><small>{role.copy}</small></div><span className="maydan-illustrative-dots">•••</span></div>)}</div>
    </div>
    
  </div>;
}
