import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { HowToPlayRoute } from '../../src/routes/GameRoutes';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true }));
vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: { kind: 'local' } }));
afterEach(() => vi.unstubAllEnvs());
function showGuide() { return render(<ThemeProvider><MemoryRouter><HowToPlayRoute /></MemoryRouter></ThemeProvider>); }

it('illustrates each game guide and groups its steps in an adaptive grid', () => {
 const { container } = showGuide();
 for (const [section, game] of [['khaliah', 'huroof'], ['enta-sah', 'enta'], ['imposter', 'imposter']]) {
   expect(container.querySelector(`#rules-${section} .game-artwork img`)).toHaveAttribute('src', `/assets/games/${game}-art-v1-360.webp`);
 }
 const enta = container.querySelector('#rules-enta-sah .game-guide__steps--grid');
 expect(enta?.children).toHaveLength(4);
 expect(enta).toHaveTextContent('المضيف يدير المباراة');
 expect(enta).toHaveTextContent('اعرضوا النتيجة');
 expect(readFileSync('src/styles/game-guide.css', 'utf8')).toMatch(/\.game-guide__steps--grid\s*\{[^}]*repeat\(auto-fit/);
});

it('offers the local game actions and explains local guest sessions', () => {
 showGuide();
 expect(screen.getByRole('link', { name: 'اختيار لعبة إنت صح' })).toHaveAttribute('href', '/enta/new');
 expect(screen.getByRole('link', { name: 'ابدأ الدخيل' })).toHaveAttribute('href', '/host/new?kind=imposter');
 expect(within(screen.getByRole('region', { name: 'ابدأوا من هنا' })).getByText(/افتحوا نافذة ثانية لكل لاعب/)).toBeVisible();
});
it('uses decorative current-color icons alongside both team names', () => {
 showGuide();
 for (const name of ['الأحمر', 'الأخضر']) {
  const label = screen.getByText(name, { selector: '.axis-mark' });
  expect(label).toBeVisible();
  expect(label.querySelector('svg')).toHaveAttribute('stroke', 'currentColor');
  expect(label.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
 }
});
it('does not offer Imposter start in static preview', () => {
 vi.stubEnv('VITE_STATIC_PREVIEW', 'true'); showGuide();
 const imposter = screen.getByRole('region', { name: 'كيف تلعب الدخيل؟' });
 expect(within(imposter).queryByRole('link', { name: 'ابدأ الدخيل' })).not.toBeInTheDocument();
 expect(within(imposter).getByText('الدخيل — اللعب المستضاف غير مفعّل')).toBeVisible();
});
