import {PAYMENT_OPTIONS,paymentOption} from './payments-options.js';
// Browser samples use cents. Payments use integer native units internally.
export const SPOT_PRICE_CENTS=paymentOption('single').costCents;
export const FOUR_SPOT_PRICE_CENTS=paymentOption('four').costCents;
export const BUNDLE_SPOTS=paymentOption('bundle').spots;
export const BUNDLE_PRICE_CENTS=paymentOption('bundle').costCents;
export const BUNDLE_MULTIPLIER=paymentOption('bundle').multiplier;
export const ENTRY_PRICES_CENTS=Object.freeze(PAYMENT_OPTIONS.map(o=>o.costCents));
export {PAYMENT_OPTIONS};
