import { assertBinding, assertProof, type HuroofBinding, type HuroofProof } from "./huroof-protocol.cjs";

export interface HuroofLease {
  jobId: string; leaseOwner: string; leaseVersion: number;
  binding: HuroofBinding; config: Record<string, unknown>;
}
export interface HuroofLeaseClaimer { claim(owner: string): Promise<HuroofLease | null> }
export interface HuroofLeaseSettler { finish(lease: HuroofLease, proof: HuroofProof | null): Promise<boolean> }
export interface HuroofFirestorePort {
  readonly projectId: string;
  provision(binding: HuroofBinding, config: Record<string, unknown>): Promise<HuroofProof>;
  cancel(binding: HuroofBinding, cancellationId: string): Promise<HuroofProof>;
  read(binding: HuroofBinding): Promise<HuroofProof | null>;
}

/** Internal loop only. Every SQL lease transaction is finished before SDK I/O. */
export async function runHuroofAdmissionJob(claimer: HuroofLeaseClaimer, settler: HuroofLeaseSettler, firestore: HuroofFirestorePort, owner: string, options: { cancel?: boolean } = {}): Promise<"idle" | "pending" | "settled" | "stale"> {
  const lease = await claimer.claim(owner);
  if (!lease) return "idle";
  assertBinding(lease.binding);
  if (lease.binding.projectId !== firestore.projectId) throw new Error("WORKER_PROJECT_MISMATCH");
  // Never release on an absent document, elapsed lease or an SDK exception.
  // The lease expires naturally after a crash; the next worker repeats safely.
  let proof = await firestore.read(lease.binding);
  if (proof) assertProof(lease.binding, proof);
  if (!proof || proof.state === "RESERVED") {
    proof = options.cancel
      ? await firestore.cancel(lease.binding, `${lease.binding.admissionId}:cancel`)
      : await firestore.provision(lease.binding, lease.config);
  }
  assertProof(lease.binding, proof);
  if (proof.state !== "RESERVED") {
    const authoritative = await firestore.read(lease.binding);
    if (!authoritative || authoritative.state !== proof.state) throw new Error("TERMINAL_READBACK_MISSING");
    assertProof(lease.binding, authoritative);
    proof = authoritative;
  }
  const terminal = proof.state === "RESERVED" ? null : proof;
  if (!await settler.finish(lease, terminal)) return "stale";
  return terminal ? "settled" : "pending";
}
