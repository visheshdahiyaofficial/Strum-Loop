import { useEffect, useRef, useState } from 'react';
import type { PlayerSettings } from './audio/player';
import { PRESETS } from './model/pattern';
import { emptyProject, type Project } from './model/project';
import type { Pattern, Song, Voicing } from './model/types';

export interface AppState {
  song: Song;
  custom: Voicing[];
  songs: Song[];
  patterns: Pattern[];
  project: Project;
  settings: PlayerSettings;
}

const KEY = 'strumloop.v1';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function defaultSong(): Song {
  return {
    name: 'My loop',
    bpm: 92,
    capo: 0,
    timeSig: '4/4',
    pattern: structuredClone(PRESETS[0]),
    slots: ['G', 'D', 'E', 'C'].map((k) => ({
      id: uid(),
      voicingId: `lib:${k}:${k === 'E' ? 'minor' : 'major'}:0`,
      bars: 1,
    })),
  };
}

function initial(): AppState {
  const base: AppState = {
    song: defaultSong(),
    custom: [],
    songs: [],
    patterns: [],
    project: emptyProject(),
    settings: { volume: 0.9, reverb: 0.22, metronome: false, humanize: 1 },
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppState>;
      return { ...base, ...saved, project: { ...base.project, ...saved.project }, settings: { ...base.settings, ...saved.settings } };
    }
  } catch {
    /* corrupt or unavailable storage: start fresh */
  }
  return base;
}

export function useAppState() {
  const [state, setState] = useState<AppState>(initial);
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  }, [state]);
  const update = (fn: (s: AppState) => AppState) => setState(fn);
  const setSong = (fn: (s: Song) => Song) => setState((s) => ({ ...s, song: fn(s.song) }));
  return { state, ref, update, setSong };
}
