// SAMPLE view history for the chart on the competition page, adapted from TJ's `getHistory`
// in frontend/data.js. It's generated from the song's sample stats so the chart has a believable
// shape; it is not real data and the UI labels it "Sample data". Swap this for real YouTube
// snapshots if the backend starts storing them.
import type { SongMeta } from "@/lib/songs";

const DAY = 86_400;

/** Deterministic hash so the same song always draws the same wiggle. */
function hash(text: string) {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value;
}

export type HistoryPoint = { time: number; views: number }; // unix seconds, total views

/**
 * Total views over the last `days`, ending at `now` with `song.sampleTotalViews`.
 * Four points per day. Growth slows into the past using the song's sample weekly growth.
 */
export function sampleHistory(song: Pick<SongMeta, "title" | "sampleTotalViews" | "sampleDailyViews" | "sampleGrowth">, now: number, days: number): HistoryPoint[] {
  const phase = hash(song.title) % 30;
  const points = days * 4;
  return Array.from({ length: points + 1 }, (_, index) => {
    const daysAgo = days - index / 4;
    // Daily rate shrinks going back in time (the song is growing), with a gentle wave on top.
    const trend = Math.exp((-daysAgo * Math.log1p(song.sampleGrowth / 100)) / 7);
    const wave = 1 + 0.065 * (Math.sin(phase - daysAgo * 2.2) - Math.sin(phase));
    const viewsBefore = song.sampleDailyViews * daysAgo * trend * wave;
    return { time: now - daysAgo * DAY, views: Math.max(1, Math.round(song.sampleTotalViews - viewsBefore)) };
  });
}
