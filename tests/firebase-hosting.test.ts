import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import sharp from "sharp";

test("Firebase Hosting routes all nested app paths to the app shell", async () => {
  const config = JSON.parse(
    await readFile(resolve(process.cwd(), "firebase.json"), "utf8"),
  ) as {
    hosting?: {
      public?: string;
      rewrites?: Array<{ source: string; destination: string }>;
    };
  };
  assert.equal(config.hosting?.public, "dist");
  assert.deepEqual(config.hosting?.rewrites, [
    { source: "**", destination: "/index.html" },
  ]);
});

test("the app-shell CSP retains production Firebase/App Check origins and explicit emulator-only ports", async () => {
  const html = await readFile(resolve(process.cwd(), "index.html"), "utf8");
  const policy = /Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1] ?? "";
  for (const source of ["https://*.googleapis.com", "https://*.firebaseio.com", "https://*.cloudfunctions.net", "https://*.firebaseapp.com", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/", "https://recaptcha.google.com/recaptcha/", "http://127.0.0.1:19099", "http://127.0.0.1:18080", "http://127.0.0.1:15001", "http://127.0.0.1:19199", "media-src 'self' blob: data:"]) assert.match(policy, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
});

test("both enforced policies allow the privacy-enhanced YouTube question and episode players", async () => {
  const [html, firebaseConfig] = await Promise.all([
    readFile(resolve(process.cwd(), "index.html"), "utf8"),
    readFile(resolve(process.cwd(), "firebase.json"), "utf8"),
  ]);
  const config = JSON.parse(firebaseConfig) as {
    hosting: { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
  };
  const shellPolicy = /Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1];
  const hostingPolicy = config.hosting.headers.flatMap(entry => entry.headers)
    .find(header => header.key === "Content-Security-Policy")?.value;

  for (const policy of [shellPolicy, hostingPolicy]) {
    const frameSources = policy?.split(";").map(part => part.trim())
      .find(part => part.startsWith("frame-src "))?.split(/\s+/u).slice(1);
    assert.deepEqual(frameSources, [
      "https://*.firebaseapp.com", "https://www.google.com/recaptcha/",
      "https://recaptcha.google.com/recaptcha/", "https://www.youtube-nocookie.com",
    ]);
  }
});

test("the public share card resolves to a shipped 1200 × 630 JPEG", async () => {
  const html = await readFile("index.html", "utf8");
  const canonical = /rel="canonical" href="([^"]+)"/u.exec(html)?.[1];
  assert.ok(canonical);
  assert.equal(new URL(canonical).protocol, "https:");
  assert.equal(/property="og:url" content="([^"]+)"/u.exec(html)?.[1], canonical);
  const share = /property="og:image" content="([^"]+)"/u.exec(html)?.[1];
  assert.equal(share, new URL("/og-image.jpg", canonical).href);
  assert.equal(/name="twitter:image" content="([^"]+)"/u.exec(html)?.[1], share);
  assert.match(html, /name="twitter:card" content="summary_large_image"/u);
  const { format, width, height } = await sharp("public/og-image.jpg").metadata();
  assert.deepEqual({ format, width, height }, { format: "jpeg", width: 1200, height: 630 });
});

test("both hero formats ship the declared desktop sizes and 4:3 phone crops", async () => {
  for (const format of ["avif", "webp"]) {
    for (const [crop, width, height] of [["", 800, 450], ["", 1280, 720], ["", 1672, 941], ["-mobile", 800, 600], ["-mobile", 1280, 960]]) {
      const filename = `public/assets/backgrounds/home-games-fantasy${crop}-v2-${width}.${format}`;
      const dimensions = await sharp(filename).metadata();
      assert.deepEqual([dimensions.mediaType, dimensions.width, dimensions.height], [`image/${format}`, width, height], filename);
    }
  }
});

test("retired art and fonts stay in design evidence and out of the published tree", async () => {
  const retired = [
    "backgrounds/studio-field-light.webp", "backgrounds/home-games-fantasy-v1.webp",
    "maydan/maydan-f-social-v1-1600.avif", "topics-sprite-v1.png",
    "fonts/IBMPlexSansArabic-Regular.woff2", "fonts/Lalezar-Regular.woff2",
  ];
  const styles = await Promise.all(["src/styles/khaliah.css", "src/styles/global.css"].map(file => readFile(file, "utf8")));
  for (const path of retired) {
    await access(`design/evidence/assets/${path}`);
    await assert.rejects(access(`public/${path.startsWith("fonts/") ? "" : "assets/"}${path}`), { code: "ENOENT" });
    assert.ok(styles.every(css => !css.includes(path.split("/").at(-1)!)), path);
  }
});

