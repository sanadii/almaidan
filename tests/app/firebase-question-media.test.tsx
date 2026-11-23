// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FirebaseGameAdapter } from '../../src/features/game/runtime/firebase-game-adapter.js';
import { youtubeDescriptorBytes } from '../../src/features/game/runtime/youtube-media.js';

const { callable, signIn } = vi.hoisted(() => ({ callable: vi.fn(), signIn: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => callable) }));
vi.mock('../../src/lib/firebase/client', () => ({
  getOptionalFirebaseClient: () => ({ functions: {} }),
  signInAnonymouslyIfNeeded: signIn,
}));

const youtube = { provider: 'youtube', videoId: 'UQWIfqEMJDU', startSeconds: 6, endSeconds: 27 } as const;
const request = { roomId: 'media-room', mediaId: 'cartoon-song-01', assetSha256: createHash('sha256').update(youtubeDescriptorBytes(youtube)).digest('hex') };
const grant = { mediaId: request.mediaId, assetSha256: request.assetSha256, expiresAt: '2026-11-19T12:10:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

it('opens a bounded YouTube player from a verified callable grant', async () => {
  callable.mockResolvedValueOnce({ data: { ...grant, youtube } });
  await expect(new FirebaseGameAdapter().getCurrentQuestionMedia(request)).resolves.toEqual({
    ...grant, youtube, url: 'https://www.youtube-nocookie.com/embed/UQWIfqEMJDU?start=6&end=27&controls=1&rel=0',
  });
  expect(signIn.mock.invocationCallOrder[0]).toBeLessThan(callable.mock.invocationCallOrder[0]);
  expect(callable).toHaveBeenCalledWith(request);
});

it('rejects tampered clip bounds and a supplied external URL', async () => {
  callable.mockResolvedValueOnce({ data: { ...grant, youtube: { ...youtube, startSeconds: 7 } } });
  callable.mockResolvedValueOnce({ data: { ...grant, youtube, url: 'https://example.com/player' } });
  const adapter = new FirebaseGameAdapter();
  await expect(adapter.getCurrentQuestionMedia(request)).rejects.toThrow('MEDIA_BINDING_MISMATCH');
  await expect(adapter.getCurrentQuestionMedia(request)).rejects.toThrow('MEDIA_BINDING_MISMATCH');
});
