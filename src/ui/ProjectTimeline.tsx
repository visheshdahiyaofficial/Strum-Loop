import { useState } from 'react';
import { resolveVoicing } from '../model/chords';
import { MAX_REPEATS, projectSeconds, songBars, songSeconds, type Project, type ProjectItem } from '../model/project';
import type { Song, Voicing } from '../model/types';
import { uid } from '../state';

interface Props {
  project: Project;
  current: Song;
  saved: Song[];
  custom: Voicing[];
  playing: boolean;
  /** block and pass sounding now, or item -1 */
  active: { item: number; rep: number };
  setProject: (fn: (p: Project) => Project) => void;
  onPlay: (from: number) => void;
  onStop: () => void;
  onOpen: (song: Song) => void;
  /** renders and downloads the project; resolves when the file has been handed to the browser */
  onExport: (kind: 'wav' | 'midi') => Promise<void>;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function ProjectTimeline({ project, current, saved, custom, playing, active, setProject, onPlay, onStop, onOpen, onExport }: Props) {
  const [busy, setBusy] = useState<null | 'wav' | 'midi'>(null);
  const [error, setError] = useState('');
  // Tempo to apply to every block; starts from the first block's tempo.
  const [allBpm, setAllBpm] = useState('');
  const bpms = [...new Set(project.items.map((it) => it.song.bpm))];
  const bpmText = allBpm !== '' ? allBpm : String(project.items[0]?.song.bpm ?? current.bpm);
  const bpmValue = Math.min(240, Math.max(40, Math.round(Number(bpmText) || 0)));
  const bpmValid = bpmText.trim() !== '' && Number(bpmText) >= 40 && Number(bpmText) <= 240;
  const applyBpm = () => {
    setItems((items) => items.map((it) => ({ ...it, song: { ...it.song, bpm: bpmValue } })));
    setAllBpm('');
  };
  const exportAs = (kind: 'wav' | 'midi') => {
    setBusy(kind);
    setError('');
    // Start a moment later so the button can show it is working before the render begins.
    setTimeout(() => {
      onExport(kind).catch((e: Error) => setError(e.message)).finally(() => setBusy(null));
    }, 40);
  };
  const setItems = (fn: (items: ProjectItem[]) => ProjectItem[]) => setProject((p) => ({ ...p, items: fn(p.items) }));
  const add = (song: Song) => setItems((items) => [...items, { id: uid(), song: structuredClone(song), repeats: 2 }]);
  const move = (from: number, to: number) =>
    setItems((items) => {
      if (to < 0 || to >= items.length) return items;
      const next = [...items];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  const total = projectSeconds(project.items);

  return (
    <div className="project">
      <div className="project-bar">
        <button className={`primary ${playing ? 'stop' : ''}`} disabled={!playing && total === 0}
          onClick={() => (playing ? onStop() : onPlay(0))}>
          {playing ? '■ Stop project' : '▶ Play project'}
        </button>
        <input className="songname" value={project.name} aria-label="Project name" maxLength={40}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))} />
        <label className="check">
          <input type="checkbox" checked={project.loop} onChange={(e) => setProject((p) => ({ ...p, loop: e.target.checked }))} />
          Repeat
        </label>
        <span className="meta">{project.items.length} block{project.items.length === 1 ? '' : 's'} · {clock(total)}</span>
        <span className="spacer" />
        <button className="ghost small" disabled={!current.slots.length} onClick={() => add(current)}>+ Add current loop</button>
        <select value="" aria-label="Add a saved loop" disabled={!saved.length}
          onChange={(e) => { const s = saved.find((x) => x.name === e.target.value); if (s) add(s); }}>
          <option value="" disabled>{saved.length ? '+ Add saved loop…' : 'No saved loops'}</option>
          {saved.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>

      <div className="project-bar export">
        <span className="meta">Download for a DAW:</span>
        <button className="ghost small" disabled={total === 0 || busy !== null} onClick={() => exportAs('wav')}
          title="Stereo 24-bit WAV audio of the whole project">
          {busy === 'wav' ? 'Rendering audio…' : '⬇ WAV audio'}
        </button>
        <button className="ghost small" disabled={total === 0 || busy !== null} onClick={() => exportAs('midi')}
          title="MIDI file with every note, tempo and time-signature change">
          {busy === 'midi' ? 'Writing…' : '⬇ MIDI notes'}
        </button>
        {error && <span className="export-error" role="alert">{error}</span>}
        <span className="spacer" />
        <div className="tempo-all">
        <label className="meta" htmlFor="allbpm">Tempo for all blocks:</label>
        <input id="allbpm" type="number" min={40} max={240} value={bpmText} disabled={!project.items.length}
          onChange={(e) => setAllBpm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && bpmValid && project.items.length) applyBpm(); }} />
        <button className="ghost small" onClick={applyBpm}
          disabled={!project.items.length || !bpmValid || (bpms.length === 1 && bpms[0] === bpmValue)}
          title="Set every block on the timeline to this BPM">
          Set all to {bpmValid ? bpmValue : '…'} BPM
        </button>
        {project.items.length > 0 && (
          <span className="meta">{bpms.length === 1 ? `all at ${bpms[0]}` : `now ${Math.min(...bpms)}–${Math.max(...bpms)}`}</span>
        )}
        </div>
      </div>

