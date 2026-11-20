import './app.js';
import { account } from './account.js';

// Browsing and sample charts work even if the optional sign-in SDK cannot load.
void import('./auth.jsx').catch(() => account.failInitialization());
