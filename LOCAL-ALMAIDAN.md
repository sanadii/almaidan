# Almaidan on this computer

Development: [http://127.0.0.1:5174/](http://127.0.0.1:5174/). Isolated optimized preview: [http://127.0.0.1:5175/](http://127.0.0.1:5175/).

The 2026-11-05 acceptance completed the game journeys, original video playback and representative light/dark browser checks using Chrome. See [the gameplay acceptance report](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/LOCAL-ACCEPTANCE-2026-11-05.md) for evidence and bounded coverage. The 2026-11-06 continuation extends local admin revision editing; its new publication checks are separate from the accepted gameplay matrix. Run the launcher below after a computer restart; documentation is not a live service-health check.

## Start and restart

Docker Desktop must be running. Start or reuse the existing isolated stack:

```powershell
& 'D:\projects\huroof_wa_oloof\scripts\start-local-almaidan-all.ps1'
```

The launcher checks the exact container, storage mount, loopback listeners and service identities, then waits for readiness. It does not reset the database. It **reuses already-running processes**, so this alone does not load new backend source. The local API creates its additive development tables when needed; production schemas are not used.

To load changed backend source, restart only the two verified local backend processes, then rerun the launcher. This leaves the Auth Emulator and its current accounts running:

```powershell
$localBackends = @(
  @{ Port = 18787; Pattern = 'D:\\projects\\huroof_wa_oloof\\server\\index\.ts' },
  @{ Port = 14001; Pattern = 'local-development.main.ts' }
)
foreach ($backend in $localBackends) {
  $listener = @(Get-NetTCPConnection -State Listen -LocalPort $backend.Port -ErrorAction SilentlyContinue)
  if ($listener.Count -eq 0) { continue }
  if ($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1') { throw 'Unexpected backend listener; leave it running' }
  $localProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
  if ($localProcess.CommandLine -notmatch $backend.Pattern) { throw 'Unexpected process; leave it running' }
  Stop-Process -Id $localProcess.ProcessId
}
& 'D:\projects\huroof_wa_oloof\scripts\start-local-almaidan-all.ps1'
```

A restart can interrupt active requests: keep their pending request keys and retry to recover the original operation. Do not reset databases, delete state or clear browser storage. Preserve signing/encryption keys, content overlays and overlay history. Auth Emulator shutdown should be graceful so its `--export-on-exit` saves new accounts; the launcher imports the existing export next time.

The narrowly scoped backend restarts were accepted normally on 2026-11-05; no execution restriction was bypassed. The current acceptance report records the subsequent runtime checks.

## Accounts and local content administration

Existing local player login: `host@almaidan.test` / `AlmaidanLocal2026!`. This Auth Emulator account has no production or payment authority. Sign in when required; browser sign-in state is not assumed. Saved-release Huroof hosting requires a verified local account; guests still join by name/room code.

Open [local administration](http://127.0.0.1:5174/local-admin). Its separate admin credentials are in `D:\projects\huroof_wa_oloof\local\almaidan\admin-identity.private.json`. Read them privately; do not copy them into logs, issues or this document. The admin uses its own in-memory browser session and does not replace the player session. Refreshing requires admin sign-in again; normal players and guests cannot administer content.

1. Search categories/questions and edit existing text, authored formats, verified local media bindings and challenge definitions. Challenge JSON is validated against its existing mechanic; original IDs, fixed authored point tiers and item metadata remain preserved. New uploads and arbitrary new categories are outside this editor.
2. Save an immutable draft, inspect it, and approve its review.
3. Activate it for new games. Concurrent changes require refreshing the selected item, rather than silently replacing a newer head.
4. Use **Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø§Ù„Ù…ØµØ¯Ø± Ø§Ù„Ø£ØµÙ„ÙŠ** to restore original content for future games while preserving the revision history.

The original saved source file is never rewritten. PostgreSQL heads are authoritative; `content-overlays.json` is an atomic private snapshot repaired at startup. Enta uses the derived local release for new games. Huroof refreshes for new-room creation and archives older snapshots. Cross-process activation is eventual, not one transaction. Existing game pins and predecessor results remain unchanged.

Local rematches create a new linked match, retain predecessor setup/source identity, and select unseen eligible content. Exhaustion is reported; it does not invent stock or rewrite the old result. Huroof rematches additionally require a completed previous room, its host capability and matching account for owned rooms, and retain cumulative exclusions across the predecessor chain. Legacy unowned rooms can be rematched with their existing host capability and a verified local account; this owns only the successor and does not claim the old room.

## Services and content

| Service | Loopback port | State |
| --- | --- | --- |
| Development web | 5174 | Integration worktree |
| Optimized preview | 5175 | `local/almaidan/web-build` |
| Auth Emulator | 19099 | `local/almaidan/auth-export` |
| Huroof | 18787 | `local/almaidan/huroof.sqlite` |
| Enta API | 14001 | PostgreSQL `local_development` schema |
| PostgreSQL 16.15 | 15439 | Existing isolated `almaidan-local-20261104` container and `local/almaidan/postgres` mount |

State, reports and logs live in `D:\projects\huroof_wa_oloof\local\almaidan`, outside tracked application source. `connection.private.json`, admin credentials, `room-signing.private` and `room-grant-key.private` are private and must not be served/shared.

The saved source contains **530 categories and 115,636 original questions**. All categories remain visible/searchable; 520 meet category-board supply requirements, while ten show insufficient-distinct-answer explanations. All 4,578 media bindings and 2,000 original challenge definitions were verified locally. Original rows remain retained even when unsuitable for a specific mode.

Enta uses 453 compatible classic text pools and 440 strict competitive pools. Supplied point tiers remain unchanged; missing tiers use documented deterministic local assignment. A separate reviewed local supplement adds **432 entries across 24 categories** for kids/list/acting/drawing, supporting three nonrepeating matches per category. This has its own local release identity; it is not labelled original saved-source content or an implicit practice fallback. Older practice games retain their own provenance.

Huroof's local signing secret persists across restarts. Tokens from sessions predating this change used an ephemeral secret and may require a new room; their existing database rows were retained.

## Dedicated local build

Build an optimized artifact without reading hosted `.env` files:

```powershell
& 'D:\projects\huroof_wa_oloof\scripts\build-local-almaidan.ps1'
```

With the local backends running, serve the artifact in a separate terminal:

```powershell
& 'D:\projects\huroof_wa_oloof\scripts\build-local-almaidan.ps1' -Serve -SkipBuild
```

Preview binds only `127.0.0.1:5175`; HTTP/WebSocket Host and Origin checks restrict access, and proxies target only local services. [Preview readiness](http://127.0.0.1:5175/__local_health) checks backend health endpoints; health alone is not gameplay/database acceptance. Reuse an existing identified preview or stop that exact process before launching another on 5175.

The script restores the invoking environment on exit and writes the private local build directory, preserving older generated assets. Ordinary production build/deployment guards remain unchanged. A successful local build is not production qualification. The latest 224-module build passed on 2026-11-06 and its index SHA-256 is `f5f5003672734077f75dbae97511c5bf56bcb55f094576866a597d70f6b8e351`. The loopback preview serves that exact artifact (see `optimized-preview-20261106.json`). Final rendered acceptance is recorded separately from the passing build and runtime suites.

The launcher waits for the isolated PostgreSQL instance to accept connections before starting the APIs. This handles ordinary recovery after a computer restart without resetting saved data. Use the launcher for persistent services; a temporary test terminal may exit when its review session ends.

Payments, production admissions and LAN exposure are outside this setup. Consult the acceptance ledger before describing the latest source, running processes or screenshots as fully accepted.

See [the November 6 admin continuation](LOCAL-ADMIN-ACCEPTANCE-2026-11-06.md) for current all-format source/HTTP evidence, optimized build metadata and the separate browser-verification limit.
