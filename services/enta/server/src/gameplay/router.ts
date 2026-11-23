import { Router, type Request, type RequestHandler } from "express";
import type { Principal } from "../identity";
import type { EntaService } from "./service";
import { EntaError } from "./types";

type OwnerRequest = Request & { principal?: Principal };
export function createEntaRouter(service: EntaService, authentication: RequestHandler): Router {
  const router = Router();
  router.use(authentication);
  const handle = (work: (request: OwnerRequest) => Promise<unknown>, created = false): RequestHandler => async (request, response) => {
    try {
      const data = await work(request as OwnerRequest);
      response.status(created && !(data as { idempotent?: boolean }).idempotent ? 201 : 200).json(data);
    } catch (error) {
      if (error instanceof EntaError) response.status(error.status).json({ error: error.code });
      else response.status(503).json({ error: "ENTA_UNAVAILABLE" });
    }
  };
  router.get("/catalog", handle(request => service.catalog(request.principal!)));
  router.get("/catalog/kids", handle(request => service.kidsCatalog(request.principal!)));
  router.post("/matches/classic", handle(request => service.start(request.principal!, request.body), true));
  router.post("/matches/kids", handle(request => service.startKids(request.principal!, request.body), true));
  router.get("/matches/history", handle(request => service.history(request.principal!, request.query)));
  router.get("/matches/:id/rematch-setup", handle(request => service.rematchSetup(request.principal!, request.params.id)));
  router.post("/matches/:id/rematch", handle(request => service.rematch(request.principal!, request.params.id, request.body), true));
  router.get("/matches/:id", handle(request => service.get(request.principal!, request.params.id)));
  router.post("/matches/:id/commands", handle(request => service.command(request.principal!, request.params.id, request.body)));
  return router;
}
