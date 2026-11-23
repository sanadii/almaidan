import type { OneStatementOwnedHistorySource, OneStatementEnvelope, AuthenticatedHistoryWindow } from './reader';

/** Trusted, parameterized database boundary, provided by the host composition. */
export interface HistoryQueryBoundary {
  query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }>;
}

/** The only persistence capability exposed to the page service is one fixed call. */
export function postgresOwnedHistory(db: HistoryQueryBoundary): OneStatementOwnedHistorySource {
  return {
    async readOneSnapshot(window: AuthenticatedHistoryWindow): Promise<OneStatementEnvelope> {
      const { context, filters, limit, upper, before } = window;
      const reply = await db.query<{ value: OneStatementEnvelope }>(
        'SELECT public.pro311_enta_history($1,$2,$3,$4::jsonb) AS value',
        [context.namespaceId, context.projectId, context.uid, JSON.stringify({ filters, limit, upper, before })],
      );
      if (!reply || !Array.isArray(reply.rows) || reply.rows.length !== 1 || !reply.rows[0]?.value) throw new Error('HISTORY_DATA_UNAVAILABLE');
      return reply.rows[0].value;
    },
  };
}