      {project.items.length === 0 ? (
        <p className="empty">
          Build a loop above, then “Add current loop” to place it here. Add more loops (verse, chorus, bridge…), set how many times
          each repeats, and play them back to back as one piece.
        </p>
      ) : (
        <div className="blocks">
          {project.items.map((it, i) => {
            const names = it.song.slots.map((s) => resolveVoicing(s.voicingId, custom)?.name ?? '?');
            const bars = +songBars(it.song).toFixed(2);
            const on = active.item === i;
            return (
              <div key={it.id} className={`block ${on ? 'active' : ''}`}>
                <div className="slot-head">
                  <span className="slot-num">{i + 1}</span>
                  <button className="icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move earlier">‹</button>
                  <button className="icon" onClick={() => move(i, i + 1)} disabled={i === project.items.length - 1} aria-label="Move later">›</button>
                  <button className="icon" aria-label="Duplicate block" title="Duplicate this block"
                    onClick={() => setItems((items) => {
                      const next = [...items];
                      next.splice(i + 1, 0, { ...structuredClone(it), id: uid() });
                      return next;
                    })}>⧉</button>
                  <button className="icon" aria-label="Remove block" title="Remove this block" onClick={() => setItems((items) => items.filter((x) => x.id !== it.id))}>×</button>
                </div>
                <button className="block-body" onClick={() => { if (playing) onStop(); onPlay(i); }} title="Play the project from here">
                  <span className="block-name">{it.song.name || 'Untitled loop'}</span>
                  <span className="block-chords">{names.length ? names.join(' · ') : 'no chords'}</span>
                  <span className="block-meta">
                    {it.song.bpm} BPM · {it.song.timeSig}{it.song.capo ? ` · capo ${it.song.capo}` : ''} · {bars} bar{bars === 1 ? '' : 's'} · {it.song.pattern.mode === 'pick' ? 'pick' : 'strum'}
                  </span>
                  <span className="block-pass">{on ? `playing pass ${active.rep + 1} of ${it.repeats}` : clock(songSeconds(it.song) * it.repeats)}</span>
                </button>
                <div className="slot-foot">
                  <button className="step" aria-label="Fewer repeats" disabled={it.repeats <= 1}
                    onClick={() => setItems((items) => items.map((x) => (x.id === it.id ? { ...x, repeats: x.repeats - 1 } : x)))}>−</button>
                  <span className="value reps">×{it.repeats}</span>
                  <button className="step" aria-label="More repeats" disabled={it.repeats >= MAX_REPEATS}
                    onClick={() => setItems((items) => items.map((x) => (x.id === it.id ? { ...x, repeats: x.repeats + 1 } : x)))}>+</button>
                  <button className="ghost small" onClick={() => onOpen(it.song)} title="Load this loop into the editor above">Edit</button>
                  <button className="ghost small" title="Replace this block with the loop in the editor above"
                    onClick={() => setItems((items) => items.map((x) => (x.id === it.id ? { ...x, song: structuredClone(current) } : x)))}>Update</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
