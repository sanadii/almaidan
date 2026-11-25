import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { loadingAuthContext } from '../../src/features/auth/auth-context';
import { EntaCompetitionNewRoute } from '../../src/features/enta/CompetitionSetup';
import { EntaDrawingNewRoute, EntaRoundNewRoute } from '../../src/features/enta/RoundRoutes';
import { advancedSetupPlayers, restoredAdvancedPlayers } from '../../src/features/enta/SetupControls';
import { createImposterRoom } from '../../src/features/imposter/runtime';
import { ImposterNewRoute } from '../../src/features/imposter/ImposterRoutes';
import { LoginRoute } from '../../src/routes/AuthRoutes';
import { EntaKidsRoute, EntaNewRoute } from '../../src/routes/EntaRoutes';
import { ObservedFirebaseAuthProvider } from './fixtures/observed-firebase-auth';

vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true, isAlmaidanRealContent: false, localContentNote: 'تدريب محلي' }));
vi.mock('../../src/features/imposter/runtime', async original => ({
  ...await original<typeof import('../../src/features/imposter/runtime')>(),
  imposterRuntimeKind: () => 'local',
  createImposterRoom: vi.fn(),
}));

const host = { uid: 'phase-four-host', emailVerified: true, isAnonymous: false, getIdToken: async () => 'test-host' } as User;
const categories = Array.from({ length: 6 }, (_, index) => ({ key: `cat-${index}`, label: `علوم ${index + 1}` }));
const catalog = { mode: 'CLASSIC', categoryCount: 6, categories, availableCredit: '1' };
const mockFetch = vi.fn();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="path">{pathname}{search}{hash}</output>;
}

function surface(initial: string, user: User | null) {
  return <ThemeProvider><ObservedFirebaseAuthProvider value={{ ...loadingAuthContext, user, status: user ? 'password' : 'signedOut', isAvailable: true }}><MemoryRouter initialEntries={[initial]}>
    <LocationProbe />
    <Routes>
      <Route path="/" element={<h1>الرئيسية التجريبية</h1>} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/host/new" element={<ImposterNewRoute />} />
      <Route path="/room/:roomCode/imposter" element={<h1>وصلوا للغرفة</h1>} />
      <Route path="/enta/new" element={<EntaNewRoute />} />
      <Route path="/enta/new/kids" element={<EntaKidsRoute />} />
      <Route path="/enta/new/drawing" element={<EntaDrawingNewRoute />} />
      <Route path="/enta/new/mixed" element={<EntaRoundNewRoute format="MIXED_BOARD" />} />
      <Route path="/enta/new/list" element={<EntaRoundNewRoute format="STANDALONE_LIST" />} />
      <Route path="/enta/new/acting" element={<EntaRoundNewRoute format="STANDALONE_ACTING" />} />
      <Route path="/enta/competitive/new/classic" element={<EntaCompetitionNewRoute format="TIER_BOARD" />} />
      <Route path="/enta/competitive/new/mixed" element={<EntaCompetitionNewRoute format="MIXED_BOARD" />} />
      <Route path="/enta/competitive/new/list" element={<EntaCompetitionNewRoute format="STANDALONE_LIST" />} />
      <Route path="/enta/competitive/new/acting" element={<EntaCompetitionNewRoute format="STANDALONE_ACTING" />} />
    </Routes>
  </MemoryRouter></ObservedFirebaseAuthProvider></ThemeProvider>;
}

beforeEach(() => {
  mockFetch.mockReset().mockImplementation((path: string) => Promise.resolve(json(path.includes('/setup-catalogue/') ? { categories } : catalog)));
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); sessionStorage.clear(); });

it('sends a signed-in direct login to the home page', async () => {
  render(surface('/login', host));
  expect(await screen.findByRole('heading', { name: 'الرئيسية التجريبية' })).toBeVisible();
});

