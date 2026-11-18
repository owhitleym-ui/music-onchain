// Display data for songs, keyed by the `metadataURI` stored in SongRegistry.
// The contract only stores the artist payout wallet and this URI; everything the UI shows lives here.
//
// Artists and stats come from TJ's frontend demo (`frontend/data.js` on codex/music-prediction-frontend).
// All three artists are fictional, and the view numbers are SAMPLE data used only to draw the chart.
// The real result is the number the admin submits at settlement.
// TODO(team): swap in the three real demo songs (SPEC.md "Still open") and their YouTube video IDs.
// Dependency-free so both server routes and client components can import it.

export type SongMeta = {
  title: string;
  artistId: string; // stable id used for "Follow artist" (stored in the browser)
  artist: string;
  genre: string;
  initials: string; // shown on the generated cover art
  color: string; // cover background
  bio: string;
  category: "popular" | "rising"; // which Discover section the card appears in
  sampleTotalViews: number; // SAMPLE: total views "now", for the chart only
  sampleDailyViews: number; // SAMPLE: views per day, for the chart only
  sampleGrowth: number; // SAMPLE: weekly growth in percent, for the chart only
  youtubeVideoId: string; // used by the optional admin view-count pre-fill
  artworkUrl: string; // empty = use the generated cover
};

export const SONGS: Record<string, SongMeta> = {
  "/songs/1.json": {
    title: "Last Bus Home",
    artistId: "maya-lane",
    artist: "Maya Lane",
    genre: "Indie",
    initials: "ML",
    color: "#c8d6f0",
    bio: "Late-night melodies and stories from the last ride home. Maya is a fictional independent artist in this demo.",
    category: "popular",
    sampleTotalViews: 1_284_000,
    sampleDailyViews: 28_420,
    sampleGrowth: 34.2,
    youtubeVideoId: "",
    artworkUrl: "",
  },
  "/songs/2.json": {
    title: "Afterglow",
    artistId: "northline",
    artist: "Northline",
    genre: "Electronic",
    initials: "NL",
    color: "#c9dedb",
    bio: "Electronic music for open roads and bright city lights. Northline is a fictional project in this demo.",
    category: "popular",
    sampleTotalViews: 2_051_000,
    sampleDailyViews: 36_750,
    sampleGrowth: 22.4,
    youtubeVideoId: "",
    artworkUrl: "",
  },
  "/songs/3.json": {
    title: "Paper Moons",
    artistId: "olive-reed",
    artist: "Olive Reed",
    genre: "Folk",
    initials: "OR",
    color: "#d5dcc1",
    bio: "Acoustic songs drawn from the everyday. Olive is a fictional independent artist in this demo.",
    category: "rising",
    sampleTotalViews: 196_500,
    sampleDailyViews: 8_400,
    sampleGrowth: 68.2,
    youtubeVideoId: "",
    artworkUrl: "",
  },
};

const UNKNOWN: SongMeta = {
  title: "Untitled song",
  artistId: "unknown",
  artist: "Unknown artist",
  genre: "Other",
  initials: "?",
  color: "#d4dbea",
  bio: "",
  category: "rising",
  sampleTotalViews: 100_000,
  sampleDailyViews: 2_000,
  sampleGrowth: 10,
  youtubeVideoId: "",
  artworkUrl: "",
};

export function songMeta(metadataURI: string): SongMeta {
  return SONGS[metadataURI] ?? UNKNOWN;
}
