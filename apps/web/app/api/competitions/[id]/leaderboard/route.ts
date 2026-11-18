import { getAddress, isAddress } from "viem";
import { connection, type NextRequest } from "next/server";
import { readCompetition, readEntries } from "@/lib/server/competitions";
import { eventsForCompetition } from "@/lib/server/events";
import { errorResponse, HttpError, json, parseId } from "@/lib/server/http";
import { entriesFromEvents, leaderboard } from "@/lib/server/views";

// GET /api/competitions/:id/leaderboard?viewer=0x...
// Entries in entry order while open; ranked with payouts once settled; refunds if cancelled.
// Reads entries from the QuickNode Stream (Supabase) when it's caught up with the chain,
// otherwise straight from the contract. `source` says which one answered.
// The UI polls this every 2-3 seconds for live updates.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection(); // request-time only; never prerender
  try {
    const id = parseId((await ctx.params).id, "id");
    const viewerParam = request.nextUrl.searchParams.get("viewer");
    const viewer = viewerParam && isAddress(viewerParam) ? getAddress(viewerParam) : null;

    const competition = await readCompetition(id);
    if (!competition) throw new HttpError(404, `Competition ${id} does not exist`, "not_found");

    const events = await eventsForCompetition(id);
    const fromStream = entriesFromEvents(events, competition.numEntries);
    const entries = fromStream ?? (await readEntries(id));

    return json(leaderboard(competition, entries, fromStream ? "stream" : "chain", viewer, fromStream ? events : null));
  } catch (err) {
    return errorResponse(err);
  }
}
