import { connection } from "next/server";
import { readAllCompetitions } from "@/lib/server/competitions";
import { errorResponse, json } from "@/lib/server/http";
import { competitionSummary } from "@/lib/server/views";

// GET /api/competitions
// Every competition with its song, pot, entry count, phase, and projected prizes.
export async function GET() {
  await connection(); // always read live chain state, never prerender
  try {
    const competitions = await readAllCompetitions();
    return json({ ok: true, competitions: competitions.map((c) => competitionSummary(c)) });
  } catch (err) {
    return errorResponse(err);
  }
}
