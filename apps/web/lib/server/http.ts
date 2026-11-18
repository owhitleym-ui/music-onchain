// Shared helpers for every API route: JSON responses, one error format
// ({ ok: false, error, message }), the admin-secret check, and input validation.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { ConfigError, env } from "./env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit) {
  // JSON can't carry bigint; callers should convert, but don't crash if one slips through.
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new Response(body, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Turns any thrown value into a JSON error response with a readable message. */
export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ ok: false, error: err.code, message: err.message }, { status: err.status });
  if (err instanceof ConfigError) {
    console.error(err.message);
    return json({ ok: false, error: "server_misconfigured", message: err.message }, { status: 500 });
  }
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "Reverted";
      return json({ ok: false, error: "contract_revert", message: name }, { status: 409 });
    }
    console.error(err);
    return json({ ok: false, error: "chain_error", message: err.shortMessage }, { status: 502 });
  }
  console.error(err);
  return json({ ok: false, error: "internal", message: "Unexpected server error" }, { status: 500 });
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function requireAdmin(request: Request) {
  const given = request.headers.get("x-admin-secret") ?? "";
  if (!given || !safeEqual(given, env.adminSecret())) {
    throw new HttpError(401, "Admin secret missing or wrong", "unauthorized");
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON", "bad_request");
  }
}

export function parseId(value: unknown, name = "competitionId"): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new HttpError(400, `${name} must be a positive integer`, "bad_request");
  }
  return n;
}

export function parseUint(value: unknown, name: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new HttpError(400, `${name} must be a non-negative whole number`, "bad_request");
}
