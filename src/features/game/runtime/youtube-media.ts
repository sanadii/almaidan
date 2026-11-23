/** An immutable, bounded external video reference. It is not local audio. */
export const YOUTUBE_MEDIA_CONTENT_TYPE = 'application/vnd.huroof.youtube+json';
export type YouTubeMediaDescriptor = { provider: 'youtube'; videoId: string; startSeconds: number; endSeconds: number };
export function isYouTubeMediaDescriptor(value: unknown): value is YouTubeMediaDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join(',') === 'endSeconds,provider,startSeconds,videoId' && v.provider === 'youtube' && typeof v.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v.videoId) && Number.isSafeInteger(v.startSeconds) && Number.isSafeInteger(v.endSeconds) && (v.startSeconds as number) >= 0 && (v.endSeconds as number) > (v.startSeconds as number) && (v.endSeconds as number) <= 86400;
}
export function youtubeDescriptorBytes(value: YouTubeMediaDescriptor): string {
  return JSON.stringify({provider:value.provider,videoId:value.videoId,startSeconds:value.startSeconds,endSeconds:value.endSeconds});
}
export function youtubeEmbedUrl(value: YouTubeMediaDescriptor): string {
  return `https://www.youtube-nocookie.com/embed/${value.videoId}?start=${value.startSeconds}&end=${value.endSeconds}&controls=1&rel=0`;
}

export async function authenticateYouTubeMedia(value: unknown, assetSha256: string): Promise<YouTubeMediaDescriptor> {
  if (!isYouTubeMediaDescriptor(value)) throw new Error('MEDIA_INVALID_TYPE');
  const bytes = new TextEncoder().encode(youtubeDescriptorBytes(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== assetSha256) throw new Error('MEDIA_BINDING_MISMATCH');
  return value;
}
