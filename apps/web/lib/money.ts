// USDC uses 6 decimals on the ERC-20 interface (1_000_000 = $1).
// Never mix in native-balance values on Arc, which use 18 decimals.
// Dependency-free so `node --test` can import it directly.

export const USDC_DECIMALS = 6;
const UNIT = 1_000_000n;

/** 12_500_000n -> "12.50". Truncates below one cent. */
export function formatUsd(raw: bigint): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const dollars = abs / UNIT;
  const cents = (abs % UNIT) / 10_000n;
  return `${negative ? "-" : ""}${dollars}.${cents.toString().padStart(2, "0")}`;
}

/** "10" or "10.5" -> 10_500_000n. Rejects more than 6 decimals or anything non-numeric. */
export function parseUsd(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid USD amount: ${value}`);
  const [, whole, frac = ""] = match;
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(6, "0"));
}

/** Money as both a display string and the raw 6-decimal integer (as a string, for JSON). */
export function money(raw: bigint) {
  return { usd: formatUsd(raw), raw: raw.toString() };
}
