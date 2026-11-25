import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';

vi.mock('../../src/features/game/runtime', () => ({
  gameRuntime: { kind: 'local', createRoom: vi.fn() },
}));

import { HostNewRoute, QuestionsRoute, readableError } from '../../src/routes/GameRoutes';

const categoryButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.category-choice'));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ error: 'LOCAL_DB_SOURCE_DISABLED' }), { status: 400 }));
});

it('shows only available categories and excludes unavailable content from browsing', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(document.title).toBe('إنشاء مباراة | الميدان'));
  expect(document.querySelector('header.game-artwork-heading img')).toHaveAttribute('src', '/assets/games/huroof-art-v1-360.webp');
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const category = categoryButtons()[0];
  expect(screen.getAllByRole('img')).toHaveLength(9);
  expect(screen.queryByRole('button', { name: /غير متاحة للعب بعد/ })).not.toBeInTheDocument();
  expect(category).toHaveTextContent('معلومات عامة');
  expect(category).not.toHaveTextContent('جاهزية الأسئلة');
  expect(screen.getByRole('button', { name: 'جغرافيا ودول 3' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'علوم وطبيعة 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'ثقافة وألغاز 2' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'أسلوب حياة 1' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /رياضة/ })).not.toBeInTheDocument();
  await user.click(category);
  expect(category).toHaveAttribute('aria-pressed', 'true');
  expect(category).toHaveClass('is-selected');
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('1 / 10');
});

it('waits for one inventory request in StrictMode without showing fixture choices', async () => {
  const freshInventory = new Response(JSON.stringify({
    source: 'local_firestore_import',
    huroofAvailable: true,
    categories: [
      { id: 'huroof-068', labelAr: 'منتخب الكويت', sourceOnly: true, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
      { id: 'tahadani-015', labelAr: 'أمثال وغطاوي', sourceOnly: false, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
    ],
  }));
  let resolveInventory!: (response: Response) => void;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { resolveInventory = resolve; }));
  render(<StrictMode><ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider></StrictMode>);
  expect(screen.getByTestId('create-room')).toBeDisabled();
  expect(screen.getByTestId('create-room')).toHaveTextContent('جارٍ تحميل الفئات…');
  expect(document.querySelectorAll('.setup-categories__skeleton')).toHaveLength(4);
  expect(categoryButtons()).toHaveLength(0);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/question-inventory')).toHaveLength(1);
  await act(async () => resolveInventory(freshInventory));
  await waitFor(() => expect(screen.getByRole('button', { name: /منتخب الكويت/ })).toBeVisible());
  expect(screen.getByRole('button', { name: 'كل الموضوعات 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /معلومات عامة/ })).not.toBeInTheDocument();
});

it('hides local categories that cannot play the selected board', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    source: 'local_sqlite_import',
    huroofAvailable: true,
    categories: [
      { id: 'tahadani-ready', labelAr: 'فئة جاهزة', sourceOnly: true, questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14, availability: 'ready', categoryGameEligible: true },
      { id: 'tahadani-held', labelAr: 'فئة مؤجلة', sourceOnly: true, questionCount: 0, heldQuestionCount: 6, huroofQuestionCount: 0, availability: 'held_only', categoryGameEligible: false },
    ],
  })));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: 'فئة جاهزة — أضف إلى الاختيار' });
  expect(screen.queryByText('فئة مؤجلة')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'الفئات' }));
  expect(screen.getByRole('button', { name: 'فئة جاهزة — أضف إلى الاختيار' })).toBeEnabled();
  expect(screen.queryByText('فئة مؤجلة')).not.toBeInTheDocument();
});

it('filters local categories per board and prunes a deep-linked Huroof-ineligible selection', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    source: 'local_sqlite_import', huroofAvailable: true,
    categories: [
      { id: 'huroof-ready', labelAr: 'تغطية الحروف', sourceOnly: true, questionCount: 1, heldQuestionCount: 0, huroofQuestionCount: 1, availability: 'ready', categoryGameEligible: true },
      { id: 'categories-only', labelAr: 'فئات فقط', sourceOnly: true, questionCount: 300, heldQuestionCount: 0, huroofQuestionCount: 0, availability: 'ready', categoryGameEligible: true },
    ],
  })));
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?category=categories-only']}><HostNewRoute /></MemoryRouter></ThemeProvider>);

  expect(await screen.findByRole('button', { name: 'تغطية الحروف — أضف إلى الاختيار' })).toBeVisible();
  expect(screen.queryByText('فئات فقط')).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'الفئات المختارة' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('radio', { name: 'الفئات' }));
  expect(screen.getByRole('button', { name: 'فئات فقط — أضف إلى الاختيار' })).toBeVisible();
});

