# T36 live gameplay acceptance

Status: implementation deployed with public challenge flags off; human execution pending. Automated live verification is separately recorded in [LIVE-CHECKS.md](../output/t36-premium-mechanics-20260922/m6/LIVE-CHECKS.md). This checklist is not evidence that tests passed. Canonical scope: [T36 M6](T36-PREMIUM-MECHANICS.md#m6--integrated-verification-publication-and-acceptance).

## Record the tested build

Record backend/client build identities, pinned content release/hash, enabled mechanic flags, room code, devices/browser versions, Arabic text direction, labelled-colour setting and human reviewer/date. Use test participants without personal identifiers. Save only consented screenshots with no private account information. Record automated emulator/browser checks separately from real-device/human findings.

## Device arrangement

TV uses the audience view, host uses its own device. For full phone-role coverage, use two phones on the first team (guide/mover or captain) and an opponent phone. Separately test a manually entered opponent captain and a host-operated mover. Navigation always needs a real private guide phone; verify setup explains this when unavailable. Test a fresh room with labelled colours enabled, then another with the setting disabled; changing it mid-match must be unavailable.

## Human walkthrough

| Check | Expected result | Evidence/status |
| --- | --- | --- |
| First-use instructions and readiness | Clear Arabic role/rule explanation, durations visible before start, one3-second countdown, no timer while required input is unready | Pending |
| Tile preview and confirm | Four source-ordered labelled options, reversible preview, one explicit confirmation, no correctness clue before commit | Pending |
| Tile/map steal | Host starts or declines;15seconds; first answer and solution stay hidden; one total cell/point for winner | Pending |
| Map identification/direction/order | North stays up; marker geometry unchanged in RTL; keyboard/tap/up-down ordering works; no hidden place mapping exposed | Pending |
| Memory observation/recall | Only board and memorization instruction during exposure; board and accessible text disappear before target question; fixed palette; numbered ordered slots | Pending |
| Memory pause/reconnect | Pause immediately covers; remaining exposure preserved; refresh never restarts; compromised attempt can be voided and replaced without points | Pending |
| Navigation private roles | Guide sees goal/obstacles without route; mover/TV see blank grid and confirmed trail; real phone and host-mover fallback both usable | Pending |
| One-phone navigation across teams | Share one authenticated private guide phone between teams; host reassigns it before selecting the next navigation cell and proxies the mover. No team/role reassignment after disclosure; fully phone-free navigation is unavailable | Pending |
| Navigation movement/failure | Alternative legal route wins; blocked move stays put and costs strike; third strike fails; boundaries disabled | Pending |
| Result/reveal/continue | Result persists, explicit host reveal only after attempts close, then explicit continue returns to board | Pending |
| Correction and mixed full match | Audited host correction works; ordinary timers/questions, scores, cell ownership and victory rules remain correct | Pending |
| Slow loading/offline | Clear recoverable state; no premature timer or private cached stimulus; fresh-content void when exposure was compromised | Pending |
| Accessibility and comfort | TV readable at room distance; phone controls usable; visible focus; meaningful colour names; restrained/reduced motion; pacing acceptable to both teams | Pending |

Human reviewer records findings and accepted/rejected usability/pacing decisions. Automated checks cannot supply that acceptance. Any failed privacy/scoring check prevents the affected mechanic's flag from being enabled. Disable new challenge-room admission on rollback while retaining support for active pinned rooms.

