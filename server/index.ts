import {createLocalOwnedRematch} from './local-owned-room-rematch.js';
import {localOwnerRoomAccess} from './local-owned-room-access.js';
import {createLocalOwnedRoom,LocalRoomCreationError,localVerifiedHost} from './local-owned-room-creation.js';
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { AuthoritativeGameService } from "./service.js";
import { LocalImposterService } from "./imposter-service.js";
import type { ChallengeDefinitionEnvelope } from "../src/features/game/challenges/integration.js";
import { isLocalAdminPath, isLoopbackAddress } from "./local-admin-guard.js";
import { loadLocalFirestoreQuestionSource, type LocalRuntimeQuestionSource } from "./local-firestore-question-source.js";
import { loadLocalSqliteImportQuestionSource } from "./local-sqlite-import-question-source.js";
import { currentLocalReleaseQuestionSource, retainedLocalReleaseSources, localRoomSecret, localRealChallengeDefinitions } from './local-release-question-source.js';
import {
  isTrustedImportReviewRequest,
  localImportReviewDetail,
  localImportReviewPage,
  readLocalImportReviewMedia,
} from "./local-import-review.js";

const localFirestoreMode =
  process.env.LOCAL_DB_QUESTION_SOURCE === "firestore-import";
const localSqliteImportMode =
  process.env.LOCAL_DB_QUESTION_SOURCE === "sqlite-import";
const localSavedReleaseMode = process.env.LOCAL_DB_QUESTION_SOURCE === 'saved-release';
const localImportedSourceMode = localFirestoreMode || localSqliteImportMode || localSavedReleaseMode;
const trustedLocalOrigins = new Set(
  (
    process.env.LOCAL_DB_TRUSTED_ORIGINS ??
    "http://127.0.0.1:5199,http://localhost:5199,http://127.0.0.1:8787,http://localhost:8787"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const localFirestoreSource = localFirestoreMode
  ? await loadLocalFirestoreQuestionSource({
      maxReads: Number(process.env.LOCAL_DB_MAX_QUESTION_READS ?? 1400),
    })
  : undefined;
/**
 * An explicit, local-only JSON source exists for isolated browser verification.
 * It is never selected by the product UI and requires an operator-supplied path,
 * just like the existing local challenge definition bundle.
 */
const localChallengeFixturePath = process.env.LOCAL_CHALLENGE_QUESTION_SOURCE_PATH;
const localChallengeFixtureSource: LocalRuntimeQuestionSource | undefined = localChallengeFixturePath
  ? await (async () => {
      const parsed = JSON.parse(await readFile(localChallengeFixturePath, "utf8")) as Partial<LocalRuntimeQuestionSource>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.snapshotId !== "string" || !Array.isArray(parsed.questions) || !parsed.inventory)
        throw new Error("LOCAL_CHALLENGE_QUESTION_SOURCE_INVALID");
      return parsed as LocalRuntimeQuestionSource;
    })()
  : undefined;
const localQuestionSource =
  (localSavedReleaseMode ? await currentLocalReleaseQuestionSource() : undefined) ?? localChallengeFixtureSource ??
  localFirestoreSource ??
  (localSqliteImportMode
    ? await loadLocalSqliteImportQuestionSource({
        dbPath: process.env.GAME_DB_PATH,
      })
    : undefined);
const localChallengeDefinitionPath = process.env.LOCAL_CHALLENGE_DEFINITIONS_PATH;
const localChallengeDefinitions: ChallengeDefinitionEnvelope[] = localSavedReleaseMode ? await localRealChallengeDefinitions() : localChallengeDefinitionPath
  ? await (async () => {
      const parsed = JSON.parse(await readFile(localChallengeDefinitionPath, "utf8")) as unknown;
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { definitions?: unknown }).definitions)
          ? (parsed as { definitions: unknown[] }).definitions
          : undefined;
      if (!values) throw new Error("LOCAL_CHALLENGE_DEFINITIONS_INVALID");
      return values as ChallengeDefinitionEnvelope[];
    })()
  : [];
const localChallengeMechanics = (process.env.LOCAL_CHALLENGE_ENABLED_MECHANICS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is "navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search" =>
    value === "navigation" || value === "missing_tile" || value === "memory" || value === "qatar_map" || value === "word_search",
  );
