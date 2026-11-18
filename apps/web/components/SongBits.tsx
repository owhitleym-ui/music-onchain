"use client";

// Small song/artist pieces from TJ's design: generated cover art, artist avatar, follow button.
import type { CompetitionSummary } from "@/lib/client/types";
import { useFollows } from "@/lib/client/prefs";
import { Icon } from "./Icon";
import { useToast } from "./ui";

type Song = CompetitionSummary["song"];

/** The striped placeholder cover with the artist's initials (TJ's `cover()`). */
export function SongCover({ song, small = false }: { song: Song; small?: boolean }) {
  return (
    <div className={`song-cover ${small ? "small-cover" : ""}`} style={{ "--cover-color": song.color } as React.CSSProperties} aria-hidden="true">
      <span className="cover-mark">{song.initials}</span>
      <span className="cover-lines">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {!small && <span className="cover-caption">{song.title}</span>}
    </div>
  );
}

/** Round initials badge. `className` picks the size: song-avatar, artist-avatar or purchase-song-avatar. */
export function Avatar({ song, className = "song-avatar" }: { song: Song; className?: string }) {
  return (
    <span className={className} style={{ "--cover-color": song.color } as React.CSSProperties}>
      {song.initials}
    </span>
  );
}

/** Follow/unfollow an artist. Stored in this browser only; following is free and has no onchain effect. */
export function FollowButton({ song, className = "button secondary small", showText = true }: { song: Song; className?: string; showText?: boolean }) {
  const { isFollowed, toggle } = useFollows();
  const toast = useToast();
  const followed = isFollowed(song.artistId);
  return (
    <button
      type="button"
      className={`${className} ${followed ? "is-followed" : ""}`}
      aria-pressed={followed}
      aria-label={`${followed ? "Unfollow" : "Follow"} ${song.artist}`}
      title={`${followed ? "Following" : "Follow"} ${song.artist}`}
      onClick={(e) => {
        e.preventDefault(); // cards are links; following shouldn't navigate
        e.stopPropagation();
        toast(toggle(song.artistId) ? "Artist added to Subscribed." : "Artist unfollowed.");
      }}
    >
      <Icon name={followed ? "check" : "heart"} />
      {showText && <span>{followed ? "Following" : "Follow artist"}</span>}
    </button>
  );
}
