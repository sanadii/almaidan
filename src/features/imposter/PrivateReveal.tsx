import { useEffect, useState, type ReactNode } from 'react';

/** Secrets are mounted only for the duration of a deliberate, focused hold. */
export function PrivateReveal({ children, disabled = false, identity }: { children: ReactNode; disabled?: boolean; identity: string }) {
  const [heldIdentity, setHeldIdentity] = useState<string>();
  const hide = () => setHeldIdentity(undefined);
  useEffect(() => { setHeldIdentity(undefined); }, [disabled, identity]);
  useEffect(() => {
    const conceal = () => setHeldIdentity(undefined);
    window.addEventListener('blur', conceal);
    window.addEventListener('pagehide', conceal);
    window.addEventListener('pointerup', conceal);
    window.addEventListener('pointercancel', conceal);
    document.addEventListener('visibilitychange', conceal);
    return () => {
      window.removeEventListener('blur', conceal);
      window.removeEventListener('pagehide', conceal);
      window.removeEventListener('pointerup', conceal);
      window.removeEventListener('pointercancel', conceal);
      document.removeEventListener('visibilitychange', conceal);
    };
  }, []);
  const visible = !disabled && heldIdentity === identity;
  return <div className="imposter-private">
    <button className="imposter-hold" type="button" disabled={disabled}
      onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture?.(event.pointerId); setHeldIdentity(identity); } }}
      onPointerUp={hide} onPointerCancel={hide} onPointerLeave={hide} onLostPointerCapture={hide} onBlur={hide}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) setHeldIdentity(identity); } if (event.key === 'Escape') hide(); }}
      onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); hide(); } }}
      aria-pressed={visible} aria-describedby="imposter-private-help">اضغط مطولاً لعرض سرك</button>
    <div className="imposter-secret" aria-live="off">{visible ? children : <p>سرك مخفي</p>}</div>
    <p id="imposter-private-help" className="imposter-muted">بعيداً عن العيون! ارفع إصبعك لإخفاء السر. بلوحة المفاتيح: اضغط مطولاً على المسافة أو Enter.</p>
  </div>;
}
