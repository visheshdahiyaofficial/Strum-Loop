import type { NoteEvent } from '../model/types';
import type { SampleBank } from './sampleBank';

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** Six strings, one sounding note each: plucking a string cuts off whatever
 *  that string was playing, exactly as on a real guitar. */
export class GuitarVoices {
  private current: (Voice | null)[] = [null, null, null, null, null, null];

  constructor(
    private ctx: BaseAudioContext,
    private bank: SampleBank,
    private out: AudioNode,
  ) {}

  play(ev: NoteEvent, time: number): void {
    const sample = this.bank.get(ev.layer, ev.string, ev.sampleFret);
    if (!sample) return;
    this.damp(ev.string, time, 0.004);

    const src = this.ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = ev.playbackRate * sample.tune;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(ev.gain, time);
    if (ev.muted) {
      // Palm-muted "chk": the pluck's attack only, darkened and cut short.
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
      src.connect(lp).connect(gain).connect(this.out);
      src.start(time, sample.offset);
      src.stop(time + 0.09);
    } else {
      src.connect(gain).connect(this.out);
      src.start(time, sample.offset);
    }
    const voice: Voice = { src, gain };
    this.current[ev.string] = voice;
    src.onended = () => {
      if (this.current[ev.string] === voice) this.current[ev.string] = null;
      gain.disconnect();
    };
  }

  /** Stops a string ringing, with a short fade so it never clicks. */
  damp(string: number, time: number, timeConstant = 0.012): void {
    const v = this.current[string];
    if (!v) return;
    v.gain.gain.cancelScheduledValues(time);
    v.gain.gain.setTargetAtTime(0, time, timeConstant);
    try {
      v.src.stop(time + timeConstant * 8);
    } catch {
      /* already stopped */
    }
    this.current[string] = null;
  }

  dampAll(time: number, timeConstant = 0.012): void {
    for (let s = 0; s < 6; s++) this.damp(s, time, timeConstant);
  }

  /** Silences strings the new chord doesn't use (the fretting hand lifts off them). */
  dampExcept(strings: Set<number>, time: number): void {
    for (let s = 0; s < 6; s++) if (!strings.has(s)) this.damp(s, time, 0.03);
  }
}
