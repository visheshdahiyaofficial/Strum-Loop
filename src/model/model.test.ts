import { describe, expect, it } from 'vitest';
import { libraryVoicings, resolveVoicing, transposeName, KEYS, suffixesFor } from './chords';
import { PRESETS, emptyPattern, fitPattern, stepEvents } from './pattern';
import { buildTimeline, stepDuration, stepTime } from './timeline';
import { voicingMidi, voicingToNotes } from './voicing';
import { encodeWav } from '../audio/wav';
import { projectToMidi } from './midi';
import { firstPlayable, nextCursor, projectPasses, projectSeconds, songSeconds, type ProjectItem } from './project';
import { PRESETS as P } from './pattern';
import type { Song } from './types';

const MAX = [19, 19, 18, 18, 19, 18];
const opt = { stepDur: 0.125, humanize: 0 };

describe('voicing + capo', () => {
  it('maps an open C chord to string/fret samples', () => {
    const c = libraryVoicings('C', 'major')[0];
    expect(c.frets).toEqual([null, 3, 2, 0, 1, 0]);
    const notes = voicingToNotes(c.frets, 0, MAX);
    expect(notes.map((n) => [n.string, n.sampleFret])).toEqual([[1, 3], [2, 2], [3, 0], [4, 1], [5, 0]]);
    expect(notes.every((n) => n.playbackRate === 1)).toBe(true);
    expect(voicingMidi(c.frets, 0)).toEqual([48, 52, 55, 60, 64]);
  });

  it('converts barre positions to absolute frets', () => {
    const c8 = libraryVoicings('C', 'major')[3];
    expect(c8.frets).toEqual([8, 10, 10, 9, 8, 8]);
  });

  it('capo shifts every string, open strings included', () => {
    const g = libraryVoicings('G', 'major')[0];
    const notes = voicingToNotes(g.frets, 2, MAX);
    expect(notes.map((n) => n.absFret)).toEqual(g.frets.map((f) => (f as number) + 2));
    expect(voicingMidi(g.frets, 2)).toEqual(voicingMidi(g.frets, 0).map((m) => m + 2));
  });

  it('pitch-shifts the last real fret when capo pushes past the recordings', () => {
    const notes = voicingToNotes([8, 10, 10, 9, 8, 8], 12, MAX);
    const low = notes[0]; // abs fret 20 on a string recorded to 19
    expect(low.absFret).toBe(20);
    expect(low.sampleFret).toBe(19);
    expect(low.playbackRate).toBeCloseTo(2 ** (1 / 12), 10);
    const d = notes[2]; // abs fret 22 on a string recorded to 18
    expect(d.sampleFret).toBe(18);
    expect(d.playbackRate).toBeCloseTo(2 ** (4 / 12), 10);
  });

  it('every library chord resolves by id and stays on the neck', () => {
    let count = 0;
    for (const key of KEYS) {
      for (const suffix of suffixesFor(key)) {
        for (const v of libraryVoicings(key, suffix)) {
          count++;
          expect(resolveVoicing(v.id, [])?.frets).toEqual(v.frets);
          expect(v.frets).toHaveLength(6);
          for (const f of v.frets) if (f !== null) expect(f >= 0 && f <= 24).toBe(true);
        }
      }
    }
    expect(count).toBeGreaterThan(2000);
  });

  it('names the sounding chord under a capo', () => {
    expect(transposeName('G', 2)).toBe('A');
    expect(transposeName('Em7', 3)).toBe('Gm7');
    expect(transposeName('C/E', 2)).toBe('D/F#');
    expect(transposeName('Bbmaj7', 1)).toBe('Bmaj7');
    expect(transposeName('My chord', 2)).toBe('My chord');
  });
});