it('does not silently show fixture categories after a DB inventory error and can retry', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'LOCAL_DB_ORIGIN_REQUIRED' }), { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      source: 'local_firestore_import', huroofAvailable: true,
      categories: [{ id: 'huroof-068', labelAr: 'منتخب الكويت', sourceOnly: true, huroofQuestionCount: 14, categoryGameEligible: true }],
    })));
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /معلومات عامة/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
  expect(await screen.findByRole('button', { name: /منتخب الكويت/ })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('disables room creation before transport in an explicit static preview', async () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await waitFor(() => expect(screen.getByText('هذه معاينة منشورة للواجهة فقط. إنشاء الغرف والانضمام وإدارة الأسئلة والبيانات غير متاحة هنا.')).toBeInTheDocument());
  expect(screen.getByTestId('create-room')).toBeDisabled();
  expect(screen.getByTestId('create-room')).toHaveTextContent('إنشاء الغرفة غير متاح في المعاينة');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses all public preview categories across board modes and preserves a deep-linked category beyond the legacy eight', async () => {
  vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
  const fetchMock = vi.spyOn(globalThis, 'fetch');
  const user = userEvent.setup();
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/host/new?kind=categories&category=huroof-100']}>
        <HostNewRoute />
      </MemoryRouter>
    </ThemeProvider>,
  );

  expect(await screen.findByRole('button', { name: /كل الموضوعات \d+/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'جغرافيا العالم — محددة' })).toBeVisible();
  expect(screen.getByText('يعرض هذا الفهرس محتوى معاينة الواجهة فقط، ولا يثبت توفره للعب المنشور.')).toBeVisible();
  await user.click(screen.getByRole('radio', { name: 'الحروف' }));
  expect(screen.getByRole('button', { name: 'جغرافيا العالم — محددة' })).toBeVisible();
  await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'كرة السلة وNBA');
  expect(screen.queryByText('كرة السلة وNBA')).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: 'الفئات' }));
  expect(screen.getByRole('button', { name: 'كرة السلة وNBA — أضف إلى الاختيار' })).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('replaces a missing category cover with the default image', async () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  fireEvent.error(await screen.findByRole('img', { name: 'غلاف فئة معلومات عامة' }));
  expect(screen.getByRole('img', { name: 'صورة افتراضية لفئة معلومات عامة' }))
    .toHaveAttribute('src', '/assets/categories/320/category-006.webp');
});

it('keeps the current available categories in a removable floating tray', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  for (const category of categoryButtons()) await user.click(category);

  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('8 / 10');
  expect(screen.getAllByRole('listitem')).toHaveLength(8);

  await user.click(screen.getByRole('button', { name: 'إزالة معلومات عامة' }));
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('7 / 10');
});

it('keeps keyboard focus in the selection tray after removing a category', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const categories = categoryButtons();
  await user.click(categories[0]);
  await user.click(categories[1]);

  const firstRemoval = screen.getByRole('button', { name: 'إزالة معلومات عامة' });
  const nextRemoval = screen.getByRole('button', { name: 'إزالة عالم الحيوان' });
  firstRemoval.focus();
  await user.keyboard('{Enter}');

  await waitFor(() => expect(nextRemoval).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'إزالة معلومات عامة' })).not.toBeInTheDocument();

  await user.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus());
});

it('filters setup categories by Arabic name without clearing the selected categories', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const firstCategory = categoryButtons()[0];
  await user.click(firstCategory);
  await user.type(screen.getByRole('searchbox', { name: 'تصفية الفئات' }), 'تكنولوجيا');
  expect(screen.getByRole('button', { name: /تكنولوجيا/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /معلومات عامة/, pressed: true })).not.toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox', { name: 'تصفية الفئات' }));
  expect(firstCategory).toHaveAttribute('aria-pressed', 'true');
});

it('intersects browse filters and resets them without clearing the game selection', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const selected = categoryButtons()[0];
  await user.click(selected);

  await user.click(screen.getByRole('button', { name: /جغرافيا ودول/ }));
  expect(screen.queryByLabelText('الفئات المختارة فقط')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'إعادة ضبط التصفية' }));
  expect(screen.getByRole('button', { name: /معلومات عامة/, pressed: true })).toBeVisible();
  expect(screen.getByRole('complementary', { name: 'الفئات المختارة' })).toHaveTextContent('1 / 10');
});

