"use client";

// "How rewards work" dialog. Same four-card layout as TJ's, rewritten for the rules the contract
// actually enforces (Competition.sol + SPEC.md). TJ's 100-rank curve and $100 bundle were dropped
// because the contract doesn't support them; see docs/BACKEND.md for that decision.
import { bps, usd } from "@/lib/client/format";
import type { CompetitionSummary } from "@/lib/client/types";
import { Modal } from "./ui";

export function PrizeSplit({ split }: { split: CompetitionSummary["split"] }) {
  const winners = split.winnersBps.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="split-bar" aria-hidden="true">
        <span className="winners" style={{ width: bps(winners) }} />
        <span className="artist" style={{ width: bps(split.artistBps) }} />
        <span className="platform" style={{ width: bps(split.platformBps) }} />
      </div>
      <div className="split-legend">
        <span>
          <i style={{ background: "var(--blue)" }} />
          Top {split.winnersBps.length}: {split.winnersBps.map(bps).join(" / ")}
        </span>
        <span>
          <i style={{ background: "var(--green)" }} />
          Artist {bps(split.artistBps)}
        </span>
        <span>
          <i style={{ background: "var(--orange)" }} />
          Platform {bps(split.platformBps)}
        </span>
      </div>
    </>
  );
}

export function RulesModal({ competition, onClose }: { competition: CompetitionSummary; onClose: () => void }) {
  const { split, entryFee, minEntries } = competition;
  const places = split.winnersBps.length;
  return (
    <Modal
      title="How rewards work"
      wide
      onClose={onClose}
      footer={
        <button className="button primary" onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="rules-grid">
        <section className="rule-card">
          <span className="rule-number">01</span>
          <h3>Guess the views</h3>
          <p>
            Each entry costs {usd(entryFee.usd)} in test USDC. Predict the result: {competition.metric}. One entry per
            person per competition, and your guess is locked once it&apos;s recorded.
          </p>
        </section>
        <section className="rule-card">
          <span className="rule-number">02</span>
          <h3>Closest guesses win</h3>
          <p>
            When entries close, the real number is submitted and the contract ranks every guess by how far off it was. If two guesses
            are equally close, the earlier entry ranks higher.
          </p>
        </section>
        <section className="rule-card">
          <span className="rule-number">03</span>
          <h3>Top {places} split the pool</h3>
          <p>
            All entry fees form the prize pool. The top {places} get {split.winnersBps.map(bps).join(", ")} of it. Everyone else&apos;s entry
            goes to the pool. Payouts land in winners&apos; balances automatically.
          </p>
        </section>
        <section className="rule-card">
          <span className="rule-number">04</span>
          <h3>The artist gets paid</h3>
          <p>
            {bps(split.artistBps)} of every pool goes straight to the artist, plus any rounding remainder. Artists and their teams can&apos;t enter
            their own competitions.
          </p>
        </section>
      </div>
      <div className="curve-heading">
        <h3>Where every pool goes</h3>
      </div>
      <PrizeSplit split={split} />
      <div className="info-box">
        <strong>Not enough players?</strong>
        <p>If fewer than {minEntries} people enter, nobody wins and everyone gets their {usd(entryFee.usd)} back.</p>
      </div>
      <p className="fine-print">Testnet prototype. Test USDC has no real value. All payouts are calculated and sent by the smart contract.</p>
    </Modal>
  );
}
