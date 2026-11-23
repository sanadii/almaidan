import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { PrismaClient } from "@prisma/client";
import { createInMemoryIdentityStore, createPrismaIdentityStore, localMockVerifier, principalFromClaims, type FirebaseClaims, type IdTokenVerifier, type IdentityStore, type Principal } from "./identity";
import { firebaseAdminVerifier } from "./firebase-verifier";
import { loadRuntimeConfig, type RuntimeConfig } from "./runtime-config";
import { projectPublicEpisodes, readReviewedEpisodeRelease, type EpisodeReleaseReader } from "./episodes/public-catalog";
import { createEntaService, hostedGameplayRuntime, type EntaService } from "./gameplay/service";
import { postgresEntaRepository } from "./gameplay/postgres";
import { createEntaRouter } from "./gameplay/router";
import { createRoundService, type RoundService } from './rounds/service';
import { postgresRoundRepository } from './rounds/postgres';
import { createRoundCapabilityRouter, createRoundOwnerRouter } from './rounds/router';
import { assertByteReader, firebasePinnedByteReader, type PinnedByteReader } from './rounds/media';
import { createCompetitionService, type CompetitionService } from './rounds/competition-service';
import { postgresCompetitionRepository } from './rounds/competition-postgres';
import { createCompetitionCapabilityRouter, createCompetitionOwnerRouter } from './rounds/competition-router';
import { createHistoryRouter, type HistoryHandlers } from './history-rematch/history-router';
import {createFavoritesRouter} from './favorites/router';
import type {FavoritesService} from './favorites/service';
import { isCapacityHttpIngress } from './history-rematch/capacity-ingress';
import { protectedPlayRouteGate, protectedPlayUnavailable } from './huroof-pg/selection-contract';

export interface AppDependencies {
  config: RuntimeConfig;
  verifyIdToken: IdTokenVerifier;
  identityStore: IdentityStore;
  readEpisodeRelease?: EpisodeReleaseReader;
  entaService?: EntaService;
  roundService?: RoundService;
  competitionService?: CompetitionService;
  mediaReader?: PinnedByteReader;
  historyHandlers?: HistoryHandlers;
  favoritesService?: FavoritesService;
  /** Explicit, qualified supervisor route; omitted by all ordinary factories. */
  capacityIngress?: RequestHandler;
  huroofHistory?: { page(token: string, input: unknown): Promise<unknown>; result(token: string, matchId: string, version: string): Promise<unknown> };
}

interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

function defaultDependencies(config: RuntimeConfig): AppDependencies {
  const prisma = new PrismaClient({
    ...(config.databaseUrl ? { datasourceUrl: config.databaseUrl } : {}),
  });
  return {
    config,
    verifyIdToken: config.allowDevMocks ? localMockVerifier(config) : firebaseAdminVerifier(config.firebaseProjectId),
    identityStore: config.databaseUrl
      ? createPrismaIdentityStore(prisma)
      : config.allowDevMocks
        ? createInMemoryIdentityStore(config.namespaceId, config.firebaseProjectId)
        : (() => { throw new Error("DATABASE_URL is required unless isolated development mocks are explicitly enabled"); })(),
    entaService: createEntaService(postgresEntaRepository(prisma, config)),
    roundService: createRoundService(postgresRoundRepository(prisma, config)),
    competitionService: createCompetitionService(postgresCompetitionRepository(prisma, config)),
  };
}

function authenticate(dependencies: AppDependencies) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.get("authorization");
    if (!header?.startsWith("Bearer ")) {
      response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }
    try {
      const claims: FirebaseClaims = await dependencies.verifyIdToken(header.slice(7));
      request.principal = principalFromClaims(claims, dependencies.config.firebaseProjectId);
      next();
    } catch {
      response.status(401).json({ error: "INVALID_ID_TOKEN" });
    }
  };
}