it('reserves engine seats for an empty advanced roster and restores it as an empty field', () => {
  expect(advancedSetupPlayers('')).toHaveLength(8);
  expect(new Set(advancedSetupPlayers('')).size).toBe(8);
  expect(restoredAdvancedPlayers(advancedSetupPlayers(''))).toBe('');
  expect(restoredAdvancedPlayers(advancedSetupPlayers('مريم\nناصر'))).toBe('مريم\nناصر');
});

it('lets guests choose real Enta categories and restores the draft through the named login return', async () => {
  const route = '/enta/new#enta-classic-setup';
  const view = render(surface(route, null));
  const category = await screen.findByRole('button', { name: 'علوم 1' });
  const anonymousRequest = mockFetch.mock.calls.find(([path]) => path.endsWith('/setup-catalogue/classic'));
  expect(anonymousRequest?.[1]).toMatchObject({ credentials: 'omit' });
  expect(anonymousRequest?.[1]).not.toHaveProperty('headers.authorization');
  fireEvent.click(category);
  for (const row of categories.slice(1)) fireEvent.click(screen.getByRole('button', { name: row.label }));
  fireEvent.change(screen.getByLabelText('اسم الفريق 1'), { target: { value: 'فريق البيت' } });
  fireEvent.change(screen.getByLabelText('الوقت بالثواني'), { target: { value: '45' } });
  fireEvent.click(screen.getByRole('button', { name: 'سجّلوا الدخول للبدء' }));
  expect(await screen.findByText('سجّل دخولك لتكمل إنشاء مباراة إنت صح — اختياراتك محفوظة.')).toBeVisible();
  expect(screen.getByTestId('path')).toHaveTextContent(`/login?returnTo=${encodeURIComponent(route)}`);
  expect(mockFetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  view.rerender(surface(route, host));
  expect(await screen.findByRole('button', { name: 'علوم 1', pressed: true })).toBeVisible();
  expect(screen.getByLabelText('اسم الفريق 1')).toHaveValue('فريق البيت');
  expect(screen.getByLabelText('الوقت بالثواني')).toHaveValue(45);
  expect(screen.getAllByLabelText('أسماء اللاعبين (اختياري)').every(input => (input as HTMLTextAreaElement).value === '')).toBe(true);
  mockFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith('/matches/classic') ? json({ error: 'INVALID_SETUP' }, 400) : json(catalog)));
  fireEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' }));
  await waitFor(() => expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
  const [, start] = mockFetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(start.body).setup.teams.map((team: { players: string[] }) => team.players)).toEqual([[], []]);
});

