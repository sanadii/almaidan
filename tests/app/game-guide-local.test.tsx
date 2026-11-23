import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { HowToPlayRoute } from '../../src/routes/GameRoutes';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true }));
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: { kind: 'local' } }));
afterEach(() => vi.unstubAllEnvs());
function showGuide() { return render(<ThemeProvider><MemoryRouter><HowToPlayRoute /></MemoryRouter></ThemeProvider>); }

it('offers the local game actions and explains local guest sessions', () => {
 showGuide();
 expect(screen.getByRole('link', { name: 'اختيار لعبة إنت صح' })).toHaveAttribute('href', '/enta/new');
 expect(screen.getByRole('link', { name: 'ابدأ الدخيل' })).toHaveAttribute('href', '/host/new?kind=imposter');
 expect(within(screen.getByRole('region', { name: 'ابدأوا من هنا' })).getByText(/جلسات متصفح منفصلة/)).toBeVisible();
});
it('does not offer Imposter start in static preview', () => {
 vi.stubEnv('VITE_STATIC_PREVIEW', 'true'); showGuide();
 const imposter = screen.getByRole('region', { name: 'كيف تلعب الدخيل؟' });
 expect(within(imposter).queryByRole('link', { name: 'ابدأ الدخيل' })).not.toBeInTheDocument();
 expect(within(imposter).getByText('الدخيل — اللعب المستضاف غير مفعّل')).toBeVisible();
});
