import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import handler, { restoreOriginalApiUrl } from "../../../../api/index.js";

test("Vercel API rewrite restores the original path and preserves ordinary query parameters", () => {
  const restored = restoreOriginalApiUrl(
    "/api/index?__api_path=v1%2Fhealth&path=caller-one&path=caller-two&query=two+words&tag=first&tag=second",
  );
  assert.ok(restored);
  const parsed = new URL(restored, "http://vercel.invalid");
  assert.equal(parsed.pathname, "/api/v1/health");
  assert.deepEqual(parsed.searchParams.getAll("path"), ["caller-one", "caller-two"]);
  assert.equal(parsed.searchParams.get("query"), "two words");
  assert.deepEqual(parsed.searchParams.getAll("tag"), ["first", "second"]);
});

test("Vercel-preserved original API path is validated and its original query is kept byte-for-byte", () => {
  const original = "/api/v1/health?probe=alpha&probe=beta&path=caller-value";
  assert.equal(restoreOriginalApiUrl(original), original);
});

test("Vercel API path restoration rejects wrong entrypoint, empty, duplicated, and ambiguous captures", () => {
  for (const url of [
    "/api/index?__api_path=",
    "/api/index?__api_path=v1/health&__api_path=auth/login",
    "/api/index?__api_path=v1/%2e%2e/auth/login",
    "/api/index?__api_path=v1/%5cadmin",
    "/api/index?__api_path=v1%252Fhealth",
    "/api/index?__api_path=../auth/login",
    "/api/index?__api_path=%2Fapi/v1/health",
    "/api/v1/%2e%2e/auth/login",
    "/api/v1/%2Fauth/login",
    "/api/v1/../auth/login",
    "/api/index?probe=only",
    "/dashboard",
  ]) {
    assert.equal(restoreOriginalApiUrl(url), undefined, url);
  }
});

test("handler returns uncached, nosniff JSON for an unrecognized function URL", () => {
  const headers = new Map<string, string>();
  let body = "";
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value: string) { body = value; },
  } as unknown as ServerResponse;
  handler({ url: "/not-an-api-path" } as IncomingMessage & { url: string }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(headers.get("cache-control"), "no-store");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(JSON.parse(body), { error: "NOT_FOUND" });
});

test("Vercel rewrite uses an unnamed path capture so it cannot add a synthetic path query", async () => {
  const config = JSON.parse(await readFile(new URL("../../../../vercel.json", import.meta.url), "utf8"));

  assert.deepEqual(config.rewrites[0], {
    source: "/api/(.*)",
    destination: "/api/index?__api_path=$1",
  });
  assert.equal(config.rewrites.at(-1).destination, "/index.html");
});