const service = new AuthoritativeGameService({
  dbPath: process.env.GAME_DB_PATH,
  ...(localChallengeDefinitions.length ? { challengeDefinitions: localChallengeDefinitions } : {}),
  ...(localChallengeMechanics.length ? { enabledChallengeMechanics: localChallengeMechanics } : {}),
  ...(localQuestionSource
    ? {
        localFirestoreQuestionSource: localQuestionSource,
        secret: localSavedReleaseMode ? await localRoomSecret() : randomUUID(),
      }
    : {}),
});
if(localSavedReleaseMode && localQuestionSource){
  // Retain the previous local snapshot for already-created rooms, then select real content for new rooms.
  service.replaceLocalQuestionSource(await loadLocalSqliteImportQuestionSource({dbPath:process.env.GAME_DB_PATH}));
  for(const retained of await retainedLocalReleaseSources())service.replaceLocalQuestionSource(retained);
  service.replaceLocalQuestionSource(localQuestionSource);
}
// Imposter rooms use an independent local store; no production admission or existing room database is modified.
const imposterService = localSavedReleaseMode && process.env.ALMAIDAN_LOCAL_ONLY === 'true' && process.env.GAME_DB_PATH
  ? new LocalImposterService(join(dirname(process.env.GAME_DB_PATH), 'imposter.sqlite'))
  : undefined;
let sqliteRefresh = Promise.resolve();
const refreshLocalQuestionSource = () => {
  if (localSavedReleaseMode) return currentLocalReleaseQuestionSource().then((source) => service.replaceLocalQuestionSource(source));
  if (!localSqliteImportMode) return;
  const refresh = sqliteRefresh.then(async () => {
    service.replaceLocalQuestionSource(
      await loadLocalSqliteImportQuestionSource({
        dbPath: process.env.GAME_DB_PATH,
      }),
    );
  });
  sqliteRefresh = refresh.catch(() => undefined);
  return refresh;
};
const json = async (
  request: import("node:http").IncomingMessage,
  maxBytes=Infinity,
): Promise<Record<string, unknown>> => {
  let body = "";
  for await (const chunk of request) {body += chunk;if(Buffer.byteLength(body)>maxBytes)throw new LocalRoomCreationError(413,'LOCAL_CREATE_REQUEST_TOO_LARGE');}
  return body ? JSON.parse(body) : {};
};
const token = (request: import("node:http").IncomingMessage): string =>
  String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
const isLoopback = (request: import("node:http").IncomingMessage) =>
  isLoopbackAddress(request.socket.remoteAddress);
