import { useEffect, useMemo, useRef, useState } from 'react';
import { Player } from './audio/player';
import { encodeWav } from './audio/wav';
import { projectToMidi } from './model/midi';
import { buildTimeline } from './model/timeline';
import type { Song, Voicing } from './model/types';
import { defaultSong, uid, useAppState } from './state';
import { ChordPicker } from './ui/ChordPicker';
import { PatternEditor } from './ui/PatternEditor';
import { ProjectTimeline } from './ui/ProjectTimeline';
import { Sequence, barOptions } from './ui/Sequence';
import { SongSearch } from './ui/SongSearch';
import { Transport } from './ui/Transport';

type Load = { phase: 'loading'; done: number; total: number } | { phase: 'ready' } | { phase: 'error'; message: string };

export function App() {
  const { state, ref, update, setSong } = useAppState();
  const { song, custom, settings } = state;
  // Held in state (not useMemo) so a hot reload during development keeps the
  // player that already has the recordings loaded.
  const [player] = useState(() => new Player());
  const [load, setLoad] = useState<Load>({ phase: 'loading', done: 0, total: 0 });
  const [mode, setMode] = useState<'off' | 'loop' | 'project'>('off');
  const [head, setHead] = useState({ pos: -1, item: -1, rep: 0 });
  const playing = mode !== 'off';
  const [picker, setPicker] = useState<null | { slotId: string | null }>(null);
  const [about, setAbout] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    player.getSong = () => ref.current.song;
    player.getCustom = () => ref.current.custom;
    player.getProject = () => ref.current.project;
    player.onEnded = () => setMode('off');
    (window as unknown as { strumloop: Player }).strumloop = player;
    if (started.current) return;
    started.current = true;
    player
      .load((done, total) => setLoad({ phase: 'loading', done, total }))
      .then(() => setLoad({ phase: 'ready' }))
      .catch((e: Error) => setLoad({ phase: 'error', message: e.message }));
  }, [player, ref]);

  useEffect(() => player.applySettings(settings), [player, settings]);

  // Follow the audio clock for the on-screen playhead.
  useEffect(() => {
    if (!playing) { setHead({ pos: -1, item: -1, rep: 0 }); return; }
    let raf = 0;
    const loop = () => {
      const h = player.playhead();
      setHead((old) => (old.pos === h.pos && old.item === h.item && old.rep === h.rep ? old : h));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, player]);

  const ready = load.phase === 'ready';
  const stop = () => { player.stop(); setMode('off'); };
  const playLoop = () => {
    if (!ready || !ref.current.song.slots.length) return;
    player.stop();
    setMode('loop');
    void player.start().then(() => { if (!player.playing) setMode('off'); });
  };
  const playProject = (from: number) => {
    if (!ready) return;
    player.stop();
    setMode('project');
    void player.startProject(from).then((ok) => { if (!ok) setMode('off'); });
  };
  /** The big Play button and the Space key: stop whatever is playing, else loop the editor's loop. */
  const toggle = () => (mode === 'loop' ? stop() : playLoop());
  const toggleAny = () => (player.playing ? stop() : playLoop());
  const toggleRef = useRef(toggleAny);
  toggleRef.current = toggleAny;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const timeline = useMemo(() => buildTimeline(song, song.pattern.steps), [song]);
  // The chord and pattern highlights follow the editor's loop only; a project block has its own.
  const pos = mode === 'loop' ? head.pos : -1;
  const activeSlot = pos >= 0 ? timeline.slotAt[pos] ?? -1 : -1;
  const activeStep = pos >= 0 ? pos % timeline.stepsPerBar : -1;
  const bars = +(timeline.totalSteps / timeline.stepsPerBar).toFixed(2);
  // lengths offered for "set all chords": the same list each chord's own dropdown has
  const allLengths = barOptions(song.pattern.steps, 1);
  const preview = (v: { frets: Voicing['frets'] }) => { if (ready) void player.preview(v.frets, ref.current.song.capo); };

  const pickChord = (v: Voicing) => {
    const slotId = picker?.slotId ?? null;
    setSong((s) => ({
      ...s,
      slots: slotId
        ? s.slots.map((x) => (x.id === slotId ? { ...x, voicingId: v.id } : x))
        : [...s.slots, { id: uid(), voicingId: v.id, bars: 1 }],
    }));
    preview(v);
    if (slotId) setPicker(null);
  };

  const exportProject = async (kind: 'wav' | 'midi') => {
    const { project, custom: chords } = ref.current;
    let bytes: Uint8Array;
    if (kind === 'wav') {
      const audio = await player.renderProject();
      bytes = encodeWav([audio.getChannelData(0), audio.getChannelData(1)], audio.sampleRate);
    } else {
      bytes = projectToMidi(project, chords);
    }
    const name = (project.name.trim() || 'StrumLoop project').replace(/[\\/:*?"<>|]+/g, '-');
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: kind === 'wav' ? 'audio/wav' : 'audio/midi' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${kind === 'wav' ? 'wav' : 'mid'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const saveSong = () => update((s) => {
    const copy: Song = structuredClone(s.song);
    return { ...s, songs: [...s.songs.filter((x) => x.name !== copy.name), copy] };
  });

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>StrumLoop</h1>
          <span className="tag">real nylon-guitar chord loops</span>
        </div>
        <div className="songbar">
          <input className="songname" value={song.name} aria-label="Loop name" maxLength={40}
            onChange={(e) => setSong((s) => ({ ...s, name: e.target.value }))} />
          <button className="ghost small" onClick={saveSong}>Save</button>
          <select value="" aria-label="Open a saved loop"
            onChange={(e) => {
              const found = state.songs.find((x) => x.name === e.target.value);
              if (found) update((s) => ({ ...s, song: structuredClone(found) }));
            }}>
            <option value="" disabled>{state.songs.length ? 'Open…' : 'No saved loops'}</option>
            {state.songs.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
          {state.songs.some((x) => x.name === song.name) && (
            <button className="ghost small" onClick={() => update((s) => ({ ...s, songs: s.songs.filter((x) => x.name !== s.song.name) }))}>Delete</button>
          )}
          <button className="ghost small" onClick={() => update((s) => ({ ...s, song: defaultSong() }))}>New</button>
          <button className="ghost small" onClick={() => setAbout(true)}>About</button>
        </div>
      </header>

      {load.phase !== 'ready' && (
        <div className={`loading ${load.phase}`} role="status">
          {load.phase === 'loading' ? (
            <>
              <span>Loading guitar recordings… {load.total ? `${load.done} / ${load.total}` : ''}</span>
              <div className="bar"><div style={{ width: `${load.total ? (100 * load.done) / load.total : 0}%` }} /></div>
            </>
          ) : (
            <span>Couldn’t load the guitar recordings: {load.message}</span>
          )}
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Find a song</h2>
          <span className="meta">chords, tempo and strumming from Ultimate Guitar</span>
        </div>
        <SongSearch
          onLoadLoop={(loop) => update((s) => ({ ...s, song: structuredClone(loop) }))}
          onAddBlocks={(items, title) => update((s) => ({
            ...s,
            project: {
              ...s.project,
              name: s.project.items.length ? s.project.name : title.slice(0, 40),
              items: [...s.project.items, ...structuredClone(items)],
            },
          }))} />
      </section>

      <Transport song={song} settings={settings} playing={mode === 'loop'} onToggle={toggle} setSong={setSong}
        setSettings={(fn) => update((s) => ({ ...s, settings: fn(s.settings) }))} />

      <section>
        <div className="section-head">
          <h2>Chord order</h2>
          <span className="meta">
            {song.slots.length} chord{song.slots.length === 1 ? '' : 's'} · {bars} bar{bars === 1 ? '' : 's'} per loop
          </span>
          <span className="spacer" />
          <select className="all-lengths" value="" disabled={!song.slots.length} aria-label="Set every chord to the same length"
            onChange={(e) => {
              const length = allLengths[Number(e.target.value)].value;
              setSong((s) => ({ ...s, slots: s.slots.map((x) => ({ ...x, bars: length })) }));
            }}>
            <option value="" disabled>Set all chords to…</option>
            {allLengths.map((o, k) => <option key={k} value={k}>{o.label}</option>)}
          </select>
        </div>
        <Sequence song={song} custom={custom} activeSlot={activeSlot} setSong={setSong} onPreview={preview}
          onAdd={() => setPicker({ slotId: null })} onChange={(slotId) => setPicker({ slotId })} />
      </section>

      <section>
        <div className="section-head">
          <h2>Pattern</h2>
          <span className="meta">one bar of {song.pattern.steps} steps, repeated under every chord</span>
        </div>
        <PatternEditor song={song} saved={state.patterns} activeStep={activeStep} setSong={setSong}
          onSave={(p) => update((s) => ({ ...s, patterns: [...s.patterns, p] }))}
          onDelete={(id) => update((s) => ({ ...s, patterns: s.patterns.filter((x) => x.id !== id) }))} />
      </section>

      <section>
        <div className="section-head">
          <h2>Project timeline</h2>
          <span className="meta">loops played one after another</span>
        </div>
        <ProjectTimeline project={state.project} current={song} saved={state.songs} custom={custom}
          playing={mode === 'project'} active={mode === 'project' ? head : { item: -1, rep: 0 }}
          setProject={(fn) => update((s) => ({ ...s, project: fn(s.project) }))}
          onPlay={playProject} onStop={stop} onExport={exportProject}
          onOpen={(loop) => update((s) => ({ ...s, song: structuredClone(loop) }))} />
      </section>

      {picker && (
        <ChordPicker capo={song.capo} custom={custom} replacing={picker.slotId !== null}
          onPick={pickChord} onPreview={(frets) => preview({ frets })}
          onSaveCustom={(v) => update((s) => ({ ...s, custom: [...s.custom.filter((x) => x.id !== v.id), v] }))}
          onDeleteCustom={(id) => update((s) => ({ ...s, custom: s.custom.filter((x) => x.id !== id) }))}
          onClose={() => setPicker(null)} />
      )}

      {about && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setAbout(false)}>
          <div className="modal narrow" role="dialog" aria-label="About StrumLoop">
            <div className="modal-head">
              <h2>About</h2>
              <button className="icon" onClick={() => setAbout(false)} aria-label="Close">×</button>
            </div>
            <div className="modal-body prose">
              <p>
                Every chord you hear is rebuilt live from single-note recordings: each of the six strings, recorded open and at
                every fret, triggered one after another in strum order. Nothing is a pre-recorded chord.
              </p>
              <p>
                Recordings: University of Iowa Electronic Music Studios, Musical Instrument Samples — Guitar (Raimundo 118
                classical guitar, recorded in an anechoic chamber). Frets beyond the last recorded one on a string reuse that
                string’s highest recording, pitched up.
              </p>
              <p>Chord shapes: chords-db by tombatossals (MIT licence).</p>
              <p>Tip: press Space to play or stop.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
