import "server-only";
import { getAddress, type Address } from "viem";
import { money } from "@/lib/money";
import { computePayouts, rankEntries, type EntryInput } from "@/lib/ranking";
import type { Competition, OnchainEntry } from "./competitions";
import type { ChainEventRow } from "./db";

// Shapes returned to the frontend. Documented in SPEC.md under "Backend API".
// Rule from .cursor/rules: crypto stays invisible, so players get a short name, not an address.

export function displayName(player: string, viewer?: Address | null) {
  if (viewer && getAddress(player) === viewer) return "You";
  return `Fan ${player.slice(-4).toUpperCase()}`;
}

/** One competition as the UI sees it. `nowSeconds` defaults to the chain time it was read at. */
export function competitionSummary(c: Competition, nowSeconds = c.now) {
  const prizes = computePayouts(c.pot, c.payoutBps, c.platformBps);
  return {
    id: c.id,
    songId: c.songId,
    title: c.song.title,
    artist: c.song.artist,
    artworkUrl: c.song.artworkUrl,
    // Full display data (artist id for following, genre, cover colors, SAMPLE chart stats).
    // The YouTube video id is admin-only, so it's left out.
    song: { ...c.song, youtubeVideoId: undefined },
    metric: c.metric,
    phase: c.phase,
    closesAt: c.closesAt,
    secondsLeft: Math.max(0, c.closesAt - nowSeconds),
    entryFee: money(c.entryFee),
    pot: money(c.pot),
    numEntries: c.numEntries,
    minEntries: c.minEntries,
    maxEntries: c.maxEntries,
    finalMetric: c.phase === "settled" ? c.finalMetric.toString() : null,
    // Projected while open; actual once settled (same math as the contract).
    prizes: {
      winners: prizes.winners.map(money),
      artist: money(prizes.artist),
      platform: money(prizes.platform),
    },
    split: { winnersBps: c.payoutBps, artistBps: c.artistBps, platformBps: c.platformBps },
  };
}

type Source = "stream" | "chain";

/** Entries from Stream events, or null if the database is behind the chain. */
export function entriesFromEvents(rows: ChainEventRow[] | null, onchainCount: number): OnchainEntry[] | null {
  if (!rows) return null;
  const entries = rows
    .filter((r) => r.event_name === "EntrySubmitted")
    .map((r) => ({
      entryIndex: Number(r.args.entryIndex),
      player: getAddress(r.args.player),
      prediction: BigInt(r.args.prediction),
    }))
    .sort((a, b) => a.entryIndex - b.entryIndex);
  return entries.length >= onchainCount ? entries : null;
}

export function leaderboard(
  c: Competition,
  entries: OnchainEntry[],
  source: Source,
  viewer: Address | null,
  events: ChainEventRow[] | null,
) {
  const inputs: EntryInput[] = entries.map((e) => ({ ...e }));
  const base = { ok: true as const, source, competition: competitionSummary(c) };

  if (c.phase === "cancelled") {
    return {
      ...base,
      entries: inputs.map((e) => ({
        entryIndex: e.entryIndex,
        name: displayName(e.player, viewer),
        isYou: displayName(e.player, viewer) === "You",
        prediction: e.prediction.toString(),
        rank: null,
        error: null,
        payout: null,
        refund: money(c.entryFee),
      })),
    };
  }

  if (c.phase !== "settled") {
    return {
      ...base,
      entries: inputs.map((e) => ({
        entryIndex: e.entryIndex,
        name: displayName(e.player, viewer),
        isYou: displayName(e.player, viewer) === "You",
        prediction: e.prediction.toString(),
        rank: null,
        error: null,
        payout: null,
        refund: null,
      })),
    };
  }

  // Settled: rank with the contract's rule. Prefer the actual WinnerPaid amounts from the Stream.
  const ranked = rankEntries(inputs, c.finalMetric);
  const split = computePayouts(c.pot, c.payoutBps, c.platformBps);
  const paidByRank = new Map<number, bigint>();
  for (const row of events ?? []) {
    if (row.event_name === "WinnerPaid") paidByRank.set(Number(row.args.rank), BigInt(row.args.amount));
  }
  const artistPaid = events?.find((r) => r.event_name === "ArtistPaid");

  return {
    ...base,
    artistEarned: money(artistPaid ? BigInt(artistPaid.args.amount) : split.artist),
    entries: ranked.map((e) => {
      const payout = paidByRank.get(e.rank) ?? split.winners[e.rank - 1] ?? 0n;
      return {
        entryIndex: e.entryIndex,
        name: displayName(e.player, viewer),
        isYou: displayName(e.player, viewer) === "You",
        prediction: e.prediction.toString(),
        rank: e.rank,
        error: e.error.toString(),
        payout: payout > 0n ? money(payout) : null,
        refund: null,
      };
    }),
  };
}
