export const PACK_VERSION = 'imposter-starter-v1' as const;
export type Phase = 'lobby' | 'reveal' | 'clues' | 'discussion' | 'vote' | 'runoff' | 'guess' | 'results' | 'cancelled' | 'closed';
export type Pace = 'fast' | 'default' | 'relaxed';
export type Settings = { mode: 'spoken' | 'typed'; pace: Pace; categories: string[] };
export type Player = { uid: string; name: string; ready: boolean; joinedAt: number; leaseUntil: number; left: boolean };
export type Word = { category: string; word: string; aliases: string[] };
export type Result = { winner: 'imposter' | 'insiders'; imposter: string; word: string; guess: string | null; totals: Record<string, number>; abstentions: number; runoffTotals?: Record<string, number>; runoffAbstentions?: number };
export type Room = { gameKind: 'imposter'; revision: number; code: string; phase: Phase; phaseId: string; round: number; packVersion?: string; organizer: string; players: Player[]; settings: Settings; deadline: number | null; used: string[]; word?: Word; imposter?: string; order: string[]; turn: number; clues: Array<{ uid: string; text: string | null }>; acks: string[]; votes: Record<string, string | null>; firstVotes?: Record<string, string | null>; candidates: string[]; guess?: string; result?: Result; receipts: Record<string, string>; viewVersions?: Record<string, number>; viewKeys?: Record<string, string>; contentExhausted?: boolean; };
export type Intent = { requestId: string; phaseId: string } & ({ type: 'ready'; ready: boolean } | { type: 'settings'; settings: Settings } | { type: 'start' } | { type: 'ack' } | { type: 'clue'; text?: string } | { type: 'vote'; target: string | null } | { type: 'guess'; text: string } | { type: 'cancel' } | { type: 'leave' } | { type: 'remove'; uid: string } | { type: 'heartbeat' } | { type: 'replay' } | { type: 'close' });
export type Projection = { gameKind: 'imposter'; revision: number; code: string; phase: Phase; phaseId: string; round: number; organizer: string; me: string; players: Array<{ uid: string; name: string; ready: boolean; connected: boolean }>; settings: Settings; deadline: number | null; category?: string; role?: 'imposter' | 'insider'; word?: string; order: string[]; turn: number; clues: Array<{ uid: string; text: string | null }>; candidates: string[]; hasActed: boolean; contentExhausted: boolean; result?: Result };





