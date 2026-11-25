import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { EntryRoute, normalizeRoomCode, validateJoinDisplayName } from '../../src/routes/EntryRoute';
import { NameJoinRoute } from '../../src/routes/NameJoinRoute';

vi.mock('../../src/features/auth/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/auth/auth-context')>();
  return { ...actual, DeferredFirebaseAuthProvider: ({ children }: { children: ReactNode }) => children };
});

function renderJoinJourney(initialEntry = '/', staticPreview = false) {
  vi.stubEnv('VITE_STATIC_PREVIEW', String(staticPreview));
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<EntryRoute staticPreview={staticPreview} />} />
          <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('EntryRoute', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('normalizes a room code to uppercase LTR ASCII before continuing to the room name step', async () => {
    const user = userEvent.setup();
    renderJoinJourney();
    expect(document.title).toBe('الميدان | الخلية وإنت صح والدخيل');
    const input = screen.getByLabelText('رمز الغرفة');
    await user.type(input, 'ab-12c');
    expect(input).toHaveValue('AB12C');
    expect(input).toHaveAttribute('dir', 'ltr');
    await user.click(screen.getByRole('button', { name: 'الدخول' }));
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByText('AB12C')).toBeInTheDocument();
  });

  it('exposes deterministic normalization without accepting non-ASCII input', () => {
    expect(normalizeRoomCode('x!9-بY')).toBe('X9Y');
    expect(validateJoinDisplayName(' نور ')).toBe('نور');
    expect(validateJoinDisplayName('   ')).toBeUndefined();
    expect(validateJoinDisplayName(`نور\u0000`)).toBeUndefined();
  });

  it('marks an empty room code with an Arabic recovery message and clears it when edited', async () => {
    const user = userEvent.setup();
    renderJoinJourney();
    const input = screen.getByLabelText('رمز الغرفة');
    await user.click(screen.getByRole('button', { name: 'الدخول' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('أدخل رمز الغرفة أولاً.');
    await user.type(input, 'ab');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });


  it('requires a player name only after the room-code step', async () => {
    const user = userEvent.setup();
    renderJoinJourney('/room/ab12/join');
    await user.click(screen.getByRole('button', { name: 'دخول الغرفة' }));
    expect(screen.getByLabelText('اسم اللاعب')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('اسم اللاعب')).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('اكتب اسمك (حتى 30 حرفاً).');
  });

  it('sends a QR room query directly to the room-specific name step', async () => {
    renderJoinJourney('/?room=qr-12');
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByText('QR12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'غيّر الرمز' })).toHaveAttribute('href', '/');
  });

  it('keeps the code and direct name-join paths visibly unavailable in an explicit static preview', async () => {
    renderJoinJourney('/?room=qr-12', true);
    expect(screen.getByRole('button', { name: 'الدخول' })).toBeDisabled();
    expect(screen.getByText('هذه معاينة منشورة للواجهة فقط. إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ما اسمك؟' })).not.toBeInTheDocument();

    renderJoinJourney('/room/qr-12/join', true);
    expect(await screen.findByRole('heading', { name: 'ما اسمك؟' })).toBeInTheDocument();
    expect(screen.getByLabelText('اسم اللاعب')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'دخول الغرفة' })).toBeDisabled();
  });

  it('presents both games truthfully and keeps guest joining separate from Huroof hosting', () => {
    render(<ThemeProvider><MemoryRouter><EntryRoute staticPreview={false} /></MemoryRouter></ThemeProvider>);
    expect(Array.from(document.querySelectorAll('[data-home-region]')).map((node) => node.getAttribute('data-home-region'))).toEqual([
      'header',
      'hero',
      'create-join-dock',
      'join-form',
      'game-choice',
      'guide',
      'discovery',
      'category-chooser',
      'gathering',
      'account-note',
      'faq',
      'final-action',
      'footer',
    ]);
    expect(screen.getByRole('heading', { name: 'الخلية' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'إنت صح' })).toBeInTheDocument();
    expect(screen.getByText('إنت صح — قريباً')).toBeInTheDocument();
    const khaliah = screen.getByRole('article', { name: 'الخلية' });
    const enta = screen.getByRole('article', { name: 'إنت صح' });
    const imposter = screen.getByRole('article', { name: 'الدخيل' });
    for (const [card, game] of [[khaliah, 'huroof'], [enta, 'enta'], [imposter, 'imposter']] as const) {
      const art = card.querySelector('picture.game-artwork');
      expect(art?.querySelector('source[type="image/avif"]')).toHaveAttribute('srcset',
        `/assets/games/${game}-art-v1-360.avif 360w, /assets/games/${game}-art-v1-720.avif 720w`);
      expect(art?.querySelector('img')).toHaveAttribute('srcset',
        `/assets/games/${game}-art-v1-360.webp 360w, /assets/games/${game}-art-v1-720.webp 720w`);
      expect(art?.querySelector('img')).toHaveAttribute('loading', 'lazy');
    }
    expect(within(khaliah).getByRole('link', { name: 'ابدأ الخلية' })).toHaveAttribute('href', '/host/new?kind=huroof');
    expect(within(khaliah).getByRole('link', { name: 'طريقة اللعب' })).toHaveAttribute('href', '/how-to-play#rules-khaliah');
    expect(within(enta).getByRole('link', { name: 'طريقة اللعب' })).toHaveAttribute('href', '/how-to-play#rules-enta-sah');
    expect(within(imposter).getByRole('link', { name: 'طريقة اللعب' })).toHaveAttribute('href', '/how-to-play/imposter');
    expect(within(enta).queryByRole('link', { name: /ابدأ إنت صح/ })).not.toBeInTheDocument();
    expect(within(imposter).queryByRole('link', { name: 'ابدأ الدخيل' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'ابدأوا مباراة الخلية' })).not.toContainElement(screen.getByLabelText('رمز الغرفة'));
    expect(document.querySelector('[data-home-region="create-join-dock"]')).toContainElement(screen.getByLabelText('رمز الغرفة'));
    expect(screen.getByRole('region', { name: 'أحلى جمعة تبدأ بلعبة. واللعبة تحلى بأصحابكم. في الميدان.' })).not.toContainElement(screen.getByLabelText('رمز الغرفة'));
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'إنشاء مباراة' })).not.toBeInTheDocument();
    expect(within(document.querySelector('[data-home-region="game-choice"]')!).queryByRole('link', { name: /إنت صح/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('spatial-board-scene')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'أحلى جمعة تبدأ بلعبة. واللعبة تحلى بأصحابكم. في الميدان.' })).toBeInTheDocument();
    expect(screen.getByText(/المضيف يبدأها، والكل يدخل برمز واحد/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'قواعد اللعب', exact: true })).toHaveAttribute('href', '/how-to-play');
    expect(document.querySelectorAll('.maydan-join-form form')).toHaveLength(1);
    expect(document.querySelectorAll('.maydan-faq details')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'ابدأوا مباراة' })).toHaveAttribute('href', '#game-choice-title');
    expect(screen.getByRole('link', { name: 'معك رمز غرفة؟' })).toHaveAttribute('href', '#room-code');
    expect(document.querySelector('.maydan-credit-note')).toHaveTextContent('شراء الرصيد غير متاح حالياً.');
  });

  it('does not invent categories in static preview', () => {
    vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
    render(<ThemeProvider><MemoryRouter><EntryRoute staticPreview /></MemoryRouter></ThemeProvider>);
    expect(screen.getByText('معاينة الواجهة لا تحتوي على فئات لعب منشورة.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox', { name: 'تصفية الفئات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /قيد الإعداد/ })).not.toBeInTheDocument();
  });
});

it('preserves the الدخيل D1 prefix alongside existing M2 and E1 room codes', () => {
  expect(normalizeRoomCode('d1-ab12cd34')).toBe('D1-AB12CD34');
  expect(normalizeRoomCode('m2-ab12cd34')).toBe('M2-AB12CD34');
  expect(normalizeRoomCode('e1-ab12cd34')).toBe('E1-AB12CD34');
});
