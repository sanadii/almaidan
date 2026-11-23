import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { FirebaseAuthProvider } from '../../src/features/auth/AuthProvider';
import { useFirebaseAuth } from '../../src/features/auth/auth-context';
import { invalidateOwner, isOwnerEpoch, ownerEpoch } from '../../src/features/enta/auth-epoch';
import { requestEnta } from '../../src/features/enta/client';

const seam = vi.hoisted(() => ({
  auth: { currentUser: null as any, authStateReady: () => Promise.resolve() },
  observe: null as any, link: vi.fn(), popup: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class GoogleAuthProvider {},
  linkWithPopup: seam.link, signInWithPopup: seam.popup, signOut: seam.signOut,
  onAuthStateChanged: (_auth: unknown, next: unknown) => { seam.observe = next; return () => {}; },
  createUserWithEmailAndPassword: vi.fn(), sendEmailVerification: vi.fn(), signInWithEmailAndPassword: vi.fn(),
}));
vi.mock('../../src/lib/firebase/client', () => ({ getOptionalFirebaseAuth: () => seam.auth }));
let context: ReturnType<typeof useFirebaseAuth>;
function Probe() { context = useFirebaseAuth(); return null; }
beforeEach(() => { invalidateOwner(); seam.link.mockReset(); seam.popup.mockReset(); seam.signOut.mockReset(); });
afterEach(() => { cleanup(); invalidateOwner(); vi.unstubAllGlobals(); });

describe('real auth service, provider and epoch collision composition', () => {
  it.each(['auth/credential-already-in-use', 'auth/account-exists-with-different-credential'])('fences the guest after %s until a fresh observation', async code => {
    const guest = { uid: 'guest-uid', isAnonymous: true, providerData: [], getIdToken: vi.fn(async () => 'inert') };
    seam.auth.currentUser = guest;
    let reject!: (error: unknown) => void;
    seam.link.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<FirebaseAuthProvider><Probe /></FirebaseAuthProvider>);
    await waitFor(() => expect(context.user).toBe(guest));
    const old = ownerEpoch(guest.uid);
    let work!: Promise<void>;
    act(() => { work = context.signInWithGoogle(); });
    await waitFor(() => expect(context.pendingAction).toBe('signIn'));
    const error = { code };
    await act(async () => { reject(error); await work; });
    expect(context.user).toBe(guest); expect(seam.auth.currentUser).toBe(guest);
    expect(context.user?.uid).toBe(guest.uid); expect(context.status).toBe('error');
    expect(context.error?.code).toBe(code); expect(context.error?.message).toContain('بقيت جلستك الضيف كما هي');
    expect(context.pendingAction).toBeNull(); expect(isOwnerEpoch(old)).toBe(false);
    await expect(requestEnta('/catalog', guest, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled(); expect(guest.getIdToken).not.toHaveBeenCalled();
    expect(seam.link).toHaveBeenCalledOnce(); expect(seam.link).toHaveBeenCalledWith(guest, expect.anything());
    expect(seam.popup).not.toHaveBeenCalled(); expect(seam.signOut).not.toHaveBeenCalled();
    act(() => seam.observe(guest));
    const fresh = ownerEpoch(guest.uid);
    expect(isOwnerEpoch(fresh)).toBe(true); expect(isOwnerEpoch(old)).toBe(false);
  });
});

