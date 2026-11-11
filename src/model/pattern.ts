import { PICK_ROWS, type NoteEvent, type Pattern, type StringNote, type StrumKind, type StrumStep } from './types';

const rest = (): StrumStep => ({ kind: '-', accent: false });

export function emptyPattern(steps: number, mode: Pattern['mode'] = 'strum'): Pattern {
  return {
    id: 'custom', name: 'Custom', mode, steps,
    strum: Array.from({ length: steps }, rest),
    pick: Array.from({ length: PICK_ROWS }, () => Array(steps).fill(false)),
    accents: Array(steps).fill(false),
  };
}

/** "D-DU-UDU" style text, one char per 8th note; uppercase after '>' is accented. */
function strum8(id: string, name: string, text: string, steps = 16): Pattern {
  const p = emptyPattern(steps, 'strum');
  p.id = id; p.name = name;
  let i = 0, accent = false;
  for (const ch of text) {
    if (ch === '>') { accent = true; continue; }
    if (i * 2 < steps) p.strum[i * 2] = { kind: ch as StrumKind, accent };
    accent = false; i++;
  }
  return p;
}

function strum16(id: string, name: string, text: string, steps = 16): Pattern {
  const p = emptyPattern(steps, 'strum');
  p.id = id; p.name = name;
  let i = 0, accent = false;
  for (const ch of text) {
    if (ch === '>') { accent = true; continue; }
    if (i < steps) p.strum[i] = { kind: ch as StrumKind, accent };
    accent = false; i++;
  }
  return p;
}

/** rows: strings as "B654321" labels; each entry is [step, rowLabel…]. */
function pick(id: string, name: string, steps: number, hits: [number, string][], accents: number[] = []): Pattern {
  const p = emptyPattern(steps, 'pick');
  p.id = id; p.name = name;
  const rowOf: Record<string, number> = { B: 0, '6': 1, '5': 2, '4': 3, '3': 4, '2': 5, '1': 6 };
  for (const [step, rows] of hits) for (const r of rows) p.pick[rowOf[r]][step] = true;
  for (const a of accents) p.accents[a] = true;
  return p;
}

export const PRESETS: Pattern[] = [
  strum8('folk', 'Folk  D-DU-UDU', '>D-DU-UDU'),
  strum8('eighths', 'Eighths  DUDUDUDU', '>DUDU>DUDU'),
  strum8('downs', 'All downs', '>DDDD>DDDD'),
  strum8('pop', 'Pop  D-DUXUDU', '>D-DUXUDU'),
  strum8('ballad', 'Ballad  D--D-UDU', '>D--D-UDU'),
  strum8('reggae', 'Off-beat  -U-U-U-U', '-U-U-U-U'),
  strum16('sixteenths', '16ths  D-DUDUDU…', '>D-DU-UDU-UDU>DUDU'),
  strum16('funk', 'Funk mute  DXUXDUXU…', '>DXUX>DUXUDXUX>DUXU'),
  strum8('waltz', 'Waltz 3/4  D-DUDU', '>D-DUDU', 12),
  strum16('sixeight', '6/8  D--DUD--DUDU', '>D-DUDU>D-DUDU', 12),
  pick('arp', 'Arpeggio  B-3-2-1-2-3', 16,
    [[0, 'B'], [2, '3'], [4, '2'], [6, '1'], [8, 'B'], [10, '3'], [12, '2'], [14, '1']], [0, 8]),
  pick('arp-updown', 'Up & down  B-3-2-1-2-3', 16,
    [[0, 'B'], [2, '4'], [4, '3'], [6, '2'], [8, '1'], [10, '2'], [12, '3'], [14, '4']], [0]),
  pick('travis', 'Travis pick', 16,
    [[0, 'B'], [2, '2'], [4, '4'], [6, '3'], [8, 'B'], [10, '2'], [12, '4'], [14, '3']], [0, 8]),
  pick('pinch', 'Pinch ballad  B1-3-2-3', 16,
    [[0, 'B1'], [2, '3'], [4, '2'], [6, '3'], [8, 'B1'], [10, '3'], [12, '2'], [14, '3']], [0, 8]),
  pick('arp34', 'Arpeggio 3/4  B-3-2-1-2-3', 12,
    [[0, 'B'], [2, '3'], [4, '2'], [6, '1'], [8, '2'], [10, '3']], [0]),
];

/** Moves a pattern onto a different grid. When one grid divides the other the
 *  rhythm is kept (hits stay at the same point of the bar); otherwise steps are
 *  kept in order and the bar is truncated or padded with rests. */
export function fitPattern(p: Pattern, steps: number): Pattern {
  if (p.steps === steps) return p;
  const src = (i: number): number => {
    if (steps % p.steps === 0) return i % (steps / p.steps) === 0 ? i / (steps / p.steps) : -1;
    if (p.steps % steps === 0) return i * (p.steps / steps);
    return i;
  };
  return {
    ...p, steps,
    strum: Array.from({ length: steps }, (_, i) => p.strum[src(i)] ?? rest()),
    pick: p.pick.map((row) => Array.from({ length: steps }, (_, i) => row[src(i)] ?? false)),
    accents: Array.from({ length: steps }, (_, i) => p.accents[src(i)] ?? false),
  };
}

export interface StrumOptions {
  /** seconds per 16th-note step */
  stepDur: number;
  /** 0 = machine-exact, 1 = default human feel */
  humanize: number;
  rand?: () => number;
}

/** Turns one pattern step into the string plucks that realise it on `notes`
 *  (the chord's sounding strings, ordered low → high). */
export function stepEvents(pattern: Pattern, step: number, notes: StringNote[], opt: StrumOptions): NoteEvent[] {
  if (!notes.length) return [];
  const rand = opt.rand ?? Math.random;
  const jitter = (amt: number) => (rand() * 2 - 1) * amt * opt.humanize;
  const sorted = [...notes].sort((a, b) => a.string - b.string);
  const i = step % pattern.steps;

  if (pattern.mode === 'pick') {
    const accent = pattern.accents[i];
    const chosen = new Map<number, StringNote>();
    pattern.pick.forEach((row, r) => {
      if (!row[i]) return;
      const n = r === 0 ? sorted[0] : sorted.find((s) => s.string === r - 1);
      if (n) chosen.set(n.string, n);
    });
    return [...chosen.values()].map((n) => ({
      ...n,
      offset: Math.max(0, jitter(0.004)),
      gain: (accent ? 1 : 0.8) * (1 + jitter(0.08)),
      layer: accent ? 'ff' as const : 'mf' as const,
      muted: false,
    }));
  }

  const s = pattern.strum[i];
  if (!s || s.kind === '-') return [];
  const stagger = Math.min(0.022, Math.max(0.007, opt.stepDur * 0.11));
  let order = sorted;
  let base = s.accent ? 1 : 0.8;
  if (s.kind === 'U') {
    // Upstrokes catch mostly the treble strings and are a little lighter.
    order = sorted.slice(-4).reverse();
    base *= 0.85;
  }
  return order.map((n, k) => ({
    ...n,
    offset: Math.max(0, k * stagger * (s.kind === 'X' ? 0.6 : 1) + jitter(0.003)),
    gain: base * (1 - k * 0.03) * (1 + jitter(0.08)),
    layer: s.accent ? 'ff' as const : 'mf' as const,
    muted: s.kind === 'X',
  }));
}
