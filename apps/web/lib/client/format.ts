// Display formatting shared by the pages. Times are shown in Central Time like TJ's design.

const TIME_ZONE = "America/Chicago";

/** "1,250,000" */
export function number(value: number | string, decimals = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(Number(value));
}

/** "$12.50" from a backend Money.usd string like "12.50" */
export function usd(value: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}

/** "+$3.00", "−$5.00", "$0.00" */
export function signedUsd(value: number) {
  const sign = value > 0.004 ? "+" : value < -0.004 ? "−" : "";
  return `${sign}${usd(Math.abs(value))}`;
}

export function profitClass(value: number) {
  return value > 0.004 ? "positive" : value < -0.004 ? "negative" : "muted";
}

/** "Nov 18, 4:05 PM" (CT) from unix seconds */
export function dateTime(unixSeconds: number, withYear = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: TIME_ZONE,
  }).format(unixSeconds * 1000);
}

/** "04:59", or "1:04:59" when an hour or more is left */
export function countdown(secondsLeft: number) {
  const s = Math.max(0, Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Parses "1,250,000" or "1250000" into a whole number; null if it isn't one. */
export function parseWholeNumber(value: string): number | null {
  const v = value.trim();
  if (!(/^\d+$/.test(v) || /^\d{1,3}(,\d{3})+$/.test(v))) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

/** Basis points to a percent label: 2500 -> "25%" */
export function bps(value: number) {
  return `${value / 100}%`;
}
