import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("media credits route gives players OpenMoji attribution, license, source and modification notice", async () => {
  const [route, app, home] = await Promise.all(["src/routes/MediaCredits.tsx", "src/app/App.tsx", "src/routes/HomeSurface.tsx"].map((path) => readFile(resolve(path), "utf8")));
  expect(route).toMatch(/اعتمادات الصور/u);
  expect(route).toMatch(/https:\/\/openmoji\.org\//u);
  expect(route).toMatch(/https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\//u);
  expect(route).toMatch(/aeb8bb3a59e2de39c754ac79180c8131c906acea/u);
  expect(route).toMatch(/حُوّلت الرسوم إلى PNG/u);
  expect(route).toMatch(/تُقص/u);
  expect(app).toMatch(/path="\/media-credits"/u);
  expect(home).toMatch(/to="\/media-credits"/u);
});
