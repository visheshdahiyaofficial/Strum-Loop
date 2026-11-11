/** Fret per string, index 0 = low E (6th string) … 5 = high E. null = muted.
 *  Frets are relative to the capo (0 = open string / capo fret). */
export type Frets = (number | null)[];

export interface Voicing {
  id: string;
  name: string;
  frets: Frets;
  custom?: boolean;
}

export type StrumKind = 'D' | 'U' | 'X' | '-';

export interface StrumStep {
  kind: StrumKind;
  accent: boolean;
}

/** Row 0 = "Bass" (lowest sounding string of the chord), rows 1..6 = strings 6..1. */
export const PICK_ROWS = 7;

export interface Pattern {
  id: string;
  name: string;
  mode: 'strum' | 'pick';
  /** the grid: how many equal steps one bar is divided into (any number, e.g. 6) */
  steps: number;
  strum: StrumStep[];
  /** pick[row][step] */
  pick: boolean[][];
  accents: boolean[];
}

export type TimeSig = '4/4' | '3/4' | '6/8';

/** Default grid (16th notes) for each time signature. */
export const STEPS_PER_BAR: Record<TimeSig, number> = { '4/4': 16, '3/4': 12, '6/8': 12 };
/** Bar length in quarter notes, and how many beats the metronome counts in it. */
export const QUARTERS_PER_BAR: Record<TimeSig, number> = { '4/4': 4, '3/4': 3, '6/8': 3 };
export const BEATS_PER_BAR: Record<TimeSig, number> = { '4/4': 4, '3/4': 3, '6/8': 2 };
export const MAX_GRID = 48;

export interface Slot {
  id: string;
  voicingId: string;
  /** length in bars: 0.5, 1, 2, 4 */
  bars: number;
}

export interface Song {
  name: string;
  bpm: number;
  capo: number;
  timeSig: TimeSig;
  pattern: Pattern;
  slots: Slot[];
}

/** One string to sound: which sample to use and how far to pitch-shift it. */
export interface StringNote {
  string: number;
  absFret: number;
  sampleFret: number;
  playbackRate: number;
}

export interface NoteEvent extends StringNote {
  /** seconds after the step's start */
  offset: number;
  gain: number;
  layer: 'mf' | 'ff';
  muted: boolean;
}
