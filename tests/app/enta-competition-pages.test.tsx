import { ObservedFirebaseAuthProvider } from './fixtures/observed-firebase-auth';
import { randomUUID, webcrypto } from 'node:crypto';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCompetitionPage } from '../../src/features/enta/use-competition-page';
import { parseAttemptRow, parseCorrectionRow } from '../../src/features/enta/competition-page-client';
import { CompetitionPageControls } from '../../src/features/enta/CompetitionPageControls';
import { CompetitionCapabilityPage } from '../../src/features/enta/CompetitionCapability';
import { CompetitionSetupForm } from '../../src/features/enta/CompetitionSetup';
import { MemoryRouter } from 'react-router-dom';
import { FirebaseAuthContext, loadingAuthContext } from '../../src/features/auth/auth-context';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/features/enta/competition-client', async original => ({ ...await original<typeof import('../../src/features/enta/competition-client')>(), competitionRequest: mocks.request }));
const user = { uid: 'host', getIdToken: async () => 'identity' } as User;
const attempts = Array.from({ length: 512 }, () => ({ id: randomUUID(), roundId: 'round', itemId: 'item', phase: 'SHARED', phaseOrdinal: 1, teamId: 'team', playerId: 'player', acceptedAt: 1000, classification: null }));
const input = { user, gameId: 'game', version: 10, collection: 'pending' as const, roundId: 'round', effectId: null, enabled: true, parseRow: parseAttemptRow, assemble: (row: ReturnType<typeof parseAttemptRow>) => ({ id: row.id, correct: false }) };
function page(offset: number, options: { correction?: boolean; changed?: boolean } = {}) {
  const collection = options.correction ? 'correction' : 'pending', rows = attempts.slice(offset, offset + 64).map(a => options.correction ? { ...a, classification: true, effectId: 'effect', effectHash: (options.changed ? 'b' : 'a').repeat(64), rulingVersion: 2, reversed: false, effectKind: 'CORRECTION' } : a);
  return { scope: { gameId: 'game', collection, roundId: options.correction ? null : 'round', effectId: options.correction ? 'effect' : null, purpose: 'OWNER' }, revision: 10, snapshot: 'a'.repeat(64), total: 512, returned: rows.length, offset, nextCursor: offset + 64 < 512 ? `page_${offset + 64}.signature` : null, complete: offset + 64 === 512, rows };
}
const offsetOf = (body: { cursor: string | null }) => body.cursor ? Number(body.cursor.match(/page_(\d+)/)![1]) : 0;
beforeEach(() => { mocks.request.mockReset(); vi.stubGlobal('crypto', webcrypto); vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); });
it('assembles every ordered verdict across eight pages while retaining one visible page', async () => {
  mocks.request.mockImplementation(async (_path, _authority, _signal, body) => page(offsetOf(body)));
  const hook = renderHook(() => useCompetitionPage(input)); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(hook.result.current.verdicts.map(v => v.id)).toEqual(attempts.map(a => a.id)); expect(hook.result.current.page?.rows).toHaveLength(64); expect(hook.result.current.pages).toBe(8); expect(mocks.request).toHaveBeenCalledTimes(8);
  act(() => hook.result.current.loadPage(7)); await waitFor(() => expect(hook.result.current.page?.offset).toBe(448)); expect(hook.result.current.verdicts).toHaveLength(512);
});
it('a failed middle page leaves no partial verdict authority or private page', async () => {
  mocks.request.mockImplementation(async (_path, _authority, _signal, body) => { const offset = offsetOf(body); if (offset === 320) throw new Error('lost page'); return page(offset); });
  const hook = renderHook(() => useCompetitionPage(input)); await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  expect(hook.result.current.ready).toBe(false); expect(hook.result.current.verdicts).toEqual([]); expect(hook.result.current.page).toBeNull();
});
it('cross-page duplicate or changed selected-effect proof cannot authorize a correction', async () => {
  mocks.request.mockImplementation(async (_path, _authority, _signal, body) => page(offsetOf(body), { correction: true, changed: offsetOf(body) === 64 }));
  const hook = renderHook(() => useCompetitionPage({ ...input, collection: 'correction', roundId: null, effectId: 'effect', parseRow: parseCorrectionRow, assemble: row => ({ id: row.id, correct: row.classification === true }) }));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy()); expect(hook.result.current.verdicts).toEqual([]); expect(hook.result.current.page).toBeNull(); expect(hook.result.current.ready).toBe(false);
});
it('principal change aborts and fences a delayed old page', async () => {
  let delayed!: (value: unknown) => void; mocks.request.mockImplementationOnce(() => new Promise(done => { delayed = done; })).mockImplementation(async (_path, _authority, _signal, body) => page(offsetOf(body)));
  const hook = renderHook(({ principal }) => useCompetitionPage({ ...input, user: principal }), { initialProps: { principal: user } }); await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1)); const signal = mocks.request.mock.calls[0][2] as AbortSignal;
  hook.rerender({ principal: { ...user, uid: 'other' } as User }); expect(signal.aborted).toBe(true); await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => delayed({ ...page(0), rows: [] })); expect(hook.result.current.error).toBeNull(); expect(hook.result.current.verdicts).toHaveLength(512);
});
it('private epoch invalidation immediately removes pages and aborts late work', async () => {
  let delayed!: (value: unknown) => void; mocks.request.mockImplementation(() => new Promise(done => { delayed = done; }));
  const hook = renderHook(({ enabled, privateEpoch }) => useCompetitionPage({ ...input, enabled, privateEpoch }), { initialProps: { enabled: true, privateEpoch: 1 } }); await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
  const signal = mocks.request.mock.calls[0][2] as AbortSignal; hook.rerender({ enabled: false, privateEpoch: 2 }); expect(signal.aborted).toBe(true); expect(hook.result.current.page).toBeNull();
  await act(async () => delayed(page(0))); expect(hook.result.current.page).toBeNull(); expect(hook.result.current.verdicts).toEqual([]);
});
it('a short last page marks its actual page index', () => {
  render(<CompetitionPageControls label="المحاولات" state={{ page: { total: 130, offset: 128, returned: 2, nextCursor: null }, ready: true, loading: false, error: null, pages: 3, loadPage: vi.fn(), next: vi.fn(), retry: vi.fn() }} />);
  expect(screen.getByRole('button', { name: 'صفحة 3' })).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByRole('button', { name: 'صفحة 2' })).toHaveAttribute('aria-pressed', 'false');
});
it('judge guide pages replace private rows and a denied next page purges the capability', async () => {
  const now = Date.now(), view = { gameId: 'game', gameVersion: 10, serverNow: now, roundId: 'round', roundVersion: 1, assignmentGeneration: null, role: 'JUDGE', format: 'LIST_ITEMS', grant: { id: 'grant', scopeId: 'scope', roundId: 'round', role: 'JUDGE', generation: 1, expiresAt: now + 600000, revoked: false }, deadline: now + 60000, media: [], mediaTotal: 0, grading: { roundId: 'round', version: 1, format: 'LIST_ITEMS', total: 17, items: [] } };
  const guide = { scope: { gameId: 'game', collection: 'grading', roundId: 'round', effectId: null, purpose: 'JUDGE' }, revision: 10, snapshot: 'a'.repeat(64), total: 17, returned: 16, offset: 0, nextCursor: 'page_16.signature', complete: false, rows: Array.from({ length: 16 }, (_, n) => ({ id: `item_${n}`, ordinal: n, consumed: false, revealed: true, text: `إجابة سرية ${n}`, value: 1, trap: false, mediaIds: [] })) };
  mocks.request.mockImplementation(async (path, authority, _signal, body) => { expect(authority.user).toBeUndefined(); expect(authority.token).toBe('j'.repeat(43)); if (path === '/capability/view') return view; if (body.cursor) throw new (await import('../../src/features/enta/client')).EntaClientError('GRANT_DENIED', 403); return guide; });
  window.history.replaceState(null, '', '/enta/competitive/capability#grant=' + 'j'.repeat(43)); render(<CompetitionCapabilityPage />); await screen.findByText('إجابة سرية 0'); expect(location.hash).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'التالي' })); await screen.findByRole('heading', { name: 'امسح رمز الجولة من جديد' }); expect(screen.queryByText('إجابة سرية 0')).not.toBeInTheDocument(); expect(sessionStorage.length).toBe(0);
});
it('catalog category and prompt pages retain only selected keys and refs across pages', async () => {
  const palette = [{ key: 'CORAL', label: 'مرجاني', color: '#ff7a4d' }, { key: 'SKY', label: 'سماوي', color: '#3fc6ff' }, { key: 'VIOLET', label: 'بنفسجي', color: '#7c5cff' }, { key: 'MINT', label: 'نعناعي', color: '#34d399' }, { key: 'GOLD', label: 'ذهبي', color: '#ffc94d' }, { key: 'ROSE', label: 'وردي', color: '#ff5c72' }];
  const category = (n: number) => ({ key: `category_${n}`, label: `فئة ${n}`, format: n === 32 ? 'LIST_ITEMS' : 'ORDINARY_TIER', cover: null, prompts: [] });
  const catalogPage = (offset: number, categoryKey: string | null = null) => { const total = categoryKey === null ? 33 : 65, size = categoryKey === null ? 32 : 64, rows = categoryKey === null ? Array.from({ length: Math.min(size, total - offset) }, (_, n) => category(n + offset)) : Array.from({ length: Math.min(size, total - offset) }, (_, n) => ({ ref: `prompt_${n + offset}`, label: `جولة ${n + offset}` })); return { scope: { gameId: 'release', collection: categoryKey === null ? 'catalog-categories' : 'catalog-prompts', roundId: categoryKey, effectId: null, purpose: 'OWNER' }, revision: 'a'.repeat(64), snapshot: (categoryKey === null ? 'b' : 'c').repeat(64), total, returned: rows.length, offset, nextCursor: offset + size < total ? `page_${offset + size}.signature` : null, complete: offset + size >= total, rows }; };
  let submitted: Record<string, unknown> | null = null;
  mocks.request.mockImplementation(async (path, _authority, _signal, body) => { if (path === '/catalog/mixed') { const page = catalogPage(0); return { version: 5, rulesVersion: 'enta-competitive-1', availableCredit: '1', palette, categories: page.rows, catalogPage: page }; } if (path === '/catalog/mixed/pages') return catalogPage(offsetOf(body), body.categoryKey); submitted = body; throw new Error('synthetic lost reply'); });
  render(<ObservedFirebaseAuthProvider value={{ ...loadingAuthContext, status: 'password', isAvailable: true, user: { ...user, emailVerified: true, isAnonymous: false } as User }}><MemoryRouter><CompetitionSetupForm format="MIXED_BOARD" /></MemoryRouter></ObservedFirebaseAuthProvider>);
  await screen.findByRole('button', { name: /^فئة 0\s*أسئلة$/ }); for (let n = 0; n < 5; n++) await userEvent.click(screen.getByRole('button', { name: new RegExp(`^فئة ${n}\\s*أسئلة$`) }));
  await userEvent.click(screen.getByRole('button', { name: 'الفئات التالية' })); await screen.findByRole('button', { name: /^فئة 32\s*قائمة$/ }); expect(screen.queryByRole('button', { name: /^فئة 0\s*أسئلة$/ })).not.toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: /^فئة 32\s*قائمة$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'عرض جولات الفئة' })); await screen.findByLabelText('جولة 0'); await userEvent.click(screen.getByRole('button', { name: 'الجولات التالية' })); await screen.findByLabelText('جولة 64'); expect(screen.queryByLabelText('جولة 0')).not.toBeInTheDocument(); await userEvent.click(screen.getByLabelText('جولة 64'));
  for (const field of screen.getAllByLabelText('اللاعبون — اسم في كل سطر')) await userEvent.type(field, 'أحمد'); await userEvent.click(screen.getByRole('button', { name: 'ابدأوا لوحة متنوعة' })); await waitFor(() => expect(submitted).not.toBeNull());
  expect((submitted as unknown as { setup: { categories: unknown[] } }).setup.categories).toEqual([...Array.from({ length: 5 }, (_, n) => ({ key: `category_${n}`, promptRefs: [] })), { key: 'category_32', promptRefs: ['prompt_64'] }]);
});
