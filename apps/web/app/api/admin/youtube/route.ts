import { connection, type NextRequest } from "next/server";
import { env } from "@/lib/server/env";
import { errorResponse, HttpError, json, requireAdmin } from "@/lib/server/http";

// GET /api/admin/youtube?videoId=...   header: x-admin-secret
// Optional helper: fetches the current YouTube view count to pre-fill the settle form.
// The admin still confirms the number before settling. First item on the cut list.
export async function GET(request: NextRequest) {
  await connection(); // request-time only; never prerender
  try {
    requireAdmin(request);
    const videoId = request.nextUrl.searchParams.get("videoId") ?? "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) throw new HttpError(400, "videoId is missing or invalid", "bad_request");

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", videoId);
    url.searchParams.set("key", env.youtubeApiKey());
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new HttpError(502, `YouTube API returned ${res.status}`, "youtube_error");

    const data = (await res.json()) as { items?: { statistics?: { viewCount?: string } }[] };
    const viewCount = data.items?.[0]?.statistics?.viewCount;
    if (!viewCount) throw new HttpError(404, "Video not found or has no public view count", "not_found");
    return json({ ok: true, videoId, viewCount, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
