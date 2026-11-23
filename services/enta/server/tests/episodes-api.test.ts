import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { projectPublicEpisodes, type EpisodeReleaseReader } from "../src/episodes/public-catalog";
import { reviewedEpisodeRelease } from "../src/episodes/reviewed-release";
import type { RuntimeConfig } from "../src/runtime-config";

const config: RuntimeConfig = { environment: "test", firebaseProjectId: "episodes-test-project", namespaceId: "episodes-test-namespace", allowDevMocks: false };
const episode = { id: "episode-one", number: 1, title: "عنوان اختبار", description: "وصف عام للاختبار.", airDate: "2026-10-07" };
const release = (episodes: unknown[] = []) => ({ ...reviewedEpisodeRelease, episodes });

async function controlledApi(t: TestContext, reader?: EpisodeReleaseReader, namespaceAvailable = true) {
  const calls = { reader: 0, namespace: 0, auth: 0, identity: 0 };
  const app = createApp({
    config,
    verifyIdToken: async () => { calls.auth++; throw new Error("must not authenticate public catalogue"); },
    identityStore: {
      async assertDeploymentNamespace(namespace, project) {
        calls.namespace++;
        assert.equal(namespace, config.namespaceId);
        assert.equal(project, config.firebaseProjectId);
        if (!namespaceAvailable) throw new Error("private namespace details");
      },
      async upsertIdentity() { calls.identity++; throw new Error("unexpected identity write"); },
      async getAdminScopes() { calls.identity++; throw new Error("unexpected identity read"); },
    },
    ...(reader ? { readEpisodeRelease: async () => { calls.reader++; return reader(); } } : {}),
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { calls, request: (path = "/api/v1/episodes", options?: RequestInit) => fetch(`http://127.0.0.1:${address.port}${path}`, options) };
}

test("adopted default release is genuinely empty over HTTP, with unchanged headers", async t => {
  const api = await controlledApi(t);
  const response = await api.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { episodes: [] });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(api.calls.namespace, 1);
  assert.equal(api.calls.auth, 0);
  assert.equal(api.calls.identity, 0);
});

test("public HTTP projection is deterministic, nullable and limited to five fields", async t => {
  const rows = [{ ...episode, id: "episode-two", number: 2, description: null, airDate: null }, episode];
  const api = await controlledApi(t, async () => release(rows));
  const response = await api.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { episodes: [episode, rows[0]] });
  assert.equal(api.calls.reader, 1);
  assert.equal(api.calls.identity + api.calls.auth, 0);
  assert.equal(rows[0].number, 2, "reader input is not mutated while sorting");
});

test("namespace denial precedes release reads and JSON parsing", async t => {
  const api = await controlledApi(t, async () => { throw new Error("must not read"); }, false);
  const response = await api.request("/api/v1/episodes", { headers: { "content-type": "application/json" }, method: "POST", body: "{broken" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "SERVICE_NAMESPACE_UNAVAILABLE" });
  assert.equal(api.calls.reader, 0);
  const read = await api.request();
  assert.equal(read.status, 503);
  assert.equal(api.calls.reader, 0);
});

test("missing, unreviewed and failed readers are generic unavailable, not an empty catalogue", async t => {
  for (const reader of [async () => undefined, async () => null, async () => ({ episodes: [] }), async () => { throw new Error("private database secret"); }]) {
    const api = await controlledApi(t, reader);
    const response = await api.request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "EPISODE_CATALOG_UNAVAILABLE" });
  }
});

test("invalid release and private/media fields fail closed through the real endpoint", async t => {
  let current: unknown = release();
  const api = await controlledApi(t, async () => current);
  const invalid = [
    { ...release(), schemaVersion: "1" }, { ...release(), schemaVersion: 2 },
    { ...release(), approval: "seed" }, { ...release(), reviewedOn: "2026-02-30" },
    { ...release(), releaseId: "" }, { ...release(), privateNotes: "secret" },
    release([{ ...episode, videoUrl: "https://private.example.test/video" }]),
    release([{ ...episode, source: "private" }]), release([{ ...episode, title: 3 }]),
    release([{ ...episode, number: "1" }]), release([{ ...episode, number: 1.5 }]),
    release([{ ...episode, title: " " }]), release([{ ...episode, title: "a".repeat(161) }]),
    release([{ ...episode, description: "a".repeat(2001) }]),
    release([{ ...episode, description: "https://example.test" }]),
    release([{ ...episode, description: "javascript:alert(1)" }]),
    release([{ ...episode, description: "www.example.test" }]),
    release([{ ...episode, airDate: "2026-02-30" }]), release([{ ...episode, airDate: "2026-10-07T23:00:00Z" }]),
    release([{ ...episode, airDate: "1899-01-01" }]), release([{ ...episode, id: "../private" }]),
    release([episode, episode]), release([episode, { ...episode, id: "another" }]),
    release(Array.from({ length: 251 }, (_, index) => ({ ...episode, id: `episode-${index}`, number: index + 1 }))),
    release(Array.from({ length: 17 }, (_, index) => ({ ...episode, id: `episode-${index}`, number: index + 1, description: "a".repeat(2000) }))),
  ];
  for (const candidate of invalid) {
    current = candidate;
    const response = await api.request();
    assert.equal(response.status, 503, JSON.stringify(candidate).slice(0, 180));
    assert.deepEqual(await response.json(), { error: "EPISODE_CATALOG_UNAVAILABLE" });
  }
  current = release([{ ...episode, airDate: "2024-02-29" }]);
  assert.equal((await api.request()).status, 200, "valid leap-day calendar date");
});

test("legacy paths, detail, and all writes stay unmounted", async t => {
  const api = await controlledApi(t, async () => release([episode]));
  for (const path of ["/api/episodes", "/api/episodes/episode-one", "/api/v1/episodes/episode-one", "/api/v1/admin/episodes"]) {
    assert.equal((await api.request(path)).status, 404, path);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await api.request("/api/v1/episodes", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(episode) });
    assert.equal(response.status, 404, method);
    assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  }
  assert.equal(api.calls.reader, 0);
  assert.equal(api.calls.identity + api.calls.auth, 0);
});

test("pure projection only includes literal public text and no release metadata", () => {
  const literal = { ...episode, title: "<b>عنوان حرفي</b>", description: null };
  assert.deepEqual(projectPublicEpisodes(release([literal])), { episodes: [literal] });
});
