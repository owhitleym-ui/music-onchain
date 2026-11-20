export const LEGACY_SONG = Object.freeze({id:'last-bus-home',title:'Last Bus Home',artistId:'maya-lane',musicId:'demo:last-bus-home',source:'sample'});
export const DEMO_SONG = Object.freeze({id:'tennessee-orange',title:'Tennessee Orange',artistId:'megan-moroney',artist:'Megan Moroney',musicId:'chartex:spotify:6DLbBlGIOjjEj0dNN25zhZ',spotifyId:'6DLbBlGIOjjEj0dNN25zhZ',source:'chartex',metric:'tiktok-video-views',policyVersion:1});
export const knownSongs = [LEGACY_SONG, DEMO_SONG];
export const activeSong = config => config?.chartexEnabled ? DEMO_SONG : LEGACY_SONG;
export const songForMusicId = id => knownSongs.find(s=>s.musicId===id)??null;
