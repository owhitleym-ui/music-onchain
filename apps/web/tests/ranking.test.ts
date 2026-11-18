// Unit tests for the ranking/payout math and money formatting. Run with `npm test`.
// The cases mirror contracts/test/Competition.t.sol so the app and the contract agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePayouts, rankEntries } from "../lib/ranking.ts";
import { formatUsd, parseUsd } from "../lib/money.ts";

const e = (entryIndex: number, prediction: bigint, player = `0x${entryIndex}`) => ({ entryIndex, player, prediction });

test("closest prediction ranks first, in either direction", () => {
  const ranked = rankEntries([e(0, 900n), e(1, 1_050n), e(2, 1_000n), e(3, 2_000n)], 1_000n);
  assert.deepEqual(ranked.map((r) => r.entryIndex), [2, 1, 0, 3]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(ranked.map((r) => r.error), [0n, 50n, 100n, 1_000n]);
});

test("ties go to the earlier entry (matches Competition.sol strict < scan)", () => {
  // 950 and 1050 are both 50 away; the earlier one (index 1) wins.
  const ranked = rankEntries([e(0, 500n), e(1, 950n), e(2, 1_050n)], 1_000n);
  assert.deepEqual(ranked.map((r) => r.entryIndex), [1, 2, 0]);
});

test("one player can hold several ranks", () => {
  const ranked = rankEntries([e(0, 990n, "alice"), e(1, 995n, "alice"), e(2, 500n, "bob")], 1_000n);
  assert.deepEqual(ranked.slice(0, 2).map((r) => r.player), ["alice", "alice"]);
});

test("payout split matches SPEC.md example: 10 entries x $5", () => {
  const pot = 50_000_000n;
  const split = computePayouts(pot, [4000, 2000, 1000], 500);
  assert.deepEqual(split.winners.map(formatUsd), ["20.00", "10.00", "5.00"]);
  assert.equal(formatUsd(split.platform), "2.50");
  assert.equal(formatUsd(split.artist), "12.50");
});

test("rounding dust goes to the artist and the pot always empties exactly", () => {
  for (const pot of [1n, 7n, 3_333_333n, 15_000_001n, 499_999_999n]) {
    const split = computePayouts(pot, [4000, 2000, 1000], 500);
    const total = split.winners.reduce((a, b) => a + b, 0n) + split.platform + split.artist;
    assert.equal(total, pot);
    assert.ok(split.artist >= (pot * 2500n) / 10_000n);
  }
});

test("money formatting and parsing", () => {
  assert.equal(formatUsd(5_000_000n), "5.00");
  assert.equal(formatUsd(12_345_678n), "12.34");
  assert.equal(formatUsd(0n), "0.00");
  assert.equal(parseUsd("10"), 10_000_000n);
  assert.equal(parseUsd("0.5"), 500_000n);
  assert.throws(() => parseUsd("1.1234567"));
  assert.throws(() => parseUsd("-1"));
});
