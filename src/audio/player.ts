import { emptyProject, firstPlayable, nextCursor, projectPasses, projectSeconds, type Cursor, type Project } from '../model/project';
import { buildTimeline, stepDuration, stepTime } from '../model/timeline';
import { BEATS_PER_BAR, type Frets, type Song, type Voicing } from '../model/types';
import { voicingToNotes } from '../model/voicing';
import { buildChain, scheduleClick, scheduleStep, type Chain } from './engine';
import { SampleBank } from './sampleBank';
import { GuitarVoices } from './voices';

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

export interface PlayerSettings {
  volume: number;
  reverb: number;
  metronome: boolean;
  humanize: number;
}

/** Real-time looper. A timer wakes every 25 ms and schedules, on the audio
 *  clock, every step that starts within the next 120 ms. Step times come from
 *  an anchor + step count, so the loop wraps without drift or a gap. */
export class Player {
  readonly ctx: AudioContext;
  readonly bank = new SampleBank();
  private chain: Chain;
  private voices: GuitarVoices;
  private timer: number | null = null;
  private anchorTime = 0;
  private anchorCount = 0;
  private count = 0; // absolute steps scheduled since play
  private pos = 0; // step within the loop
  private lastDur = 0;
  private marks: { time: number; pos: number; item: number; rep: number }[] = [];
  /** set while a project is playing: which block and which pass through it */
  private cursor: Cursor | null = null;
  /** audio-clock time at which a finished project's last step ends */
  private endAt: number | null = null;

