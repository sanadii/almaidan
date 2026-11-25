import { useState } from 'react';
import { ConfirmDialog } from '../../design-system/ConfirmDialog';

export function EntaFinish({ hasUnplayed, disabled, onFinish }: {
  hasUnplayed: boolean;
  disabled: boolean;
  onFinish: (confirmEarly: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return <section className="enta-finish">
    <button className="button button--secondary" type="button" disabled={disabled} onClick={() => setOpen(true)}>إنهاء المباراة وعرض النتيجة</button>
    <ConfirmDialog open={open} title="إنهاء المباراة" busy={disabled}
      description={hasUnplayed ? 'باقي أسئلة أو جولات ما لعبتوها. تبون تنهُون المباراة وتشوفون النتيجة؟' : 'بتنتهي المباراة وتظهر النتيجة للجميع.'}
      confirmLabel="إنهاء وعرض النتيجة" cancelLabel="متابعة اللعب" onCancel={() => setOpen(false)} onConfirm={() => {
        setOpen(false);
        onFinish(hasUnplayed);
      }} />
  </section>;
}
