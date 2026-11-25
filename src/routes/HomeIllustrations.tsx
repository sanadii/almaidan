import { BrandEmblem } from "../design-system/BrandMark";
import { Icon } from "../design-system/Icon";
export function HomeEmblem({ closing = false }: { closing?: boolean }) {
  return <span className={`maydan-emblem${closing ? " maydan-emblem--closing" : ""}`} aria-hidden="true"><BrandEmblem /></span>;
}

export function HomeSharingIllustration() {
  return <div className="maydan-sharing-illustration">
    <div className="maydan-sharing-illustration__panel" aria-hidden="true">
      <div className="maydan-sharing-illustration__tabs"><span><Icon kind="link" />رابط الانضمام</span><span><Icon kind="screen" />شاشة العرض</span></div>
      <p>رمز واحد. وكل واحد على جهازه.</p>
      <div className="maydan-sharing-illustration__tools">{(["arrow", "code", "link", "check"] as const).map(kind => <span key={kind}><Icon kind={kind} /></span>)}</div>
      <strong>للمضيف ولأصحابه</strong>
      <div className="maydan-sharing-illustration__roles">{[
        { icon: "settings", title: "المضيف", copy: "حساب موثّق وإدارة المباراة", tone: "peach" },
        { icon: "people", title: "الضيف", copy: "رمز الغرفة ثم اسم اللاعب", tone: "lilac" },
        { icon: "screen", title: "شاشة العرض", copy: "اللوحة في متصفح الشاشة", tone: "mint" },
      ].map(role => <div className="maydan-sharing-illustration__role" key={role.title}><span className={`maydan-avatar maydan-avatar--${role.tone}`}><Icon kind={role.icon as "settings" | "people" | "screen"} /></span><div><b>{role.title}</b><small>{role.copy}</small></div><span className="maydan-illustrative-dots">•••</span></div>)}</div>
    </div>
    
  </div>;
}
