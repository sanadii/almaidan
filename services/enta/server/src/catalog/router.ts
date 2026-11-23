import { Router } from "express";
import type { CatalogStore, HuroofReleaseReader } from "./types";
import { readPublicCatalog } from "./service";

export interface CatalogRouterDependencies {
  store: CatalogStore;
  huroofReader: HuroofReleaseReader;
  expectedFirebaseProjectId: string;
}

/** Explicit allow-list public projection. This router is intentionally unmounted in app.ts. */
export function createCatalogRouter(dependencies: CatalogRouterDependencies) {
  const router = Router();
  router.get("/", async (_request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    try {
      response.status(200).json(await readPublicCatalog(dependencies));
    } catch {
      response.status(503).json({ error: "CATALOG_UNAVAILABLE" });
    }
  });
  return router;
}
