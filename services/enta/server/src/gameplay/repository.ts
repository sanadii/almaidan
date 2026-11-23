import type { Principal } from "../identity";
import type { CommandReceipt, MatchCommand, MatchRecord, PreparedCatalog, PreparedStart, EntaMode, SuccessorCatalog, PreparedSuccessor, HistoryQuery, HistoryRow } from "./types";

export interface StoredStart { gameId: string; requestHash: string; intentHash: string }
export interface EntaTransaction {
  resolveIdentity(principal: Principal): Promise<{ id: string }>;
  lockWallet(principal: Principal): Promise<{ identityId: string; available: bigint; held: bigint; debt: bigint }>;
  findStart(principal: Principal, requestKey: string | null, logicalMatchId: string | null): Promise<StoredStart | null>;
  activeCatalog(principal: Principal, identityId: string): Promise<PreparedCatalog>;
  createClassic(principal: Principal, prepared: PreparedStart, catalog: PreparedCatalog): Promise<MatchRecord>;
  loadMatch(principal: Principal, gameId: string, lock: boolean): Promise<MatchRecord | null>;
  findCommand(principal: Principal, gameId: string, commandId: string): Promise<CommandReceipt | null>;
  applyCommand(principal: Principal, gameId: string, command: MatchCommand, intentHash: string, next: MatchRecord): Promise<CommandReceipt>;
  now(): Promise<number>;
  successorCatalog?(principal: Principal, identityId: string, mode: EntaMode): Promise<SuccessorCatalog>;
  createSuccessor?(principal: Principal, prepared: PreparedSuccessor, catalog: SuccessorCatalog): Promise<MatchRecord>;
  history?(principal: Principal, query: HistoryQuery): Promise<HistoryRow[]>;
}
export interface EntaRepository {
  readonly source: "postgres" | "test-only";
  readonly projectId: string;
  transaction<T>(work: (transaction: EntaTransaction) => Promise<T>): Promise<T>;
}
