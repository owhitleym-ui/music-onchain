export class AppError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

export const messages = Object.freeze({
  PAYMENTS_NOT_READY: 'Test purchases are waiting for the new payment setup.',
  PAYMENTS_UNAVAILABLE: 'Purchases are temporarily unavailable. Please try again.',
  ROUND_UNAVAILABLE: 'This test round is unavailable.',
  ROUND_CLOSED: 'This round is not accepting entries.',
  APPROVAL_REQUIRED: 'Finish activating your account before purchasing.',
  ARTIST_EXCLUDED: 'This account cannot enter this contest.',
  RESERVE_UNAVAILABLE: 'The ten-spot option is temporarily unavailable.',
  INSUFFICIENT_BALANCE: 'Your balance must cover the entry and its network fee.',
  ORDER_PENDING: 'A purchase is already in progress. Open My Purchases to check it.',
  ORDER_CONFLICT: 'This purchase request does not match the saved order.',
  ORDER_NOT_FOUND: 'This purchase could not be found for your account.',
  ORDER_EXPIRED: 'This confirmation expired. Please start again.',
  BAD_SIGNATURE: 'The payment authorization did not match this purchase.',
  PAYMENT_MISMATCH: 'Your purchase needs the organizer’s attention. Do not pay again.',
  PAYMENT_UNCERTAIN: 'We are checking this payment. Do not pay again.',
  PAYMENT_REVERTED: 'The entry payment failed. A network fee may still apply.',
  OLD_CONTRACT_PENDING: 'Finish outstanding administrator actions before changing contracts.',

  AUTH_REQUIRED: 'Please sign in again to activate your account.',
  EMAIL_REQUIRED: 'Finish verifying your email before activating your account.',
  ACCOUNT_UNAVAILABLE: 'Your account is unavailable. Please contact the organizer.',
  WALLET_PENDING: 'We’re finishing your account setup. Please try again shortly.',
  CONFIG_REQUIRED: 'Account activation is not available yet. Please try again later.',
  DB_UNAVAILABLE: 'Account activation is temporarily unavailable. Please try again.',
  RPC_UNAVAILABLE: 'Account activation is temporarily unavailable. Please try again.',
  RATE_LIMITED: 'Account activation is busy. Please try again later.',
  REVOKED: 'Account activation has been disabled. Please contact the organizer.',
  OWNER_NOT_READY: 'Account activation is not available yet. Please try again later.',
  NO_GAS: 'Account activation is temporarily unavailable. Please contact the organizer.',
  TX_REVERTED: 'Account activation did not finish. Please try again.',
  NONCE_CONFLICT: 'Your activation needs the organizer’s attention. Please try again later.',
  BAD_REQUEST: 'This account request could not be processed.',
});

export function publicError(error) {
  const code = error instanceof AppError && messages[error.code] ? error.code : 'CONFIG_REQUIRED';
  return { status: 'error', code, message: messages[code] };
}
