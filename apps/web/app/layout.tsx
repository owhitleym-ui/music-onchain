// Root layout: TJ's design system, the client providers (wallet, balance, toasts) and the header
// on every page. Pages: / (Discover), /compete/[id] (Support Artist), /entries (My Purchases), /admin.
import type { Metadata } from "next";
import { Suspense } from "react";
import { BRAND } from "@/brand.config";
import { Header } from "@/components/Header";
import "./globals.css";
import "./predict.css"; // TJ's design system; loaded after globals.css so its tokens win
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: `${BRAND.tagline} Testnet prototype.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the header's theme toggle; light until the browser says otherwise.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <Providers>
          {/* The header reads the URL (active tab), which Next 16 requires inside Suspense. */}
          <Suspense fallback={<div className="site-header" />}>
            <Header />
          </Suspense>
          {children}
        </Providers>
      </body>
    </html>
  );
}
