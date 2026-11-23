import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { EpisodesRoute } from '../../src/routes/EpisodesRoute';
import { EpisodeCatalogError, formatEpisodeDate, loadEpisodeCatalog, parseEpisodeCatalog } from '../../src/features/episodes/client';

const fetchMock = vi.fn();
const row = { id: 'episode-one', number: 1, title: 'عنوان اختبار للحلقة', description: 'وصف عام للاختبار.', airDate: '2026-10-07' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function surface() { return <ThemeProvider><MemoryRouter initialEntries={['/episodes']}><Routes><Route path="/episodes" element={<EpisodesRoute />} /><Route path="/" element={<h1>الرئيسية للاختبار</h1>} /></Routes></MemoryRouter></ThemeProvider>; }
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.stubEnv('VITE_STATIC_PREVIEW', 'false'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); });

describe('public episodes route', () => {
  it('announces loading and performs the same-origin public request', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    render(surface());
    expect(screen.getByRole('heading', { name: 'جارٍ تحميل الحلقات…' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'الحلقات' })).toHaveAttribute('aria-busy', 'true');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/episodes', expect.objectContaining({ credentials: 'omit', signal: expect.any(AbortSignal) }));
    await act(async () => finish(json({ episodes: [] })));
    expect(await screen.findByRole('heading', { name: 'لا توجد حلقات منشورة بعد' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'الحلقات' })).toHaveAttribute('aria-busy', 'false');
    expect(document.title).toBe('الحلقات | الميدان');
    expect(screen.queryByRole('button', { name: 'إعادة المحاولة' })).not.toBeInTheDocument();
  });

  it('renders ordered literal descriptions, stable dates and honest missing metadata', async () => {
    fetchMock.mockResolvedValue(json({ episodes: [{ ...row, id: 'episode-two', number: 2, title: 'حلقة ثانية', description: null, airDate: null }, { ...row, description: '<img src=x onerror=alert(1)>' }] }));
    render(surface());
    const list = await screen.findByRole('list', { name: 'قائمة الحلقات' });
    expect(list.querySelectorAll('article')[0]).toHaveTextContent('عنوان اختبار للحلقة');
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(list.querySelector('img')).toBeNull();
    expect(list.querySelector('iframe')).toBeNull();
    expect(list.querySelector('a')).toBeNull();
    const date = list.querySelector('time')!;
    expect(date).toHaveAttribute('datetime', '2026-10-07');
    expect(date).toHaveTextContent(formatEpisodeDate('2026-10-07'));
    expect(screen.getByText('لا يوجد وصف لهذه الحلقة بعد.')).toBeVisible();
    expect(screen.getByText('لم يُحدد تاريخ العرض بعد.')).toBeVisible();
  });

  it('allows a native keyboard retry after a service failure and navigates home', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'EPISODE_CATALOG_UNAVAILABLE' }, 503)).mockResolvedValueOnce(json({ episodes: [row] }));
    render(surface());
    const retry = await screen.findByRole('button', { name: 'إعادة المحاولة' });
    expect(screen.getByRole('alert')).toHaveTextContent('تحقق من الاتصال');
    retry.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: row.title })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const home = screen.getByRole('link', { name: 'العودة للرئيسية', exact: true });
    home.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'الرئيسية للاختبار' })).toBeVisible();
  });

  it('distinguishes malformed data from valid empty, and retries', async () => {
    fetchMock.mockResolvedValueOnce(json({ episodes: [{ ...row, videoUrl: 'https://private.test' }] })).mockResolvedValueOnce(json({ episodes: [] }));
    render(surface());
    expect(await screen.findByRole('heading', { name: 'تعذر عرض بيانات الحلقات' })).toBeVisible();
    expect(screen.queryByText('لا توجد حلقات منشورة بعد')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(await screen.findByRole('heading', { name: 'لا توجد حلقات منشورة بعد' })).toBeVisible();
  });

  it('handles network rejection with a recoverable alert', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(surface());
    expect(await screen.findByRole('heading', { name: 'تعذر تحميل الحلقات' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeEnabled();
  });

  it('static preview never requests or invents catalogue content', () => {
    vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
    render(surface());
    expect(screen.getByRole('heading', { name: 'الحلقات غير متاحة في المعاينة' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'قائمة الحلقات' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إعادة المحاولة' })).not.toBeInTheDocument();
  });

  it('cancels and ignores an obsolete response even if its transport ignores abort', async () => {
    let oldFinish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { oldFinish = resolve; })).mockResolvedValueOnce(json({ episodes: [] }));
    const mounted = render(surface());
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    vi.stubEnv('VITE_STATIC_PREVIEW', 'true');
    mounted.rerender(surface());
    expect(oldSignal.aborted).toBe(true);
    vi.stubEnv('VITE_STATIC_PREVIEW', 'false');
    mounted.rerender(surface());
    expect(await screen.findByRole('heading', { name: 'لا توجد حلقات منشورة بعد' })).toBeVisible();
    await act(async () => oldFinish(json({ episodes: [row] })));
    expect(screen.queryByText(row.title)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'لا توجد حلقات منشورة بعد' })).toBeVisible();
    mounted.unmount();
    expect((fetchMock.mock.calls[1][1].signal as AbortSignal).aborted).toBe(true);
  });

  it('adds real header discovery and preserves Escape focus restoration', async () => {
    fetchMock.mockResolvedValue(json({ episodes: [] }));
    render(surface());
    await screen.findByText('لا توجد حلقات منشورة بعد');
    expect(screen.getByRole('link', { name: 'الحلقات', exact: true })).toHaveAttribute('href', '/episodes');
    const menu = screen.getByRole('button', { name: 'القائمة' });
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(menu).toHaveFocus());
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('episode client boundary', () => {
  it('rejects coercion, impossible dates, missing fields, duplicates, unbounded and link-bearing text', () => {
    const invalid = [null, [], {}, { episodes: [], private: 'secret' }, { episodes: '[]' },
      ...[{ ...row, number: '1' }, { ...row, number: 1.1 }, { ...row, airDate: '2026-02-30' }, { ...row, title: ' ' }, { ...row, title: 'a'.repeat(161) }, { ...row, description: 'a'.repeat(2001) }, { ...row, description: 'https://example.test' }, { ...row, id: '../other' }, { ...row, airDate: undefined }].map(item => ({ episodes: [item] })),
      { episodes: [row, row] }, { episodes: [row, { ...row, id: 'another' }] },
      { episodes: Array.from({ length: 251 }, (_, i) => ({ ...row, id: `episode-${i}`, number: i + 1 })) },
      { episodes: Array.from({ length: 17 }, (_, i) => ({ ...row, id: `episode-${i}`, number: i + 1, description: 'a'.repeat(2000) })) },
    ];
    for (const input of invalid) expect(() => parseEpisodeCatalog(input)).toThrow(EpisodeCatalogError);
    expect(parseEpisodeCatalog({ episodes: [{ ...row, airDate: '2024-02-29' }] })).toHaveLength(1);
  });
  it('rejects HTML SPA fallback, invalid JSON and excessive response text', async () => {
    for (const response of [new Response('<html>preview fallback</html>', { headers: { 'content-type': 'text/html' } }), new Response('{broken', { headers: { 'content-type': 'application/json' } }), new Response(' '.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(loadEpisodeCatalog(new AbortController().signal)).rejects.toMatchObject({ kind: 'malformed' });
    }
  });
});
