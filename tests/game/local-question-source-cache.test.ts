import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheLocalQuestionSource } from "../../server/local-question-source-cache.js";

test("the local release cache reloads only after the overlay changes and shares concurrent reloads", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "huroof-source-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const overlay = join(directory, "overlays.json");
  const temporary = join(directory, "overlays.tmp");
  let loads = 0;
  const load = cacheLocalQuestionSource([overlay], async () => {
    loads += 1;
    try {
      return { revision: JSON.parse(await readFile(overlay, "utf8")) as number };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: 0 };
      throw error;
    }
  });
  const publish = async (body: string) => {
    await writeFile(temporary, body);
    await rename(temporary, overlay);
  };

  const baseline = await load();
  assert.equal(await load(), baseline);
  assert.equal(loads, 1);
  await publish("1");
  const [first, concurrent] = await Promise.all([load(), load()]);
  assert.equal(first.revision, 1);
  assert.equal(concurrent, first);
  assert.equal(loads, 2);
  await publish("2");
  assert.equal((await load()).revision, 2);
  assert.equal(loads, 3);

  await publish("broken");
  await assert.rejects(load(), SyntaxError);
  await assert.rejects(load(), SyntaxError);
  assert.equal(loads, 5);
  await rm(overlay);
  assert.equal((await load()).revision, 0);
});
