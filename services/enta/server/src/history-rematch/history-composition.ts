import type { Principal } from '../identity';
import type { Keyring } from './cursor';
import { deny } from './core';
import { readHistoryRematchPage } from './service';
import { postgresOwnedHistory, type HistoryQueryBoundary } from './postgres';
import { createOriginalResultReader } from './result';
import type { HistoryHandlers } from './history-router';

/** Explicit injection only: no SDK, database, key or environment initialization. */
export function composeHistory(db: HistoryQueryBoundary, namespace: string, project: string, keyring: Keyring | null, now: () => number): HistoryHandlers {
 const source=postgresOwnedHistory(db), original=createOriginalResultReader(db,namespace,project);
 return {
  async page(principal: Principal, query) {
   if (!principal.verifiedAccount || principal.projectId !== project) return deny('HISTORY_UNAVAILABLE',503);
   const context={uid:principal.uid,namespaceId:namespace,projectId:project};
   return readHistoryRematchPage(query,{owner:{cursor:context,authenticatedOwner:context,session:{...context,ownerUid:principal.uid}},source,keyring,now});
  },
  original,
 };
}
