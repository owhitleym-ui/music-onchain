import "server-only";
import type { Address } from "viem";
import { songMeta, type SongMeta } from "@/lib/songs";
import { contracts, publicClient } from "./chain";

// Typed reads of onchain competition state. If Competition.sol's Config changes
// (e.g. adding `resolvesAt`), re-export the ABI and update `readCompetition` and `phaseOf` only.

export const STATUS = ["None", "Open", "Settled", "Cancelled"] as const;
export type Status = (typeof STATUS)[number];

/** What the UI should show. "closed" = entries closed, waiting for the admin to settle. */
export type Phase = "open" | "closed" | "settled" | "cancelled";

export type Competition = {
  id: number;
  songId: number;
  song: SongMeta;
  artist: Address;
  entryFee: bigint;
  closesAt: number;
  minEntries: number;
  maxEntries: number;
  artistBps: number;
  platformBps: number;
  payoutBps: number[];
  metric: string;
  status: Status;
  phase: Phase;
  pot: bigint;
  finalMetric: bigint;
  numEntries: number;
  now: number; // chain time the phase was computed at
};

export type OnchainEntry = { entryIndex: number; player: Address; prediction: bigint };

export function phaseOf(status: Status, closesAt: number, nowSeconds = Math.floor(Date.now() / 1000)): Phase {
  if (status === "Settled") return "settled";
  if (status === "Cancelled") return "cancelled";
  return nowSeconds < closesAt ? "open" : "closed";
}

export async function competitionCount(): Promise<number> {
  const n = await publicClient().readContract({ ...contracts.competition(), functionName: "competitionCount" });
  return Number(n);
}

/** The chain's clock (latest block timestamp). The contract checks closesAt against this, not wall time. */
export async function chainNow(): Promise<number> {
  const block = await publicClient().getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

export async function readCompetition(id: number, nowSeconds?: number): Promise<Competition | null> {
  const client = publicClient();
  const now = nowSeconds ?? (await chainNow());
  const [cfg, statusRaw, pot, finalMetric, numEntries] = await client.readContract({
    ...contracts.competition(),
    functionName: "getCompetition",
    args: [BigInt(id)],
  });
  const status = STATUS[Number(statusRaw)] ?? "None";
  if (status === "None") return null;

  const song = await client.readContract({
    ...contracts.songRegistry(),
    functionName: "getSong",
    args: [cfg.songId],
  });

  const closesAt = Number(cfg.closesAt);
  return {
    id,
    songId: Number(cfg.songId),
    song: songMeta(song.metadataURI),
    artist: song.artist,
    entryFee: cfg.entryFee,
    closesAt,
    minEntries: Number(cfg.minEntries),
    maxEntries: Number(cfg.maxEntries),
    artistBps: Number(cfg.artistBps),
    platformBps: Number(cfg.platformBps),
    payoutBps: cfg.payoutBps.map(Number),
    metric: cfg.metric,
    status,
    phase: phaseOf(status, closesAt, now),
    now,
    pot,
    finalMetric,
    numEntries: Number(numEntries),
  };
}

export async function readAllCompetitions(): Promise<Competition[]> {
  const [count, now] = await Promise.all([competitionCount(), chainNow()]);
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const all = await Promise.all(ids.map((id) => readCompetition(id, now)));
  return all.filter((c): c is Competition => c !== null);
}

export async function readEntries(id: number): Promise<OnchainEntry[]> {
  const entries = await publicClient().readContract({
    ...contracts.competition(),
    functionName: "getEntries",
    args: [BigInt(id)],
  });
  return entries.map((e, i) => ({ entryIndex: i, player: e.player, prediction: e.prediction }));
}
