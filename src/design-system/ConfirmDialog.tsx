import { useEffect, useId, useRef } from 'react';

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'تراجع', busy = false, testId, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  testId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    cancelRef.current?.focus();

    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open]);

  return <dialog ref={dialogRef} className="correction-dialog app-confirm-dialog" data-testid={testId}
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => {
      event.preventDefault();
      if (!busy) onCancel();
    }}>
    <div className="correction-dialog__surface">
      <header className="correction-dialog__header"><h2 id={`${id}-title`}>{title}</h2></header>
      <p id={`${id}-description`}>{description}</p>
      <div className="app-confirm-dialog__actions">
        <button ref={cancelRef} className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        <button className="button button--primary" type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </dialog>;
}
