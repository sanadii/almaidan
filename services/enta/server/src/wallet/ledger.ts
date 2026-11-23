export type WalletEffect = "FREE_FIRST_GRANT" | "RESERVE" | "COMMIT" | "RELEASE";

export interface WalletBalances {
  available: bigint;
  held: bigint;
  debt: bigint;
  version: bigint;
}

export interface LedgerDelta {
  available: bigint;
  held: bigint;
  debt: bigint;
}

export interface WalletLedgerRecord {
  sequence: bigint;
  originType: string;
  originId: string;
  effect: WalletEffect;
  deltaAvailable: bigint;
  deltaHeld: bigint;
  deltaDebt: bigint;
  resultingAvailable: bigint;
  resultingHeld: bigint;
  resultingDebt: bigint;
}

export function deltaForEffect(effect: WalletEffect): LedgerDelta {
  switch (effect) {
    case "FREE_FIRST_GRANT": return { available: 1n, held: 0n, debt: 0n };
    case "RESERVE": return { available: -1n, held: 1n, debt: 0n };
    case "COMMIT": return { available: 0n, held: -1n, debt: 0n };
    case "RELEASE": return { available: 1n, held: -1n, debt: 0n };
  }
}

export function applyLedgerEffect(current: WalletBalances, effect: WalletEffect): WalletBalances {
  const delta = deltaForEffect(effect);
  const next = {
    available: current.available + delta.available,
    held: current.held + delta.held,
    debt: current.debt + delta.debt,
    version: current.version + 1n,
  };
  if (effect === "RESERVE" && current.debt > 0n) throw new Error("WALLET_DEBT_BLOCKS_START");
  if (next.available < 0n || next.held < 0n || next.debt < 0n) throw new Error("INSUFFICIENT_CREDIT");
  return next;
}

export function reconcileLedger(opening: WalletBalances, effects: readonly WalletEffect[]): WalletBalances {
  return effects.reduce(applyLedgerEffect, opening);
}

export function reconcileLedgerEntries(opening: WalletBalances, entries: readonly WalletLedgerRecord[]): WalletBalances {
  let current = opening;
  const origins = new Set<string>();
  for (const entry of entries) {
    if (entry.sequence !== current.version + 1n) throw new Error("LEDGER_SEQUENCE_GAP");
    const originKey = `${entry.originType}\u0000${entry.originId}\u0000${entry.effect}`;
    if (origins.has(originKey)) throw new Error("DUPLICATE_LEDGER_EFFECT");
    origins.add(originKey);
    const delta = deltaForEffect(entry.effect);
    if (entry.deltaAvailable !== delta.available || entry.deltaHeld !== delta.held || entry.deltaDebt !== delta.debt) {
      throw new Error("LEDGER_EFFECT_DELTA_MISMATCH");
    }
    const next = applyLedgerEffect(current, entry.effect);
    if (entry.resultingAvailable !== next.available || entry.resultingHeld !== next.held || entry.resultingDebt !== next.debt) {
      throw new Error("LEDGER_RESULT_MISMATCH");
    }
    current = next;
  }
  return current;
}
