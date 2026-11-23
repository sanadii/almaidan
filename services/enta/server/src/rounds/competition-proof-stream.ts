import { fail } from '../gameplay/types';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { boundedValue, encodedBytes, PROOF_PAGE_BYTES } from './competition-content';
import { exact } from './validation';
import type { Effect, Posting } from './competition-types';
export interface EffectProofRow { effect: Effect; postings: Posting[] }
export interface EffectProofAnchor { gameId: string; version: number; start: number; end: number; count: number }
export interface EffectProofPage { anchor: EffectProofAnchor; offset: number; returned: number; complete: boolean; rows: EffectProofRow[] }
/** The caller holds Game/version through the terminal page. No prefix can
 * prove independence. Byte and row bounds apply together, including one row. */
export class CorrectionProofStream {
  private next = 0;
  private seen = 0;
  private closed = false;
  private readonly teams = new Set<string>();
  private readonly blocked: string[] = [];
  private blockedCount = 0;
  constructor(private readonly anchor: EffectProofAnchor, original: Effect, private readonly excluded: Set<string>, changedTeams: string[], private readonly participantIds: Set<string>) {
    exact(anchor, ['gameId', 'version', 'start', 'end', 'count']);
    if (anchor.start !== original.sequence + 1 || anchor.count !== Math.max(0, anchor.end - anchor.start + 1)) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
    this.next = anchor.start; for (const team of changedTeams) this.teams.add(team);
  }
  page(page: EffectProofPage): void {
    exact(page, ['anchor', 'offset', 'returned', 'complete', 'rows']);
    if (this.closed || admissionHash(page.anchor) !== admissionHash(this.anchor) || page.offset !== this.seen || page.returned !== page.rows.length || page.rows.length > 256 || !page.rows.length && this.anchor.count !== 0 || typeof page.complete !== 'boolean') return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
    boundedValue(page.rows, PROOF_PAGE_BYTES, 'EFFECT_PROOF_UNAVAILABLE');
    for (const row of page.rows) {
      exact(row, ['effect', 'postings']); const effect = row.effect;
      exact(effect, ['id', 'eventId', 'sequence', 'roundId', 'kind', 'aid', 'amountKind', 'reversible', 'barrier', 'reads', 'dependencies', 'postingIds', 'beforeClock', 'afterClock', 'originalAttemptIds', 'correctAttemptIds', 'bonusSnapshot', 'predecessorId', 'predecessorHash', 'reason', 'hash']);
      if (effect.sequence !== this.next || effect.sequence > this.anchor.end || !Array.isArray(effect.postingIds) || !Array.isArray(effect.reads) || !Array.isArray(effect.dependencies) || !Array.isArray(row.postings) || row.postings.length !== effect.postingIds.length || row.postings.some(p => p.effectId !== effect.id || !effect.postingIds.includes(p.id) || p.after - p.before !== p.delta || !this.participantIds.has(p.teamId)) || new Set(row.postings.map(p => p.id)).size !== row.postings.length) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
      const { hash, ...payload } = effect; if (hash !== admissionHash({ domain: 'maydan.enta.effect.v1', payload })) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
      this.next++; this.seen++;
      if (this.excluded.has(effect.id)) continue;
      // Every edge must have an explained participant read. Corrupt/unknown
      // edges deny, rather than accumulating a whole-history affected-ID set.
      if (effect.dependencies.some(id => !effect.reads.some(r => r.sourceEffectId === id && this.participantIds.has(r.teamId)))) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
      const reads = effect.reads.filter(r => this.teams.has(r.teamId)); if (!reads.length) continue;
      if (effect.amountKind === 'DERIVED' || reads.some(r => r.kind !== 'BASE') || effect.postingIds.length > 0 && effect.amountKind !== 'FIXED') { this.blockedCount++; if (this.blocked.length < 32) this.blocked.push(effect.id); for (const posting of row.postings) this.teams.add(posting.teamId); }
    }
    if (page.complete) { if (this.seen !== this.anchor.count || this.next !== this.anchor.end + 1) return fail(503, 'EFFECT_PROOF_UNAVAILABLE'); this.closed = true; }
    else if (this.seen >= this.anchor.count) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
  }
  finish(): { ids: string[]; total: number } { if (!this.closed) return fail(503, 'EFFECT_PROOF_UNAVAILABLE'); return { ids: this.blocked, total: this.blockedCount }; }
}
export function* effectProofPages(anchor: EffectProofAnchor, source: Iterable<EffectProofRow>): Generator<EffectProofPage> {
  let rows: EffectProofRow[] = [], offset = 0, bytes = 2;
  for (const row of source) {
    const size = encodedBytes(row); if (size + 2 > PROOF_PAGE_BYTES) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
    if (rows.length === 256 || bytes + size + (rows.length ? 1 : 0) > PROOF_PAGE_BYTES) { yield { anchor, offset, returned: rows.length, complete: false, rows }; offset += rows.length; rows = []; bytes = 2; }
    bytes += size + (rows.length ? 1 : 0); rows.push(row);
  }
  yield { anchor, offset, returned: rows.length, complete: true, rows };
}