test("the Arabic install manifest links real icons including an opaque maskable icon", async () => {
  const [html, manifestSource, favicon, robots] = await Promise.all([
    readFile("index.html", "utf8"), readFile("public/manifest.webmanifest", "utf8"),
    readFile("public/favicon.ico"), readFile("public/robots.txt", "utf8"),
  ]);
  const { name, short_name, lang, dir, start_url, display, background_color, theme_color, icons } = JSON.parse(manifestSource) as {
    name: string; short_name: string; lang: string; dir: string; start_url: string; display: string;
    background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.match(html, /rel="icon" href="\/favicon\.ico"/u);
  assert.deepEqual({ name, short_name, lang, dir, start_url, display }, { name: "الميدان", short_name: "الميدان", lang: "ar", dir: "rtl", start_url: "/", display: "standalone" });
  assert.match(background_color, /^#[0-9a-f]{6}$/u);
  assert.ok(html.includes(`content="${theme_color}"`));
  const maskable = icons.filter(icon => icon.purpose === "maskable");
  assert.equal(maskable.length, 1);
  assert.equal(maskable[0].sizes, "512x512");
  for (const icon of icons) {
    const file = sharp(`public${icon.src}`);
    const { width, height, mediaType } = await file.metadata();
    assert.equal(`${width}x${height}`, icon.sizes);
    assert.equal(mediaType, icon.type);
    if (icon.purpose === "maskable") assert.equal((await file.stats()).isOpaque, true);
  }
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 1);
  assert.match(robots, /^User-agent: \*\r?\nAllow: \/\s*$/u);
});

test("Cairo Latin preload points to the pinned font and Cairo has metric-matched fallbacks", async () => {
  const file = "Cairo-Latin-Variable.woff2";
  const [html, font, manifest, css, tokens] = await Promise.all([
    readFile("index.html", "utf8"), readFile(`public/fonts/${file}`), readFile("public/fonts/cairo-instrument-manifest.json", "utf8"),
    readFile("src/styles/global.css", "utf8"), readFile("design/tokens.css", "utf8"),
  ]);
  const info = (JSON.parse(manifest) as { files: { file: string; source: string; bytes: number; sha256: string }[] }).files.find(info => info.file === file);
  assert.ok(info);
  assert.match(info.source, /^https:\/\/fonts\.gstatic\.com\/s\/cairo\//u);
  assert.equal(font.subarray(0, 4).toString(), "wOF2");
  assert.equal(font.length, info.bytes);
  assert.equal(createHash("sha256").update(font).digest("hex"), info.sha256);
  assert.ok(html.includes(`rel="preload" href="/fonts/${file}" as="font"`));
  assert.match(css, /font-weight: 200 1000;[^}]+Cairo-Latin-Variable\.woff2[^}]+U\+0000-00FF/u);
  const fallbacks = [...css.matchAll(/font-family: 'Cairo Fallback(?: [^']+)?';[^}]+size-adjust: ([\d.]+)%;[^}]+ascent-override: ([\d.]+)%;[^}]+descent-override: ([\d.]+)%/gu)];
  assert.equal(fallbacks.length, 6);
  for (const fallback of fallbacks) {
    const [, size, ascent, descent] = fallback.map(Number);
    assert.ok(Math.abs(size * ascent / 100 - 130.3) < 0.02);
    assert.ok(Math.abs(size * descent / 100 - 57.1) < 0.02);
  }
  assert.match(tokens, /--font-sans: "Cairo", "Cairo Fallback", "Cairo Fallback Naskh", "Cairo Fallback Arial"/u);
});

test("Firebase Hosting sets immutable caching only on fonts and versioned assets", async () => {
  const { hosting: { headers } } = JSON.parse(await readFile("firebase.json", "utf8")) as {
    hosting: { headers: Array<{ source?: string; regex?: string; headers: Array<{ key: string; value: string }> }> };
  };
  const cached = headers.filter(rule => rule.headers.some(header => header.key === "Cache-Control"));
  for (const rule of cached) assert.ok(rule.headers.some(header => header.value === "public, max-age=31536000, immutable"));
  assert.deepEqual(cached.filter(rule => rule.source).map(rule => rule.source), ["/fonts/**"]);
  const assetPatterns = cached.flatMap(rule => rule.regex ? [new RegExp(rule.regex, "u")] : []);
  assert.equal(assetPatterns.length, 2);
  for (const path of ["/assets/backgrounds/home-games-fantasy-mobile-v2-800.avif", "/assets/games/enta-art-v1-720.webp", "/assets/index-BTN_2_ou.js", "/assets/index-w5k96KjZ.css"]) {
    assert.ok(assetPatterns.some(pattern => pattern.test(path)), path);
  }
  for (const path of ["/", "/index.html", "/og-image.jpg", "/manifest.webmanifest", "/assets/topics-sprite.png", "/assets/index.js", "/assets/index.css"]) {
    assert.ok(assetPatterns.every(pattern => !pattern.test(path)), path);
  }
});
