import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { App } from '../../src/app/App';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { InternalHeader } from '../../src/design-system/InternalHeader';
import { FirebaseAuthContext, loadingAuthContext } from '../../src/features/auth/auth-context';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

it('shows the match history menu link only for signed-in accounts', () => {
  function header(user: User | null) {
    return <ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={{ ...loadingAuthContext, user }}>
      <InternalHeader />
    </FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>;
  }
  const view = render(header(null));
  const menu = screen.getByRole('navigation', { name: 'التنقل الرئيسي' });
  expect(within(menu).queryByRole('link', { name: 'مبارياتي' })).toBeNull();
  view.rerender(header({ isAnonymous: true } as User));
  expect(within(menu).queryByRole('link', { name: 'مبارياتي' })).toBeNull();
  view.rerender(header({ isAnonymous: false } as User));
  expect(within(menu).getByRole('link', { name: 'مبارياتي' })).toHaveAttribute('href', '/history');
  const utilities = document.querySelector('.app-header__utilities');
  fireEvent.click(screen.getByRole('button', { name: 'القائمة' }));
  expect(document.querySelector('.app-header__utilities')).toBe(utilities);
  expect(screen.getByRole('button', { name: 'القائمة' })).toHaveAttribute('aria-expanded', 'true');
});

it.each([
  ['/contact', 'تواصل معنا'],
  ['/media-credits', 'اعتمادات الخطوط والصور'],
  ['/study', 'الصفحة غير موجودة'],
])('renders the public footer on %s and does not expose study', async (path, title) => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  window.history.replaceState({}, '', path);
  render(<App />);
  const panel = await screen.findByRole('region', { name: title });
  expect(within(panel).getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', '/');
  expect(panel.querySelector('img')).toHaveAttribute('src', expect.stringContaining('maydan-e-'));
  const footer = screen.getByRole('contentinfo');
  expect(within(footer).getByRole('link', { name: 'تواصل معنا' })).toHaveAttribute('href', '/contact');
  expect(within(footer).queryByRole('link', { name: 'التدريب' })).toBeNull();
});
it('keeps a shared public footer off the Enta display, including its access guidance', async () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  window.history.replaceState({}, '', '/enta/rooms/E1-ABCDEF12/display');
  render(<App />);
  expect(await screen.findByText('افتحوا شاشة العرض من غرفة المضيف، أو انسخوا رابطها من هناك.')).toBeVisible();
  expect(screen.queryByRole('contentinfo')).toBeNull();
});
