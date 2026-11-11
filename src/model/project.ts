import { QUARTERS_PER_BAR, type Song } from './types';

/** One block on the project timeline: a snapshot of a loop, played `repeats` times. */
export interface ProjectItem {
  id: string;
  song: Song;
  repeats: number;
}

export interface Project {
  name: string;
  items: ProjectItem[];
  /** start again from the first block after the last one */
  loop: boolean;
}

/** Where playback is: which block, and which pass through it (0-based). */
export interface Cursor {
  item: number;
  rep: number;
}

export const MAX_REPEATS = 32;

export function emptyProject(): Project {
  return { name: 'My project', items: [], loop: false };
}

const playable = (it: ProjectItem | undefined) => !!it && it.song.slots.length > 0 && it.repeats > 0;

/** Index of the first block at or after `from` that has something to play, or -1. */
export function firstPlayable(items: ProjectItem[], from = 0): number {
  for (let i = Math.max(0, from); i < items.length; i++) if (playable(items[i])) return i;
  return -1;
}

/** Called each time a pass through the current block ends. Returns where to go
 *  next, or null when the project is over. */
export function nextCursor(items: ProjectItem[], c: Cursor, loop: boolean): Cursor | null {
  const cur = items[c.item];
  if (playable(cur) && c.rep + 1 < cur.repeats) return { item: c.item, rep: c.rep + 1 };
  const after = firstPlayable(items, c.item + 1);
  if (after >= 0) return { item: after, rep: 0 };
  if (!loop) return null;
  const first = firstPlayable(items, 0);
  return first >= 0 ? { item: first, rep: 0 } : null;
}

/** Block index for every pass of one play-through, in order (ignores Repeat). */
export function projectPasses(items: ProjectItem[]): number[] {
  const out: number[] = [];
  const first = firstPlayable(items);
  let c: Cursor | null = first >= 0 ? { item: first, rep: 0 } : null;
  while (c) {
    out.push(c.item);
    c = nextCursor(items, c, false);
  }
  return out;
}

export function songBars(song: Song): number {
  return song.slots.reduce((a, s) => a + s.bars, 0);
}

/** Length of one pass through a loop, in seconds. */
export function songSeconds(song: Song): number {
  return (songBars(song) * QUARTERS_PER_BAR[song.timeSig] * 60) / song.bpm;
}

export function projectSeconds(items: ProjectItem[]): number {
  return items.reduce((a, it) => a + (playable(it) ? songSeconds(it.song) * it.repeats : 0), 0);
}
