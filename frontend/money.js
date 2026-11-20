// Integer cents throughout the demo; integer native units until balance formatting.
export function formatDollars(value, { fixed = false } = {}) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('Expected whole cents.');
  const cents = BigInt(value);
  const amount = cents < 0n ? -cents : cents;
  const whole = (amount / 100n).toLocaleString('en-US');
  const fraction = String(amount % 100n).padStart(2, '0');
  return `${cents < 0n ? '−' : ''}$${whole}${fixed || amount % 100n ? `.${fraction}` : ''}`;
}

export function formatAccountDollars(value) {
  const units = BigInt(value);
  if (units < 0n) throw new RangeError('Balance cannot be negative.');
  // Round to cents using only integer arithmetic. The native asset has 18 decimals.
  return formatDollars((units + 5_000_000_000_000_000n) / 10_000_000_000_000_000n, { fixed: true });
}
