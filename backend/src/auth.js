import { PrivyClient } from '@privy-io/node';
import { linkedEmbeddedWallet } from '../../frontend/privy-session.js';
import { APP_ID, address } from './config.js';
import { AppError } from './errors.js';

export function identityFromUser(user, userId) {
  if (user?.id !== userId || user.is_guest || user.frozen_at != null) throw new AppError('ACCOUNT_UNAVAILABLE', 403);
  const linked = user.linked_accounts ?? [];
  if (!linked.some(item => item.type === 'email' && typeof item.address === 'string'
    && Number(item.verified_at ?? item.latest_verified_at ?? item.first_verified_at) > 0)) throw new AppError('EMAIL_REQUIRED', 403);
  const normalized = linked.map(item => ({ ...item,
    chainType: item.chain_type, walletClientType: item.wallet_client_type, walletIndex: item.wallet_index,
  }));
  const wallet = linkedEmbeddedWallet({ linkedAccounts: normalized });
  if (!wallet) throw new AppError('WALLET_PENDING', 409);
  return { appId: APP_ID, userId, wallet: address(wallet.address) };
}

export function createAuthenticator({ verifyToken, getUser }) {
  return async authorization => {
    const match = /^Bearer ([^\s]{1,20000})$/.exec(authorization ?? '');
    if (!match) throw new AppError('AUTH_REQUIRED', 401);
    let token;
    try { token = await verifyToken(match[1]); } catch { throw new AppError('AUTH_REQUIRED', 401); }
    if (token?.app_id !== APP_ID || typeof token.user_id !== 'string' || !token.user_id.startsWith('did:privy:')) throw new AppError('AUTH_REQUIRED', 401);
    let user;
    try { user = await getUser(token.user_id); } catch { throw new AppError('CONFIG_REQUIRED'); }
    return identityFromUser(user, token.user_id);
  };
}

export function privyAuthenticator(config) {
  const privy = new PrivyClient({ appId: APP_ID, appSecret: config.appSecret, timeout: 10000, maxRetries: 0 });
  // Verify every token. Cache only authoritative profiles briefly to bound polling lookups.
  const profiles = new Map();
  return createAuthenticator({
    verifyToken: value => privy.utils().auth().verifyAccessToken(value),
    getUser: async id => {
      const previous = profiles.get(id);
      if (previous && previous.expires > Date.now()) return previous.value;
      const value = await privy.users()._get(id);
      if (profiles.size > 200) profiles.clear();
      // Do not cache the wallet-less state while onboarding is still creating a wallet.
      if ((value.linked_accounts ?? []).some(item => item.type === 'wallet')) profiles.set(id, { value, expires: Date.now() + 10000 });
      return value;
    },
  });
}
