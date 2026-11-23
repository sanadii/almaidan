# INT-051.B4-L2.C-v2 — Root technical acceptance

**Outcome: Done for runner source/mock scope. B4 and full integration remain open.**

Accepted package: `C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int5b-resume-20261006/L2-B-SCHED-HOST-complete-v2/`.

Freeze SHA256: `5c72b5fd783d83fb51aaa3e18a3d26ad3b745d7a43e43bf1a764393c361edf7c`.

## Changes and verification

- Staging entrypoint sets Stop and StrictMode immediately after parameters. Root ran the actual entrypoint under ambient Continue with mocked effects: **4/4 passed**. Directory/security/copy errors stop later callbacks and success receipts.
- Registration waits for a protected, correlated host-start acknowledgement before client completion. One shared finite startup deadline is used. Root coupled protocol mocks, including delayed host startup, failed/missing/wrong/late acknowledgement and receipt errors: **22/22 passed**, including liveness cases.
- Process identity uses one retained query/synchronize handle and accepts only zero-time wait result 258. Signaled, failed, unexpected and identity-failure cases deny.
- Root rehashed 58 artifacts, 27 financial/test sources and 3 installed tools: **88 pins, zero drift**. Both exact reviewers also checked predecessor/carry bindings: **98 pins, zero drift**.

Root receipts outside the immutable package:

| Receipt | SHA256 |
| --- | --- |
| `database/ROOT-V2-STAGING-REPRO.json` | `6de0d334f712fd9fb936c4708dc445d22a23d192d5c46305865e7fa81656ffb0` |
| `database/ROOT-V2-PROTOCOL-REPRO.json` | `0552d138125ede89f58025ba94f8d953e084c45c6d239fcb923329139304b213` |
| `database/scheduler-host-l2c-v2-focused-review.md` | `25e024704ad7c659c322ed073ee7fc3dacfc08cfc9fadecd769e6ca82443621b` |
| `security/L2-C-COMPLETE-V2-EXACT-REVIEW.md` | `334faa172b6be353c3374eb19e5326171d95712d407e56217826f339d1478df1` |

## Limits and next action

Both complete reviews allow this technical scope after Root reproduction, now satisfied. These checks use mocked effect transports; they do not prove actual Scheduler security, process ownership/survival, database initialization, SQL/Firestore races or payment readiness. The 1800-second startup budget is finite and explicitly unmeasured. Historical v1 and earlier failures remain unchanged.

No actual task, native process, ACL, PostgreSQL or SQL effects occurred during Root reproduction. Existing servers, data, private files, source work and preview remain preserved. The preview independently returned HTTP200.

Next authorized action: **INT-051.B4-L3.D1 output-only initialization adapter draft**, governed by [financial contract](../INT-5-FINANCIAL-CONTRACT.md#int-051b4-l3d1--draft-native-initialization-adapter). Actual staging/init requires separate exact review and external authority. No financial Gate or production release approval follows from this acceptance.
