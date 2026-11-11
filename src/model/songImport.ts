import { libraryVoicings, suffixesFor } from './chords';
import { emptyPattern } from './pattern';
import { MAX_REPEATS, type ProjectItem } from './project';
import type { Pattern, Song, TimeSig } from './types';
import { MAX_CAPO } from './voicing';
import { strokeOf, type TabData, type TabSection, type TabStrumming } from './ug';

const ROOT_TO_KEY: Record<string, string> = {
  C: 'C', 'B#': 'C', 'C#': 'C#', Db: 'C#', D: 'D', 'D#': 'Eb', Eb: 'Eb', E: 'E', Fb: 'E', F: 'F', 'E#': 'F',
  'F#': 'F#', Gb: 'F#', G: 'G', 'G#': 'Ab', Ab: 'Ab', A: 'A', 'A#': 'Bb', Bb: 'Bb', B: 'B', Cb: 'B',
};

const SUFFIX_ALIASES: Record<string, string> = {
  '': 'major', maj: 'major', M: 'major', m: 'minor', min: 'minor', '-': 'minor', sus: 'sus4', M7: 'maj7', Maj7: 'maj7',
  min7: 'm7', '+': 'aug', '°': 'dim', o: 'dim', dim7: 'dim7', '7sus': '7sus4', add2: 'add9', '2': 'sus2', '4': 'sus4',
  m7b5: 'm7b5', 'ø': 'm7b5', maj9: 'maj9', M9: 'maj9', min9: 'm9', mmaj7: 'mmaj7', '5': 'major',
};

/** Library chord for a chord name as written on a chord sheet, or null. Unknown
 *  extensions fall back to the plain major/minor chord on the same root. */
export function libraryIdFor(name: string): string | null {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(name.trim());
  if (!m) return null;
  const key = ROOT_TO_KEY[m[1]];
  if (!key) return null;
  const have = suffixesFor(key);
  const quality = m[2].trim();
  const base = SUFFIX_ALIASES[quality] ?? quality;
  const bass = m[3] ? ROOT_TO_KEY[m[3]] : null;
  const tries: string[] = [];
  if (bass) tries.push(base === 'major' ? `/${bass}` : base === 'minor' ? `m/${bass}` : '');
  tries.push(base, /^m(?!aj)/.test(quality) ? 'minor' : 'major');
  for (const suffix of tries) {
    if (suffix && have.includes(suffix) && libraryVoicings(key, suffix).length) return `lib:${key}:${suffix}:0`;
  }
  return null;
}

/** A voicing id that carries its own shape, so imported chords need no entry in "My chords". */
export function shapeId(name: string, frets: (number | null)[]): string {
  return `shape:${name.replace(/:/g, '')}:${frets.map((f) => (f === null ? 'x' : f)).join(',')}`;
}

function voicingIdFor(name: string, tab: TabData): string | null {
  const shape = tab.shapes[name];
  if (shape && shape.some((f) => f !== null)) return shapeId(name, shape);
  return libraryIdFor(name);
}

/** Turns the site's strumming into a one-bar pattern, plus the time signature it implies. */
export function strummingToPattern(s: TabStrumming): { pattern: Pattern; timeSig: TimeSig; bars: number } {
  let grid = s.triplet ? (s.denominator * 3) / 2 : s.denominator;
  let timeSig: TimeSig = '4/4';
  const quarters = (s.codes.length * 4) / s.denominator;
  if (!s.triplet && s.codes.length < grid && quarters === 3) {
    timeSig = '3/4';
    grid = s.codes.length;
  }
  grid = Math.max(1, Math.round(grid));
  const pattern = emptyPattern(grid, 'strum');
  pattern.name = s.part || 'Imported';
  pattern.strum = Array.from({ length: grid }, (_, i) => strokeOf(s.codes[i] ?? 202));
  return { pattern, timeSig, bars: Math.max(1, Math.round(s.codes.length / grid)) };
}

const usable = (s: TabStrumming) => s.bpm > 0 && s.codes.some((c) => strokeOf(c).kind !== '-');

/** The strumming meant for a section: one named after it, else "Whole Song", else the first. */
export function strummingFor(section: string, tab: TabData): TabStrumming | undefined {
  const all = tab.strummings.filter(usable);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  const want = norm(section);
  return (
    all.find((s) => norm(s.part) && want.startsWith(norm(s.part))) ??
    all.find((s) => norm(s.part) === 'wholesong') ??
    all[0]
  );
}

/** Shortest repeating unit of a chord list: [Em G D A, Em G D A] → [Em G D A] × 2. */
export function reduceCycle<T>(items: T[]): { cycle: T[]; repeats: number } {
  for (let p = 1; p <= items.length / 2; p++) {
    if (items.length % p) continue;
    if (items.every((x, i) => x === items[i % p])) return { cycle: items.slice(0, p), repeats: items.length / p };
  }
  return { cycle: items, repeats: 1 };
}

let seq = 0;
const nid = () => `imp${Date.now().toString(36)}${(seq++).toString(36)}`;

/** One section of an imported song as a loop, and how many times it repeats. Null if nothing in it is playable. */
export function sectionToLoop(tab: TabData, section: TabSection): { song: Song; repeats: number } | null {
  const strumming = strummingFor(section.name, tab);
  if (!strumming) return null;
  const { cycle, repeats } = reduceCycle(section.chords);
  const slots = cycle
    .map((name) => voicingIdFor(name, tab))
    .filter((id): id is string => id !== null)
    .map((voicingId) => ({ id: nid(), voicingId, bars: 1 }));
  if (!slots.length) return null;
  const { pattern, timeSig } = strummingToPattern(strumming);
  return {
    repeats: Math.min(MAX_REPEATS, repeats),
    song: {
      name: `${tab.title} – ${section.name}`.slice(0, 40),
      bpm: Math.min(240, Math.max(40, Math.round(strumming.bpm))),
      capo: Math.min(MAX_CAPO, tab.capo),
      timeSig, pattern, slots,
    },
  };
}

/** The whole song as project blocks, one per section, in song order. */
export function tabToBlocks(tab: TabData): ProjectItem[] {
  return tab.sections.flatMap((section) => {
    const loop = sectionToLoop(tab, section);
    return loop ? [{ id: nid(), song: loop.song, repeats: loop.repeats }] : [];
  });
}
