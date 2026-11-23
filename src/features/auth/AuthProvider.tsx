import { beginOwnerProvider, currentOwnerProvider, observeProviderOwner, invalidateProviderOwner, endOwnerProvider, type ProviderLease } from '../enta/auth-epoch';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { getOptionalFirebaseAuth } from '../../lib/firebase/client';
import { authErrorMessage, createEmailPasswordAccount, signInOrLinkGoogle, signInWithEmailPassword, signOutFirebaseUser, type AuthActionError } from './auth-service';
import { FirebaseAuthContext, FirebaseAuthRuntimeBoundary, type AuthPendingAction, type FirebaseAuthContextValue, type FirebaseAuthStatus, useFirebaseAuth } from './auth-context';

function userStatus(user: User | null): Exclude<FirebaseAuthStatus, 'loading' | 'unavailable' | 'error'> {
  if (!user) return 'signedOut';
  if (user.isAnonymous) return 'anonymous';
  return user.providerData.some((provider) => provider.providerId === 'password') ? 'password' : 'google';
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FirebaseAuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [pendingAction, setPendingAction] = useState<AuthPendingAction>(null);
  const [error, setError] = useState<AuthActionError | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const authRef = useRef<Auth | null>(null);
  const actionQueue = useRef(Promise.resolve());
  const lifecycle = useRef<ProviderLease | null>(null);

  useEffect(() => {
    let active = true;
    const lease = beginOwnerProvider(); lifecycle.current = lease;
    const current = () => active && lifecycle.current === lease && currentOwnerProvider(lease);
    const close = () => { active = false; if (lifecycle.current === lease) lifecycle.current = null; endOwnerProvider(lease); };
    let auth: Auth | null;
    try {
      auth = getOptionalFirebaseAuth();
    } catch {
      setIsAvailable(false);
      invalidateProviderOwner(lease);
      setStatus('error');
      setError({ code: 'auth/configuration-failed', message: 'تعذر تهيئة تسجيل الدخول حالياً. تحقق من إعداد Firebase العام.' });
      return close;
    }
    authRef.current = auth;
    if (!auth) {
      setIsAvailable(false);
      invalidateProviderOwner(lease);
      setStatus('unavailable');
      return close;
    }
    setIsAvailable(true);
    let restored = false;
    const applyUser = (nextUser: User | null) => {
      if (!current()) return;
      observeProviderOwner(lease, nextUser?.uid ?? null);
      setUser(nextUser);
      setError(null);
      if (restored) setStatus(userStatus(nextUser));
    };
    const unsubscribe = onAuthStateChanged(auth, applyUser, () => {
      if (!current()) return;
      observeProviderOwner(lease, auth.currentUser?.uid ?? null);
      setUser(auth.currentUser);
      invalidateProviderOwner(lease);
      setStatus('error');
      setError({ code: 'auth/observer-failed', message: 'تعذر استعادة حالة تسجيل الدخول. حدّث الصفحة ثم حاول مجدداً.' });
    });
    void auth.authStateReady().then(() => {
      if (!current()) return;
      restored = true;
      applyUser(auth.currentUser);
    }).catch(() => {
      if (!current()) return;
      observeProviderOwner(lease, auth.currentUser?.uid ?? null);
      setUser(auth.currentUser);
      invalidateProviderOwner(lease);
      setStatus('error');
      setError({ code: 'auth/restore-failed', message: 'تعذر استعادة حالة تسجيل الدخول. حدّث الصفحة ثم حاول مجدداً.' });
    });
    return () => { close(); unsubscribe(); };
  }, []);

  const runAction = (pending: Exclude<AuthPendingAction, null>, action: (auth: Auth) => Promise<void>) => {
    // Capture before queue admission. A stale queued action cannot gain the
    // replacement provider's current lease when it eventually starts.
    const lease = lifecycle.current;
    const current = () => lease !== null && lifecycle.current === lease && currentOwnerProvider(lease);
    const run = actionQueue.current.then(async () => {
      if (!current() || lease === null) return;
      const auth = authRef.current;
      if (!auth) { invalidateProviderOwner(lease); setStatus('unavailable'); return; }
      setPendingAction(pending); setError(null);
      try {
        await action(auth);
        if (!current()) return;
        observeProviderOwner(lease, auth.currentUser?.uid ?? null);
        setUser(auth.currentUser); setStatus(userStatus(auth.currentUser));
      } catch (caught) {
        if (!current()) return;
        const nextError = authErrorMessage(caught);
        // Error state denies owner transports until fresh provider observation.
        invalidateProviderOwner(lease);
        setUser(auth.currentUser); setStatus('error'); setError(nextError);
      } finally {
        if (current()) setPendingAction(null);
      }
    });
    actionQueue.current = run.catch(() => undefined);
    return run;
  };

  const value = useMemo<FirebaseAuthContextValue>(() => ({
    status,
    user,
    pendingAction,
    error,
    isAvailable,
    signInWithGoogle: () => runAction('signIn', async (auth) => { await signInOrLinkGoogle(auth); }),
    signInWithEmailPassword: (email, password) => runAction('signIn', async (auth) => { await signInWithEmailPassword(auth, email, password); }),
    createEmailPasswordAccount: (email, password) => runAction('signIn', async (auth) => { await createEmailPasswordAccount(auth, email, password); }),
    signOut: () => runAction('signOut', signOutFirebaseUser),
  }), [status, user, pendingAction, error, isAvailable]);
  return <FirebaseAuthRuntimeBoundary><FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider></FirebaseAuthRuntimeBoundary>;
}

export { useFirebaseAuth };
