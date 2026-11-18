// Server-side Privy login check, used by /api/faucet so free test USDC only goes to real,
// signed-in users. The browser sends its Privy access token; we verify it with Privy's SDK
// (signature + expiry) and look up the user's embedded wallet address from Privy itself.
import "server-only";
import { PrivyClient } from "@privy-io/node";
import { getAddress, type Address } from "viem";
import { env } from "./env";
import { HttpError } from "./http";

let _privy: PrivyClient | undefined;
function privy() {
  _privy ??= new PrivyClient({ appId: env.privyAppId(), appSecret: env.privyAppSecret() });
  return _privy;
}

export type AuthedUser = { userId: string; address: Address };

/**
 * Verifies the Privy access token from `Authorization: Bearer <token>` and returns the
 * user's Privy embedded Ethereum wallet. The address always comes from Privy, never from
 * the request body, so nobody can point the faucet at an arbitrary wallet.
 */
export async function requirePrivyUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sign in first", "unauthorized");

  let userId: string;
  try {
    const claims = await privy().utils().auth().verifyAccessToken(token);
    userId = claims.user_id;
  } catch {
    throw new HttpError(401, "Session expired. Sign in again.", "unauthorized");
  }

  const user = await privy().users()._get(userId);
  const wallet = user.linked_accounts.find(
    (a) =>
      a.type === "wallet" &&
      "chain_type" in a &&
      a.chain_type === "ethereum" &&
      "wallet_client_type" in a &&
      a.wallet_client_type === "privy",
  );
  if (!wallet || !("address" in wallet)) {
    throw new HttpError(409, "No embedded wallet yet. Try again in a moment.", "no_wallet");
  }
  return { userId, address: getAddress(wallet.address) };
}
