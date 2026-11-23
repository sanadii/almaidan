# Independent local database polling review

Reviewed 2026-11-05. Reviewer: local_database_final_review. Scope: the integration worktree local-development rooms.ts, competition-store.ts, round-store.ts and store.ts; no production schema or service changes.

## Decision

No blocking safety finding in the conditional-write change. Concur with loading this isolated local candidate after the planned focused PostgreSQL checks and safe quiescence of active browser matches. This is source-review concurrence, not a claim of measured post-reload latency or database-test execution by this reviewer. No database operation, service restart, cleanup or source modification was performed during this review.

## Safety reasoning

All four wrappers obtain their original SELECT FOR UPDATE before capturing JSON, then await the same callback, serialize the resulting persistent state, and skip UPDATE only when the serialized bytes are equal. Locks remain held until transaction completion even on a no-op. Thus concurrent commands retain their existing serialization; this is not an unlocked read optimization.

Clock settlement still executes inside the callback and the current save paths. Changed round phase, deadlines, versions, events and finished timestamps change serialized state and therefore still write. Identical state after settlement needs no new row version. Competitive score/posting/event updates, admission/command receipts, audits, disclosure events, grants and token-hash changes, revocations, room membership, encrypted grants and submissions likewise participate in the compared JSON. No field-specific allowlist can accidentally omit a mutation.

Exceptions still prevent the final UPDATE and roll back the current transaction. Serialization errors retain fail-closed behavior. Cross-store engine commit followed by room rollback remains the prior nested-transaction recovery problem; this patch neither introduces nor claims to eliminate it. Existing deterministic request/receipt recovery remains applicable.

JSONB-loaded values are plain JSON. Changes invisible to JSON.stringify (undefined-only properties, equivalent serializations) were also invisible to the old persisted JSON encoding, so skipping those writes does not remove a previously durable semantic change. Ordering changes may cause an unnecessary write but cannot suppress a distinct JSON value. Owner-state's INSERT ON CONFLICT remains unchanged, including creation of a new empty owner row on its first access. Missing singleton-state guards and all local-only guards/timeouts remain unchanged. No data/schema reset, migration, rewrite or deletion is required.

## Performance limits and focused verification

The reported 8.8 MB competition state, 2.2 MB round state, 3,759 competition updates, approximately 610 MB relation size and multi-second lock waits are root diagnostic evidence, not independently remeasured here. Avoiding unchanged UPDATE should remove repeated MVCC/TOAST write amplification from stable polling. It does not shrink existing relation files, remove the singleton lock, avoid reading/deserializing the entire state, or avoid two serializations per callback. Pollers still serialize behind active writes. Do not claim all 30-second browser delays are fixed until live checks show that.

Root's focused new-owner tests should establish: stable read/poll leaves ctid unchanged; a real command and receipt mutate ctid/state; expired-clock read persists settlement; exact retries remain idempotent; throw-after-mutation rolls back; concurrent real commands retain versions and state. Reuse existing grant/revocation, scoring, privacy and cross-store recovery evidence for unchanged reducer paths. Review current test results before loading; retain active rooms and all existing data. No VACUUM FULL, truncation, lock removal or data cleanup is authorized by this review.

## Paused-match restart boundary

Root reports both active browser matches were explicitly paused through the real UI, with no in-flight writes and retained remaining times of 13 seconds (acting) and 105 seconds (mixed). Pausing rather than finishing does not alter source safety concurrence: paused timers and state remain ordinary persisted JSON, and the conditional-write change does not discard them. Reuse the same databases and private key files, restart only the identified isolated local service, and resume via the existing UI after verifying retained state/times. This is review of the reported plan, not independent observation of those pauses or authorization of data cleanup. Root owns focused database checks and runtime verification; this reviewer performed no runtime/database effect.
