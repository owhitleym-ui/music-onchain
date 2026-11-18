"use client";

// Competition page: TJ's "Support Artist" screen (`renderSupport`) connected to the real contract.
//
// Data:   GET /api/competitions/:id/leaderboard  (polled every 3s; filled by the QuickNode Stream)
//         GET /api/activity                      (polled every 5s; recent onchain events)
// Action: "Review prediction" -> review dialog -> "Confirm" runs, in order:
//           1. POST /api/faucet if the balance can't cover the entry fee (test USDC, first time only)
//           2. USDC.approve + Competition.enter from the fan's wallet (lib/client/enter.ts)
//
// Changes from TJ's demo, because the contract works differently:
//   - one prediction window per competition (no 24h / 48h / 1-week tabs)
//   - one fixed entry price per wallet (no $100 bundle)
//   - "Most popular guesses" became crowd stats, and a live entries / final results table was added
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { PrizeSplit, RulesModal } from "@/components/RulesModal";
import { Avatar, FollowButton } from "@/components/SongBits";
import { ViewsChart } from "@/components/ViewsChart";
import { DetailRows, EmptyState, Modal, useToast } from "@/components/ui";
import { useAccount } from "@/lib/client/account";
import { usePoll } from "@/lib/client/api";
import { enterCompetition, friendlyError, type EnterStep } from "@/lib/client/enter";
import { bps, countdown, dateTime, number, parseWholeNumber, usd } from "@/lib/client/format";
import { sampleHistory } from "@/lib/client/history";
import { rememberCompetition } from "@/lib/client/prefs";
import type { ActivityItem, CompetitionSummary, Leaderboard, LeaderboardEntry } from "@/lib/client/types";
import { useWallet } from "@/lib/client/wallet";

/** Wall-clock seconds, ticking once a second (null until the first tick, to keep rendering pure). */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000);
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

export default function CompetePage() {
  // useParams reads the URL, which Next 16 requires inside a Suspense boundary.
  return (
    <Suspense fallback={<main className="page-shell">Loading…</main>}>
      <Compete />
    </Suspense>
  );
}

function Compete() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const wallet = useWallet();
  const viewer = wallet.address ? `?viewer=${wallet.address}` : "";
  const board = usePoll<Leaderboard>(Number.isInteger(id) && id > 0 ? `/api/competitions/${id}/leaderboard${viewer}` : null, 3000);
  const activity = usePoll<{ ok: true; available: boolean; items: ActivityItem[] }>("/api/activity?limit=50", 5000);

  useEffect(() => {
    if (id > 0) rememberCompetition(id); // the header's "Support Artist" tab returns here
  }, [id]);

  if (board.loading) return <main className="page-shell">Loading…</main>;
  if (!board.data) {
    return (
      <main className="page-shell">
        <EmptyState
          title="Competition not found"
          description={board.error ?? "This competition doesn't exist."}
          action={
            <Link className="button primary" href="/">
              Explore songs
            </Link>
          }
        />
      </main>
    );
  }
  return <CompetitionView board={board.data} refresh={board.refresh} activity={activity.data} />;
}

