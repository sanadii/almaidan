import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("media credits route gives players OpenMoji attribution, license, source and modification notice", async () => {
  const [route, app, home,footer] = await Promise.all(["src/routes/MediaCredits.tsx", "src/app/App.tsx", "src/routes/HomeSurface.tsx","src/design-system/PublicFooter.tsx"].map((path) => readFile(resolve(path), "utf8")));
  expect(route).toMatch(/اعتمادات الخطوط والصور/u);
  expect(route).toMatch(/https:\/\/openmoji\.org\//u);
  expect(route).toMatch(/https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\//u);
  expect(route).toMatch(/aeb8bb3a59e2de39c754ac79180c8131c906acea/u);
  expect(route).toMatch(/حُوّلت الرسوم إلى PNG/u);
  expect(route).toMatch(/تُقص/u);
  expect(app).toMatch(/path="\/media-credits"/u);
  expect(home).toMatch(/<PublicFooter home/u);
  expect(footer).toMatch(/to="\/media-credits">اعتمادات الخطوط والصور/u);
});

it("records the shipped fonts, artwork and question media in named lists", async () => {
  const [route, cairoLicense, instrumentLicense] = await Promise.all(["src/routes/MediaCredits.tsx", "public/fonts/Cairo-OFL.txt", "public/fonts/InstrumentSans-OFL.txt"].map((path) => readFile(resolve(path), "utf8")));
  for (const id of ["fonts", "illustrations", "questions"]) expect(route).toContain(`<ul aria-labelledby="media-credits-${id}">`);
  expect(route).toMatch(/Cairo<\/bdi>.*href="\/fonts\/Cairo-OFL\.txt" rel="license"/u);
  expect(route).toMatch(/Instrument Sans<\/bdi>.*href="\/fonts\/InstrumentSans-OFL\.txt" rel="license"/u);
  expect(cairoLicense).toMatch(/The Cairo Project Authors.+\s+This Font Software is licensed under the SIL Open Font License, Version 1\.1/u);
  expect(instrumentLicense).toMatch(/The Instrument Sans Project Authors.+\s+This Font Software is licensed under the SIL Open Font License, Version 1\.1/u);
  expect(route).toMatch(/الخلية وإنت صح والدخيل ورسوم طرق اللعب في إنت صح/u);
  expect(route).toContain('www.metmuseum.org/hubs/open-access');
  expect(route).toContain('www.clevelandart.org/open-access');
});
