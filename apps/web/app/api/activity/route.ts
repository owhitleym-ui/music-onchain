import { connection, type NextRequest } from "next/server";
import { money } from "@/lib/money";
import { recentEvents } from "@/lib/server/events";
import { errorResponse, json } from "@/lib/server/http";
import { displayName } from "@/lib/server/views";

// GET /api/activity?limit=20
// Live feed of contract events delivered by the QuickNode Stream ("Fan 3F9A entered", "Competition 2 settled").
// Requires Supabase; returns an empty feed with `available: false` otherwise.
export async function GET(request: NextRequest) {
  await connection(); // request-time only; never prerender
  try {
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20));
    const rows = await recentEvents(limit);
    if (!rows) return json({ ok: true, available: false, items: [] });

    const items = rows.map((r) => {
      const a = r.args;
      const base = { competitionId: r.competition_id, at: r.block_time, txHash: r.tx_hash, event: r.event_name };
      switch (r.event_name) {
        case "EntrySubmitted":
          return { ...base, text: `${displayName(a.player)} predicted ${Number(a.prediction).toLocaleString("en-US")}` };
        case "CompetitionSettled":
          return { ...base, text: `Settled at ${Number(a.finalMetric).toLocaleString("en-US")}` };
        case "WinnerPaid":
          return { ...base, text: `${displayName(a.player)} won $${money(BigInt(a.amount)).usd} (#${a.rank})` };
        case "ArtistPaid":
          return { ...base, text: `Artist earned $${money(BigInt(a.amount)).usd}` };
        case "CompetitionCancelled":
          return { ...base, text: "Cancelled. Everyone refunded" };
        case "CompetitionCreated":
          return { ...base, text: "New competition opened" };
        default:
          return { ...base, text: r.event_name };
      }
    });
    return json({ ok: true, available: true, items });
  } catch (err) {
    return errorResponse(err);
  }
}
