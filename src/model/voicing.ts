import type { Frets, StringNote } from './types';

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
export const MAX_CAPO = 12;

/** Maps a chord shape + capo to the real string/fret samples that rebuild it.
 *  Frets past a string's last recorded fret reuse that last recording, pitched up. */
export function voicingToNotes(frets: Frets, capo: number, maxFret: number[]): StringNote[] {
  const notes: StringNote[] = [];
  frets.forEach((f, string) => {
    if (f === null || f === undefined) return;
    const absFret = capo + f;
    const sampleFret = Math.min(absFret, maxFret[string]);
    notes.push({ string, absFret, sampleFret, playbackRate: 2 ** ((absFret - sampleFret) / 12) });
  });
  return notes;
}

export function voicingMidi(frets: Frets, capo: number): number[] {
  return frets.flatMap((f, s) => (f === null ? [] : [OPEN_MIDI[s] + capo + f]));
}