  getSong: () => Song = () => { throw new Error('no song'); };
  getProject: () => Project = emptyProject;
  /** called when a project reaches its end on its own */
  onEnded: () => void = () => {};
  getCustom: () => Voicing[] = () => [];
  settings: PlayerSettings = { volume: 0.9, reverb: 0.22, metronome: false, humanize: 1 };

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.chain = buildChain(this.ctx, this.settings.reverb, this.settings.volume);
    this.voices = new GuitarVoices(this.ctx, this.bank, this.chain.input);
  }

  load(onProgress: (done: number, total: number) => void) {
    return this.bank.load(this.ctx, onProgress);
  }

  get playing() {
    return this.timer !== null;
  }

  applySettings(s: PlayerSettings) {
    this.settings = s;
    const t = this.ctx.currentTime;
    this.chain.master.gain.setTargetAtTime(s.volume, t, 0.02);
    this.chain.reverbGain.gain.setTargetAtTime(s.reverb, t, 0.02);
  }

  /** Loops the loop being edited. */
  async start() {
    if (this.playing || !this.bank.loaded) return;
    await this.begin(null);
  }

  /** Plays the project timeline from block `from`. Returns false if there is nothing to play. */
  async startProject(from = 0): Promise<boolean> {
    if (this.playing || !this.bank.loaded) return false;
    const first = firstPlayable(this.getProject().items, from);
    if (first < 0) return false;
    await this.begin({ item: first, rep: 0 });
    return true;
  }

  private async begin(cursor: Cursor | null) {
    await this.ctx.resume();
    this.cursor = cursor;
    this.endAt = null;
    this.anchorTime = this.ctx.currentTime + 0.08;
    this.anchorCount = 0;
    this.count = 0;
    this.pos = 0;
    const s = this.current() ?? this.getSong();
    this.lastDur = stepDuration(s.bpm, s.timeSig, s.pattern.steps);
    this.marks = [];
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.marks = [];
    this.cursor = null;
    this.endAt = null;
    this.voices.dampAll(this.ctx.currentTime, 0.03);
  }

  /** A project that ran out: stop scheduling but let the last chord ring. */
  private finish() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.marks = [];
    this.cursor = null;
    this.endAt = null;
    this.onEnded();
  }

  /** The loop being played right now: the editor's loop, or the project's current block. */
  private current(): Song | null {
    if (!this.cursor) return this.getSong();
    return this.getProject().items[this.cursor.item]?.song ?? null;
  }

  /** Moves a playing project to its next pass or block; false when it is over. */
  private advance(): boolean {
    if (!this.cursor) return true;
    const p = this.getProject();
    const next = nextCursor(p.items, this.cursor, p.loop);
    if (!next) return false;
    this.cursor = next;
    return true;
  }

  private tick() {
    if (this.endAt !== null) {
      if (this.ctx.currentTime >= this.endAt) this.finish();
      return;
    }
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    for (;;) {
      const song = this.current();
      const grid = song?.pattern.steps ?? 1;
      const timeline = song ? buildTimeline(song, grid) : null;
      if (!song || !timeline || !timeline.totalSteps) {
        // Nothing to play here. A loop just waits for chords; a project moves on.
        if (!this.cursor) return;
        this.pos = 0;
        if (!this.advance()) { this.endAt = this.ctx.currentTime; return; }
        continue;
      }
      const dur = stepDuration(song.bpm, song.timeSig, grid);
      if (dur !== this.lastDur) {
        // Tempo or grid change (or the next project block): keep the next step where it
        // already was, then use the new spacing.
        this.anchorTime = stepTime(this.anchorTime, this.anchorCount, this.count, this.lastDur);
        this.anchorCount = this.count;
        this.lastDur = dur;
      }
      const time = stepTime(this.anchorTime, this.anchorCount, this.count, dur);
      if (time >= horizon) break;
      if (this.pos >= timeline.totalSteps) this.pos = 0;
      // If the tab was asleep, skip steps that are already in the past.
      if (time >= this.ctx.currentTime - 0.01) {
        scheduleStep(
          { song, timeline, custom: this.getCustom(), bank: this.bank, voices: this.voices, humanize: this.settings.humanize },
          this.pos, time,
        );
        if (this.settings.metronome) {
          // Beats need not land on grid steps (e.g. a 6 grid in 4/4), so place each
          // click at its exact point inside the step it falls in.
          const beats = BEATS_PER_BAR[song.timeSig];
          const inBar = this.pos % grid;
          for (let k = 0; k < beats; k++) {
            const at = (k * grid) / beats;
            if (Math.floor(at + 1e-9) === inBar) scheduleClick(this.ctx, this.chain.master, time + (at - inBar) * dur, k === 0);
          }
        }
        this.marks.push({ time, pos: this.pos, item: this.cursor?.item ?? -1, rep: this.cursor?.rep ?? 0 });
      }
      this.count++;
      this.pos++;
      if (this.pos >= timeline.totalSteps) {
        this.pos = 0;
        if (!this.advance()) {
          this.endAt = stepTime(this.anchorTime, this.anchorCount, this.count, dur);
          break;
        }
      }
    }
  }

  /** What is sounding right now: the step within the loop (-1 when stopped) and,
   *  for a project, the block (-1 otherwise) and pass. */
  playhead(): { pos: number; item: number; rep: number } {
    const none = { pos: -1, item: -1, rep: 0 };
    if (!this.playing) return none;
    const now = this.ctx.currentTime;
    while (this.marks.length > 1 && this.marks[1].time <= now) this.marks.shift();
    const m = this.marks[0];
    return m && m.time <= now ? { pos: m.pos, item: m.item, rep: m.rep } : none;
  }

  /** One slow down-strum to audition a chord shape. */
  async preview(frets: Frets, capo: number) {
    if (!this.bank.loaded) return;
    await this.ctx.resume();
    const t = this.ctx.currentTime + 0.03;
    const notes = voicingToNotes(frets, capo, this.bank.maxFret);
    if (!this.playing) this.voices.dampAll(t, 0.01);
    notes.forEach((n, i) => {
      this.voices.play({ ...n, offset: 0, gain: 0.85, layer: 'mf', muted: false }, t + i * 0.028);
    });
  }

  /** Renders one play-through of the project to audio, with the same engine,
   *  room and feel as live playback, plus a few seconds for the last chord to die away. */
  async renderProject(): Promise<AudioBuffer> {
    if (!this.bank.loaded) throw new Error('The guitar recordings are still loading.');
    const project = this.getProject();
    const passes = projectPasses(project.items);
    const seconds = projectSeconds(project.items);
    if (!passes.length) throw new Error('The project has nothing to play yet.');
    if (seconds > 20 * 60) throw new Error('The project is longer than 20 minutes, which is too long to export in the browser.');
    const sr = this.ctx.sampleRate;
    const off = new OfflineAudioContext(2, Math.ceil((seconds + 4) * sr), sr);
    const chain = buildChain(off, this.settings.reverb, Math.min(1, this.settings.volume));
    const voices = new GuitarVoices(off, this.bank, chain.input);
    let start = 0.05;
    for (const item of passes) {
      const song = project.items[item].song;
      const timeline = buildTimeline(song, song.pattern.steps);
      const dur = stepDuration(song.bpm, song.timeSig, song.pattern.steps);
      for (let i = 0; i < timeline.totalSteps; i++) {
        scheduleStep(
          { song, timeline, custom: this.getCustom(), bank: this.bank, voices, humanize: this.settings.humanize },
          i, stepTime(start, 0, i, dur),
        );
      }
      start += timeline.totalSteps * dur;
    }
    const out = await off.startRendering();
    // Keep a little headroom so nothing clips in the file.
    let peak = 0;
    for (let c = 0; c < out.numberOfChannels; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
    if (peak > 0.97) {
      const g = 0.97 / peak;
      for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
    }
    return out;
  }

  /** Renders the loop offline `passes` times with the same engine and returns
   *  how much the last two passes differ. 0 means a sample-exact loop. */
  async seamTest(passes = 4) {
    const song = this.getSong();
    const timeline = buildTimeline(song, song.pattern.steps);
    const dur = stepDuration(song.bpm, song.timeSig, song.pattern.steps);
    const sr = this.ctx.sampleRate;
    const loopLen = Math.round(timeline.totalSteps * dur * sr);
    const off = new OfflineAudioContext(2, loopLen * passes, sr);
    const chain = buildChain(off, this.settings.reverb, this.settings.volume);
    const voices = new GuitarVoices(off, this.bank, chain.input);
    for (let i = 0; i < timeline.totalSteps * passes; i++) {
      scheduleStep(
        { song, timeline, custom: this.getCustom(), bank: this.bank, voices, humanize: 0 },
        i % timeline.totalSteps, stepTime(0, 0, i, dur),
      );
    }
    const out = await off.startRendering();
    const d = out.getChannelData(0);
    const a = (passes - 2) * loopLen, b = (passes - 1) * loopLen;
    let maxDiff = 0, peak = 0, sum = 0;
    for (let i = 0; i < loopLen; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(d[a + i] - d[b + i]));
      peak = Math.max(peak, Math.abs(d[b + i]));
      sum += d[b + i] * d[b + i];
    }
    // Loudness contour (10 ms windows) of the last two passes. Unlike maxDiff this
    // still works when the loop is not a whole number of samples long.
    const win = Math.round(sr * 0.01);
    let envDiff = 0;
    for (let i = 0; i + win <= loopLen; i += win) {
      let ea = 0, eb = 0;
      for (let j = i; j < i + win; j++) { ea += d[a + j] * d[a + j]; eb += d[b + j] * d[b + j]; }
      envDiff = Math.max(envDiff, Math.abs(Math.sqrt(ea / win) - Math.sqrt(eb / win)));
    }
    // Level right at the wrap point versus the loop average: a gap would show as a dip.
    const w = Math.round(sr * 0.05);
    let seam = 0;
    for (let i = b - w; i < b + w; i++) seam += d[i] * d[i];
    return {
      loopSeconds: loopLen / sr,
      loopSamples: loopLen,
      exactSamples: timeline.totalSteps * dur * sr,
      peak,
      rms: Math.sqrt(sum / loopLen),
      seamRms: Math.sqrt(seam / (2 * w)),
      maxDiff,
      envDiff,
    };
  }
}

// Development only: the app keeps one Player alive across hot reloads, so any page
// left open would keep an out-of-date player after this file (or the engine under
// it) changes. Reload the page instead so the open tab always has the current one.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
