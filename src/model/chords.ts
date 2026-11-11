import db from '@tombatossals/chords-db/lib/guitar.json';
import type { Frets, Voicing } from './types';

interface DbPosition { frets: number[]; baseFret: number }
interface DbChord { key: string; suffix: string; positions: DbPosition[] }

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const KEYS: string[] = db.keys;
export const SUFFIXES: string[] = db.suffixes;

export function chordName(key: string, suffix: string): string {
  if (suffix === 'major') return key;
  if (suffix === 'minor') return key + 'm';
  return key + suffix;
}

function dbKey(key: string) {
  return key.replace('#', 'sharp');
}

function toFrets(p: DbPosition): Frets {
  return p.frets.map((f) => (f < 0 ? null : f === 0 ? 0 : f + p.baseFret - 1));
}

/** All voicings (positions up the neck) for a chord, e.g. ('C', 'maj7'). */
export function libraryVoicings(key: string, suffix: string): Voicing[] {
  const chords = (db.chords as unknown as Record<string, DbChord[]>)[dbKey(key)] ?? [];
  const chord = chords.find((c) => c.suffix === suffix);
  if (!chord) return [];
  return chord.positions.map((p, i) => ({
    id: `lib:${key}:${suffix}:${i}`,
    name: chordName(key, suffix),
    frets: toFrets(p),
  }));
}

export function suffixesFor(key: string): string[] {
  const chords = (db.chords as unknown as Record<string, DbChord[]>)[dbKey(key)] ?? [];
  return chords.map((c) => c.suffix);
}

export function resolveVoicing(id: string, custom: Voicing[]): Voicing | undefined {
  if (id.startsWith('lib:')) {
    const [, key, suffix, idx] = id.split(':');
    return libraryVoicings(key, suffix)[Number(idx)];
  }
  if (id.startsWith('shape:')) {
    // self-describing chord from an imported song: shape:<name>:<fret,fret,…> with x for a muted string
    const [, name, shape] = id.split(':');
    const frets = (shape ?? '').split(',').map((f) => (f === 'x' ? null : Number(f)));
    if (frets.length !== 6 || frets.some((f) => f !== null && !(f >= 0 && f <= 24))) return undefined;
    return { id, name, frets };
  }
  return custom.find((c) => c.id === id);
}

/** Shifts every note name in a chord name (root and slash bass) up by `semis`. */
export function transposeName(name: string, semis: number): string {
  if (!semis) return name;
  const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(name);
  if (!m) return name;
  const shift = (n: string) => {
    let i = SHARPS.indexOf(n);
    if (i < 0) i = FLATS.indexOf(n);
    if (i < 0) return n;
    const j = (i + semis + 120) % 12;
    return n.includes('b') ? FLATS[j] : SHARPS[j];
  };
  return shift(m[1]) + m[2] + (m[3] ? '/' + shift(m[3]) : '');
}

const QUALITIES: [string, number[]][] = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['maj7', [0, 4, 7, 11]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['6', [0, 4, 7, 9]],
  ['m6', [0, 3, 7, 9]], ['add9', [0, 2, 4, 7]], ['madd9', [0, 2, 3, 7]], ['9', [0, 2, 4, 7, 10]],
  ['m9', [0, 2, 3, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['dim7', [0, 3, 6, 9]], ['m7b5', [0, 3, 6, 10]],
  ['7sus4', [0, 5, 7, 10]], ['mmaj7', [0, 3, 7, 11]], ['5', [0, 7]],
];

/** Best-guess name for a set of sounding notes (lowest first), or null. */
export function detectChordName(midi: number[]): string | null {
  if (midi.length < 2) return null;
  const pcs = [...new Set(midi.map((m) => m % 12))].sort((a, b) => a - b);
  const bass = midi[0] % 12;
  let best: string | null = null;
  for (const root of [bass, ...pcs.filter((p) => p !== bass)]) {
    const rel = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b).join(',');
    const q = QUALITIES.find(([, iv]) => iv.join(',') === rel);
    if (q) {
      best = SHARPS[root] + q[0] + (root === bass ? '' : '/' + SHARPS[bass]);
      break;
    }
  }
  return best;
}

export function noteName(midi: number): string {
  return SHARPS[midi % 12];
}