const trustedLoopbackHost = (host: string | undefined) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
      new URL(`http://${host ?? ""}`).hostname,
    );
  } catch {
    return false;
  }
};
const trustedLocalDbRequest = (
  request: import("node:http").IncomingMessage,
) => {
  if (!localImportedSourceMode) return true;
  if (!isLoopback(request) || !trustedLoopbackHost(request.headers.host))
    return false;
  const origin = request.headers.origin;
  return typeof origin === "string"
    ? trustedLocalOrigins.has(origin)
    : request.headers["sec-fetch-site"] === "same-origin";
};
const server = createServer(async (request, response) => {
  try {
    const origin =
      typeof request.headers.origin === "string"
        ? request.headers.origin
        : undefined;
    const privateReadPath =
      /^\/api\/(?:admin\/questions|local-import-review)(?:\/|$)/u.test(
        request.url ?? "",
      );
    if (privateReadPath) {
      if (origin && isTrustedImportReviewRequest(request))
        response.setHeader("access-control-allow-origin", origin);
    } else if (localImportedSourceMode) {
      if (origin && trustedLocalOrigins.has(origin))
        response.setHeader("access-control-allow-origin", origin);
    } else
      response.setHeader(
        "access-control-allow-origin",
        process.env.CORS_ORIGIN ?? "*",
      );
    response.setHeader(
      "access-control-allow-headers",
      "content-type, authorization",
    );
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname.startsWith('/api/imposter/')) {
      if (!imposterService) { response.writeHead(404).end(); return; }
      if (!trustedLocalDbRequest(request)) throw new LocalRoomCreationError(403,'LOCAL_DB_ORIGIN_REQUIRED');
      if (request.method === 'POST' && url.pathname === '/api/imposter/rooms') {
        await localVerifiedHost(request.headers.authorization);
        const body=await json(request,4096);
        const value=imposterService.create(typeof body.displayName === 'string' ? body.displayName : '',body.categories);
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value)); return;
      }
      if (request.method === 'POST' && parts.length===4 && parts[2]==='resolve') {
        const value=imposterService.resolve(parts[3]);
        if (!value) { response.writeHead(404,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({error:'ROOM_NOT_FOUND'})); return; }
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value)); return;
      }
      if (request.method === 'POST' && parts.length===5 && parts[2]==='rooms') {
        const body=await json(request,8192); let value: unknown;
        if (parts[4]==='join') value=imposterService.join(parts[3],typeof body.displayName === 'string' ? body.displayName : '');
        else if (parts[4]==='resume' || parts[4]==='sync') value=imposterService.read(parts[3],token(request));
        else if (parts[4]==='intents') value=imposterService.intent(parts[3],token(request),body as never);
        else { response.writeHead(404).end(); return; }
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(value)); return;
      }
      response.writeHead(404).end(); return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: true }));
      return;
    }
    if (
      isLocalAdminPath(url.pathname) &&
      !isTrustedImportReviewRequest(request)
    )
      throw new Error("LOCAL_ADMIN_REQUEST_REQUIRED");
    if (isLocalAdminPath(url.pathname)) {
      response.removeHeader("access-control-allow-origin");
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("cross-origin-resource-policy", "same-origin");
      response.setHeader("x-content-type-options", "nosniff");
    }
    if (url.pathname.startsWith("/api/local-import-review")) {
      if (!isTrustedImportReviewRequest(request))
        throw new Error("LOCAL_IMPORT_REVIEW_REQUIRED");
      response.setHeader("cache-control", "private, no-store");
      response.setHeader("cross-origin-resource-policy", "same-origin");
      response.setHeader("x-content-type-options", "nosniff");
      if (
        request.method === "GET" &&
        url.pathname === "/api/local-import-review"
      ) {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(await localImportReviewPage(url)));
        return;
      }
      if (
        request.method === "GET" &&
        parts.length === 4 &&
        parts[2] === "entries"
      ) {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(await localImportReviewDetail(parts[3])));
        return;
      }
      if (
        request.method === "GET" &&
        parts.length === 5 &&
        parts[2] === "entries" &&
        parts[4] === "media"
      ) {
        const bytes = await readLocalImportReviewMedia(
          parts[3],
          url.searchParams.get("sha") ?? "",
        );
        response.writeHead(200, { "content-type": "image/png" }).end(bytes);
        return;
      }
      response.writeHead(404).end();
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/api/question-inventory"
    ) {
      if (!trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      await refreshLocalQuestionSource();
      const inventory = service.questionInventory();
      if (!inventory) throw new Error("LOCAL_DB_SOURCE_DISABLED");
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(JSON.stringify(inventory));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/question-inventory/coverage") {
      if (!trustedLocalDbRequest(request)) throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      const kind = url.searchParams.get("kind");
      const categories = url.searchParams.getAll("category");
      const challenge = url.searchParams.get("challenge");
      const mapPresentation = url.searchParams.get("mapPresentation") ?? "ordinary";
      if (
        (kind !== "huroof" && kind !== "categories") || categories.length > 10 ||
        categories.some((id) => !/^[A-Za-z0-9:._-]{1,128}$/.test(id)) ||
        (challenge !== null && challenge !== "1") ||
        (mapPresentation !== "ordinary" && mapPresentation !== "interactive")
      ) throw new Error("QUESTION_COVERAGE_REQUEST_INVALID");
      await refreshLocalQuestionSource();
      const sufficient = service.questionCoverage(kind, categories, challenge === "1", mapPresentation);
      if (sufficient === undefined) throw new Error("LOCAL_DB_SOURCE_DISABLED");
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ sufficient }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/challenge-availability") {
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify({ enabledMechanics: localChallengeMechanics }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/questions") {
      const payload = JSON.stringify(await service.legacyAdminQuestions());
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "admin" &&
      parts[2] === "questions"
    ) {
      const question = await service.legacyAdminQuestion(parts[3]);
      if (!question) throw new Error("QUESTION_NOT_FOUND");
      const payload = JSON.stringify(question);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/questions") {
      const payload = JSON.stringify(
        service.saveAdminDraft(await json(request)),
      );
      response
        .writeHead(201, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    const ownerAccessPath=url.pathname.match(/^\/api\/rooms\/([a-z0-9-]{6,36})\/owner-access$/i);
    if(request.method==='POST'&&ownerAccessPath&&localSavedReleaseMode){
      if(!trustedLocalDbRequest(request))throw new LocalRoomCreationError(403,'LOCAL_DB_ORIGIN_REQUIRED');
      const access=await localOwnerRoomAccess(service,request.headers.authorization,ownerAccessPath[1]);
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(access));return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rooms/history' && localSavedReleaseMode) {
      if(!trustedLocalDbRequest(request))throw new LocalRoomCreationError(403,'LOCAL_DB_ORIGIN_REQUIRED');
      const host=await localVerifiedHost(request.headers.authorization);
      const rawOffset=url.searchParams.get('offset')??'0';
      if(!/^(0|[1-9][0-9]{0,5})$/.test(rawOffset)||Number(rawOffset)>100000)throw new LocalRoomCreationError(400,'LOCAL_HISTORY_REQUEST_INVALID');
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(service.store.localOwnedHistory(host.uid,Number(rawOffset))));
      return;
    }
    if(localSavedReleaseMode&&request.method==='POST'&&parts.length===4&&parts[0]==='api'&&parts[1]==='rooms'&&parts[3]==='rematch'){
      if(!trustedLocalDbRequest(request))throw new LocalRoomCreationError(403,'LOCAL_DB_ORIGIN_REQUIRED');
      const result=await createLocalOwnedRematch(service,request.headers.authorization,typeof request.headers['x-almaidan-host-capability']==='string'?request.headers['x-almaidan-host-capability']:undefined,parts[2],await json(request,4096));
      response.writeHead(result.idempotent?200:201,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(result));return;
    }
    if(localSavedReleaseMode&&request.method==='POST'&&parts.length===4&&parts[0]==='api'&&parts[1]==='rooms'&&parts[3]==='carry-rematch'){
      if(!trustedLocalDbRequest(request))throw new LocalRoomCreationError(403,'LOCAL_DB_ORIGIN_REQUIRED');
      const authorization=request.headers.authorization;
      if(!authorization?.startsWith('Bearer '))throw new LocalRoomCreationError(403,'UNAUTHORIZED');
      const result=service.carryRematch(parts[2],authorization.slice(7));
      response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(result));return;
    }
    if (request.method === 'GET' && parts.length === 4 &&
        parts[0] === 'api' && parts[1] === 'rooms' && parts[3] === 'exists') {
      if (localImportedSourceMode && !trustedLocalDbRequest(request))
        throw new Error('LOCAL_DB_ORIGIN_REQUIRED');
      const lookup = service.store.lookupRoomCode(parts[2]);
      if (lookup.exists && lookup.finished) {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(lookup));
      } else {
        response.writeHead(lookup.exists ? 204 : 404, { 'cache-control': 'no-store' }).end();
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      if (localImportedSourceMode && !trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      await refreshLocalQuestionSource();
      const body = await json(request,localSavedReleaseMode?32768:Infinity);
      const creation=localSavedReleaseMode
        ? await createLocalOwnedRoom(service,request.headers.authorization,body)
        : service.create(typeof body.displayName === 'string'?body.displayName:undefined,body.demo===true,body);
      const payload=JSON.stringify(creation);
      response
        .writeHead('idempotent' in creation&&creation.idempotent?200:201, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "join"
    ) {
      const body = await json(request);
      const joined = await service.join(
        parts[2],
        typeof body.displayName === "string" ? body.displayName : undefined,
        body.challenge,
        body.requestKey,
      );
      broadcast(joined.roomId);
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(joined));
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "audience"
    ) {
      if (localImportedSourceMode && !trustedLocalDbRequest(request))
        throw new Error("LOCAL_DB_ORIGIN_REQUIRED");
      const room = service.store.load(parts[2]);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      const body = await json(request);
      const payload = JSON.stringify({
        roomId: room.id,
        revision: room.revision,
        token: service.createAudienceCapability(room.id, body.challenge),
      });
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "resume"
    ) {
      const resumed = service.resume(parts[2], token(request), (await json(request)).challenge);
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
        .end(JSON.stringify(resumed));
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "api" &&
      parts[1] === "rooms"
    ) {
      const offered = url.searchParams.get("challenge");
      const challenge = offered ? JSON.parse(offered) : undefined;
      service.resume(parts[2], token(request), challenge);
      const payload = JSON.stringify(service.metadata(parts[2], token(request)));
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "intents"
    ) {
      const result = await service.intent(
        parts[2],
        token(request),
        (await json(request)) as never,
      );
      broadcast(parts[2]);
      const payload = JSON.stringify(result);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(payload);
      return;
    }
    if (
      request.method === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "rooms" &&
      parts[3] === "current-question-media"
    ) {
      const payload = JSON.stringify(
        service.issueCurrentQuestionMedia(
          parts[2],
          token(request),
          await json(request),
        ),
      );
      response
        .writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        })
        .end(payload);
      return;
    }
    if (
      request.method === "GET" &&
      parts.length === 3 &&
      parts[0] === "api" &&
      parts[1] === "question-media"
    ) {
      const media = await service.readCurrentQuestionMedia(
        parts[2],
        token(request),
      );
      response
        .writeHead(200, {
          "content-type": media.contentType,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        })
        .end(media.bytes);
      return;
    }
    if (
      request.method === "GET" &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/ws"
    ) {
      const dist = join(process.cwd(), "dist");
      const requested = normalize(
        join(dist, url.pathname === "/" ? "index.html" : url.pathname),
      );
      const safe = requested.startsWith(dist)
        ? requested
        : join(dist, "index.html");
      try {
        const file = await stat(safe).then(() => safe);
        const body = await readFile(file);
        const contentType =
          extname(file) === ".js"
            ? "text/javascript"
            : extname(file) === ".css"
              ? "text/css"
              : extname(file) === ".svg"
                ? "image/svg+xml"
                : "text/html";
        response.writeHead(200, { "content-type": contentType }).end(body);
      } catch {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end(await readFile(join(dist, "index.html")));
      }
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    const code = error instanceof Error ? error.message : 'BAD_REQUEST';
    if (!response.headersSent)
      response
        .writeHead(
          error instanceof LocalRoomCreationError ? error.status : localSavedReleaseMode&&request.method==='POST'&&request.url?.split('?')[0]==='/api/rooms'?503 : code === 'ROOM_NOT_FOUND' ? 404 :
            code === 'MATCH_COMPLETE' || code === 'DUPLICATE_DISPLAY_NAME' || code === 'JOIN_REQUEST_KEY_CONFLICT' ? 409 :
            code === 'UNAUTHORIZED' || code === 'SEAT_REMOVED' ||
            String(error).includes("FORBIDDEN") ||
            String(error).includes("LOCAL_ONLY_") ||
            String(error).includes("LOCAL_ADMIN_REQUEST_REQUIRED") ||
            String(error).includes("LOCAL_IMPORT_REVIEW_REQUIRED")
            ? 403
            : 400,
          { "content-type": "application/json" },
        )
        .end(
          JSON.stringify({
            error: code,
          }),
        );
    else response.destroy(error instanceof Error ? error : undefined);
  }
});
const imposterSockets = new WebSocketServer({ noServer: true });
const imposterConnections = new Map<string, Set<{ws: import('ws').WebSocket; token: string; lastRevision: number}>>();
// Terminal failures (removed member, unknown room, forged token) end the socket with a reason the
// client can show instead of retrying forever behind a "reconnecting" banner.
const IMPOSTER_TERMINAL_CLOSE = 4403;
const endImposterSocket = (ws: import('ws').WebSocket, error: unknown) => { const code = error instanceof Error && /^[A-Z_]{3,40}$/.test(error.message) ? error.message : 'ROOM_UNAVAILABLE'; try { ws.send(JSON.stringify({ error: code })); } catch { /* socket already closing */ } ws.close(IMPOSTER_TERMINAL_CLOSE, code); };
const broadcastImposter = (roomId: string) => { for (const c of imposterConnections.get(roomId) ?? []) { try { if (c.ws.readyState===c.ws.OPEN && imposterService) { const snapshot=imposterService.read(roomId,c.token); if (snapshot.projection.revision!==c.lastRevision) { c.lastRevision=snapshot.projection.revision; c.ws.send(JSON.stringify(snapshot)); } } } catch (error) { endImposterSocket(c.ws, error); } } };
const imposterTick = setInterval(() => { for (const id of imposterConnections.keys()) broadcastImposter(id); },1000);
imposterTick.unref();
const sockets = new WebSocketServer({ noServer: true });
type Connection = {
  ws: import("ws").WebSocket;
  token: string;
  uid: string;
  role: "host" | "player" | "audience";
  challenge?: unknown;
  lastPong: number;
};
const connections = new Map<string, Set<Connection>>();
const presenceSeen = new Map<string, Map<string, number>>();
service.playerHasConnectedTransport = (roomId, uid) => [...(connections.get(roomId) ?? [])]
  .some(connection => connection.role === 'player' && connection.uid === uid && connection.ws.readyState === connection.ws.OPEN);
