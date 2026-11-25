import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { canRenderCurrentQuestionMedia, CurrentQuestionMedia } from '../../src/routes/GameRoutes';
import { youtubeEmbedUrl } from '../../src/features/game/runtime/youtube-media';

const media = { mediaId: 'v18-011-001', assetSha256: 'a'.repeat(64), altAr: 'صورة السؤال' };

it('renders a bounded YouTube player only after a matching authorized descriptor grant', async () => {
  const video = { ...media, type: 'video' as const, altAr: 'فيديو السؤال' };
  const youtube = { provider: 'youtube' as const, videoId: 'UQWIfqEMJDU', startSeconds: 6, endSeconds: 27 };
  const load = vi.fn().mockResolvedValue({ ...video, youtube, url: youtubeEmbedUrl(youtube), expiresAt: new Date(Date.now() + 60_000).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
  const frame = await screen.findByTitle('فيديو السؤال');
  expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/UQWIfqEMJDU?start=6&end=27&controls=1&rel=0');
  expect(screen.getByTestId('question-media').querySelector('audio')).toBeNull();
});

it('keeps the same YouTube player through a compatible grant refresh and removes it on expiry', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    const video = { ...media, type: 'video' as const, altAr: 'فيديو السؤال' };
    const youtube = { provider: 'youtube' as const, videoId: 'UQWIfqEMJDU', startSeconds: 6, endSeconds: 27 };
    const grant = () => ({ ...video, youtube, url: youtubeEmbedUrl(youtube), expiresAt: new Date(Date.now() + 1_500).toISOString() });
    const load = vi.fn().mockImplementationOnce(async () => grant()).mockImplementationOnce(async () => grant()).mockRejectedValue(new Error('unavailable'));
    render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
    await act(async () => { await Promise.resolve(); });
    const frame = screen.getByTitle('فيديو السؤال');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(screen.getByTitle('فيديو السؤال')).toBe(frame);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(screen.queryByTitle('فيديو السؤال')).not.toBeInTheDocument();
    expect(screen.getByTestId('question-media-error')).toBeVisible();
    load.mockImplementationOnce(async () => grant());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' })); await Promise.resolve(); });
    expect(screen.getByTitle('فيديو السؤال')).toHaveAttribute('src', youtubeEmbedUrl(youtube));
  } finally { vi.useRealTimers(); }
});

