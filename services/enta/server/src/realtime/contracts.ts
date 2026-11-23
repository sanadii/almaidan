import type { PgFrame } from '../../../../../src/features/game/runtime/pg-recovery';
export const REALTIME_LIMITS = Object.freeze({ snapshotBytes: 262144, frameBytes: 524288, depth: 32, events: 64, connections: 64, queueFrames: 8, queueBytes: 1048576, refreshMs: 15000 });
export interface RealtimeRequest { roomId: string; roomGeneration: string; memberGeneration: string | null; afterSequence: string | null; afterRevision: string | null; offer?:unknown }
export interface AudienceRealtimeRead {actualMemberRole:'host'|'audience';frame:PgFrame}
export type RealtimeEnvelope = PgFrame;
export const decimal = (v: unknown): v is string => typeof v === 'string' && v.length <= 16 && /^(0|[1-9][0-9]*)$/.test(v) && BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER);
