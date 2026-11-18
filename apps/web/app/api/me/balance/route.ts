import { connection, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { money } from "@/lib/money";
import { contracts, publicClient } from "@/lib/server/chain";
import { errorResponse, HttpError, json } from "@/lib/server/http";

// GET /api/me/balance?address=0x...
// The wallet's test USDC balance, for the header's balance button and the "do I need the
// faucet first?" check before entering. Read through the server so the browser doesn't need
// its own RPC access just to show a number.
export async function GET(request: NextRequest) {
  await connection(); // request-time only; never prerender
  try {
    const raw = request.nextUrl.searchParams.get("address") ?? "";
    if (!isAddress(raw)) throw new HttpError(400, "address is missing or invalid", "bad_request");
    const balance = await publicClient().readContract({
      ...contracts.usdc(),
      functionName: "balanceOf",
      args: [getAddress(raw)],
    });
    return json({ ok: true, balance: money(balance) });
  } catch (err) {
    return errorResponse(err);
  }
}
