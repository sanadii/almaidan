# Qolbha container comparison — 2026-11-13

Owner correction: match Qolbha's measured page/container geometry while preserving Almaidan's colors, Cairo/Instrument Sans typography, fantasy artwork, functional behavior and readable inner form widths. This supersedes the earlier fixed 1200px outer rail.

## Evidence and limits

- The owner's existing signed-in `https://golbha.com/` Chrome tab was inspected read-only using browser DOM/computed styles. It showed the same “ألعاب ثانية” and “تحديات اليوم” screen supplied in the screenshot. No game, account, payment or content action was performed.
- Measurements below use actual `window.innerWidth` CSS pixels, not screenshot pixels. The reference browser used DPR1.25 and a roughly12px scrollbar; comparisons use client width to account for other browsers' scrollbar sizes.
- The loaded public stylesheet was `https://golbha.com/build/assets/app-DVhtxvvn.css`. A read-only copy is retained under ignored `local/almaidan/qolbha-reference-layout-20261113.css`; no third-party stylesheet is shipped with Almaidan. The relevant declarations were parsed with PostCSS.
- REA's isolated browser returned Qolbha's Cloudflare security-check page. That capture is a limitation, not authenticated-site evidence. No challenge was solved or bypassed. Actual reference layout evidence comes from the already-open user tab and its loaded public stylesheet. Final Almaidan captures are recorded separately.
- The existing Qolbha Imposter entry tab was also inspected read-only: its outer main was full width, with intentionally narrower nested content (456px at root19px). This supports retaining readable login/join/prose caps rather than widening every individual panel.

## Measured reference rules

- Shared header, main and footer outer rail: `width:100%;max-width:80.063rem;margin-inline:auto;box-sizing:border-box`.
- Main itself has zero inline padding; its content wrapper adds1rem below576 CSS px and1.5rem from576 CSS px. Header/footer wrappers have the same internal padding. Almaidan may combine the two layers into a single padded border box, preserving identical outer/usable widths and avoiding repeated gutters.
- Normal UI root scale: `clamp(16px,calc(16px + (100vw - 1920px)*.014651),60px)`. Non-game layouts use at least17px from1280px and19px from1536px.
- Compact landscape rules set the reference root to14px for landscape widths<=1023px and heights>=501.5px, and12px for landscape heights<=501px.
- Almaidan adapts these **geometry** units through `--page-layout-unit`; it does not change global font size or the accepted pixel typography scale. Game-board geometry, team semantics and media ratios remain independent.

| CSS viewport, height900 | Reference client | Layout unit | Outer measured | Internal gutter | Usable content |
|---:|---:|---:|---:|---:|---:|
|320|308|16|308|16|276|
|390|378.4|16|378.4|16|346.4|
|768|756|16|756|24|708|
|1024|1012|16|1012|24|964|
|1280|1268|17|1268|25.5|1217|
|1440|1428|17|1361.06|25.5|1310.06|
|1536|1524|19|1521.19|28.5|1464.19|
|1920|1908|19|1521.19|28.5|1464.19|

Fractional layout values are browser-rounded. At a CSS viewport2048 the same reference outer rail remained1521.19px; the supplied wide screenshot must not be interpreted as a2550 CSS-pixel viewport.

## Implementation acceptance

All ordinary app/home/header/admin/Enta/Imposter rails use the shared responsive token and one internal gutter. Hero artwork remains full bleed; hero copy follows the shared rail. Auth560px, join520px, account1000px and prose760px are intentional inner maxima. Legacy nested1200px/84rem task caps must not silently constrain the widened outer frame.

The route audit calculates expected widths from the measured reference function, replacing its earlier fixed1201px assertion. Verify both themes, mobile/desktop,1280/1536 threshold changes and compact landscape. Record outer width, gutter and usable content separately. Existing functional/privacy tests remain applicable; no room creation or content mutation is needed for this correction.

## Completed local verification

- The local build and54 focused tests passed. Representative public/auth/setup/admin/game fixtures were checked at320/390/768/1024/1440/1920/2038 in both themes without document overflow. Measured desktop outer/usable widths match the table within browser rounding; no board geometry or font-size changes were required.
- `local/almaidan/qolbha-width-audit-20261113/routes-confirmed.json` records1296 route/viewport/theme observations:70 unique route patterns plus two host-mode query variants, nine widths320/390/768/1024/1280/1440/1536/1920/2550, both themes. No remaining audit failures or loading cases. Raw initial evidence is preserved in `routes.json`. Its ten homepage-width assertion false positives were caused by using root client width rather than the parent body width reserved by `scrollbar-gutter:stable`; only those cases were rerun using the corrected metric, with zero failures in `routes-filtered.json`. The confirmed report explicitly identifies the evidence source for each observation.
- In the owner's open Almaidan homepage, after a safe refresh with no entered form data, a1920 CSS-pixel viewport measured outer/header1521.193px and usable1464.193px. This matches the earlier live Qolbha1920 measurement1521.1875px/1464.1875px within0.006px. Temporary viewport overrides were cleared; no reference-site actions or account changes were made.
- `local/almaidan/rea-qolbha-container-20261113.json` retains two REA records: the reference's isolated Cloudflare check (explicit access limitation) and the updated Almaidan1920 desktop render, which completed without observed page errors. The reference's authenticated dimensions were measured in the already-open browser, not claimed as an isolated REA capture.
- Updated screenshot: `local/almaidan/qolbha-aligned-home-1920.png`. Existing readable caps, Cairo/Instrument Sans typography, palette and full-bleed fantasy hero remain intact.
