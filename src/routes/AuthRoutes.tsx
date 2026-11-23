import { isAlmaidanLocalDevelopment } from '../lib/local-development';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '../design-system/BrandMark';
import { InternalHeader } from '../design-system/InternalHeader';
import {FavoritesPanel} from '../features/favorites/FavoritesPanel';
import { useFirebaseAuth } from '../features/auth/AuthProvider';

function useDocumentTitle(title: string) {
  useEffect(() => { document.title = `${title} | الميدان`; }, [title]);
}

function AuthShell({ children, login = false }: { children: ReactNode; login?: boolean }) {
  return <main data-page-layout="wide" data-page-kind={login ? "auth" : "account"} className={`auth-page maydan-app${login ? ' auth-page--login' : ''}`} id="main-content"><InternalHeader /><section className="auth-panel page-rail" aria-label="الحساب"><div className="page-readable">{children}</div></section><footer className="auth-page__footer"><BrandMark /><span>الخلية · إنت صح · الدخيل</span></footer></main>;
}

function statusCopy(status: ReturnType<typeof useFirebaseAuth>['status']) {
  return ({
    loading: 'جارٍ استعادة حالة تسجيل الدخول…',
    unavailable: 'تسجيل الدخول غير متاح في هذه النسخة حالياً.',
    signedOut: isAlmaidanLocalDevelopment ? 'ادخل بالبريد المحلي للاستضافة، أو انضم كضيف برمز الغرفة.' : 'يمكنك المتابعة كضيف أو تسجيل الدخول عبر Google أو البريد الإلكتروني.',
    anonymous: 'أنت تلعب كضيف. ربط Google يحافظ على جلسة الغرفة الحالية؛ تسجيل الدخول بالبريد يبدّلها.',
    google: 'تم تسجيل الدخول عبر Google.',
    password: 'تم تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.',
    error: 'تحتاج محاولة تسجيل الدخول إلى انتباهك.',
  })[status];
}

export function LoginRoute() {
  useDocumentTitle('تسجيل الدخول');
  const location = useLocation();
  const requestedReturn = new URLSearchParams(location.search).get('returnTo');
  const returnTo = requestedReturn?.startsWith('/') && !requestedReturn.startsWith('//') && !requestedReturn.includes('\\') && !requestedReturn.startsWith('/login') ? requestedReturn : null;
  const { status, user, pendingAction, error, isAvailable, signInWithGoogle, signInWithEmailPassword, createEmailPasswordAccount } = useFirebaseAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isSignedIn = Boolean(user && !user.isAnonymous);
  const disabled = !isAvailable || pendingAction !== null || status === 'loading';
  const submit = (action: 'signIn' | 'create') => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (action === 'signIn') void signInWithEmailPassword(email, password);
    else void createEmailPasswordAccount(email, password);
  };
  if (isSignedIn && returnTo) return <Navigate replace to={returnTo}/>;
  return <AuthShell login>
    <p className="eyebrow">أهلاً بك في الميدان</p>
    <h1>{isSignedIn ? 'حسابك جاهز' : 'سجّل دخولك'}</h1>
    <p>استضافة المباراة تتطلب حساباً موثقاً. ويمكن للضيوف الانضمام إلى الغرف.</p>
    <p className="auth-status" data-state={error ? 'error' : status} aria-live="polite">{error?.message ?? statusCopy(status)}</p>
    {isSignedIn ? <Link className="button button--primary" to="/account">إدارة الحساب</Link> : <>
      {!isAlmaidanLocalDevelopment ? <button className="button button--primary auth-google-button" disabled={disabled} onClick={() => void signInWithGoogle()}>{pendingAction === 'signIn' ? 'جارٍ تسجيل الدخول…' : 'المتابعة مع Google'}</button> : null}
      {!isAlmaidanLocalDevelopment ? <div className="auth-divider"><span>أو بالبريد الإلكتروني</span></div> : null}
      <form className="auth-email-form" onSubmit={submit('signIn')}>
        <label>البريد الإلكتروني<input autoComplete="email" dir="ltr" disabled={disabled} name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
        <label>كلمة المرور<input autoComplete="current-password" dir="ltr" disabled={disabled} minLength={6} name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
        <button className={`button ${isAlmaidanLocalDevelopment ? 'button--primary' : 'button--secondary'}`} disabled={disabled} type="submit">{pendingAction === 'signIn' ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول بالبريد'}</button>
        {!isAlmaidanLocalDevelopment ? <button className="text-link auth-email-form__create" disabled={disabled} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) void createEmailPasswordAccount(email, password); }} type="button">إنشاء حساب جديد وإرسال رسالة التحقق</button> : null}
      </form>
    </>}
    <Link className="text-link" to="/">العب كضيف أو عُد للرئيسية</Link>
  </AuthShell>;
}

export function AccountRoute() {
  useDocumentTitle('الحساب');
  const { status, user, pendingAction, error, signOut } = useFirebaseAuth();
  if (status === 'loading') return <AuthShell><p className="eyebrow">حسابك في الميدان</p><h1>لحظة واحدة</h1><p className="auth-status" data-state="loading" role="status">جارٍ استعادة الحساب…</p></AuthShell>;
  if (!user) return <Navigate replace to="/login" />;
  return <AuthShell>
    <nav className="account-nav" aria-label="أقسام الحساب">
      <a href="#account-identity">بيانات الحساب</a><a href="#account-favorites">المفضلة</a><a href="#account-session">الجلسة</a><Link to={isAlmaidanLocalDevelopment?'/history':'/enta/history'}>مبارياتي</Link>
    </nav>
    <section className="account-section" id="account-identity" aria-labelledby="account-identity-title">
    <p className="eyebrow">حسابك في الميدان</p>
    <h1 id="account-identity-title">{user?.displayName || (status === 'anonymous' ? 'جلسة ضيف' : 'الحساب')}</h1>
    <dl className="account-details">
      <div><dt>طريقة الدخول</dt><dd>{user?.isAnonymous ? 'ضيف' : status === 'password' ? 'البريد الإلكتروني وكلمة المرور' : 'Google'}</dd></div>
      {user?.email ? <div><dt>البريد الإلكتروني</dt><dd dir="ltr">{user.email}</dd></div> : null}
      <div><dt>الحالة</dt><dd>{error?.message ?? statusCopy(status)}</dd></div>
    </dl>
    {!user.isAnonymous ? <p className="auth-status" data-state={user.emailVerified ? 'verified' : 'unverified'}>{user.emailVerified ? 'حسابك موثّق.' : 'استضافة المباراة تتطلب حساباً موثقاً.'}</p> : null}
    </section>
    <section className="account-section" id="account-favorites" aria-label="المفضلة"><FavoritesPanel /></section>
    <section className="account-section" id="account-session" aria-labelledby="account-session-title"><h2 id="account-session-title">الجلسة</h2>
    <p className="auth-impact">تسجيل الخروج لا يحذف الغرف. ستنتهي جلستك على هذا الجهاز، وقد تحتاج إلى تسجيل الدخول مجدداً للعودة إلى الغرفة النشطة.</p>
    <button className="button button--secondary" disabled={pendingAction !== null} onClick={() => void signOut()}>{pendingAction === 'signOut' ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button>
    </section>
    <Link className="text-link" to="/">العودة للرئيسية</Link>
  </AuthShell>;
}
