"use client";

// "My Purchases" (TJ's `renderPurchases`), filled from GET /api/me/entries for the signed-in
// wallet instead of browser-stored demo purchases. Same two tabs:
//   Subscribed     - artists you follow (stored in this browser) and their competitions
//   All Purchases  - every entry you've made, with rank, status and net profit
// Clicking a row opens the same breakdown dialog as TJ's, using the contract's real numbers.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon } from "@/components/Icon";
import { Avatar, FollowButton } from "@/components/SongBits";
import { DetailRows, EmptyState, Modal } from "@/components/ui";
import { usePoll } from "@/lib/client/api";
import { dateTime, number, profitClass, signedUsd, usd } from "@/lib/client/format";
import { useFollows } from "@/lib/client/prefs";
import type { CompetitionSummary, MyEntry } from "@/lib/client/types";
import { useWallet } from "@/lib/client/wallet";

type Status = "open" | "awaiting" | "won" | "completed" | "refunded";

function statusOf(e: MyEntry): Status {
  const phase = e.competition.phase;
  if (phase === "open") return "open";
  if (phase === "closed") return "awaiting";
  if (phase === "cancelled") return "refunded";
  return e.payout ? "won" : "completed";
}

const STATUS_LABEL: Record<Status, { text: string; tone: string }> = {
  open: { text: "Open", tone: "blue" },
  awaiting: { text: "Awaiting result", tone: "orange" },
  won: { text: "Won", tone: "green" },
  completed: { text: "Completed", tone: "" },
  refunded: { text: "Refunded", tone: "" },
};

/** Net result of one entry in dollars: payout or refund minus the entry fee. Null while pending. */
function netOf(e: MyEntry): number | null {
  const fee = Number(e.competition.entryFee.usd);
  const s = statusOf(e);
  if (s === "open" || s === "awaiting") return null;
  if (s === "refunded") return 0;
  return Number(e.payout?.usd ?? 0) - fee;
}

function StatusBadge({ e }: { e: MyEntry }) {
  const s = STATUS_LABEL[statusOf(e)];
  return (
    <span className={`badge ${s.tone}`}>
      <span className="status-dot" />
      {s.text}
    </span>
  );
}

export default function EntriesPage() {
  // useSearchParams needs a Suspense boundary so the rest of the page can prerender.
  return (
    <Suspense fallback={<main className="page-shell">Loading…</main>}>
      <Entries />
    </Suspense>
  );
}

