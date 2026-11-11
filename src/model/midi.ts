import { resolveVoicing } from './chords';
import { stepEvents } from './pattern';
import { projectPasses, type Project } from './project';
import { buildTimeline, stepDuration } from './timeline';
import { QUARTERS_PER_BAR, type Voicing } from './types';
import { OPEN_MIDI, voicingToNotes } from './voicing';

const PPQ = 480;
const NO_LIMIT = [99, 99, 99, 99, 99, 99];

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** The whole project as a Standard MIDI File (format 0, nylon guitar): every
 *  string pluck as a note at its exact time, with tempo and time-signature
 *  changes between blocks. Opens in any DAW or notation program. */
export function projectToMidi(project: Project, custom: Voicing[]): Uint8Array {
  const events: { tick: number; order: number; data: number[] }[] = [];
  const add = (tick: number, order: number, data: number[]) => events.push({ tick: Math.max(0, Math.round(tick)), order, data });
  // one sounding note per string, like the audio engine
  const active: ({ pitch: number; at: number } | null)[] = [null, null, null, null, null, null];
  const release = (string: number, tick: number) => {
    const a = active[string];
    if (!a) return;
    add(Math.max(tick, a.at + 1), 0, [0x80, a.pitch, 0]);
    active[string] = null;
  };

  add(0, -2, [0xff, 0x03, ...vlq(text(project.name).length), ...text(project.name)]);
  add(0, -2, [0xc0, 24]); // General MIDI: acoustic guitar (nylon)

  let tick = 0;
  let lastTempo = '';
  for (const item of projectPasses(project.items)) {
    const song = project.items[item].song;
    const grid = song.pattern.steps;
    const timeline = buildTimeline(song, grid);
    const stepTicks = (QUARTERS_PER_BAR[song.timeSig] * PPQ) / grid;
    const ticksPerSecond = (song.bpm / 60) * PPQ;
    const tempo = `${song.bpm}|${song.timeSig}`;
    if (tempo !== lastTempo) {
      const usPerQuarter = Math.round(60_000_000 / song.bpm);
      add(tick, -1, [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255]);
      const [nn, dd] = song.timeSig === '6/8' ? [6, 3] : song.timeSig === '3/4' ? [3, 2] : [4, 2];
      add(tick, -1, [0xff, 0x58, 4, nn, dd, 24, 8]);
      lastTempo = tempo;
    }
    for (let i = 0; i < timeline.totalSteps; i++) {
      const slot = song.slots[timeline.slotAt[i]];
      const voicing = slot && resolveVoicing(slot.voicingId, custom);
      if (!voicing) continue;
      const notes = voicingToNotes(voicing.frets, song.capo, NO_LIMIT);
      const evs = stepEvents(song.pattern, i, notes, { stepDur: stepDuration(song.bpm, song.timeSig, grid), humanize: 0 });
      if (!evs.length) continue;
      const t0 = tick + i * stepTicks;
      const inChord = new Set(notes.map((n) => n.string));
      for (let s = 0; s < 6; s++) if (evs[0].muted || !inChord.has(s)) release(s, t0);
      for (const e of evs) {
        const t = t0 + e.offset * ticksPerSecond;
        release(e.string, t);
        const pitch = OPEN_MIDI[e.string] + e.absFret;
        const velocity = Math.min(127, Math.max(1, Math.round(e.gain * (e.layer === 'ff' ? 118 : 100))));
        add(t, 1, [0x90, pitch, e.muted ? Math.round(velocity * 0.6) : velocity]);
        if (e.muted) add(Math.round(t) + Math.max(1, Math.round(0.06 * ticksPerSecond)), 0, [0x80, pitch, 0]);
        else active[e.string] = { pitch, at: Math.round(t) };
      }
    }
    tick += timeline.totalSteps * stepTicks;
  }
  for (let s = 0; s < 6; s++) release(s, tick + PPQ * 2); // let the last chord ring two beats

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let prev = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - prev), ...e.data);
    prev = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0);
  return Uint8Array.from([
    ...text('MThd'), ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255,
    ...text('MTrk'), ...u32(track.length), ...track,
  ]);
}
