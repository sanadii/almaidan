import type { Auth } from "firebase-admin/auth";
import type { Router } from "express";
import { firebaseTokenVerifier } from "../firebase-verifier";
import { postgresCommandRepository, postgresLobbyRepository, postgresPaidRepository } from "./postgres";
import type { QueryBoundary } from "./repository";
import { createCommandService, createLobbyService, createPaidStartService, createLobbyCommandService, createProjectionService } from "./service";
import { mountHuroofCommand, mountHuroofLobby, mountHuroofStart, mountHuroofLobbyCommand, mountHuroofProjection } from "./router";
import type { CustodyEvidenceVerifier } from "./content-reader";
import { postgresRealtimeRepository } from "../realtime/postgres";
import { createJoinPreparation, createRealtimeService } from "../realtime/service";
import { mountJoinPreparation, mountRealtime } from "../realtime/router";
import { reconcileForObservation } from "./challenge";

/** Explicit factory only. The default application never constructs or mounts it. */
export function composeHuroofCommands(options: { namespace: string; projectId: string; clientProjectId: string; auth: Pick<Auth,"verifyIdToken"|"getUser"|"app">; database: QueryBoundary; router: Router; clock: () => number; custodyVerifier?: CustodyEvidenceVerifier }): Router {
 if (!options.namespace || !options.projectId || options.projectId!==options.clientProjectId || options.auth.app.options.projectId!==options.projectId) throw new Error("PROJECT_BINDING_MISMATCH");
 const repository=postgresCommandRepository(options.database);
 const realtimeRepository=postgresRealtimeRepository(options.database,repository);
 const verifier=firebaseTokenVerifier(options.projectId,options.auth);
 const identity={namespace:options.namespace,clientProjectId:options.clientProjectId,readActivePolicy:repository.readActivePolicy,verifyToken:verifier,resolveIdentity:repository.resolveIdentity};
 const lobbyRepository=postgresLobbyRepository(options.database);
 mountHuroofLobby(options.router,createLobbyService(identity,lobbyRepository));
 mountHuroofLobbyCommand(options.router,createLobbyCommandService(identity,lobbyRepository,options.clock));
 mountHuroofStart(options.router,createPaidStartService(identity,postgresPaidRepository(options.database),options.clock,options.custodyVerifier));
 mountHuroofProjection(options.router,createProjectionService(identity,repository,realtimeRepository.read,options.clock));
 mountRealtime(options.router,createRealtimeService(identity,repository,realtimeRepository,(context,roomId,generation)=>reconcileForObservation(context,roomId,generation,repository,options.clock)));
 mountJoinPreparation(options.router,createJoinPreparation(identity,lobbyRepository,options.clock));
 return mountHuroofCommand(options.router,createCommandService(identity,repository,options.clock,options.custodyVerifier));
}