it('rejects an external URL without an authorized bounded YouTube descriptor', async () => {
  const video = { ...media, type: 'video' as const };
  const load = vi.fn().mockResolvedValue({ ...video, url: 'https://example.com/video', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  expect(screen.queryByTitle('صورة السؤال')).not.toBeInTheDocument();
});

it('rejects a malformed YouTube descriptor even with a matching grant binding', async () => {
  const video = { ...media, type: 'video' as const };
  const youtube = { provider: 'youtube', videoId: 'invalid', startSeconds: 20, endSeconds: 10 };
  const load = vi.fn().mockResolvedValue({ ...video, youtube, url: 'https://www.youtube-nocookie.com/embed/invalid', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  expect(screen.queryByTitle('صورة السؤال')).not.toBeInTheDocument();
});

it('loads the bound image, retries HTTP/image failures, and revokes a late blob response', async () => {
  const first = vi.fn()
    .mockRejectedValueOnce(new Error('expired'))
    .mockResolvedValueOnce({ ...media, url: 'blob:retry', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const view = render(<CurrentQuestionMedia roomId="room-a" media={media} load={first} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'أعد المحاولة' }));
  const image = await waitFor(() => {
    const image = screen.getByTestId('question-media').querySelector('img');
    expect(image).toHaveAttribute('src', 'blob:retry');
    return image!;
  });
  fireEvent.error(image);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  let resolveLate: ((value: { url: string; expiresAt: string }) => void) | undefined;
  const late = vi.fn(() => new Promise<{ url: string; expiresAt: string }>((resolve) => { resolveLate = resolve; }));
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  view.rerender(<CurrentQuestionMedia roomId="room-a" media={{ ...media, mediaId: 'v18-011-002' }} load={late} />);
  view.unmount();
  await act(async () => resolveLate?.({ ...media, mediaId: 'v18-011-002', url: 'blob:late', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  await waitFor(() => expect(late).toHaveBeenCalledTimes(1));
  expect(revoke).toHaveBeenCalledWith('blob:late');
  delete (URL as typeof URL & { revokeObjectURL?: () => void }).revokeObjectURL;
});

it('refreshes a valid image grant shortly before expiry', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-09-09T12:00:00.000Z'));
    const load = vi.fn()
      .mockResolvedValueOnce({ ...media, url: 'blob:first', expiresAt: new Date(Date.now() + 1_500).toISOString() })
      .mockResolvedValueOnce({ ...media, url: 'blob:second', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    render(<CurrentQuestionMedia roomId="room-a" media={media} load={load} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('renders a contained muted inline video from the currently bound blob', async () => {
  const video = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: 'c'.repeat(64), altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
  const load = vi.fn().mockResolvedValue({ ...video, url: 'blob:goal', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
  const element = await waitFor(() => {
    const video = screen.getByTestId('question-media').querySelector('video');
    expect(video).toHaveAttribute('src', 'blob:goal');
    return video;
  });
  expect(element).toHaveProperty('muted', true);
  expect(element).toHaveAttribute('playsinline');
});

it('keeps a playing video source through a same-binding grant refresh and starts a clear variant fresh', async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  try {
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const video = { mediaId: 'goal-quiz-2026:001:blur', assetSha256: 'c'.repeat(64), altAr: 'مقطع السؤال', type: 'video' as const, contentType: 'video/mp4' };
    const load = vi.fn()
      .mockResolvedValueOnce({ ...video, url: 'blob:first', expiresAt: new Date(Date.now() + 1_500).toISOString() })
      .mockResolvedValueOnce({ ...video, url: 'blob:refresh', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const view = render(<CurrentQuestionMedia roomId="room-a" media={video} load={load} />);
    await act(async () => { await Promise.resolve(); });
    const original = screen.getByTestId('question-media').querySelector('video')!;
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).toHaveBeenCalledTimes(2);
    expect((screen.getByTestId('question-media')).querySelector('video')).toBe(original);
    expect(original).toHaveAttribute('src', 'blob:first');
    expect(revoke).toHaveBeenCalledWith('blob:refresh');
    view.rerender(<CurrentQuestionMedia roomId="room-a" media={{ ...video, mediaId: 'goal-quiz-2026:001:clean', assetSha256: 'd'.repeat(64) }} load={vi.fn().mockResolvedValue({ ...video, mediaId: 'goal-quiz-2026:001:clean', assetSha256: 'd'.repeat(64), url: 'blob:clear', expiresAt: new Date(Date.now() + 60_000).toISOString() })} />);
    await act(async () => { await Promise.resolve(); });
    const clear = screen.getByTestId('question-media').querySelector('video')!;
    expect(clear).toHaveAttribute('src', 'blob:clear');
    expect(clear).not.toBe(original);
  } finally {
    vi.useRealTimers();
    delete (URL as typeof URL & { revokeObjectURL?: () => void }).revokeObjectURL;
  }
});

it('rejects expired or mismatched grants without displaying or rapidly refreshing them', async () => {
  const load = vi.fn().mockResolvedValue({ mediaId: 'v18-011-002', assetSha256: 'b'.repeat(64), url: 'blob:wrong', expiresAt: new Date(Date.now() - 1).toISOString() });
  render(<CurrentQuestionMedia roomId="room-a" media={media} load={load} />);
  expect(await screen.findByTestId('question-media-error')).toBeVisible();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(1);
});

it('requires a current authoritative host/audience surface before rendering image media', () => {
  expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'host', state: 'PAUSED', surface: 'host' })).toBe(true);
  expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'audience', state: 'QUESTION_READING', surface: 'display' })).toBe(true);
  for (const patch of [
    { authoritative: false },
    { connection: 'offline' },
    { role: 'player' as const },
    { audienceQuestionVisible: false },
    { state: 'CELL_SELECTION' },
  ]) expect(canRenderCurrentQuestionMedia({ audienceQuestionVisible: true, authoritative: true, connection: 'connected', role: 'audience', state: 'QUESTION_READING', surface: 'display', ...patch })).toBe(false);
});