it('requires an explicit category choice before creating a match', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const firstCategory = categoryButtons()[0];

  const categorySection = screen.getByRole('region', { name: 'الفئات' });
  expect(within(categorySection).queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByTestId('create-room'));
  expect(within(categorySection).getByRole('alert')).toHaveTextContent('اختاروا فئة واحدة على الأقل.');
  expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus();

  await user.click(firstCategory);
  expect(within(categorySection).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(categorySection).getByText('1 مختارة')).toBeVisible();
});

it('maps an insufficient selected-question scope to clear Arabic recovery copy', () => {
  expect(readableError(new Error('QUESTION_SCOPE_INSUFFICIENT_COVERAGE'))).toBe(
    'الفئات المختارة لا تكفي لتعبئة اللوح. أضيفوا فئة أو فئتين ثم حاولوا.',
  );
});

it('uses the fixed Arabic match rule and does not expose a best-of selector', async () => {
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  expect(screen.getAllByText('تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً')).toHaveLength(2);
  expect(screen.queryByRole('radiogroup', { name: 'عدد الجولات' })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('الأفضل من');
});

it('uses a roving tab stop and arrow-key navigation for match modes', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  const classic = screen.getByRole('radio', { name: 'كلاسيكية' });
  const fast = screen.getByRole('radio', { name: 'سريعة' });
  const custom = screen.getByRole('radio', { name: 'مخصصة' });
  const additionalSettings = screen.getByText('إعدادات إضافية').closest('details');
  expect(additionalSettings).not.toHaveAttribute('open');
  expect(screen.queryByText('تحدّيات تفاعلية')).not.toBeInTheDocument();
  await user.click(screen.getByText('إعدادات إضافية'));
  expect(screen.getByLabelText('وقت السؤال')).toHaveValue(20);

  expect(classic).toHaveAttribute('tabindex', '0');
  expect(fast).toHaveAttribute('tabindex', '-1');
  classic.focus();
  await user.keyboard('{ArrowLeft}');
  expect(fast).toHaveFocus();
  expect(fast).toHaveAttribute('aria-checked', 'true');
  expect(fast).toHaveAttribute('tabindex', '0');
  expect(screen.getByLabelText('وقت السؤال')).toHaveValue(10);
  expect(screen.getByLabelText('فرصة الخصم')).toHaveValue(10);

  await user.keyboard('{End}');
  expect(custom).toHaveFocus();
  expect(custom).toHaveAttribute('aria-checked', 'true');
});

it('keeps board kind separate from pace and blocks a category board until two categories are selected', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  const huroof = screen.getByRole('radio', { name: 'الحروف' });
  const categories = screen.getByRole('radio', { name: 'الفئات' });
  expect(huroof).toHaveAttribute('aria-checked', 'true');
  expect(huroof).toHaveAttribute('aria-describedby', 'setup-kind-huroof-description');
  expect(screen.getByText('إجابات تبدأ بحرف الخلية')).toBeVisible();
  expect(screen.getByText('أسئلة من الفئات التي تختارها')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'كلاسيكية' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('حروف')).toBeVisible();
  expect(screen.getByText('مجموعات')).toBeVisible();
  for (const kind of ['huroof', 'categories']) {
    const image = document.querySelector(`.setup-kind-selector__image[src="/assets/game-types/${kind}.webp"]`);
    expect(image).toHaveAttribute('width', '192');
    expect(image).toHaveAttribute('height', '192');
    expect(image).toHaveAttribute('decoding', 'async');
  }

  huroof.focus();
  await user.keyboard('{ArrowLeft}');
  expect(categories).toHaveFocus();
  expect(categories).toHaveAttribute('aria-checked', 'true');
  await user.click(screen.getByRole('button', { name: 'معلومات عامة — أضف إلى الاختيار' }));
  await user.click(screen.getByTestId('create-room'));
  expect(screen.getByRole('alert')).toHaveTextContent('الفئات المختارة لا تكفي لتعبئة اللوح.');
  expect(screen.getByRole('searchbox', { name: 'تصفية الفئات' })).toHaveFocus();
});

it('seeds a supported category-board URL and keeps its selected categories', async () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&mode=fast&category=tahadani-006&category=tahadani-007']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'الفئات' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'سريعة' })).toHaveAttribute('aria-checked', 'true');
  expect(await screen.findByRole('button', { name: /معلومات عامة/, pressed: true })).toBeVisible();
  expect(screen.getByRole('button', { name: /عالم الحيوان/, pressed: true })).toBeVisible();
  expect(screen.getByText('معلومات عامة، عالم الحيوان', { selector: 'dd' })).toBeVisible();
});

