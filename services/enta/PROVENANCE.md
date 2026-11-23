# Enta backend provenance

The Express/Prisma backend source in `server/` was copied from the pinned Git
checkout `D:/projects/EntaSa7-git`, commit
`a009328442c7469937b073b6a8fe3ce4ce115160` (2026-10-01). The source checkout
was clean at that commit when copied. The schema and existing Prisma migration
history are preserved as imported; the additive Firebase identity migration is
new and has not been applied to any database.

The import includes the pinned `server/src/` source tree, Vercel adapter,
package/runtime manifests, Prisma schema, and existing migration SQL. It omits
`node_modules`, environment files/secrets, generated Prisma clients/build
output, `prisma/seed.ts`, `prisma/data/`, `prisma/import-data/`, uploads, and the
top-level assets directory. Legacy Enta route source remains for provenance,
but the combined app does not import or mount it; `/api/*` is handled by the
new Vercel function and only `/api/v1/*` is implemented.

The Huroof development proxy sends `/api/v1` to the isolated Enta API port
4001. Other `/api` requests continue to the existing Huroof local authority on
port 8787. Vercel's filesystem function `api/[...path].ts` takes `/api/*`
before the final SPA rewrite, and returns JSON 404 for every unimplemented or
legacy route. No Firebase Hosting rewrite was changed. Deploy only with new
Firebase/PostgreSQL/payment configuration; the new identity migration requires
separate review and has not been applied.
