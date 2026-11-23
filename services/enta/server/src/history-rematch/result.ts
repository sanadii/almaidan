import type { Principal } from '../identity';
import { identifier, object, integer, text, deny } from './core';
import { tuples } from './dto';
import type { HistoryQueryBoundary } from './postgres';

export interface OriginalResult {
  schemaVersion: 1; id: string; physicalProtocol: 2 | 3 | 4 | 5;
  mode: string; executionFormat: string; retainedRulesProfile: string;
  reason: string; unplayedCount: number; isTie: boolean;
  teams: Array<{ name: string; score: number; winner: boolean }>;
}
/** Closed, public-only result projection; untrusted SQL output never crosses directly. */
export function parseOriginalResult(input: unknown, expectedId: string): OriginalResult {
  try {
    const r = object(input, ['schemaVersion','id','physicalProtocol','mode','executionFormat','retainedRulesProfile','reason','unplayedCount','isTie','teams']);
    identifier(r.id); if (r.schemaVersion !== 1 || r.id !== expectedId) return deny('RESULT_UNAVAILABLE', 503);
    const tuple = tuples.find(t => t[0] === r.physicalProtocol && t[1] === r.mode && t[2] === r.executionFormat && t[3] === r.retainedRulesProfile);
    if (!tuple || !Array.isArray(r.teams) || r.teams.length < 2 || r.teams.length > 4 || typeof r.isTie !== 'boolean') return deny('RESULT_UNAVAILABLE', 503);
    if ((r.mode === 'KIDS' || r.executionFormat === 'STANDALONE_LIST' || r.executionFormat === 'STANDALONE_ACTING') && r.teams.length !== 2) return deny('RESULT_UNAVAILABLE', 503);
    const allowed = tuple[0] < 4 ? ['ALL_QUESTIONS_PLAYED','HOST_ENDED'] : ['ALL_ROUNDS','HOST_ENDED'];
    if (!allowed.includes(r.reason as string)) return deny('RESULT_UNAVAILABLE', 503);
    const count = integer(r.unplayedCount, 0, r.mode === 'KIDS' ? 6 : r.executionFormat === 'STANDALONE_LIST' || r.executionFormat === 'STANDALONE_ACTING' ? 4 : 36);
    if ((r.reason === 'HOST_ENDED') !== (count > 0)) return deny('RESULT_UNAVAILABLE', 503);
    const teams = r.teams.map(value => { const team = object(value, ['name','score','winner']); if (typeof team.winner !== 'boolean') return deny('RESULT_UNAVAILABLE', 503); return {name:text(team.name,2,22),score:integer(team.score,-2147483648,2147483647),winner:team.winner}; });
    const winners = teams.filter(t => t.winner).length;
    if (tuple[0] === 5) {
      const max = Math.max(...teams.map(t=>t.score)), leaders = teams.filter(t=>t.score===max);
      if (r.reason === 'HOST_ENDED' ? winners !== 0 || r.isTie : r.isTie ? winners !== 0 || leaders.length < 2 : leaders.length !== 1 || winners !== 1 || !leaders[0].winner) return deny('RESULT_UNAVAILABLE',503);
    }
    else { const max = Math.max(...teams.map(t=>t.score)); if (teams.some(t=>t.winner !== (t.score === max)) || r.isTie !== (winners > 1)) return deny('RESULT_UNAVAILABLE',503); }
    return {schemaVersion:1,id:r.id as string,physicalProtocol:tuple[0],mode:tuple[1],executionFormat:tuple[2],retainedRulesProfile:tuple[3],reason:r.reason as string,unplayedCount:count,isTie:r.isTie as boolean,teams};
  } catch { return deny('RESULT_UNAVAILABLE', 503); }
}
export function createOriginalResultReader(db: HistoryQueryBoundary, namespace: string, project: string) {
 return async (principal: Principal, id: string): Promise<OriginalResult> => {
  identifier(id); if (!principal.verifiedAccount || principal.projectId !== project) return deny('RESULT_UNAVAILABLE',503);
  const result = await db.query<{value: unknown}>('SELECT public.pro311_enta_original_result($1,$2,$3,$4) AS value',[namespace,project,principal.uid,id]);
  if (!Array.isArray(result.rows) || result.rows.length !== 1) return deny('RESULT_UNAVAILABLE',503);
  return parseOriginalResult(result.rows[0].value,id);
 };
}
