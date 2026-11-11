// Reads the data Ultimate Guitar embeds in its search and chord pages.
// Only chord names, section names, tempo, capo and strumming are kept — never lyrics.
// No imports: this file is used both by the dev server (vite.config.ts) and by tests.

export interface FoundVersion {
  url: string;
  votes: number;
  rating: number;
}

export interface FoundSong {
  title: string;
  artist: string;
  /** chord-sheet versions of this song, most-voted first */
  versions: FoundVersion[];
}

export interface TabStrumming {
  part: string;
  bpm: number;
  /** note value of one step: 8 = eighth notes, 16 = sixteenths */
  denominator: number;
  triplet: boolean;
  /** site stroke codes, one per step */
  codes: number[];
}

export interface TabSection {
  name: string;
  chords: string[];
}

export interface TabData {
  title: string;
  artist: string;
  url: string;
  capo: number;
  key: string;
  strummings: TabStrumming[];
  sections: TabSection[];
  /** fingering the site shows for each chord name: fret per string low E → high E, null = muted */
  shapes: Record<string, (number | null)[]>;
}

const HOST = 'tabs.ultimate-guitar.com';

export function isTabUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === HOST && u.pathname.startsWith('/tab/');
  } catch {
    return false;
  }
}

export function searchUrl(query: string): string {
  return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`;
}

/** The JSON blob the site embeds in every page, or null if the page has none. */
export function extractStore(html: string): any {
  const m = /class="js-store"\s+data-content="([^"]*)"/.exec(html);
  if (!m) return null;
  const json = m[1]
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try {
    return JSON.parse(json)?.store?.page?.data ?? null;
  } catch {
    return null;
  }
}

/** Groups the public chord sheets in a search result by song, most popular song first. */
export function parseSearch(data: any, maxSongs = 8, maxVersions = 5): FoundSong[] {
  const songs = new Map<string, FoundSong & { total: number }>();
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    if (r?.type !== 'Chords' || r.tab_access_type !== 'public' || typeof r.tab_url !== 'string' || !isTabUrl(r.tab_url)) continue;
    const key = String(r.song_id ?? `${r.artist_name}|${r.song_name}`);
    let s = songs.get(key);
    if (!s) songs.set(key, (s = { title: String(r.song_name ?? ''), artist: String(r.artist_name ?? ''), versions: [], total: 0 }));
    const votes = Number(r.votes) || 0;
    s.versions.push({ url: r.tab_url, votes, rating: Number(r.rating) || 0 });
    s.total += votes;
  }
  return [...songs.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, maxSongs)
    .map(({ title, artist, versions }) => ({
      title, artist,
      versions: versions.sort((a, b) => b.votes - a.votes).slice(0, maxVersions),
    }));
}

/** Chord names per section, in song order. Lyrics lines are ignored entirely. */
export function parseSections(content: string): TabSection[] {
  const sections: TabSection[] = [];
  let current: TabSection | null = null;
  for (const raw of content.replace(/\[\/?tab\]/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[(?!\/?ch\])([^\[\]]{1,40})\]$/.exec(line);
    if (head) {
      current = { name: head[1].trim(), chords: [] };
      sections.push(current);
      continue;
    }
    const chords = [...line.matchAll(/\[ch\]([^\[\]]+)\[\/ch\]/g)].map((m) => m[1].trim()).filter(Boolean);
    if (!chords.length) continue;
    if (!current) sections.push((current = { name: 'Song', chords: [] }));
    current.chords.push(...chords);
  }
  return sections.filter((s) => s.chords.length > 0);
}

export function parseTab(data: any, url: string): TabData | null {
  const view = data?.tab_view;
  const content = view?.wiki_tab?.content;
  if (!view || typeof content !== 'string') return null;
  const strummings: TabStrumming[] = (Array.isArray(view.strummings) ? view.strummings : []).map((s: any) => ({
    part: String(s?.part ?? ''),
    bpm: Number(s?.bpm) || 0,
    denominator: Number(s?.denuminator ?? s?.denominator) || 8,
    triplet: !!s?.is_triplet,
    codes: (Array.isArray(s?.measures) ? s.measures : []).map((m: any) => Number(m?.measure) || 0),
  }));
  const shapes: TabData['shapes'] = {};
  for (const [name, variants] of Object.entries(view.applicature ?? {})) {
    const frets = (variants as any)?.[0]?.frets;
    // the site lists strings high e → low E, with -1 for a muted string
    if (Array.isArray(frets) && frets.length === 6) shapes[name] = [...frets].reverse().map((f) => (Number(f) < 0 ? null : Number(f)));
  }
  return {
    title: String(data?.tab?.song_name ?? ''),
    artist: String(data?.tab?.artist_name ?? ''),
    url,
    capo: Math.max(0, Number(view.meta?.capo) || 0),
    key: String(view.meta?.tonality ?? data?.tab?.tonality_name ?? ''),
    strummings,
    sections: parseSections(content),
    shapes,
  };
}

/** A song is only usable if the site has all three: chords, a tempo, and a strumming pattern. */
export function isComplete(tab: TabData | null): tab is TabData {
  if (!tab || !tab.sections.length) return false;
  return tab.strummings.some((s) => s.bpm > 0 && s.codes.some((c) => strokeOf(c).kind !== '-'));
}

/** Site stroke code → stroke. Hundreds digit: 0 down, 1 up, 2 no stroke. Units: 1 plain, 2 muted, 3 accented. */
export function strokeOf(code: number): { kind: 'D' | 'U' | 'X' | '-'; accent: boolean } {
  const dir = Math.floor(code / 100);
  const type = code % 100;
  if (dir > 1 || type < 1 || type > 3) return { kind: '-', accent: false };
  if (type === 2) return { kind: 'X', accent: false };
  return { kind: dir === 0 ? 'D' : 'U', accent: type === 3 };
}
