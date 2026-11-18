// Ranking and payout math, shared by the API and (optionally) the UI.
// MUST match contracts/src/Competition.sol exactly:
//   - smaller |prediction - finalMetric| ranks higher
//   - ties go to the earlier entry (lower entryIndex)
//   - each winner gets floor(pot * payoutBps[rank] / 10_000)
//   - platform gets floor(pot * platformBps / 10_000)
//   - artist gets everything left over (its share plus rounding dust)
// This file is dependency-free so `node --test` can import it directly.

export const BPS = 10_000n;

export type EntryInput = {
  entryIndex: number;
  player: string;
  prediction: bigint;
};

export type RankedEntry = EntryInput & {
  rank: number; // 1-based
  error: bigint;
};

export function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

export function rankEntries(entries: readonly EntryInput[], finalMetric: bigint): RankedEntry[] {
  return entries
    .map((e) => ({ ...e, error: absDiff(e.prediction, finalMetric) }))
    .sort((a, b) => {
      if (a.error !== b.error) return a.error < b.error ? -1 : 1;
      return a.entryIndex - b.entryIndex;
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export type PayoutSplit = {
  winners: bigint[]; // index 0 = rank 1
  platform: bigint;
  artist: bigint;
};

export function computePayouts(
  pot: bigint,
  payoutBps: readonly number[],
  platformBps: number,
): PayoutSplit {
  const winners = payoutBps.map((bps) => (pot * BigInt(bps)) / BPS);
  const platform = (pot * BigInt(platformBps)) / BPS;
  const paid = winners.reduce((sum, x) => sum + x, 0n) + platform;
  return { winners, platform, artist: pot - paid };
}
