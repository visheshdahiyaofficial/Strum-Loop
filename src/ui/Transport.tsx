import { useRef } from 'react';
import type { PlayerSettings } from '../audio/player';
import { fitPattern } from '../model/pattern';
import { STEPS_PER_BAR, type Song, type TimeSig } from '../model/types';
import { MAX_CAPO } from '../model/voicing';

interface Props {
  song: Song;
  settings: PlayerSettings;
  playing: boolean;
  onToggle: () => void;
  setSong: (fn: (s: Song) => Song) => void;
  setSettings: (fn: (s: PlayerSettings) => PlayerSettings) => void;
}

const clampBpm = (n: number) => Math.min(240, Math.max(40, Math.round(n)));

export function Transport({ song, settings, playing, onToggle, setSong, setSettings }: Props) {
  const taps = useRef<number[]>([]);
  const tap = () => {
    const now = performance.now();
    const t = taps.current.filter((x) => now - x < 2500);
    t.push(now);
    taps.current = t.slice(-6);
    if (taps.current.length >= 2) {
      const span = taps.current[taps.current.length - 1] - taps.current[0];
      setSong((s) => ({ ...s, bpm: clampBpm(60000 / (span / (taps.current.length - 1))) }));
    }
  };
  const setBpm = (n: number) => setSong((s) => ({ ...s, bpm: clampBpm(n) }));
  const setCapo = (n: number) => setSong((s) => ({ ...s, capo: Math.min(MAX_CAPO, Math.max(0, n)) }));

  return (
    <div className="transport">
      <button className={`play ${playing ? 'on' : ''}`} onClick={onToggle} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? '■ Stop' : '▶ Play'}
      </button>

      <div className="field bpm">
        <label htmlFor="bpm">BPM</label>
        <div className="row">
          <button className="step" onClick={() => setBpm(song.bpm - 1)} aria-label="Slower">−</button>
          <input id="bpm" type="number" min={40} max={240} value={song.bpm}
            onChange={(e) => e.target.value && setBpm(Number(e.target.value))} />
          <button className="step" onClick={() => setBpm(song.bpm + 1)} aria-label="Faster">+</button>
          <button className="ghost" onClick={tap}>Tap</button>
        </div>
        <input type="range" min={40} max={240} value={song.bpm} aria-label="Tempo"
          onChange={(e) => setBpm(Number(e.target.value))} />
      </div>

      <div className="field">
        <label>Capo</label>
        <div className="row">
          <button className="step" onClick={() => setCapo(song.capo - 1)} aria-label="Capo down">−</button>
          <span className="value">{song.capo === 0 ? 'None' : `Fret ${song.capo}`}</span>
          <button className="step" onClick={() => setCapo(song.capo + 1)} aria-label="Capo up">+</button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="sig">Time</label>
        <select id="sig" value={song.timeSig}
          onChange={(e) => {
            const timeSig = e.target.value as TimeSig;
            // A grid left on the old signature's default follows the new one; a custom grid is kept.
            setSong((s) => ({
              ...s, timeSig,
              pattern: s.pattern.steps === STEPS_PER_BAR[s.timeSig] ? fitPattern(s.pattern, STEPS_PER_BAR[timeSig]) : s.pattern,
            }));
          }}>
          <option>4/4</option>
          <option>3/4</option>
          <option>6/8</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="rev">Room</label>
        <input id="rev" type="range" min={0} max={0.6} step={0.01} value={settings.reverb}
          onChange={(e) => setSettings((s) => ({ ...s, reverb: Number(e.target.value) }))} />
      </div>

      <div className="field">
        <label htmlFor="vol">Volume</label>
        <input id="vol" type="range" min={0} max={1.2} step={0.01} value={settings.volume}
          onChange={(e) => setSettings((s) => ({ ...s, volume: Number(e.target.value) }))} />
      </div>

      <div className="field toggles">
        <label className="check">
          <input type="checkbox" checked={settings.metronome}
            onChange={(e) => setSettings((s) => ({ ...s, metronome: e.target.checked }))} />
          Click
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.humanize > 0}
            onChange={(e) => setSettings((s) => ({ ...s, humanize: e.target.checked ? 1 : 0 }))} />
          Human feel
        </label>
      </div>
    </div>
  );
}
