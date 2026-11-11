import { resolveVoicing } from '../model/chords';
import { stepEvents } from '../model/pattern';
import { stepDuration, type Timeline } from '../model/timeline';
import type { Song, Voicing } from '../model/types';
import { voicingToNotes } from '../model/voicing';
import type { SampleBank } from './sampleBank';
import { GuitarVoices } from './voices';

export interface Chain {
  input: GainNode;
  reverbGain: GainNode;
  master: GainNode;
}

/** Deterministic noise so the reverb (and the offline loop test) is repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function impulseResponse(ctx: BaseAudioContext, seconds = 1.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.round(sr * seconds);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const rand = seeded(ch ? 9173 : 2741);
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const white = rand() * 2 - 1;
      // darker as the tail decays, like a small wooden room
      const a = 0.25 + 0.6 * Math.exp(-t * 3);
      lp += a * (white - lp);
      const pre = t < 0.012 ? t / 0.012 : 1;
      d[i] = lp * pre * Math.exp(-t * 4.2);
    }
  }
  return ir;
}

/** guitar → (dry + small-room reverb) → limiter → master → destination */
export function buildChain(ctx: BaseAudioContext, reverbMix: number, volume: number): Chain {
  const input = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = impulseResponse(ctx);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = reverbMix;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = volume;
  input.connect(limiter);
  input.connect(convolver).connect(reverbGain).connect(limiter);
  limiter.connect(master).connect(ctx.destination);
  return { input, reverbGain, master };
}

export interface StepContext {
  song: Song;
  timeline: Timeline;
  custom: Voicing[];
  bank: SampleBank;
  voices: GuitarVoices;
  humanize: number;
}

/** Schedules everything that sounds on one 16th-note step of the loop. */
export function scheduleStep(c: StepContext, pos: number, time: number): void {
  const slot = c.song.slots[c.timeline.slotAt[pos]];
  if (!slot) return;
  const voicing = resolveVoicing(slot.voicingId, c.custom);
  if (!voicing) return;
  const notes = voicingToNotes(voicing.frets, c.song.capo, c.bank.maxFret);
  const stepDur = stepDuration(c.song.bpm, c.song.timeSig, c.song.pattern.steps);
  const events = stepEvents(c.song.pattern, pos, notes, { stepDur, humanize: c.humanize });
  if (!events.length) return;
  if (events[0].muted) c.voices.dampAll(time, 0.006);
  else c.voices.dampExcept(new Set(notes.map((n) => n.string)), time);
  for (const ev of events) c.voices.play(ev, time + ev.offset);
}

export function scheduleClick(ctx: BaseAudioContext, out: AudioNode, time: number, strong: boolean): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = strong ? 1568 : 1046;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(strong ? 0.25 : 0.14, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
  osc.connect(g).connect(out);
  osc.start(time);
  osc.stop(time + 0.06);
}
