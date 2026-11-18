"use client";

// Admin console for the demo: check wallet balances, then settle or cancel competitions.
// Every action goes through /api/admin/*, which checks ADMIN_SECRET and signs with the oracle key
// on the server. The secret you type is kept in this tab's sessionStorage only.
// Not linked from the public UI. Styled with TJ's design classes (app/predict.css).

import { useState } from "react";

type Summary = {
  id: number;
  title: string;
  artist: string;
  metric: string;
  phase: "open" | "closed" | "settled" | "cancelled";
  secondsLeft: number;
  numEntries: number;
  minEntries: number;
  pot: { usd: string };
  finalMetric: string | null;
};

type Status = {
  ok: boolean;
  message?: string;
  chainId?: number;
  database?: string;
  faucetDrip?: string;
  wallets?: Record<string, { address?: string; balance?: { usd: string }; error?: string }>;
  competitions?: Summary[];
};

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [metric, setMetric] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Restore the secret saved earlier in this tab, without touching storage during render.
  function restoreSecret() {
    if (secret) return;
    try {
      setSecret(sessionStorage.getItem("adminSecret") ?? "");
    } catch {}
  }

  /** Newest first, capped at 30 lines. */
  const say = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 30));

  async function call(path: string, init?: RequestInit) {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", "x-admin-secret": secret, ...(init?.headers ?? {}) },
    });
    return res.json();
  }

  /** "Load": saves the secret for this tab and fetches balances + every competition. */
  async function refresh() {
    try {
      sessionStorage.setItem("adminSecret", secret);
    } catch {}
    const s: Status = await call("/api/admin/status");
    setStatus(s);
    if (!s.ok) say(`status: ${s.message}`);
  }

  /** Submits the real number. Below minEntries the contract cancels and refunds instead. */
  async function settle() {
    if (selected === null || !metric) return;
    setBusy(true);
    const r = await call("/api/admin/settle", {
      method: "POST",
      body: JSON.stringify({ competitionId: selected, finalMetric: metric.replace(/[,_\s]/g, "") }),
    });
    say(r.ok ? `#${selected} ${r.status} (tx ${r.txHash.slice(0, 10)}…)` : `settle failed: ${r.message}`);
    setBusy(false);
    refresh();
  }

  /** Cancels an unsettled competition and refunds every entry (useful to reset a demo). */
  async function cancel() {
    if (selected === null || !confirm(`Cancel competition #${selected} and refund everyone?`)) return;
    setBusy(true);
    const r = await call("/api/admin/cancel", { method: "POST", body: JSON.stringify({ competitionId: selected }) });
    say(r.ok ? `#${selected} cancelled, ${r.refunded} refunded` : `cancel failed: ${r.message}`);
    setBusy(false);
    refresh();
  }

  /** Optional: pre-fills the metric from the YouTube API. The admin still reviews it before settling. */
  async function prefill() {
    const videoId = prompt("YouTube video ID");
    if (!videoId) return;
    const r = await call(`/api/admin/youtube?videoId=${encodeURIComponent(videoId)}`);
    if (r.ok) setMetric(r.viewCount);
    say(r.ok ? `YouTube: ${Number(r.viewCount).toLocaleString()} views` : `YouTube failed: ${r.message}`);
  }

  return (
    <main className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operator console</p>
          <h1 className="page-title">Admin</h1>
          <p className="page-description">Submit results and settle competitions with the oracle key. Testnet prototype.</p>
        </div>
      </div>

      <section className="panel">
        <div className="discover-tools">
          <label className="search-field">
            <span className="sr-only">Admin secret</span>
            <input type="password" placeholder="Admin secret" value={secret} onFocus={restoreSecret} onChange={(e) => setSecret(e.target.value)} />
          </label>
          <button className="button primary" onClick={refresh}>
            Load
          </button>
        </div>
        {status?.ok && (
          <dl className="detail-list">
            <div>
              <dt>Chain</dt>
              <dd>{status.chainId}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{status.database}</dd>
            </div>
            <div>
              <dt>Faucet drip</dt>
              <dd>${status.faucetDrip}</dd>
            </div>
            {Object.entries(status.wallets ?? {}).map(([name, w]) => (
              <div key={name}>
                <dt>{name} wallet</dt>
                <dd>{w.error ? <span className="negative">{w.error}</span> : `$${w.balance?.usd} · ${w.address}`}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {status?.ok && (
        <section className="panel">
          <div className="panel-heading">
            <h2 className="panel-title">Competitions</h2>
          </div>
          <table className="popular-table">
            <thead>
              <tr>
                <th scope="col">Competition</th>
                <th scope="col">Phase</th>
                <th scope="col">Entries</th>
                <th scope="col">Pool</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {status.competitions?.map((c) => (
                <tr key={c.id} className={`popular-row ${selected === c.id ? "selected" : ""}`}>
                  <td>
                    <label className="checkbox-label">
                      <input type="radio" name="competition" checked={selected === c.id} onChange={() => setSelected(c.id)} />#{c.id} {c.title} · {c.artist}
                    </label>
                  </td>
                  <td>{c.phase === "open" ? `open · ${c.secondsLeft}s left` : c.phase}</td>
                  <td>
                    {c.numEntries} (min {c.minEntries})
                  </td>
                  <td>${c.pot.usd}</td>
                  <td>{c.finalMetric ? Number(c.finalMetric).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="discover-tools" style={{ marginTop: 18 }}>
            <label className="search-field">
              <span className="sr-only">Final metric</span>
              <input inputMode="numeric" placeholder="Final metric, e.g. 1250000" value={metric} onChange={(e) => setMetric(e.target.value)} />
            </label>
            <button className="button secondary" onClick={prefill}>
              From YouTube
            </button>
            <button className="button primary" disabled={busy || selected === null || !metric} onClick={settle}>
              Settle
            </button>
            <button className="button danger" disabled={busy || selected === null} onClick={cancel}>
              Cancel + refund
            </button>
          </div>
          <p className="fine-print">Settle only after the real number is final. Below the minimum entries, settling cancels and refunds everyone instead.</p>
        </section>
      )}

      {log.length > 0 && (
        <section className="panel">
          <h2 className="panel-title">Log</h2>
          <pre className="fine-print" style={{ whiteSpace: "pre-wrap" }}>
            {log.join("\n")}
          </pre>
        </section>
      )}
    </main>
  );
}