function Entries() {
  const wallet = useWallet();
  const tab = useSearchParams().get("tab") === "subscribed" ? "subscribed" : "all";
  const { follows } = useFollows();
  const mine = usePoll<{ ok: true; entries: MyEntry[] }>(wallet.address ? `/api/me/entries?address=${wallet.address}` : null, 5000);
  const all = usePoll<{ ok: true; competitions: CompetitionSummary[] }>("/api/competitions", 10_000);
  const [detail, setDetail] = useState<MyEntry | null>(null);

  const entries = mine.data?.entries ?? [];
  const completed = entries.map(netOf).filter((n): n is number => n !== null);
  const netProfit = completed.reduce((a, b) => a + b, 0);
  const artistsSupported = new Set(entries.map((e) => e.competition.song.artistId)).size;
  // Artist share of each entry fee in settled competitions (the artist also gets rounding dust).
  const toArtists = entries
    .filter((e) => e.competition.phase === "settled")
    .reduce((sum, e) => sum + (Number(e.competition.entryFee.usd) * e.competition.split.artistBps) / 10_000, 0);
  const pending = entries.filter((e) => netOf(e) === null).length;

  // Subscribed tab: followed artists, with links to their competitions.
  const competitions = all.data?.competitions ?? [];
  const followedArtists = [...new Map(competitions.filter((c) => follows.includes(c.song.artistId)).map((c) => [c.song.artistId, c])).values()];

  let content;
  if (tab === "subscribed") {
    content = followedArtists.length ? (
      <div className="followed-grid">
        {followedArtists.map((c) => (
          <article className="followed-card" key={c.song.artistId}>
            <div className="artist-summary">
              <Avatar song={c.song} className="artist-avatar" />
              <div>
                <h2 className="artist-heading">{c.artist}</h2>
                <span className="genre-tag">{c.song.genre}</span>
              </div>
            </div>
            <p className="artist-bio">{c.song.bio}</p>
            <div className="followed-songs">
              {competitions
                .filter((x) => x.song.artistId === c.song.artistId)
                .map((x) => (
                  <Link key={x.id} href={`/compete/${x.id}`}>
                    {x.title} <Icon name="arrow" />
                  </Link>
                ))}
            </div>
            <FollowButton song={c.song} />
          </article>
        ))}
      </div>
    ) : (
      <EmptyState
        title="Find your people"
        description="Follow an artist to keep their songs here."
        action={
          <Link className="button primary" href="/">
            Discover artists
          </Link>
        }
      />
    );
  } else if (!wallet.authenticated) {
    content = (
      <EmptyState
        title="Sign in to see your predictions"
        description="Your entries are tied to your account, so they show up on any device."
        action={
          <button className="button primary" onClick={wallet.login} disabled={!wallet.ready}>
            Sign in
          </button>
        }
      />
    );
  } else if (mine.loading) {
    content = <p className="fine-print">Loading your entries…</p>;
  } else if (!entries.length) {
    content = (
      <EmptyState
        title="Your first prediction starts here"
        description="Choose a song and make a guess to see your entries here."
        action={
          <Link className="button primary" href="/">
            Explore songs
          </Link>
        }
      />
    );
  } else {
    content = (
      <div className="table-container">
        <table className="purchase-table">
          <thead>
            <tr>
              <th scope="col">Song / artist</th>
              <th scope="col">Closes</th>
              <th scope="col">Your guess</th>
              <th scope="col">Entry</th>
              <th scope="col">Rank</th>
              <th scope="col">Status</th>
              <th scope="col">Net profit</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const net = netOf(e);
              const c = e.competition;
              return (
                <tr
                  key={`${c.id}-${e.entryIndex}`}
                  className="purchase-row"
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${c.title} entry`}
                  onClick={() => setDetail(e)}
                  onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), setDetail(e))}
                >
                  <td>
                    <div className="purchase-song">
                      <Avatar song={c.song} className="purchase-song-avatar" />
                      <div className="purchase-song-meta">
                        <strong>{c.title}</strong>
                        <span className="subline">{c.artist}</span>
                      </div>
                    </div>
                  </td>
                  <td className="purchase-period-cell">
                    {dateTime(c.closesAt)}
                    <span className="subline purchase-period">{c.metric}</span>
                  </td>
                  <td>
                    {number(e.prediction)}
                    <span className="subline">views</span>
                  </td>
                  <td>
                    {usd(c.entryFee.usd)}
                    <span className="subline">1 entry</span>
                  </td>
                  <td>{e.rank ? <span className="rank-label">#{e.rank}</span> : <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge e={e} />
                  </td>
                  <td className="profit-cell">
                    {net === null ? (
                      <span className="muted">Awaiting result</span>
                    ) : (
                      <>
                        <strong className={profitClass(net)}>{signedUsd(net)}</strong>
                        <span className="subline">{usd(Number(e.payout?.usd ?? e.refund?.usd ?? 0))} returned</span>
                      </>
                    )}
                  </td>
                  <td className="row-arrow">
                    <Icon name="arrow" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Your music intuition, on record.</p>
          <h1 className="page-title">My Purchases</h1>
          <p className="page-description">Keep track of the artists you support and how your predictions perform.</p>
        </div>
        <span className="sample-data-label">Recorded onchain · test USDC</span>
      </div>
      <div className="portfolio-stats">
        <section className="portfolio-stat">
          <span className="field-label">Artists supported</span>
          <strong className="portfolio-value">
            {artistsSupported}
            <span>artists</span>
          </strong>
          <p className="fine-print">{usd(toArtists)} of your entry fees went to artists</p>
        </section>
        <section className="portfolio-stat">
          <span className="field-label">Net profit</span>
          <strong className={`portfolio-value ${profitClass(netProfit)}`}>{signedUsd(netProfit)}</strong>
          <p className="fine-print">Payouts and refunds minus entry fees, for finished competitions</p>
        </section>
      </div>
      <div className="purchase-toolbar">
        <div className="tabs" aria-label="Purchase views">
          <Link href="/entries?tab=subscribed" className={tab === "subscribed" ? "active" : ""}>
            Subscribed <span>{followedArtists.length}</span>
          </Link>
          <Link href="/entries" className={tab === "all" ? "active" : ""}>
            All Purchases <span>{entries.length}</span>
          </Link>
        </div>
        <span className="section-note">{tab === "all" ? `${pending} pending · ${entries.length - pending} completed` : "Following is free"}</span>
      </div>
      {content}
      <p className="fine-print page-footnote">Entries and payouts are recorded by the smart contract on Arc testnet. Test USDC has no real value.</p>
      {detail && <EntryDetail e={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}

/** TJ's purchase breakdown dialog with the contract's actual numbers. */
function EntryDetail({ e, onClose }: { e: MyEntry; onClose: () => void }) {
  const c = e.competition;
  const net = netOf(e);
  const fee = Number(c.entryFee.usd);
  return (
    <Modal
      title="Your prediction"
      onClose={onClose}
      footer={
        <>
          <Link className="button secondary" href={`/compete/${c.id}`} onClick={onClose}>
            View this competition <Icon name="arrow" />
          </Link>
          <button className="button primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="confirmation-song">
        <strong>{c.title}</strong>
        <StatusBadge e={e} />
      </div>
      <DetailRows
        rows={[
          ["Entries closed", `${dateTime(c.closesAt, true)} CT`],
          ["Result measured", c.metric],
          ["Your guess", `${number(e.prediction)} views`],
          ...(c.finalMetric ? ([["Actual", `${number(c.finalMetric)} views`]] as [string, string][]) : []),
          ...(e.rank ? ([["Rank", `#${e.rank} of ${c.numEntries} · off by ${number(e.error ?? 0)}`]] as [string, string][]) : []),
        ]}
      />
      <div className="breakdown-section">
        <h3>Breakdown</h3>
        <DetailRows
          rows={[
            ["Entry fee", usd(fee)],
            ["Payout", e.payout ? `+${usd(e.payout.usd)}` : usd(0)],
            ...(e.refund ? ([["Refund", `+${usd(e.refund.usd)}`]] as [string, string][]) : []),
            ["To the artist from this pool", c.phase === "settled" ? usd(c.prizes.artist.usd) : "After settlement"],
          ]}
        />
        {net !== null ? (
          <div className="breakdown-total profit-total">
            <span>Net profit</span>
            <strong className={profitClass(net)}>{signedUsd(net)}</strong>
          </div>
        ) : (
          <div className="info-box">Your entry is recorded onchain. The result is added once entries close and the real view count is submitted.</div>
        )}
      </div>
    </Modal>
  );
}