it('shows specific setup errors and focuses categories, name fields and time before any start', async () => {
  render(surface('/enta/new', host));
  const category = await screen.findByRole('button', { name: 'علوم 1' });
  const start = screen.getByRole('button', { name: 'ابدأوا إنت صح' });
  const check = (input: HTMLElement, copy: string) => {
    fireEvent.click(start);
    expect(screen.getByRole('alert')).toHaveTextContent(copy);
    expect(input).toHaveFocus();
  };
  check(screen.getByRole('searchbox', { name: 'البحث في الفئات' }), 'اختاروا ست فئات مختلفة.');
  fireEvent.click(category);
  for (const row of categories.slice(1)) fireEvent.click(screen.getByRole('button', { name: row.label }));
  const team = screen.getByLabelText('اسم الفريق 2');
  fireEvent.change(team, { target: { value: 'الفريق الأول' } });
  check(team, 'خلّوا لكل فريق اسم مختلف.');
  fireEvent.change(team, { target: { value: 'X' } });
  check(team, 'اكتبوا اسم الفريق من 2 إلى 22 حرفاً');
  fireEvent.change(team, { target: { value: 'الفريق الثاني' } });
  const players = screen.getAllByLabelText('أسماء اللاعبين (اختياري)')[0];
  fireEvent.change(players, { target: { value: 'س'.repeat(31) } });
  check(players, 'اكتبوا اسم كل لاعب حتى 30 حرفاً');
  fireEvent.change(players, { target: { value: Array.from({ length: 9 }, (_, index) => `لاعب ${index}`).join('\n') } });
  check(players, 'اكتبوا 8 أسماء لاعبين أو أقل لكل فريق.');
  fireEvent.change(players, { target: { value: '' } });
  const seconds = screen.getByLabelText('الوقت بالثواني');
  fireEvent.change(seconds, { target: { value: '4' } });
  check(seconds, 'اختاروا وقتاً من 5 إلى 120 ثانية كاملة.');
  expect(mockFetch.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
});

it('keeps available cards visible when the admin disabled enough categories that setup cannot start', async () => {
  mockFetch.mockImplementation(() => Promise.resolve(json({ ...catalog, categories: categories.slice(0, 5) })));
  render(surface('/enta/new', host));
  expect(await screen.findByRole('button', { name: 'علوم 1' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'علوم 6' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ابدأوا إنت صح' }));
  expect(screen.getByRole('alert')).toHaveTextContent('الفئات المتاحة ما تكفي لهالمباراة حالياً.');
  expect(screen.getByRole('searchbox', { name: 'البحث في الفئات' })).toHaveFocus();
});

it.each([
  ['/enta/new/kids', 'kids'], ['/enta/new/drawing', 'drawing'], ['/enta/new/mixed', 'roundMixed'],
  ['/enta/new/list', 'roundList'], ['/enta/new/acting', 'roundActing'], ['/enta/competitive/new/classic', 'competitiveTier'],
  ['/enta/competitive/new/mixed', 'competitiveMixed'], ['/enta/competitive/new/list', 'competitiveList'], ['/enta/competitive/new/acting', 'competitiveActing'],
])('orders the steps and uses the shared bounded picker on %s', async (path, mode) => {
  const { container } = render(surface(path, null));
  await screen.findByRole('button', { name: 'علوم 1' });
  expect(mockFetch).toHaveBeenCalledWith(`/api/v1/enta/setup-catalogue/${mode}`, expect.anything());
  expect([...container.querySelectorAll('.enta-step')].map(step => step.textContent)).toEqual(['1', '2', '3']);
  expect(screen.getByLabelText('الفئات المتاحة')).toHaveClass('enta-picker__results');
  expect(container.querySelector('.enta-setup')?.lastElementChild).toHaveClass('enta-setup-summary');
});

it('keeps the Imposter name and category selection through sign-in and uses it on creation', async () => {
  const route = '/host/new?kind=imposter';
  const view = render(surface(route, null));
  expect(screen.getByRole('checkbox', { name: 'الفواكه' })).toBeChecked();
  for (const checkbox of screen.getAllByRole('checkbox')) if (checkbox !== screen.getByRole('checkbox', { name: 'الفواكه' })) fireEvent.click(checkbox);
  fireEvent.change(screen.getByLabelText('اسمك في الغرفة'), { target: { value: 'مريم' } });
  fireEvent.click(screen.getByRole('button', { name: 'سجّل الدخول لإنشاء الغرفة' }));
  expect(await screen.findByText('سجّل دخولك لتكمل إنشاء مباراة الدخيل — اختياراتك محفوظة.')).toBeVisible();
  expect(createImposterRoom).not.toHaveBeenCalled();
  view.rerender(surface(route, host));
  expect(await screen.findByLabelText('اسمك في الغرفة')).toHaveValue('مريم');
  expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(1);
  vi.mocked(createImposterRoom).mockResolvedValue({ roomCode: 'D1-12345678' } as Awaited<ReturnType<typeof createImposterRoom>>);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'أنشئ الغرفة' })));
  expect(await screen.findByRole('heading', { name: 'وصلوا للغرفة' })).toBeVisible();
  expect(createImposterRoom).toHaveBeenCalledWith('مريم', ['الفواكه']);
});