const broadcast = (roomId: string) => {
  // Each recipient is projected separately; one projection failure must not starve the others
  // (or turn an already-committed HTTP intent into an error response).
  for (const connection of connections.get(roomId) ?? []) {
    if (connection.ws.readyState !== connection.ws.OPEN) continue;
    try {
      connection.ws.send(JSON.stringify(service.metadata(roomId, connection.token)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      // A seat the host removed can never read the room again: tell that client and stop its socket.
      if (/^(UNAUTHORIZED|FORBIDDEN_ROLE|NOT_MEMBER|ROOM_NOT_FOUND)$/.test(reason)) {
        try { connection.ws.send(JSON.stringify({ error: 'SEAT_REMOVED' })); } catch { /* already closing */ }
        connection.ws.close(4403, 'SEAT_REMOVED');
        continue;
      }
      console.error(`ROOM_BROADCAST_FAILED ${roomId}: ${reason.slice(0, 200)}`);
    }
  }
};
const presenceSnapshot = (roomId: string, refreshId?: string) => {
  const room = service.store.load(roomId);
  if (!room)
    return {
      type: "presence",
      roomId,
      serverTime: new Date().toISOString(),
      players: {},
    };
  const connected = new Set(
    [...(connections.get(roomId) ?? [])]
      .filter(
        (connection) =>
          connection.role === "player" &&
          connection.ws.readyState === connection.ws.OPEN,
      )
      .map((connection) => connection.uid),
  );
  const seen = presenceSeen.get(roomId) ?? new Map<string, number>();
  return {
    type: "presence" as const,
    roomId,
    serverTime: new Date().toISOString(),
    ...(refreshId ? { refreshId } : {}),
    players: Object.fromEntries(
      room.members
        .filter((member) => member.role === "player")
        .map((member) => [
          member.uid,
          {
            state: connected.has(member.uid)
              ? "connected"
              : seen.has(member.uid)
                ? "disconnected"
                : "unknown",
            ...(seen.has(member.uid)
              ? { lastSeen: new Date(seen.get(member.uid)!).toISOString() }
              : {}),
          },
        ]),
    ),
  };
};
const broadcastPresence = (roomId: string) => {
  const message = JSON.stringify(presenceSnapshot(roomId));
  for (const connection of connections.get(roomId) ?? [])
    if (
      connection.role === "host" &&
      connection.ws.readyState === connection.ws.OPEN
    )
      connection.ws.send(message);
};
service.onRoomChanged = (roomId) => broadcast(roomId);
let gameTickRunning = false;
const gameTick = setInterval(() => {
  // Never overlap ticks, and never let a rejected tick become an unhandled rejection.
  if (gameTickRunning) return;
  gameTickRunning = true;
  void service.tick()
    .then((ids) => ids.forEach(broadcast))
    .catch((error: unknown) => console.error(`GAME_TICK_FAILED: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`))
    .finally(() => { gameTickRunning = false; });
}, 250);
gameTick.unref();
const presenceTick = setInterval(() => {
  const current = Date.now();
  for (const [roomId, roomConnections] of connections) {
    for (const connection of roomConnections) {
      if (current - connection.lastPong > 45_000) connection.ws.terminate();
      else if (connection.ws.readyState === connection.ws.OPEN)
        connection.ws.ping();
    }
    broadcastPresence(roomId);
  }
}, 15_000);
presenceTick.unref();
server.on("upgrade", (request, socket, head) => {
  // A malformed Host header or token must close this socket, never throw out of the listener.
  socket.on("error", () => socket.destroy());
  try { handleUpgrade(request, socket, head); } catch { socket.destroy(); }
});
function handleUpgrade(request: import("node:http").IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) {
  if(localImportedSourceMode && !trustedLocalDbRequest(request)){socket.destroy();return;}
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === '/ws/imposter') {
    if (!imposterService) return socket.destroy();
    const id=url.searchParams.get('roomId') ?? '', capability=url.searchParams.get('token') ?? '';
    let initial: ReturnType<NonNullable<typeof imposterService>['read']>;
    try { initial=imposterService.read(id,capability); } catch (error) { imposterSockets.handleUpgrade(request,socket,head,ws=>{ ws.on('error',()=>ws.terminate()); endImposterSocket(ws,error); }); return; }
    imposterSockets.handleUpgrade(request,socket,head,ws=> { ws.on('error',()=>ws.terminate()); const item={ws,token:capability,lastRevision:initial.projection.revision}; const group=imposterConnections.get(id) ?? new Set(); group.add(item); imposterConnections.set(id,group); ws.send(JSON.stringify(initial)); ws.on('close',()=>{group.delete(item); if (!group.size) imposterConnections.delete(id);}); });
    return;
  }
  if (url.pathname !== "/ws") return socket.destroy();
  const roomId = url.searchParams.get("roomId") ?? "";
  const capabilityToken = url.searchParams.get("token") ?? "";
  const capability = service.verify(capabilityToken);
  if (!capability || capability.roomId !== roomId) return socket.destroy();
  let actor: { uid: string; role: "host" | "player" | "audience" };
  let challenge: unknown;
  try {
    const offered = url.searchParams.get("challenge");
    if (offered) challenge = JSON.parse(offered);
    service.resume(roomId, capabilityToken, challenge);
    actor = service.presenceActor(roomId, capabilityToken);
  } catch {
    return socket.destroy();
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    // An unhandled 'error' event (oversized frame, protocol error) would otherwise crash the process.
    ws.on("error", () => ws.terminate());
    const connection: Connection = {
      ws,
      token: capabilityToken,
      ...actor,
      challenge,
      lastPong: Date.now(),
    };
    const roomConnections = connections.get(roomId) ?? new Set<Connection>();
    roomConnections.add(connection);
    connections.set(roomId, roomConnections);
    if (actor.role === "player") {
      service.playerTransportObserved(roomId, actor.uid);
      const seen = presenceSeen.get(roomId) ?? new Map<string, number>();
      seen.set(actor.uid, Date.now());
      presenceSeen.set(roomId, seen);
    }
    ws.send(JSON.stringify(service.metadata(roomId, capabilityToken)));
    if (actor.role === "host")
      ws.send(JSON.stringify(presenceSnapshot(roomId)));
    else broadcastPresence(roomId);
    ws.on("pong", () => {
      connection.lastPong = Date.now();
      if (actor.role === "player")
        presenceSeen.get(roomId)?.set(actor.uid, connection.lastPong);
    });
    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw)) as Record<string, unknown>;
        if (message.type === "presence-refresh") {
          if (
            actor.role === "host" &&
            typeof message.refreshId === "string" &&
            message.refreshId.length <= 128
          )
            ws.send(
              JSON.stringify(presenceSnapshot(roomId, message.refreshId)),
            );
          return;
        }
        await service.intent(roomId, capabilityToken, message as never);
        broadcast(roomId);
      } catch (error) {
        ws.send(
          JSON.stringify({
            error: error instanceof Error ? error.message : "BAD_REQUEST",
          }),
        );
      }
    });
    ws.on("close", () => {
      roomConnections.delete(connection);
      if (actor.role === "player")
        presenceSeen.get(roomId)?.set(actor.uid, Date.now());
      if (roomConnections.size === 0) {
        connections.delete(roomId);
        presenceSeen.delete(roomId);
      }
      broadcastPresence(roomId);
    });
  });
}
const port = Number(process.env.PORT ?? 8787);
const host = process.env.GAME_HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  const address = server.address();
  console.log(`Huroof local authority listening on ${host}:${typeof address === 'object' && address ? address.port : port}`);
});
const close = () => {
  clearInterval(imposterTick);
  imposterSockets.clients.forEach(client => client.close());
  imposterConnections.clear();
  clearInterval(gameTick);
  clearInterval(presenceTick);
  sockets.clients.forEach((client) => client.close());
  connections.clear();
  presenceSeen.clear();
  server.close(() => { service.close(); imposterService?.close(); });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