export function createApp(dependencies: AppDependencies = defaultDependencies(loadRuntimeConfig())) {
  if (dependencies.competitionService?.source === 'local-development' || dependencies.roundService?.source === 'local-development') throw new Error('LOCAL_SERVICE_REQUIRES_STANDALONE_ENTRY');
  if (dependencies.entaService?.source === "test-only" && (dependencies.config.environment !== "test" || hostedGameplayRuntime())) throw new Error("TEST_GAMEPLAY_FORBIDDEN");
  if (dependencies.roundService?.source === 'test-only' && (dependencies.config.environment !== 'test' || hostedGameplayRuntime())) throw new Error('TEST_GAMEPLAY_FORBIDDEN');
  if (dependencies.competitionService?.source === 'test-only' && (dependencies.config.environment !== 'test' || hostedGameplayRuntime())) throw new Error('TEST_GAMEPLAY_FORBIDDEN');
  const mediaReader = dependencies.mediaReader ?? firebasePinnedByteReader(dependencies.config.firebaseProjectId, process.env.ENTA_PRIVATE_MEDIA_BUCKET ?? null);
  assertByteReader(mediaReader, dependencies.config.environment === 'test');
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    next();
  });
  // Namespace verification runs before JSON parsing or any API route, including
  // health. An unprovisioned or misdirected database cannot serve the API.
  app.use("/api/v1", async (_request, response, next) => {
    try {
      await dependencies.identityStore.assertDeploymentNamespace(
        dependencies.config.namespaceId,
        dependencies.config.firebaseProjectId,
      );
      next();
    } catch {
      response.status(503).json({ error: "SERVICE_NAMESPACE_UNAVAILABLE" });
    }
  });
  // The reserved ordinary-play surface is bounded before the shared parser.
  // Unknown paths and methods cannot fall through to body parsing.
  app.use('/api/v1/huroof-play', protectedPlayRouteGate);
  // The ordinary-play admission channel is not connected yet. Keep this
  // reserved surface closed until the real channel is integrated above it.
  app.use('/api/v1/huroof-play', protectedPlayUnavailable);
  if (dependencies.capacityIngress) {
    if (!isCapacityHttpIngress(dependencies.capacityIngress)) throw new Error("CAPACITY_INGRESS_INVALID");
    app.use("/api/v1", dependencies.capacityIngress);
  }
  app.use(express.json({ limit: "32kb" }));

  const api = express.Router();
  api.get("/health", (_request, response) => {
    response.status(200).json({ ok: true, service: "enta", apiVersion: 1 });
  });

  api.get("/episodes", async (_request, response) => {
    try {
      const release = await (dependencies.readEpisodeRelease ?? readReviewedEpisodeRelease)();
      response.status(200).json(projectPublicEpisodes(release));
    } catch {
      response.status(503).json({ error: "EPISODE_CATALOG_UNAVAILABLE" });
    }
  });

  api.get('/huroof/history', async (request, response) => {
    const header=request.get('authorization');
    if (!header?.startsWith('Bearer ')) { response.status(401).json({error:'AUTHENTICATION_REQUIRED'}); return; }
    if (!dependencies.huroofHistory) { response.status(503).json({error:'HISTORY_UNAVAILABLE'}); return; }
    const q=request.query;
    if (Object.keys(q).some(k=>!['limit','cursor'].includes(k)) || (q.limit !== undefined && (typeof q.limit!=='string' || !/^(?:[1-9]|[1-4][0-9]|50)$/.test(q.limit))) || (q.cursor !== undefined && typeof q.cursor!=='string')) { response.status(400).json({error:'INVALID_HISTORY_QUERY'}); return; }
    try { response.status(200).json(await dependencies.huroofHistory.page(header.slice(7),{limit:q.limit===undefined?25:Number(q.limit),cursor:q.cursor??null})); }
    catch { response.status(503).json({error:'HISTORY_UNAVAILABLE'}); }
  });
  api.get('/huroof/matches/:id/results/:version', async (request,response) => {
    const header=request.get('authorization');
    if (!header?.startsWith('Bearer ')) { response.status(401).json({error:'AUTHENTICATION_REQUIRED'}); return; }
    if (!dependencies.huroofHistory) { response.status(503).json({error:'RESULT_UNAVAILABLE'}); return; }
    try { response.status(200).json(await dependencies.huroofHistory.result(header.slice(7),request.params.id,request.params.version)); }
    catch { response.status(503).json({error:'RESULT_UNAVAILABLE'}); }
  });

  const entaService = dependencies.entaService ?? createEntaService(postgresEntaRepository(new PrismaClient({ ...(dependencies.config.databaseUrl ? { datasourceUrl: dependencies.config.databaseUrl } : {}) }), dependencies.config));
  const roundService = dependencies.roundService ?? createRoundService(postgresRoundRepository(new PrismaClient({ ...(dependencies.config.databaseUrl ? { datasourceUrl: dependencies.config.databaseUrl } : {}) }), dependencies.config));
  const competitionService = dependencies.competitionService ?? createCompetitionService(postgresCompetitionRepository(new PrismaClient({ ...(dependencies.config.databaseUrl ? { datasourceUrl: dependencies.config.databaseUrl } : {}) }), dependencies.config));
  api.use('/account/favorites',createFavoritesRouter(authenticate(dependencies),dependencies.favoritesService));
  api.use('/enta', createHistoryRouter(authenticate(dependencies), dependencies.historyHandlers));
  api.use('/enta/competition/capability', createCompetitionCapabilityRouter(competitionService, mediaReader));
  api.use('/enta/competition', createCompetitionOwnerRouter(competitionService, authenticate(dependencies), mediaReader));
  api.use('/enta/capability', createRoundCapabilityRouter(roundService, mediaReader));
  api.use('/enta', createRoundOwnerRouter(roundService, authenticate(dependencies), mediaReader));
  api.use("/enta", createEntaRouter(entaService, authenticate(dependencies)));

  api.get("/account", authenticate(dependencies), async (request: AuthenticatedRequest, response, next) => {
    try {
      const principal = request.principal!;
      const adminScopes = principal.verifiedAccount
        ? await dependencies.identityStore.getAdminScopes(principal.projectId, principal.uid)
        : [];
      response.status(200).json({
        uid: principal.uid,
        projectId: principal.projectId,
        account: principal.verifiedAccount ? "verified" : principal.anonymous ? "anonymous" : "unverified",
        capabilities: {
          canJoin: true,
          canHost: principal.verifiedAccount,
          canClaimFreeGrant: principal.verifiedAccount,
          canCheckout: principal.verifiedAccount,
          adminScopes,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  api.post("/account", authenticate(dependencies), async (request: AuthenticatedRequest, response, next) => {
    try {
      const principal = request.principal!;
      if (!principal.verifiedAccount) {
        response.status(403).json({ error: "VERIFIED_ACCOUNT_REQUIRED" });
        return;
      }
      // Prisma's composite-unique upsert gives concurrent first-login requests
      // one row per (new Firebase project, UID) without client-selected IDs.
      // This registers only the Firebase identity. Linking the legacy Enta User
      // row and its balance belongs to the reviewed wallet/account milestone,
      // before any game or commerce route is mounted.
      await dependencies.identityStore.upsertIdentity(principal.projectId, principal.uid);
      response.status(200).json({ uid: principal.uid, projectId: principal.projectId, identityRegistered: true });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/v1", api);
  // Every unimplemented legacy Enta or Huroof route is a JSON 404. This API
  // handler never mounts shared-code/JWT auth, guest credit, game, answer,
  // payment, or admin routers.
  app.use((_request, response) => response.status(404).json({ error: "NOT_FOUND" }));
  app.use((error: Error, _request: Request, response: Response, next: NextFunction) => {
    void next;
    const status = error.message === "VERIFIED_ACCOUNT_REQUIRED" ? 403 : 500;
    response.status(status).json({ error: status === 403 ? error.message : "INTERNAL_ERROR" });
  });
  return app;
}

