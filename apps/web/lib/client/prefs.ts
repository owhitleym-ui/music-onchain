"use client";

// Per-browser preferences from TJ's design: followed artists and light/dark theme.
// These are conveniences, not data the product depends on, so they live in localStorage only.
// useSyncExternalStore keeps every component in sync and is hydration-safe.
import { useSyncExternalStore } from "react";

const FOLLOWS_KEY = "followed-artists";
const THEME_KEY = "theme";
const listeners = new Set<() => void>();
const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};
const notifyAll = () => listeners.forEach((notify) => notify());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
  notifyAll();
}

// useSyncExternalStore needs a stable snapshot, so cache the parsed array per raw string.
let followsRaw: string | null = null;
let followsParsed: string[] = [];
function readFollows(): string[] {
  const raw = read(FOLLOWS_KEY);
  if (raw !== followsRaw) {
    followsRaw = raw;
    try {
      followsParsed = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      followsParsed = [];
    }
  }
  return followsParsed;
}
const NO_FOLLOWS: string[] = [];

export function useFollows() {
  const follows = useSyncExternalStore(subscribe, readFollows, () => NO_FOLLOWS);
  /** Returns true if the artist is now followed. */
  const toggle = (artistId: string) => {
    const now = readFollows();
    const next = now.includes(artistId) ? now.filter((id) => id !== artistId) : [...now, artistId];
    write(FOLLOWS_KEY, JSON.stringify(next));
    return next.includes(artistId);
  };
  return { follows, toggle, isFollowed: (artistId: string) => follows.includes(artistId) };
}

// The header's "Support Artist" tab reopens the last competition you looked at (TJ's `lastSong`).
const LAST_KEY = "last-competition";
export function rememberCompetition(id: number) {
  if (read(LAST_KEY) !== String(id)) write(LAST_KEY, String(id));
}
export function useLastCompetition(): number {
  const raw = useSyncExternalStore(subscribe, () => read(LAST_KEY), () => null);
  return Number(raw) || 1;
}

export type Theme = "light" | "dark";

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    () => (read(THEME_KEY) === "dark" ? "dark" : "light"),
    () => "light" as const,
  );
  const toggle = () => write(THEME_KEY, theme === "light" ? "dark" : "light");
  return { theme: theme as Theme, toggle };
}
