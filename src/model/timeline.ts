import { QUARTERS_PER_BAR, type Song, type TimeSig } from './types';

export interface Timeline {
  /** slot index for every 16th-note step of one pass through the song */
  slotAt: number[];
  totalSteps: number;
  stepsPerBar: number;
}

/** `grid` is the number of steps in a bar. Each step belongs to whichever chord
 *  is sounding at that point of the bar, so a half-bar chord still works on an
 *  odd grid and the loop always stays a whole number of bars long. */
export function buildTimeline(song: Pick<Song, 'slots'>, grid: number): Timeline {
  const ends: number[] = [];
  let bars = 0;
  for (const slot of song.slots) ends.push((bars += slot.bars));
  const totalSteps = song.slots.length ? Math.max(1, Math.round(bars * grid)) : 0;
  const slotAt: number[] = [];
  let slot = 0;
  for (let i = 0; i < totalSteps; i++) {
    while (slot < ends.length - 1 && i / grid >= ends[slot] - 1e-9) slot++;
    slotAt.push(slot);
  }
  return { slotAt, totalSteps, stepsPerBar: grid };
}

/** Seconds per grid step: the bar's length (BPM counts quarter notes) split into `grid` equal parts. */
export function stepDuration(bpm: number, timeSig: TimeSig = '4/4', grid = 16): number {
  return (QUARTERS_PER_BAR[timeSig] * 60) / bpm / grid;
}

/** Start time of an absolute step. Always derived from an anchor (never summed
 *  step by step) so the loop cannot drift or leave a gap at the wrap point. */
export function stepTime(anchorTime: number, anchorStep: number, step: number, stepDur: number): number {
  return anchorTime + (step - anchorStep) * stepDur;
}
