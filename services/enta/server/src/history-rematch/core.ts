export class E3Error extends Error { constructor(readonly code: string, readonly status = 400) { super(code); } }
export function deny(code: string, status = 400): never { throw new E3Error(code, status); }
export const ID = /^[A-Za-z0-9_-]{1,128}$/;
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) return deny('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function identifier(value: unknown): string { return typeof value === 'string' && ID.test(value) ? value : deny('INVALID_REQUEST'); }
export function integer(value: unknown, min: number, max: number): number { return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : deny('INVALID_REQUEST'); }
export function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.normalize('NFC').replace(/^ +| +$/g, '') !== value || /[<>\p{Cc}\p{Zl}\p{Zp}\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/u.test(value)) return deny('INVALID_REQUEST');
  for (let n = 0; n < value.length; n++) { const c = value.charCodeAt(n); if (c >= 0xdc00 && c <= 0xdfff) return deny('INVALID_REQUEST'); if (c >= 0xd800 && c <= 0xdbff) { const d = value.charCodeAt(++n); if (!(d >= 0xdc00 && d <= 0xdfff)) return deny('INVALID_REQUEST'); } }
  return value;
}
export type Format = 'TIER_BOARD' | 'MIXED_BOARD' | 'STANDALONE_LIST' | 'STANDALONE_ACTING';
export type Mode = 'CLASSIC' | 'KIDS' | 'LIST' | 'ACTING';
/** Conditional new-history context material bound only; not account/identity policy. */
export function contextValue(value: unknown): string {
 if(typeof value!=='string'||!value.length||value.length>256||value.includes('\0')||Buffer.byteLength(value,'utf8')>1024)return deny('HISTORY_UNAVAILABLE',503);
 for(let n=0;n<value.length;n++){const c=value.charCodeAt(n);if(c>=0xdc00&&c<=0xdfff)deny('HISTORY_UNAVAILABLE',503);if(c>=0xd800&&c<=0xdbff){const d=value.charCodeAt(++n);if(!(d>=0xdc00&&d<=0xdfff))deny('HISTORY_UNAVAILABLE',503);}}
 return value;
}

export type Profile = 'enta-classic-2' | 'enta-classic-3' | 'enta-kids-3' | 'enta-format-1' | 'enta-competitive-1';
