import { useState } from 'react';
import type { User } from 'firebase/auth';

type NoticeState = 'idle' | 'busy' | 'sent' | 'unverified' | 'failed';

/**
 * Hosting needs a verified email. A signed-in but unverified user used to be sent to /login,
 * which immediately returns signed-in users, so they had no way forward. This lets them resend
 * the verification email and pick up a verification made in another tab without signing out.
 */
export function VerifyEmailNotice({ user, className = '' }: { user: User; className?: string }) {
  const [state, setState] = useState<NoticeState>('idle');
  async function recheck() {
    setState('busy');
    try {
      await user.reload();
      if (user.emailVerified) {
        // Refresh the ID token so server checks see the verified claim, then reload the auth state.
        await user.getIdToken(true);
        window.location.reload();
        return;
      }
      setState('unverified');
    } catch {
      setState('failed');
    }
  }
  async function resend() {
    setState('busy');
    try {
      const { sendEmailVerification } = await import('firebase/auth');
      await sendEmailVerification(user);
      setState('sent');
    } catch {
      setState('failed');
    }
  }
  const message = state === 'sent'
    ? 'أرسلنا رابط تأكيد جديداً إلى بريدك.'
    : state === 'unverified'
      ? 'لم يُؤكَّد البريد بعد. افتح الرابط في بريدك ثم حاول مرة أخرى.'
      : state === 'failed'
        ? 'تعذر إتمام الطلب. تحقق من الاتصال ثم أعد المحاولة.'
        : '';
  return (
    <div className={`verify-email-notice ${className}`.trim()} data-testid="verify-email-notice">
      <p>
        الاستضافة تحتاج بريداً مؤكَّداً. افتح رابط التأكيد المرسل إلى <bdi dir="ltr">{user.email}</bdi> ثم اضغط «أكّدت بريدي».
      </p>
      <div className="verify-email-notice__actions">
        <button className="button button--primary" disabled={state === 'busy'} onClick={() => void recheck()} type="button">أكّدت بريدي</button>
        <button className="button button--quiet" disabled={state === 'busy'} onClick={() => void resend()} type="button">أعد إرسال رابط التأكيد</button>
      </div>
      {message ? <p aria-live="polite" role="status">{message}</p> : null}
    </div>
  );
}
