import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPublicEpisodes } from '../episodes/public-catalog';

const episode = { id: 'episode-one', number: 1, title: 'حلقة للاختبار', description: null, airDate: null };
const release = (episodes: unknown[]) => ({
  schemaVersion: 1,
  releaseId: 'episode-fixture',
  approval: 'reviewed-public-descriptions',
  reviewedOn: '2026-11-25',
  episodes,
});

test('the episode catalogue projection used by the local route includes only a valid optional YouTube ID', () => {
  const withVideo = { ...episode, id: 'episode-two', number: 2, youtubeId: 'xYz09aB_-Q0' };
  assert.deepEqual(projectPublicEpisodes(release([withVideo, episode])), { episodes: [episode, withVideo] });
  for (const youtubeId of [null, 123, undefined, 'xYz09aB_-Q', 'xYz09aB_-Q0\n', 'xYz09aB_ Q0', 'https://youtu.be/xYz09aB_-Q0']) {
    assert.throws(() => projectPublicEpisodes(release([{ ...episode, youtubeId }])), /EPISODE_CATALOG_UNAVAILABLE/);
  }
  assert.throws(() => projectPublicEpisodes(release([{ ...withVideo, videoUrl: 'https://private.example.test/video' }])), /EPISODE_CATALOG_UNAVAILABLE/);
});
