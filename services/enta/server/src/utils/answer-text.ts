/**
 * About 5,300 saved-source answers arrive wrapped in escaped chat "spoiler" markers, for example
 * `\|\|باريس\|\` instead of `باريس`. The saved source is hash-pinned and must not be rewritten,
 * so the markers are removed where answers are read for play and display.
 */
const LEADING_MARKERS = /^(?:\s*\\*\|)+\s*/u;
const TRAILING_MARKERS = /\s*(?:\\*\|\s*)+\\*\s*$/u;

const MARKDOWN_ESCAPE = /\\([*_|\\`~])/gu;

export function cleanAnswerText(value: string): string {
  const cleaned = value.replace(LEADING_MARKERS, '').replace(TRAILING_MARKERS, '').replace(MARKDOWN_ESCAPE, '$1').trim();
  // Never turn a real answer into an empty string; keep the original if it was only markers.
  return cleaned || value;
}