describe('patterns', () => {
  const g = voicingToNotes(libraryVoicings('G', 'major')[0].frets, 0, MAX);
  const folk = PRESETS.find((p) => p.id === 'folk')!;

  it('down strums run low → high, up strums high → low on the treble strings', () => {
    const down = stepEvents(folk, 0, g, opt);
    expect(down.map((e) => e.string)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(down.map((e) => e.offset)).toEqual([...down.map((e) => e.offset)].sort((a, b) => a - b));
    expect(down[0].layer).toBe('ff'); // accented first beat
    const up = stepEvents(folk, 6, g, opt); // D-DU: the U
    expect(up.map((e) => e.string)).toEqual([5, 4, 3, 2]);
    expect(up[0].layer).toBe('mf');
  });

  it('rests and off-grid steps make no sound', () => {
    expect(stepEvents(folk, 2, g, opt)).toEqual([]);
    expect(stepEvents(folk, 1, g, opt)).toEqual([]);
  });

  it('skips muted strings and wraps past one bar', () => {
    const c = voicingToNotes([null, 3, 2, 0, 1, 0], 0, MAX);
    expect(stepEvents(folk, 16, c, opt).map((e) => e.string)).toEqual([1, 2, 3, 4, 5]);
  });

  it('muted strums are flagged', () => {
    const pop = PRESETS.find((p) => p.id === 'pop')!;
    const x = stepEvents(pop, 8, g, opt);
    expect(x.length).toBe(6);
    expect(x.every((e) => e.muted)).toBe(true);
  });

  it('picking: Bass row follows the chord, string rows skip muted strings', () => {
    const p = emptyPattern(16, 'pick');
    p.pick[0][0] = true; // bass
    p.pick[1][4] = true; // 6th string
    p.pick[6][4] = true; // 1st string
    const d = voicingToNotes([null, null, 0, 2, 3, 2], 0, MAX); // D: bass is the open D string
    expect(stepEvents(p, 0, d, opt).map((e) => e.string)).toEqual([2]);
    expect(stepEvents(p, 4, d, opt).map((e) => e.string)).toEqual([5]);
  });

  it('all presets fit their bar length and can be refitted', () => {
    for (const p of PRESETS) {
      expect(p.strum).toHaveLength(p.steps);
      expect(p.pick).toHaveLength(7);
      const f = fitPattern(p, 7);
      expect(f.strum).toHaveLength(7);
      expect(f.pick.every((r) => r.length === 7)).toBe(true);
      expect(f.accents).toHaveLength(7);
    }
  });

  it('keeps the rhythm when moving between grids that divide each other', () => {
    const kinds = (p: { strum: { kind: string }[] }) => p.strum.map((s) => s.kind).join('');
    expect(kinds(fitPattern(folk, 8))).toBe('D-DU-UDU');
    expect(kinds(fitPattern(fitPattern(folk, 8), 16))).toBe(kinds(folk));
    expect(kinds(fitPattern(fitPattern(folk, 8), 6))).toBe('D-DU-U'); // unrelated grids: keep steps in order
  });
});

describe('timeline', () => {
  const song: Pick<Song, 'slots'> = {
    slots: [
      { id: 'a', voicingId: 'lib:G:major:0', bars: 1 },
      { id: 'b', voicingId: 'lib:D:major:0', bars: 0.5 },
      { id: 'c', voicingId: 'lib:C:major:0', bars: 2 },
    ],
  };

  it('lays slots out in 16th-note steps', () => {
    const t = buildTimeline(song, 16);
    expect(t.totalSteps).toBe(16 + 8 + 32);
    expect(t.slotAt[0]).toBe(0);
    expect(t.slotAt[15]).toBe(0);
    expect(t.slotAt[16]).toBe(1);
    expect(t.slotAt[24]).toBe(2);
    expect(buildTimeline(song, 12).totalSteps).toBe(12 + 6 + 24);
  });

  it('works on any custom grid, including odd ones with half-bar chords', () => {
    const six = buildTimeline(song, 6); // 1 + ½ + 2 bars = 21 steps
    expect(six.totalSteps).toBe(21);
    expect(six.slotAt.slice(0, 10)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 2]);
    // 5 steps per bar: two half-bar chords share one bar as 3 + 2 steps, loop stays whole bars
    const halves = { slots: [{ id: 'a', voicingId: 'x', bars: 0.5 }, { id: 'b', voicingId: 'y', bars: 0.5 }] };
    expect(buildTimeline(halves, 5).slotAt).toEqual([0, 0, 0, 1, 1]);
    expect(buildTimeline({ slots: [] }, 6).totalSteps).toBe(0);
  });

  it('chords can last any number of grid steps', () => {
    const s = { slots: [1 / 6, 5 / 6, 2 / 6, 1].map((bars, i) => ({ id: String(i), voicingId: 'x', bars })) };
    const t = buildTimeline(s, 6);
    expect(t.totalSteps).toBe(1 + 5 + 2 + 6);
    expect(t.slotAt).toEqual([0, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3]);
    for (const n of [3, 5, 7, 12, 16, 48]) {
      const all = { slots: Array.from({ length: n - 1 }, (_, k) => ({ id: String(k), voicingId: 'x', bars: (k + 1) / n })) };
      const tl = buildTimeline(all, n);
      for (let k = 0; k < n - 1; k++) expect(tl.slotAt.filter((x) => x === k)).toHaveLength(k + 1);
    }
  });

  it('a bar lasts the same time whatever the grid', () => {
    for (const grid of [1, 5, 6, 7, 16, 48]) {
      expect(stepDuration(120, '4/4', grid) * grid).toBeCloseTo(2, 12);
      expect(stepDuration(120, '3/4', grid) * grid).toBeCloseTo(1.5, 12);
      expect(stepDuration(120, '6/8', grid) * grid).toBeCloseTo(1.5, 12);
    }
    expect(stepDuration(120, '4/4', 6)).toBeCloseTo(1 / 3, 12);
  });

  it('step times never drift across many loops', () => {
    const dur = stepDuration(97);
    const total = buildTimeline(song, 16).totalSteps;
    // the first step of loop 1000 lands exactly 1000 loop-lengths after the start
    expect(stepTime(10, 0, 1000 * total, dur)).toBe(10 + 1000 * total * dur);
    // spacing across the wrap point equals spacing anywhere else
    const wrapGap = stepTime(0, 0, total, dur) - stepTime(0, 0, total - 1, dur);
    const midGap = stepTime(0, 0, 8, dur) - stepTime(0, 0, 7, dur);
    expect(wrapGap).toBeCloseTo(midGap, 12);
    expect(stepDuration(120)).toBe(0.125);
  });

  it('re-anchoring on a tempo change keeps the next step where it was', () => {
    const next = stepTime(5, 0, 40, stepDuration(100));
    expect(stepTime(next, 40, 40, stepDuration(140))).toBe(next);
    expect(stepTime(next, 40, 41, stepDuration(140)) - next).toBeCloseTo(stepDuration(140), 12);
  });
});

