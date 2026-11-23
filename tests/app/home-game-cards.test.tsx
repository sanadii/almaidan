import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { FirebaseAuthContext, loadingAuthContext } from '../../src/features/auth/auth-context';
import { HomeSurface } from '../../src/routes/HomeSurface';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true }));
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: { kind: 'local' } }));
afterEach(() => vi.restoreAllMocks());

function showHome(staticPreview = false) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ source: 'local_sqlite_import', huroofAvailable: true, categories: [] })));
  return render(<ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={loadingAuthContext}><HomeSurface joinForm={null} joinMessage={null} staticPreview={staticPreview} /></FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
}

it('keeps local game start routes within the matching cards', async () => {
  showHome();
  await screen.findByText('لا توجد فئات جاهزة للعرض حالياً.');
  expect(within(screen.getByRole('article', { name: 'الخلية' })).getByRole('link', { name: 'ابدأ الخلية' })).toHaveAttribute('href', '/host/new?kind=huroof');
  expect(within(screen.getByRole('article', { name: 'إنت صح' })).getByRole('link', { name: 'ابدأ إنت صح' })).toHaveAttribute('href', '/enta/new');
  expect(within(screen.getByRole('article', { name: 'الدخيل' })).getByRole('link', { name: 'ابدأ الدخيل' })).toHaveAttribute('href', '/host/new?kind=imposter');
});

it('keeps Imposter unavailable in static preview', () => {
  showHome(true);
  const card = screen.getByRole('article', { name: 'الدخيل' });
  expect(within(card).queryByRole('link', { name: 'ابدأ الدخيل' })).not.toBeInTheDocument();
  expect(within(card).getByText('الدخيل — اللعب المستضاف غير مفعّل')).toBeVisible();
});
