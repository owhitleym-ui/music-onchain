"use client";

// Site header from TJ's design. The demo's fake "$1,000 demo wallet" and "Reset demo" are
// replaced by the real thing:
//   signed out -> "Sign in" (Privy email login, or the local test wallet in development)
//   signed in  -> balance button; its menu has "Get test USDC" (POST /api/faucet) and "Sign out"
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/brand.config";
import { useAccount } from "@/lib/client/account";
import { usd } from "@/lib/client/format";
import { useLastCompetition, useTheme } from "@/lib/client/prefs";
import { useWallet } from "@/lib/client/wallet";
import { Icon } from "./Icon";
import { useToast } from "./ui";

export function Header() {
  const pathname = usePathname();
  const wallet = useWallet();
  const { balance, requestTestUsdc } = useAccount();
  const { theme, toggle: toggleTheme } = useTheme();
  const lastCompetition = useLastCompetition();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [funding, setFunding] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // Apply the theme to <html data-theme>, which TJ's stylesheet keys off.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Close the profile menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const page = pathname.startsWith("/compete")
    ? "support"
    : pathname.startsWith("/entries")
      ? "purchases"
      : pathname === "/"
        ? "discover"
        : "other"; // e.g. /admin: no tab highlighted
  const navLink = (href: string, key: string, label: string) => (
    <Link href={href} className={page === key ? "active" : ""} aria-current={page === key ? "page" : undefined}>
      {label}
    </Link>
  );

  async function getTestUsdc() {
    setFunding(true);
    try {
      const result = await requestTestUsdc();
      toast(result.alreadyFunded ? `You already received test USDC. Balance ${usd(result.balance.usd)}.` : `Added ${usd(result.amount?.usd ?? "0")} test USDC.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't add test USDC.");
    } finally {
      setFunding(false);
      setMenuOpen(false);
    }
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label={`${BRAND.name} home`}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {BRAND.name}
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          {navLink("/", "discover", "Discover")}
          {navLink(`/compete/${lastCompetition}`, "support", "Support Artist")}
          {navLink("/entries", "purchases", "My Purchases")}
        </nav>
        <div className="header-actions">
          {/* Project rule: always label the app as a testnet prototype. */}
          <span className="demo-badge">
            <span />
            Testnet prototype
          </span>
          <button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} title="Switch theme">
            <Icon name={theme === "light" ? "moon" : "sun"} />
          </button>

          {wallet.ready && !wallet.authenticated && (
            <button className="button primary small sign-in-button" onClick={wallet.login}>
              Sign in
            </button>
          )}

          {wallet.authenticated && (
            <div className="profile-anchor" ref={anchor}>
              <button className="balance-button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={`Wallet, balance ${balance ? usd(balance.usd) : "loading"}`}>
                <Icon name="wallet" />
                <span>{balance ? usd(balance.usd) : "…"}</span>
                <Icon name="down" />
              </button>
              {menuOpen && (
                <div className="profile-menu">
                  <div className="profile-caption">{wallet.label ?? "Your wallet"} · test USDC</div>
                  <div className="profile-balance">{balance ? usd(balance.usd) : "…"}</div>
                  <button className="menu-item" onClick={getTestUsdc} disabled={funding}>
                    <Icon name="wallet" /> {funding ? "Adding test USDC…" : "Get test USDC"}
                  </button>
                  <button
                    className="menu-item"
                    onClick={async () => {
                      setMenuOpen(false);
                      await wallet.logout();
                    }}
                  >
                    <Icon name="reset" /> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
