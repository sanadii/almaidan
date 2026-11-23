import type { PolicyRow } from "./identity-policy";
import type { LocatorRecord } from "./locator";
/** Private structured SQL denial; never inferred from an error message. */
export class ChallengeDeadlineDue extends Error { constructor() { super("CHALLENGE_DEADLINE_DUE"); } }
/** Fixed operations only. This connection is trusted server authority, not Firebase authentication. */
export interface QueryBoundary { query<T>(sql: string, params: readonly unknown[]): Promise<{ rows: T[] }> }
export interface BootstrapRepository {
  readActivePolicy(namespace: string): Promise<PolicyRow | null>;
  resolveIdentity(projectId: string, uid: string): Promise<string | null>;
  resolveLocator(namespace: string, code: string): Promise<LocatorRecord | null>;
}

import type { AuthenticatedContext } from "./identity-policy";
import type { CanonicalMember, CanonicalRoom, GameIntent } from "../../../../../functions/src/game.js";
import type { PinnedSnapshot, VerifiedCustody, CustodyPolicyRow } from "./content-reader";
export interface SealedCommandOutcome { revision: number; sequence: number; replayed: boolean; stale?: boolean }
export interface StoredCommand { intent: GameIntent; outcome: SealedCommandOutcome }
export interface CommandSnapshot { roomId: string; generation: number; memberGeneration: number; sequence: number; matchId: string; room: CanonicalRoom; members: CanonicalMember[]; actor: CanonicalMember; receipt: StoredCommand | null; previousTerminalRoom?: CanonicalRoom }
export interface CommandRepository extends BootstrapRepository {
  /** Current member/owner authorization occurs before returning even a saved receipt. */
  loadCommand(context: AuthenticatedContext, roomId: string, generation: number, intentId: string): Promise<CommandSnapshot>;
  readPinnedContent(context: AuthenticatedContext, snapshot: CommandSnapshot): Promise<PinnedSnapshot>;
  readCustodyPolicy(namespace: string): Promise<CustodyPolicyRow | null>;
  commitExpiry(context:AuthenticatedContext,snapshot:CommandSnapshot,next:CanonicalRoom,projections:Array<{uid:string;payload:ReturnType<typeof import("./projection").projectForMember>}>):Promise<SealedCommandOutcome>;
  commitChallengeExpiry(context:AuthenticatedContext,snapshot:CommandSnapshot,intent:import("./challenge").DeadlineIntent,next:CanonicalRoom,projections:Array<{uid:string;payload:ReturnType<typeof import("./projection").projectForMember>}>):Promise<SealedCommandOutcome>;
  /** Rechecks actor, generation, policy, full receipt, revision, sequence, result and pins in one transaction. */
  commitCommand(context: AuthenticatedContext, snapshot: CommandSnapshot, intent: GameIntent, next: CanonicalRoom, nextMember: CanonicalMember, targetMember: CanonicalMember | undefined, eventType: string, resultChanged: boolean, custody: VerifiedCustody | undefined, members: CanonicalMember[], projections: Array<{ uid: string; payload: ReturnType<typeof import("./projection").projectForMember> }>): Promise<SealedCommandOutcome>;
}

export interface LobbyState { schemaVersion: "huroof-lobby-v1"; room: CanonicalRoom; members: CanonicalMember[]; memberBindings: Array<{identityId:string;uid:string;generation:string;version:string}> }
export interface LobbyCreateIntent { type: "CREATE_ROOM"; intentId: string; displayName: string; config: CanonicalRoom["config"] }
export interface LobbyCreateOutcome { roomId: string; locator: string; revision: number; replayed: boolean }
export interface LobbyRepository extends BootstrapRepository {
 findCreate(context: AuthenticatedContext, intent: LobbyCreateIntent): Promise<LobbyCreateOutcome | null>;
 deriveCreateIdentity(context: AuthenticatedContext, key: string): Promise<{roomId:string;code:string}>;
 createLobby(context: AuthenticatedContext, intent: LobbyCreateIntent, state: LobbyState): Promise<LobbyCreateOutcome>;
 findLobbyReceipt(context:AuthenticatedContext,roomId:string,intent:GameIntent | import("./types").JoinIntent):Promise<LobbyOutcome|null>;
 loadLobby(context:AuthenticatedContext,roomId:string,generation:number):Promise<LobbySnapshot>;
 loadJoinLobby(context:AuthenticatedContext,roomId:string,generation:number):Promise<LobbyJoinSnapshot>;
 deriveManualIdentity(context:AuthenticatedContext,roomId:string,key:string):Promise<string>;
 commitLobby(context:AuthenticatedContext,snapshot:LobbyJoinSnapshot,intent:GameIntent | import("./types").JoinIntent,state:LobbyState):Promise<LobbyOutcome>;
}

export interface LobbySnapshot { roomId:string;generation:number;memberGeneration:number;stateHash:string;state:LobbyState;actor:CanonicalMember }
export interface PaidIds { admissionId:string;matchId:string;logicalMatchId:string }
export interface PaidOutcome { admissionId:string;matchId:string;roomId:string;status:"STARTED";state:"COMMITTED";revision:number;sequence:number;replayed:boolean }
export interface PaidRepository extends LobbyRepository, Pick<CommandRepository,"readCustodyPolicy"> {
 derivePaidIdentity(context:AuthenticatedContext,roomId:string,key:string):Promise<PaidIds>;
 findPaid(context:AuthenticatedContext,roomId:string,ids:PaidIds,client:import("./types").PaidStartDto):Promise<PaidOutcome|null>;
 loadLobby(context:AuthenticatedContext,roomId:string,generation:number):Promise<LobbySnapshot>;
 readLobbyContent(context:AuthenticatedContext,lobby:LobbySnapshot,profileScope:string):Promise<PinnedSnapshot>;
 startPaid(context:AuthenticatedContext,ids:PaidIds,intent:Record<string,unknown>,initial:Record<string,unknown>,projections:Array<{uid:string;payload:ReturnType<typeof import("./projection").projectForMember>}>):Promise<PaidOutcome>;
}

export interface LobbyOutcome { roomId:string;revision:number;replayed:boolean }
export interface LobbyJoinSnapshot { roomId:string;generation:number;stateHash:string;state:LobbyState }
