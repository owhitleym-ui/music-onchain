import { getAddress, isAddress } from "viem";
import { connection, type NextRequest } from "next/server";
import { money } from "@/lib/money";
import { rankEntries } from "@/lib/ranking";
import { readAllCompetitions, readEntries } from "@/lib/server/competitions";
import { errorResponse, HttpError, json } from "@/lib/server/http";
import { competitionSummary } from "@/lib/server/views";

// GET /api/me/entries?address=0x...
// Every entry this wallet made, with the competition's state and the result for that entry.
// Reads the contract directly: with three demo competitions that's a handful of calls,
// and it's always exact. (The Stream-backed path is the leaderboard and /api/activity.)
export async function GET(request: NextRequest) {
  await connection(); // request-time only; never prerender
  try {
    const raw = request.nextUrl.searchParams.get("address") ?? "";
    if (!isAddress(raw)) throw new HttpError(400, "address is missing or invalid", "bad_request");
    const address = getAddress(raw);

    const competitions = await readAllCompetitions();
    const results = await Promise.all(
      competitions.map(async (c) => {
        const entries = await readEntries(c.id);
        const mine = entries.filter((e) => e.player === address);
        if (mine.length === 0) return [];
        const ranked = c.phase === "settled" ? rankEntries(entries, c.finalMetric) : null;
        const summary = competitionSummary(c);
        return mine.map((e) => {
          const r = ranked?.find((x) => x.entryIndex === e.entryIndex);
          const payout = r ? summary.prizes.winners[r.rank - 1] ?? null : null;
          return {
            competition: summary,
            entryIndex: e.entryIndex,
            prediction: e.prediction.toString(),
            rank: r?.rank ?? null,
            error: r?.error.toString() ?? null,
            payout,
            refund: c.phase === "cancelled" ? money(c.entryFee) : null,
          };
        });
      }),
    );
    return json({ ok: true, entries: results.flat() });
  } catch (err) {
    return errorResponse(err);
  }
}