describe('project timeline', () => {
  const mk = (id: string, bpm: number, bars: number[], repeats: number): ProjectItem => ({
    id, repeats,
    song: {
      name: id, bpm, capo: 0, timeSig: '4/4', pattern: P[0],
      slots: bars.map((b, i) => ({ id: id + i, voicingId: 'lib:G:major:0', bars: b })),
    },
  });
  const verse = mk('verse', 120, [1, 1, 1, 1], 2);
  const empty = mk('empty', 120, [], 3);
  const chorus = mk('chorus', 90, [1, 0.5, 0.5], 1);
  const items = [verse, empty, chorus];

  it('plays each block its number of times, skipping empty blocks', () => {
    const seen: string[] = [];
    let c: ReturnType<typeof nextCursor> = { item: firstPlayable(items), rep: 0 };
    while (c) {
      seen.push(`${items[c.item].id}#${c.rep}`);
      c = nextCursor(items, c, false);
    }
    expect(seen).toEqual(['verse#0', 'verse#1', 'chorus#0']);
  });

  it('wraps to the start only when repeat is on', () => {
    expect(nextCursor(items, { item: 2, rep: 0 }, false)).toBeNull();
    expect(nextCursor(items, { item: 2, rep: 0 }, true)).toEqual({ item: 0, rep: 0 });
    expect(nextCursor([empty], { item: 0, rep: 0 }, true)).toBeNull();
    expect(firstPlayable([empty])).toBe(-1);
    expect(firstPlayable(items, 1)).toBe(2);
  });

  it('survives the current block being removed mid-play', () => {
    expect(nextCursor([verse], { item: 3, rep: 0 }, false)).toBeNull();
    expect(nextCursor([verse], { item: 3, rep: 0 }, true)).toEqual({ item: 0, rep: 0 });
  });

  it('adds up durations with each block at its own tempo', () => {
    expect(songSeconds(verse.song)).toBeCloseTo(8, 12); // 4 bars at 120
    expect(songSeconds(chorus.song)).toBeCloseTo((2 * 4 * 60) / 90, 12);
    expect(projectSeconds(items)).toBeCloseTo(16 + (2 * 4 * 60) / 90, 12);
  });
});

