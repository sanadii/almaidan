import type { Request, Response, Router } from "express";
import type { SealedCommandOutcome } from "./repository";
export type CommandHandler = (token: string, body: unknown) => Promise<SealedCommandOutcome>;
function bearer(request: Request): string {
 const value=request.get("authorization");
 if(typeof value!=="string" || value.length>16384 || !/^Bearer [^\s]+$/.test(value)) throw new Error("AUTH_REQUIRED");
 return value.slice(7);
}
function status(error: unknown): number {
 const message=error instanceof Error ? error.message : "";
 if(message==="AUTH_REQUIRED" || message==="USER_UNAVAILABLE" || message==="FIREBASE_PROJECT_MISMATCH") return 401;
 if(message==="INVALID_REQUEST" || message==="INVALID_LOCATOR" || message==="PG_LOCATOR_REQUIRED" || message==="INVALID_COMMAND") return 400;
 if(message==="STALE_REVISION" || message==="COMMAND_INTENT_CONFLICT") return 409;
 if(message==="COMMAND_FORBIDDEN" || message==="PG_LOCATOR_UNAVAILABLE") return 403;
 return 503;
}
/** Explicitly supplied router is never mounted by default application composition. */
export function mountHuroofCommand(router: Router, command: CommandHandler): Router {
 router.post("/command", async (request: Request,response: Response) => {
  response.set("Cache-Control","no-store");
  try { const result=await command(bearer(request),request.body); response.status(200).json(result); }
  catch(error) { response.status(status(error)).json({error:"REQUEST_UNAVAILABLE"}); }
 });
 return router;
}

export function mountHuroofLobby(router: Router, create: (token: string, body: unknown) => Promise<import("./repository").LobbyCreateOutcome>): Router {
 router.post("/rooms", async (request: Request,response: Response) => {
  response.set("Cache-Control","no-store");
  try { const result=await create(bearer(request),request.body); response.status(200).json(result); }
  catch(error) { response.status(status(error)).json({error:"REQUEST_UNAVAILABLE"}); }
 });
 return router;
}

export function mountHuroofStart(router: Router, start: (token: string, body: unknown) => Promise<import("./repository").PaidOutcome>): Router {
 router.post("/start", async (request: Request,response: Response) => {
  response.set("Cache-Control","no-store");
  try { const result=await start(bearer(request),request.body); response.status(200).json(result); }
  catch(error) { response.status(status(error)).json({error:"REQUEST_UNAVAILABLE"}); }
 });
 return router;
}

export function mountHuroofLobbyCommand(router: Router, command: (token: string, body: unknown) => Promise<import("./repository").LobbyOutcome>): Router {
 router.post("/lobby-command", async (request: Request,response: Response) => {
  response.set("Cache-Control","no-store");
  try { const result=await command(bearer(request),request.body); response.status(200).json(result); }
  catch(error) { response.status(status(error)).json({error:"REQUEST_UNAVAILABLE"}); }
 });
 return router;
}

export function mountHuroofProjection(router: Router, projection: (token: string, body: unknown) => Promise<ReturnType<typeof import("./projection").projectForMember>>): Router {
 router.post("/projection", async (request: Request,response: Response) => {
  response.set("Cache-Control","no-store");
  try { const result=await projection(bearer(request),request.body); response.status(200).json(result); }
  catch(error) { response.status(status(error)).json({error:"REQUEST_UNAVAILABLE"}); }
 });
 return router;
}
