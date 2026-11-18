// Response shapes of the backend routes in app/api, as the browser receives them.
// Keep in sync with lib/server/views.ts and SPEC.md "Backend API".
import type { SongMeta } from "@/lib/songs";

/** Every amount: a display string in dollars plus the raw 6-decimal USDC integer as a string. */
export type Money = { usd: string; raw: string };

export type Phase = "open" | "closed" | "settled" | "cancelled";

export type CompetitionSummary = {
  id: number;
  songId: number;
  title: string;
  artist: string;
  artworkUrl: string;
  song: Omit<SongMeta, "youtubeVideoId">;
  metric: string;
  phase: Phase;
  closesAt: number; // unix seconds (chain time)
  secondsLeft: number; // until entries close, measured on the chain's clock
  entryFee: Money;
  pot: Money;
  numEntries: number;
  minEntries: number;
  maxEntries: number;
  finalMetric: string | null;
  prizes: { winners: Money[]; artist: Money; platform: Money };
  split: { winnersBps: number[]; artistBps: number; platformBps: number };
};

export type LeaderboardEntry = {
  entryIndex: number;
  name: string; // "You" or "Fan 3F9A"; never a raw address
  isYou: boolean;
  prediction: string;
  rank: number | null;
  error: string | null;
  payout: Money | null;
  refund: Money | null;
};

export type Leaderboard = {
  ok: true;
  source: "stream" | "chain"; // "stream" = served from QuickNode Stream events
  competition: CompetitionSummary;
  entries: LeaderboardEntry[];
  artistEarned?: Money;
};

export type MyEntry = {
  competition: CompetitionSummary;
  entryIndex: number;
  prediction: string;
  rank: number | null;
  error: string | null;
  payout: Money | null;
  refund: Money | null;
};

export type ActivityItem = {
  competitionId: number | null;
  at: string | null;
  text: string;
  event: string;
  txHash: string;
};

export type ApiError = { ok: false; error: string; message: string };
