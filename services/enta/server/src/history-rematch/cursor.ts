import { strictJSON } from './strict-json';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deny, object, identifier, integer, contextValue, type Format, type Mode, type Profile } from './core';
export type Filters = { mode: Mode | null; format: Format | null; rules: Profile | null; status: 'ACTIVE' | 'FINISHED' | null };
export type Anchor = { createdAt: string; id: string };
export interface Cursor { cursorVersion: 1; keyVersion: string; registryVersion: 1; queryVersion: 2; filters: Filters; limit: number; issuedAt: number; expiresAt: number; upper: Anchor; before: Anchor }
export interface CursorContext { namespaceId: string; projectId: string; uid: string }
export interface Key { bytes: Buffer; issueUntil: number; verifyUntil: number }
export interface Keyring { active: string; keys: ReadonlyMap<string, Key> }
const fields = ['cursorVersion', 'keyVersion', 'registryVersion', 'queryVersion', 'filters', 'limit', 'issuedAt', 'expiresAt', 'upper', 'before'] as const;
export function filters(value: unknown): Filters {
  const r = object(value, ['mode', 'format', 'rules', 'status']);
  const allowed = { mode: ['CLASSIC', 'KIDS', 'LIST', 'ACTING'], format: ['TIER_BOARD', 'MIXED_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING'], rules: ['enta-classic-2', 'enta-classic-3', 'enta-kids-3', 'enta-format-1', 'enta-competitive-1'], status: ['ACTIVE', 'FINISHED'] };
  for (const k of Object.keys(allowed) as (keyof Filters)[]) if (r[k] !== null && !allowed[k].includes(r[k] as never)) deny('INVALID_CURSOR');
  return { mode: r.mode as Filters['mode'], format: r.format as Filters['format'], rules: r.rules as Filters['rules'], status: r.status as Filters['status'] };
}
export function anchor(value: unknown): Anchor {
  const r = object(value, ['createdAt', 'id']); identifier(r.id);
  if (typeof r.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt) || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt) deny('INVALID_CURSOR');
  return { createdAt: r.createdAt as string, id: r.id as string };
}
export const compareAnchor = (a: Anchor, b: Anchor): number => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function ordered(c: Cursor): string { return JSON.stringify({ cursorVersion: c.cursorVersion, keyVersion: c.keyVersion, registryVersion: c.registryVersion, queryVersion: c.queryVersion, filters: filters(c.filters), limit: c.limit, issuedAt: c.issuedAt, expiresAt: c.expiresAt, upper: anchor(c.upper), before: anchor(c.before) }); }
function parse(value: unknown): Cursor {
  const r = object(value, fields), f = filters(r.filters), upper = anchor(r.upper), before = anchor(r.before);
  if (r.cursorVersion !== 1 || r.registryVersion !== 1 || r.queryVersion !== 2 || typeof r.keyVersion !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(r.keyVersion) || compareAnchor(before, upper) > 0) deny('INVALID_CURSOR');
  const issuedAt = integer(r.issuedAt, 0, 8_640_000_000_000_000), expiresAt = integer(r.expiresAt, 0, 8_640_000_000_000_000);
  if (expiresAt !== issuedAt + 900_000) deny('INVALID_CURSOR');
  return { cursorVersion: 1, keyVersion: r.keyVersion as string, registryVersion: 1, queryVersion: 2, filters: f, limit: integer(r.limit, 1, 50), issuedAt, expiresAt, upper, before };
}
function key(ring: Keyring | null, version: string, now: number, issuing: boolean): Buffer {
  if (!Number.isSafeInteger(now) || now < 0) deny('HISTORY_UNAVAILABLE',503);
  if (!ring || !(ring.keys instanceof Map) || ring.keys.size < 1 || ring.keys.size > 8 || !/^[A-Za-z0-9_-]{1,32}$/.test(ring.active) || !ring.keys.has(ring.active)) deny('HISTORY_UNAVAILABLE', 503);
  for (const [v, k] of ring.keys) if (!/^[A-Za-z0-9_-]{1,32}$/.test(v) || !Buffer.isBuffer(k.bytes) || k.bytes.length < 32 || k.bytes.length > 128 || !Number.isSafeInteger(k.issueUntil) || k.issueUntil < 0 || !Number.isSafeInteger(k.verifyUntil) || !Number.isSafeInteger(k.issueUntil + 930_000) || k.verifyUntil < k.issueUntil + 930_000) deny('HISTORY_UNAVAILABLE',503);
  const k = ring.keys.get(version);
  if (!k || k.bytes.length < 32 || k.bytes.length > 128 || !Number.isSafeInteger(k.issueUntil) || !Number.isSafeInteger(k.verifyUntil) || k.verifyUntil < k.issueUntil + 930_000 || now > k.verifyUntil || (issuing && (version !== ring.active || now > k.issueUntil))) deny(issuing ? 'HISTORY_UNAVAILABLE' : 'INVALID_CURSOR', issuing ? 503 : 400);
  return k.bytes;
}
export function requireActiveKey(ring:Keyring|null,now:number):asserts ring is Keyring { if(!ring)deny('HISTORY_UNAVAILABLE',503);key(ring,ring.active,now,true); }
function component(value: string): Buffer { const b = Buffer.from(value, 'utf8'), n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); }
function mac(bytes: Buffer, context: CursorContext, payload: string): Buffer {
  [context.namespaceId, context.projectId, context.uid].forEach(contextValue);
  return createHmac('sha256', bytes).update(Buffer.concat(['maydan/enta/history-cursor', context.namespaceId, context.projectId, context.uid, payload].map(component))).digest();
}
function wire(c: Cursor, context: CursorContext, ring: Keyring, now: number, issuing: boolean): string {
  const payload = ordered(parse(c)), result = `${Buffer.from(payload, 'utf8').toString('base64url')}.${mac(key(ring, c.keyVersion, now, issuing), context, payload).toString('base64url')}`;
  if (result.length > 1024) deny('INVALID_CURSOR'); return result;
}
export function issue(context: CursorContext, ring: Keyring | null, now: number, f: Filters, limit: number, upper: Anchor, before: Anchor): string {
  if (!ring) return deny('HISTORY_UNAVAILABLE', 503);
  return wire({ cursorVersion: 1, keyVersion: ring.active, registryVersion: 1, queryVersion: 2, filters: f, limit, issuedAt: now, expiresAt: now + 900_000, upper, before }, context, ring, now, true);
}
export function authenticate(wireValue: unknown, context: CursorContext, ring: Keyring | null, now: number, f: Filters, limit: number): Cursor {
  if (!ring) deny('HISTORY_UNAVAILABLE', 503);
  if (typeof wireValue !== 'string' || wireValue.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(wireValue)) deny('INVALID_CURSOR');
  const [encoded, signature] = (wireValue as string).split('.');
  // Bound decoded allocation BEFORE Buffer.from and JSON.parse.
  if (encoded.length % 4 === 1 || Math.floor(encoded.length * 6 / 8) > 735) deny('INVALID_CURSOR');
  const b = Buffer.from(encoded, 'base64url'), sig = Buffer.from(signature, 'base64url');
  if (b.length > 735) deny('INVALID_CURSOR');
  if (b.toString('base64url') !== encoded || sig.toString('base64url') !== signature || sig.length !== 32) deny('INVALID_CURSOR');
  let payload:string;try{payload = new TextDecoder('utf-8', { fatal: true }).decode(b);}catch{return deny('INVALID_CURSOR');}
  let c: Cursor; try { c = parse(strictJSON(payload,735)); } catch { return deny('INVALID_CURSOR'); }
  // Canonical byte equality rejects duplicate keys, whitespace, reordering,
  // alternate escapes/numbers and unknown fields before any owner anchor read.
  if (ordered(c) !== payload || JSON.stringify(c.filters) !== JSON.stringify(filters(f)) || c.limit !== limit || now >= c.expiresAt || c.issuedAt > now + 30_000) deny('INVALID_CURSOR');
  if (!timingSafeEqual(mac(key(ring, c.keyVersion, now, false), context, payload), sig)) deny('INVALID_CURSOR'); return c;
}
export function advance(c: Cursor, before: Anchor, context: CursorContext, ring: Keyring, now: number): string {
  c = parse(c); before = anchor(before);
  if (now >= c.expiresAt || compareAnchor(before, c.before) >= 0) deny('INVALID_CURSOR');
  // Preserve key, first issuance, expiry and upper; verification key need not
  // still be active for issuance when continuing an existing signed context.
  return wire({ ...c, before }, context, ring, now, false);
}
