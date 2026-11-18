"use client";

// Discover page (TJ's `renderDiscover`). Cards come from GET /api/competitions: one card per
// onchain competition, grouped into "Popular" and "Fast-rising" by the song's category.
// Search, genre filter and "Only artists I follow" work exactly like TJ's demo, client-side.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { FollowButton, SongCover } from "@/components/SongBits";
import { EmptyState } from "@/components/ui";
import { usePoll } from "@/lib/client/api";
import { number, usd } from "@/lib/client/format";
import { useFollows } from "@/lib/client/prefs";
import type { CompetitionSummary } from "@/lib/client/types";

const PHASE_LABEL: Record<CompetitionSummary["phase"], { text: string; tone: string }> = {
  open: { text: "Accepting entries", tone: "green" },
  closed: { text: "Awaiting result", tone: "orange" },
  settled: { text: "Results in", tone: "blue" },
  cancelled: { text: "Refunded", tone: "" },
};

function SongCard({ c, index }: { c: CompetitionSummary; index: number }) {
  const href = `/compete/${c.id}`;
  const phase = PHASE_LABEL[c.phase];
  return (
    <article className="song-card">
      <div className="cover-container">
        <Link href={href} aria-label={`Predict views for ${c.title}`}>
          <SongCover song={c.song} />
        </Link>
        <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
        <FollowButton song={c.song} className="card-follow" showText={false} />
      </div>
      <div className="song-card-body">
        <Link className="song-title" href={href}>
          {c.title}
        </Link>
        <div className="song-artist">{c.artist}</div>
        <div className="song-stats">
          <div>
            <span className="stat-value">{usd(c.pot.usd)}</span>
            <span className="stat-label">prize pool · {c.numEntries} entries</span>
          </div>
          <span className={`badge ${phase.tone}`}>{phase.text}</span>
        </div>
        <div className="card-bottom">
          <span className="genre-tag">{c.song.genre}</span>
          <Link className="card-open" href={href} aria-label={`Open ${c.title} contest`}>
            {usd(c.entryFee.usd)} entry <Icon name="arrow" />
          </Link>
        </div>
        <div className="fine-print">
          Sample: {number(c.song.sampleDailyViews)} views/day · <span className="growth">+{c.song.sampleGrowth}%</span>
        </div>
      </div>
    </article>
  );
}

export default function DiscoverPage() {
  const { data, error, loading } = usePoll<{ ok: true; competitions: CompetitionSummary[] }>("/api/competitions", 5000);
  const { follows } = useFollows();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("all");
  const [followedOnly, setFollowedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const competitions = useMemo(() => data?.competitions ?? [], [data]);
  const genres = useMemo(() => [...new Set(competitions.map((c) => c.song.genre))].sort(), [competitions]);
  const filtered = competitions.filter((c) => {
    const q = search.toLocaleLowerCase().trim();
    return (
      `${c.title} ${c.artist}`.toLocaleLowerCase().includes(q) &&
      (genre === "all" || c.song.genre === genre) &&
      (!followedOnly || follows.includes(c.song.artistId))
    );
  });
  const filterCount = Number(genre !== "all") + Number(followedOnly);
  const clear = () => {
    setSearch("");
    setGenre("all");
    setFollowedOnly(false);
  };

  let results;
  if (loading) results = <p className="fine-print">Loading competitions…</p>;
  else if (error && !data) results = <EmptyState title="Couldn't load competitions" description={error} />;
  else if (!filtered.length)
    results = (
      <EmptyState
        title="No songs found"
        description="Try a different song, artist, or filter."
        action={
          <button className="button secondary" onClick={clear}>
            Clear search and filters
          </button>
        }
      />
    );
  else
    results = (["popular", "rising"] as const).map((category) => {
      const group = filtered.filter((c) => c.song.category === category);
      if (!group.length) return null;
      return (
        <section className="song-section" key={category}>
          <div className="section-heading">
            <h2 className="section-title">{category === "popular" ? "Popular BGMs" : "Fast-rising Artists"}</h2>
            <span className="section-note">{category === "popular" ? "Most watched in our sample collection" : "Songs gaining momentum"}</span>
          </div>
          <div className="song-grid">
            {group.map((c, i) => (
              <SongCard key={c.id} c={c} index={i} />
            ))}
          </div>
        </section>
      );
    });

  return (
    <main className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">A little music intuition.</p>
          <h1 className="page-title">Spot the next big moment.</h1>
          <p className="page-description">Choose a song. Predict its video views. Support the artist.</p>
        </div>
        <span className="sample-data-label">Live competitions · test USDC</span>
      </div>

      <div className="discover-tools">
        <label className="search-field">
          <Icon name="search" />
          <span className="sr-only">Search songs or artists</span>
          <input type="search" placeholder="Search a song or artist" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </label>
        <button className="button secondary filter-toggle" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="filter-panel">
          <Icon name="filter" />
          Filters
          {filterCount > 0 && <span className="filter-count">{filterCount}</span>}
        </button>
      </div>
      <div id="filter-panel" className={`filter-panel ${filtersOpen ? "visible" : ""}`}>
        <label className="field-label">
          Genre
          <select className="select-input" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="all">All genres</option>
            {genres.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={followedOnly} onChange={(e) => setFollowedOnly(e.target.checked)} /> Only artists I follow
        </label>
        <button
          className="text-button"
          onClick={() => {
            setGenre("all");
            setFollowedOnly(false);
          }}
        >
          Reset filters
        </button>
      </div>

      <div className="discover-results">{results}</div>
      <p className="fine-print page-footnote">
        Testnet prototype: entries use free test USDC with no real value. Artists are fictional and view histories are sample data.
      </p>
    </main>
  );
}