it('restores valid editable setup settings from a shared URL', async () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?kind=categories&mode=custom&category=tahadani-006&category=tahadani-007&horizontal=فريق%20أ&vertical=فريق%20ب&questionSeconds=35&opponentSeconds=15&demo=0']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByRole('button', { name: /معلومات عامة —/ });
  expect(screen.queryByRole('heading', { name: 'الفريقان' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('اسم الفريق الأحمر ↔ الأحمر')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('اسم الفريق الأخضر ↕ الأخضر')).not.toBeInTheDocument();
  expect(screen.getByLabelText('وقت السؤال')).toHaveValue(35);
  expect(screen.getByLabelText('فرصة الخصم')).toHaveValue(15);
  expect(screen.getByLabelText('وقت السؤال').closest('.timing-fields__control')).toContainElement(screen.getByText('وقت السؤال'));
  expect(screen.getByLabelText('فرصة الخصم').closest('.timing-fields__control')).toContainElement(screen.getByText('فرصة الخصم'));
  expect(screen.getByRole('checkbox', { name: /استخدم مسودات تجريبية/ })).not.toBeChecked();
});

it('seeds only supported mode and category queries once, preserving query order and user edits', async () => {
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=custom&category=tahadani-007&category=tahadani-006&category=tahadani-007']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'مخصصة' })).toHaveAttribute('aria-checked', 'true');
  const first = await screen.findByRole('button', { name: /معلومات عامة/, pressed: true });
  const second = screen.getByRole('button', { name: /عالم الحيوان/, pressed: true });
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('radio', { name: 'سريعة' }));
  await user.click(first);
  expect(screen.getByRole('radio', { name: 'سريعة' })).toHaveAttribute('aria-checked', 'true');
  expect(first).toHaveAttribute('aria-pressed', 'false');
});

it('falls back safely when setup query values are unsupported', async () => {
  render(<ThemeProvider><MemoryRouter initialEntries={['/host/new?mode=unknown&category=missing&category=tahadani-001&category=tahadani-006']}><HostNewRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('radio', { name: 'كلاسيكية' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('setup-query-notice')).toHaveTextContent('تجاهلنا اختيارات غير مدعومة');
  expect(await screen.findByRole('button', { name: /معلومات عامة/, pressed: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /من أنا \/ دول/, pressed: true })).not.toBeInTheDocument();
});

it('filters local inventory by review status, use count, and objections', async () => {
  const user = userEvent.setup();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([
    { id: 'used-objection', targetLetter: 'أ', headerAr: 'سؤال مع اعتراض', status: 'draft', useCount: 2, objectionCount: 1 },
    { id: 'unused', targetLetter: 'ب', headerAr: 'سؤال هادئ', status: 'approved', useCount: 0, objectionCount: 0 },
  ]), { status: 200 }));
  render(<ThemeProvider><MemoryRouter initialEntries={['/questions']}><QuestionsRoute /></MemoryRouter></ThemeProvider>);
  await screen.findByText('سؤال مع اعتراض');
  expect(screen.getByRole('link', { name: 'مسودة جديدة' }).closest('.admin-page__header')).not.toBeNull();
  expect(screen.getByText('سؤال مع اعتراض').closest('.table-row')).toHaveTextContent('مسودة');
  expect(screen.queryByText('draft')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('حالة المراجعة'), 'draft');
  await user.selectOptions(screen.getByLabelText('عدد الاستخدام'), 'used');
  await user.selectOptions(screen.getByLabelText('الاعتراضات'), 'has');
  expect(screen.getByText('سؤال مع اعتراض')).toBeVisible();
  expect(screen.queryByText('سؤال هادئ')).not.toBeInTheDocument();
});

it('loads an existing read-only question and makes a review error visible', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const question = { id: 'approved-1', targetLetter: 'ت', headerAr: 'عنوان السؤال', promptAr: 'نص السؤال المحفوظ', canonicalAnswer: 'الإجابة', acceptedAnswers: ['بديل'], status: 'approved', categoryId: 'language', difficulty: 'سهل', sourceUrl: 'https://example.test/source', reviewError: 'يلزم توثيق المصدر' };
    return new Response(JSON.stringify(url.endsWith('/approved-1') ? question : [question]), { status: 200 });
  });
  render(<ThemeProvider><MemoryRouter initialEntries={['/questions/approved-1']}><Routes><Route path="/questions/:questionId" element={<QuestionsRoute />} /></Routes></MemoryRouter></ThemeProvider>);
  await screen.findByTestId('read-only-question');
  expect(screen.getByTestId('review-error')).toHaveTextContent('يلزم توثيق المصدر');
  await waitFor(() => expect(screen.getByLabelText('السؤال')).toHaveValue('نص السؤال المحفوظ'));
  expect(screen.getByLabelText('السؤال')).toBeDisabled();
});
