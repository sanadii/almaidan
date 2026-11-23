# INT-032.I — Root technical review — 2026-10-04

Implementation complete, live human review pending. No aesthetic approval is asserted.

Changed HomeSurface.tsx (passive scroll state/cleanup), homepage-only khaliah.css (transparent top header, compact utilities, readable scrolled surface, translucent photographic dark wash, soft top contrast wash and lighter dark-theme pink headline), DESIGN-DNA and canonical plan/evidence. Existing family assets unchanged.

Root visually inspected light/dark desktop and320pxmobile. The right side now shows room texture rather than a near-solid black column. Header floats over photo at top; it gains a quiet translucent backdrop after24pxscroll. RTL wordmark/utilities remain aligned to shared rail. All utility targets and wordmark retain44pxheight; mobile controls stay on one line.

Verification:19 focused UI tests passed; app TypeScript, scoped ESLint and frontend Vite build passed.84/84 pixel contrast roles passed across six viewport/theme cases; reduced motion used. Existing bundle-size warning remains. The first contrast trial failed for header sign-in and dark pink emphasis; continuous top fade/lighter dark emphasis corrected these and final rerun passed. No unresolved check failure.

Responsive geometry unchanged:1280x720 hero717.56px/phone707.46px;1440x768 hero734.36px/phone724.47px;1536x915 hero838.52px/phone821.81px.320/390mobile stays naturally stacked. No overflow;13regions retained. Root replayed join anchor: room-code focus at203.58px below84pxstickyheader; header scrolled class applied. Theme radio works; original system preference/viewport restored.

Preservation:10backend files,EntryRoute,raw CSS outside homepage,category/host logic and761prior frozen asset/evidence entries unchanged. Earlier H outputs also checked against H manifest; only intentionally mutable current source/DNA differs. No new assets/dependency/backend/other-route changes; no deployment or commit.

Rollback: inspect intervening changes, then restore I-owned source from output/int3i-baseline-20261004. All historical authorities remain immutable. Owner feedback0024 rejects H appearance; I4liveapproval remains open and other-screen expansion stays closed.

Usage: one root session; no delegated sessions. Host token telemetry unavailable. Original ETA15–25minutes; actual approximately9minutes.
