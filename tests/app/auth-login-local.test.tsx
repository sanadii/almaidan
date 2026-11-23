import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { FirebaseAuthContext, loadingAuthContext } from '../../src/features/auth/auth-context';
import { LoginRoute } from '../../src/routes/AuthRoutes';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true }));

it('presents the local email form and submits with standard autocomplete', async () => {
 const signIn = vi.fn().mockResolvedValue(undefined);
 render(<ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: 'signedOut', isAvailable: true, signInWithEmailPassword: signIn }}><LoginRoute /></FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
 expect(screen.queryByText('أو بالبريد الإلكتروني')).not.toBeInTheDocument();
 expect(screen.queryByRole('button', { name: 'المتابعة مع Google' })).not.toBeInTheDocument();
 const email = screen.getByLabelText('البريد الإلكتروني');
 const password = screen.getByLabelText('كلمة المرور');
 expect(email).toHaveAttribute('autocomplete', 'email');
 expect(password).toHaveAttribute('autocomplete', 'current-password');
 await userEvent.type(email, 'player@example.test');
 await userEvent.type(password, 'secret1');
 await userEvent.click(screen.getByRole('button', { name: 'تسجيل الدخول بالبريد' }));
 expect(signIn).toHaveBeenCalledWith('player@example.test', 'secret1');
});

it('shows pending sign-in and keeps it disabled', () => {
 render(<ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: 'signedOut', isAvailable: true, pendingAction: 'signIn' }}><LoginRoute /></FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
 expect(screen.getByRole('button', { name: 'جارٍ تسجيل الدخول…' })).toBeDisabled();
});

it('returns a signed-in user to the requested local route', () => {
 const user = { uid: 'fixture', isAnonymous: false, emailVerified: true, providerData: [{ providerId: 'password' }] } as never;
 render(<ThemeProvider><MemoryRouter initialEntries={['/login?returnTo=%2Fhost%2Fnew']}><FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: 'password', isAvailable: true, user }}><Routes><Route path="/login" element={<LoginRoute />} /><Route path="/host/new" element={<h1>إعداد الاختبار</h1>} /></Routes></FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
 expect(screen.getByRole('heading', { name: 'إعداد الاختبار' })).toBeVisible();
});
