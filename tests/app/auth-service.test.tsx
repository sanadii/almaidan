import { afterEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  linkWithPopup: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  GoogleAuthProvider: class GoogleAuthProvider {},
  linkWithPopup: firebaseMocks.linkWithPopup,
  signInWithPopup: firebaseMocks.signInWithPopup,
  signOut: firebaseMocks.signOut,
}));

import { authErrorMessage, signInOrLinkGoogle, signOutFirebaseUser } from '../../src/features/auth/auth-service';

const user = (uid: string, isAnonymous: boolean) => ({
  uid,
  isAnonymous,
  providerData: isAnonymous ? [] : [{ providerId: 'google.com' }],
}) as never;

afterEach(() => vi.resetAllMocks());

describe('Google auth service', () => {
  it('uses a popup sign-in only when no Firebase user exists', async () => {
    const signedIn = user('google-user', false);
    firebaseMocks.signInWithPopup.mockResolvedValue({ user: signedIn });
    await expect(signInOrLinkGoogle({ currentUser: null } as never)).resolves.toBe(signedIn);
    expect(firebaseMocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(firebaseMocks.linkWithPopup).not.toHaveBeenCalled();
  });

  it('links an anonymous user and verifies that the UID is retained', async () => {
    const guest = user('guest-uid', true);
    const linked = user('guest-uid', false);
    firebaseMocks.linkWithPopup.mockResolvedValue({ user: linked });
    await expect(signInOrLinkGoogle({ currentUser: guest } as never)).resolves.toBe(linked);
    expect(firebaseMocks.linkWithPopup).toHaveBeenCalledWith(guest, expect.anything());
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it.each(['auth/credential-already-in-use', 'auth/account-exists-with-different-credential'])('preserves the guest on %s', async (code) => {
    const guest = user('guest-uid', true);
    const auth = { currentUser: guest };
    const error = { code };
    firebaseMocks.linkWithPopup.mockRejectedValue(error);
    await expect(signInOrLinkGoogle(auth as never)).rejects.toBe(error);
    expect(auth.currentUser).toBe(guest);
    expect((auth.currentUser as { uid: string }).uid).toBe('guest-uid');
    expect(firebaseMocks.linkWithPopup).toHaveBeenCalledOnce();
    expect(firebaseMocks.linkWithPopup).toHaveBeenCalledWith(guest, expect.anything());
    expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
    expect(authErrorMessage(error).message).toContain('بقيت جلستك الضيف كما هي');
    expect(authErrorMessage({ code: 'auth/popup-blocked' }).message).toContain('حظر المتصفح');
  });

  it('propagates cancellation without replacing the guest', async () => {
    const error = { code: 'auth/popup-closed-by-user' };
    firebaseMocks.linkWithPopup.mockRejectedValue(error);
    await expect(signInOrLinkGoogle({ currentUser: user('guest-uid', true) } as never)).rejects.toBe(error);
    expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('rejects a linked result with a different UID', async () => {
    firebaseMocks.linkWithPopup.mockResolvedValue({ user: user('other', false) });
    await expect(signInOrLinkGoogle({ currentUser: user('guest-uid', true) } as never)).rejects.toMatchObject({ code: 'auth/link-changed-user' });
    expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('leaves other nonanonymous identities unchanged', async () => {
    const passwordUser = { uid: 'password-user', isAnonymous: false, providerData: [{ providerId: 'password' }] };
    await expect(signInOrLinkGoogle({ currentUser: passwordUser } as never)).resolves.toBe(passwordUser);
    expect(firebaseMocks.linkWithPopup).not.toHaveBeenCalled();
    expect(firebaseMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('is idempotent for a Google user and signs out only when requested', async () => {
    const googleUser = user('google-user', false);
    await expect(signInOrLinkGoogle({ currentUser: googleUser } as never)).resolves.toBe(googleUser);
    expect(firebaseMocks.linkWithPopup).not.toHaveBeenCalled();
    await signOutFirebaseUser({} as never);
    expect(firebaseMocks.signOut).toHaveBeenCalledOnce();
  });
});

it.each(['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'])(
  'shows a consistent credential error for %s', (code) => {
    expect(authErrorMessage({ code }).message).toBe('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
  },
);