describe('export', () => {
  const song = (bpm: number, keys: string[], timeSig: Song['timeSig'] = '4/4'): Song => ({
    name: 'x', bpm, capo: 0, timeSig, pattern: P.find((p) => p.id === 'downs')!,
    slots: keys.map((k, i) => ({ id: String(i), voicingId: `lib:${k}:major:0`, bars: 1 })),
  });
  const project = {
    name: 'Demo', loop: true,
    items: [
      { id: 'a', song: song(120, ['G', 'C']), repeats: 2 },
      { id: 'b', song: song(90, ['D']), repeats: 1 },
    ],
  };

  // Minimal SMF reader: returns note-ons, note-offs, tempo changes and the last tick.
  function readMidi(b: Uint8Array) {
    const str = (a: number, n: number) => String.fromCharCode(...b.slice(a, a + n));
    expect(str(0, 4)).toBe('MThd');
    expect([...b.slice(8, 14)]).toEqual([0, 0, 0, 1, 0x01, 0xe0]); // format 0, 1 track, 480 PPQ
    expect(str(14, 4)).toBe('MTrk');
    const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
    expect(22 + len).toBe(b.length);
    let p = 22, tick = 0;
    const ons: { tick: number; pitch: number; vel: number }[] = [], offs: { tick: number; pitch: number }[] = [], tempos: { tick: number; us: number }[] = [];
    let ended = false;
    while (p < b.length) {
      let d = 0;
      for (;;) { const c = b[p++]; d = (d << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
      tick += d;
      const st = b[p++];
      if (st === 0xff) {
        const type = b[p++], n = b[p++];
        if (type === 0x51) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        if (type === 0x2f) ended = true;
        p += n;
      } else if ((st & 0xf0) === 0xc0) p += 1;
      else if ((st & 0xf0) === 0x90) { ons.push({ tick, pitch: b[p], vel: b[p + 1] }); p += 2; }
      else if ((st & 0xf0) === 0x80) { offs.push({ tick, pitch: b[p] }); p += 2; }
      else throw new Error('unexpected status ' + st);
    }
    return { ons, offs, tempos, ended, tick };
  }

  it('lists every pass of a play-through once, ignoring Repeat', () => {
    expect(projectPasses(project.items)).toEqual([0, 0, 1]);
    expect(projectPasses([])).toEqual([]);
  });

  it('writes a valid MIDI file with the right notes and tempo changes', () => {
    const m = readMidi(projectToMidi(project, []));
    expect(m.ended).toBe(true);
    // "downs" = 8 strums a bar. G has 6 strings, C has 5, D has 4.
    expect(m.ons).toHaveLength(2 * (8 * 6 + 8 * 5) + 8 * 4);
    expect(m.offs).toHaveLength(m.ons.length); // nothing left hanging
    expect(m.tempos).toEqual([{ tick: 0, us: 500000 }, { tick: 2 * 2 * 4 * 480, us: 666667 }]);
    // first strum is an accented open-position G chord, low string first
    expect(m.ons.slice(0, 6).map((n) => n.pitch)).toEqual([43, 47, 50, 55, 59, 67]);
    expect(m.ons[0].tick).toBe(0);
    expect(m.ons[0].vel).toBeGreaterThan(m.ons[6].vel - 30);
    // the D block starts exactly 4 bars in (two passes of two bars)
    const firstD = m.ons.find((n) => n.tick >= 7680)!;
    expect(firstD.tick).toBe(7680);
    expect(firstD.pitch).toBe(50);
    expect(m.tick).toBe(7680 + 4 * 480 + 2 * 480); // one bar of D, then the last chord rings two beats
  });

  it('keeps note times exact on an odd grid', () => {
    const s = song(100, ['G']);
    s.pattern = fitPattern(P.find((p) => p.id === 'downs')!, 16);
    s.pattern = { ...s.pattern, steps: 7, strum: Array.from({ length: 7 }, () => ({ kind: 'D' as const, accent: false })), accents: Array(7).fill(false), pick: s.pattern.pick.map(() => Array(7).fill(false)) };
    const m = readMidi(projectToMidi({ name: 'odd', loop: false, items: [{ id: 'a', song: s, repeats: 3 }] }, []));
    const starts = m.ons.filter((n) => n.pitch === 43).map((n) => n.tick);
    expect(starts).toHaveLength(21);
    starts.forEach((t, i) => expect(Math.abs(t - (i * 1920) / 7)).toBeLessThanOrEqual(0.5));
  });

  it('encodes 24-bit stereo WAV', () => {
    const w = encodeWav([Float32Array.from([0, 1, -1, 0.5]), Float32Array.from([0, 0, 0, 0])], 48000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4)) + String.fromCharCode(...w.slice(8, 12))).toBe('RIFFWAVE');
    expect(w.length).toBe(44 + 4 * 2 * 3);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 2, 48000, 24]);
    expect(v.getUint32(40, true)).toBe(24);
    expect([...w.slice(50, 53)]).toEqual([0xff, 0xff, 0x7f]); // +1.0 on the left channel
    expect([...w.slice(56, 59)]).toEqual([0x01, 0x00, 0x80]); // -1.0
  });
});