function CompetitionView({
  board,
  refresh,
  activity,
}: {
  board: Leaderboard;
  refresh: () => Promise<void>;
  activity: { available: boolean; items: ActivityItem[] } | null;
}) {
  const c = board.competition;
  const song = c.song;
  const wallet = useWallet();
  const now = useNow();
  const [historyDays, setHistoryDays] = useState(7);
  const [guess, setGuess] = useState("");
  const [formError, setFormError] = useState("");
  const [modal, setModal] = useState<null | "rules" | { guess: number }>(null);

  // Seconds until entries close. The server measures on the chain's clock; we tick it down
  // locally between polls and never show more time than the wall clock allows.
  const secondsLeft = c.phase === "open" ? Math.max(0, now === null ? c.secondsLeft : Math.min(c.secondsLeft, c.closesAt - now)) : 0;
  const open = c.phase === "open" && secondsLeft > 0;
  const mine = board.entries.find((e) => e.isYou) ?? null;
  const predictions = board.entries.map((e) => Number(e.prediction));
  const crowdAverage = predictions.length ? predictions.reduce((a, b) => a + b, 0) / predictions.length : null;
  const people = new Set(board.entries.map((e) => e.name)).size;
  const chainNow = c.closesAt - c.secondsLeft; // the chain time this data was read at
  const history = useMemo(() => sampleHistory(song, Math.min(chainNow, c.closesAt), historyDays), [song, chainNow, c.closesAt, historyDays]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.authenticated) return wallet.login();
    const value = parseWholeNumber(guess);
    if (value === null) return setFormError("Enter a whole number of views, starting at zero.");
    setModal({ guess: value });
  }

  return (
    <main className="page-shell support-page">
      <Link className="breadcrumb" href="/">
        <Icon name="back" /> All songs
      </Link>
      <div className="song-page-heading">
        <div className="song-heading-meta">
          <Avatar song={song} />
          <div>
            {/* The "sample data" caveat for the chart lives in the chart legend ("Past views (sample)"). */}
            <p className="eyebrow">{c.metric}</p>
            <h1 className="page-title">{c.title}</h1>
            <p className="song-artist">
              {c.artist} <span className="genre-tag">{song.genre}</span>
            </p>
          </div>
        </div>
        <button className="button secondary small" onClick={() => setModal("rules")}>
          <Icon name="info" /> How rewards work
        </button>
      </div>

      <div className="support-layout">
        <div className="support-main">
          <section className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <h2 className="panel-title">Follow the momentum</h2>
                <p className="muted chart-subtitle">Total views over time, with where the crowd thinks it lands</p>
              </div>
              <div className="segmented-control chart-controls" aria-label="Historical chart range">
                {[3, 7, 30].map((days) => (
                  <button key={days} onClick={() => setHistoryDays(days)} className={historyDays === days ? "active" : ""} aria-pressed={historyDays === days}>
                    {days}D
                  </button>
                ))}
              </div>
            </div>
            <div className="chart-wrap">
              <ViewsChart
                history={history}
                closesAt={c.closesAt}
                crowdAverage={crowdAverage}
                yourGuess={mine ? Number(mine.prediction) : parseWholeNumber(guess)}
                finalMetric={c.finalMetric ? Number(c.finalMetric) : null}
              />
            </div>
            <div className="chart-legend">
              <span>
                <i className="legend-line solid" />
                Past views (sample)
              </span>
              <span>
                <i className="legend-line dashed" />
                Crowd average
              </span>
              <span className="chart-note">Type a guess to see it on the chart</span>
            </div>
          </section>

          <section className="panel prediction-panel">
            <div className="panel-heading">
              <h2 className="panel-title">Make your prediction</h2>
              <PhaseBadge c={c} open={open} />
            </div>
            <div className="window-box">
              <span className="window-label">Closest guess wins · result: {c.metric}</span>
              <span className="window-value">Entries close {dateTime(c.closesAt)} CT</span>
            </div>

            {mine ? (
              <div className="info-box">
                <strong>You&apos;re in.</strong> Your guess: {number(mine.prediction)} views.
                {c.phase === "settled" && (mine.payout ? ` You placed #${mine.rank} and won ${usd(mine.payout.usd)}.` : ` You placed #${mine.rank}.`)}
                {c.phase === "cancelled" && ` Refunded ${usd(c.entryFee.usd)}.`}
              </div>
            ) : (
              <form className="prediction-form" noValidate onSubmit={submit}>
                <div className="prediction-grid">
                  <label className="guess-field field-label" htmlFor="prediction-guess">
                    Your guess, in views
                    <input
                      id="prediction-guess"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={`e.g. ${number(crowdAverage ?? song.sampleTotalViews)}`}
                      value={guess}
                      disabled={!open}
                      aria-describedby="guess-hint form-error"
                      onChange={(e) => {
                        setGuess(e.target.value);
                        setFormError("");
                      }}
                    />
                  </label>
                  <fieldset className="amount-fieldset">
                    <legend className="field-label">Your entry</legend>
                    <div className="amount-options">
                      {/* The contract has one fixed price and one entry per wallet, so there's one option. */}
                      <button type="button" className="amount-option selected" aria-pressed="true" disabled={!open}>
                        <span className="amount-top">{usd(c.entryFee.usd)}</span>
                        <span className="amount-bottom">1 entry</span>
                        <span className="standard-label">Test USDC</span>
                      </button>
                    </div>
                  </fieldset>
                </div>
                <p id="guess-hint" className="fine-print">
                  One {usd(c.entryFee.usd)} entry per person. {bps(c.split.artistBps)} of the pool goes to {c.artist}.
                </p>
                <p className="error-message" id="form-error" role="alert">
                  {formError}
                </p>
                <div className="purchase-footer">
                  <BalanceCaption />
                  <SubmitButton c={c} open={open} />
                </div>
              </form>
            )}
          </section>

          <ResultsPanel board={board} />
        </div>

        <aside className="support-sidebar">
          <section className="panel">
            <div className="artist-summary">
              <Avatar song={song} className="artist-avatar" />
              <div>
                <span className="field-label">You&apos;re supporting</span>
                <h2 className="artist-heading">{c.artist}</h2>
              </div>
            </div>
            <FollowButton song={song} className="button secondary full-width" />
            <details className="artist-details">
              <summary>
                About the artist <Icon name="down" />
              </summary>
              <p className="artist-bio">{song.bio}</p>
              <p className="fine-print">The artist receives {bps(c.split.artistBps)} of every prize pool in their competitions.</p>
            </details>
            {board.artistEarned && (
              <div className="round-total">
                <span>{c.artist} earned</span>
                <strong>{usd(board.artistEarned.usd)}</strong>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="round-meta">
              <span className="field-label">Entries close</span>
              <strong>{dateTime(c.closesAt)} CT</strong>
            </div>
            <div className="round-status">
              <Icon name="clock" />
              <span>{open ? "Entries close in" : c.phase === "settled" ? "Settled" : c.phase === "cancelled" ? "Cancelled" : "Waiting for the result"}</span>
              {open && <strong className="countdown">{countdown(secondsLeft)}</strong>}
            </div>
            <div className="stat-grid">
              <div className="side-stat">
                <strong>{number(people)}</strong>
                <span>people</span>
              </div>
              <div className="side-stat">
                <strong>{number(c.numEntries)}</strong>
                <span>of {c.maxEntries} entries</span>
              </div>
            </div>
            <div className="round-total">
              <span>Prize pool</span>
              <strong>{usd(c.pot.usd)}</strong>
            </div>
            <dl className="prize-list">
              {c.prizes.winners.map((p, i) => (
                <div key={i}>
                  <dt>{["1st", "2nd", "3rd"][i] ?? `${i + 1}th`} place</dt>
                  <dd>{usd(p.usd)}</dd>
                </div>
              ))}
              <div>
                <dt>Artist</dt>
                <dd>{usd(c.prizes.artist.usd)}</dd>
              </div>
            </dl>
            <p className="fine-print">
              {c.phase === "open" || c.phase === "closed" ? "Projected from the current pool. " : ""}
              Needs {c.minEntries} entries, or everyone is refunded.
            </p>
          </section>

          <section className="panel popular-panel">
            <h2 className="panel-title">Crowd guesses</h2>
            <p className="fine-print">From every entry so far</p>
            <table className="popular-table">
              <tbody>
                <tr className="popular-row">
                  <td>Average</td>
                  <td>{crowdAverage === null ? "—" : number(crowdAverage)}</td>
                </tr>
                <tr className="popular-row">
                  <td>Lowest – highest</td>
                  <td>{predictions.length ? `${number(Math.min(...predictions))} – ${number(Math.max(...predictions))}` : "—"}</td>
                </tr>
                <tr className={`popular-row ${mine ? "selected" : ""}`}>
                  <td>Your guess</td>
                  <td>{mine ? number(mine.prediction) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <ActivityPanel competitionId={c.id} activity={activity} />
        </aside>
      </div>

      {modal === "rules" && <RulesModal competition={c} onClose={() => setModal(null)} />}
      {modal && modal !== "rules" && (
        <ConfirmModal
          c={c}
          guess={modal.guess}
          onClose={() => setModal(null)}
          onDone={async () => {
            setModal(null);
            setGuess("");
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function PhaseBadge({ c, open }: { c: CompetitionSummary; open: boolean }) {
  if (open) return <span className="badge green">Accepting entries</span>;
  if (c.phase === "settled") return <span className="badge blue">Results in</span>;
  if (c.phase === "cancelled") return <span className="badge">Refunded</span>;
  return <span className="badge orange">Entries closed</span>;
}

function BalanceCaption() {
  const wallet = useWallet();
  const { balance } = useAccount();
  if (!wallet.authenticated) return <span className="cost-caption">Sign in with email. No crypto setup needed.</span>;
  return (
    <span className="cost-caption">
      <Icon name="wallet" /> {balance ? usd(balance.usd) : "…"} test USDC
    </span>
  );
}

/** The one button under the form; its label follows the user and competition state. */
function SubmitButton({ c, open }: { c: CompetitionSummary; open: boolean }) {
  const wallet = useWallet();
  if (!open)
    return (
      <button className="button primary" type="button" disabled>
        {c.phase === "settled" ? "Results are in" : c.phase === "cancelled" ? "Refunded" : "Awaiting result"}
      </button>
    );
  if (!wallet.ready)
    return (
      <button className="button primary" type="button" disabled>
        Loading…
      </button>
    );
  return (
    <button className="button primary" type="submit">
      {wallet.authenticated ? "Review prediction" : "Sign in to predict"} <Icon name="arrow" />
    </button>
  );
}

/** Live entries while open; ranked results with payouts once settled; refunds if cancelled. */
function ResultsPanel({ board }: { board: Leaderboard }) {
  const c = board.competition;
  const settled = c.phase === "settled";
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2 className="panel-title">{settled ? "Final results" : c.phase === "cancelled" ? "Refunded entries" : "Live entries"}</h2>
        <span className={`source-note ${board.source}`}>{board.source === "stream" ? "Live via QuickNode Stream" : "Read from the contract"}</span>
      </div>
      {settled && (
        <div className="result-banner">
          <span>Result: {c.metric}</span>
          <strong>{number(c.finalMetric ?? 0)}</strong>
        </div>
      )}
      {c.phase === "cancelled" && (
        <div className="result-banner cancelled">
          <span>Fewer than {c.minEntries} entries or cancelled. Everyone got their entry back.</span>
        </div>
      )}
      {board.entries.length === 0 ? (
        <p className="results-empty">No entries yet. Be the first.</p>
      ) : (
        <table className="popular-table results-table">
          <thead>
            <tr>
              <th scope="col">{settled ? "Rank" : "#"}</th>
              <th scope="col">Player</th>
              <th scope="col">Guess</th>
              {settled && <th scope="col">Off by</th>}
              <th scope="col">{settled ? "Payout" : c.phase === "cancelled" ? "Refund" : ""}</th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((e: LeaderboardEntry) => (
              <tr key={e.entryIndex} className={e.isYou ? "is-you" : ""}>
                <td className="rank-cell">{settled ? `#${e.rank}` : e.entryIndex + 1}</td>
                <td>{e.name}</td>
                <td>{number(e.prediction)}</td>
                {settled && <td>{number(e.error ?? 0)}</td>}
                <td className={e.payout ? "payout" : ""}>{e.payout ? usd(e.payout.usd) : e.refund ? usd(e.refund.usd) : settled ? "—" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Recent onchain events for this competition, delivered by the QuickNode Stream. Hidden without a database. */
function ActivityPanel({ competitionId, activity }: { competitionId: number; activity: { available: boolean; items: ActivityItem[] } | null }) {
  if (!activity?.available) return null;
  const items = activity.items.filter((i) => i.competitionId === competitionId).slice(0, 6);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2 className="panel-title">Live activity</h2>
        <span className="source-note">QuickNode Stream</span>
      </div>
      {items.length === 0 ? (
        <p className="results-empty">Nothing yet.</p>
      ) : (
        <ul className="activity-list">
          {items.map((i) => (
            <li key={`${i.txHash}-${i.event}-${i.text}`}>
              <span>{i.text}</span>
              {i.at && <time dateTime={i.at}>{new Date(i.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Review + confirm dialog (TJ's "Review your prediction"). Confirming runs the real flow:
 * faucet if needed -> approve -> enter, showing each step, then refreshes the page data.
 */
function ConfirmModal({ c, guess, onClose, onDone }: { c: CompetitionSummary; guess: number; onClose: () => void; onDone: () => Promise<void> }) {
  const wallet = useWallet();
  const { balance, requestTestUsdc, refreshBalance } = useAccount();
  const toast = useToast();
  const [step, setStep] = useState<"idle" | "faucet" | EnterStep>("idle");
  const [error, setError] = useState("");
  // Whether this run started with a faucet step. Frozen at click time so the step list doesn't
  // change shape when the balance refreshes mid-flow.
  const [usedFaucet, setUsedFaucet] = useState(false);
  const busy = step !== "idle" && step !== "done";

  const fee = BigInt(c.entryFee.raw);
  const needsFunds = balance !== null && BigInt(balance.raw) < fee;
  // What first place would win if this entry is the last one in (pool grows by one fee).
  const firstPrize = ((BigInt(c.pot.raw) + fee) * BigInt(c.split.winnersBps[0] ?? 0)) / 10_000n;

  async function confirm() {
    setError("");
    setUsedFaucet(needsFunds);
    try {
      if (needsFunds) {
        setStep("faucet");
        const funded = await requestTestUsdc();
        if (BigInt(funded.balance.raw) < fee) throw new Error("Your balance is too low for this entry, and this wallet already received test USDC.");
      }
      const walletClient = await wallet.getWalletClient();
      await enterCompetition({ walletClient, competitionId: c.id, prediction: BigInt(guess), entryFee: fee, onStep: setStep });
      toast(`Entry recorded: ${number(guess)} views on ${c.title}.`);
      await refreshBalance();
      await onDone();
    } catch (e) {
      setStep("idle");
      setError(friendlyError(e));
    }
  }

  const stepClass = (mine: string, order: string[]) => {
    const at = order.indexOf(step);
    const me = order.indexOf(mine);
    return at === me ? "active" : at > me ? "done" : "";
  };
  const order = ["faucet", "approve", "enter", "done"];

  return (
    <Modal
      title="Review your prediction"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button className="button secondary" onClick={onClose} disabled={busy}>
            Go back
          </button>
          <button className="button primary" onClick={confirm} disabled={busy}>
            {busy ? "Working…" : `Confirm ${usd(c.entryFee.usd)} prediction`}
          </button>
        </>
      }
    >
      <div className="confirmation-song">
        <Avatar song={c.song} />
        <div>
          <strong>{c.title}</strong>
          <span className="subline">{c.artist}</span>
        </div>
        <span className="badge blue">Test USDC</span>
      </div>
      <DetailRows
        rows={[
          ["Entries close", `${dateTime(c.closesAt)} CT`],
          ["Result", c.metric],
          ["Your guess", <strong key="g">{number(guess)} views</strong>],
          ["Entry", "1 entry · one per person"],
          ["1st place would win", usd(Number(firstPrize) / 1e6)],
        ]}
      />
      <PrizeSplit split={c.split} />
      <div className="confirmation-total">
        <span>Total from your balance</span>
        <strong>{usd(c.entryFee.usd)}</strong>
      </div>
      {needsFunds && step === "idle" && <p className="fine-print">Your balance is {usd(balance!.usd)}, so we&apos;ll add free test USDC first.</p>}
      {step !== "idle" && (
        <ol className="steps" aria-live="polite">
          {usedFaucet && <li className={stepClass("faucet", order)}>Adding test USDC to your balance</li>}
          <li className={stepClass("approve", order)}>Approving the {usd(c.entryFee.usd)} payment</li>
          <li className={stepClass("enter", order)}>Recording your entry</li>
        </ol>
      )}
      <p className="fine-print">Your guess is locked once it&apos;s recorded.</p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
