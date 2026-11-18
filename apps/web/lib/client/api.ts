"use client";

// Small fetch helpers for the backend routes, plus a polling hook for live data.
// Polling every few seconds is how the leaderboard "updates live": the backend fills it from
// QuickNode Stream events, so the UI only has to ask again.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError } from "./types";

export class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** fetch + JSON + turn `{ ok: false }` responses into a thrown ApiRequestError. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiError | null;
  if (!body || body.ok === false) {
    const err = body as ApiError | null;
    throw new ApiRequestError(err?.error ?? "network", err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

/**
 * Fetches `path` now and then every `intervalMs` while the tab is visible.
 * Pass `null` to pause (e.g. before the user signs in). `refresh()` re-fetches immediately,
 * which the UI calls right after a transaction so the user sees their change without waiting.
 */
export function usePoll<T>(path: string | null, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const pathRef = useRef(path);

  const load = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const next = await api<T>(current);
      if (pathRef.current === current) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (pathRef.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    pathRef.current = path;
    if (!path) return;
    // Kick off the first load on the next tick so state updates happen outside the effect body.
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [path, intervalMs, load]);

  return { data, error, loading: loading && data === null, refresh: load };
}
