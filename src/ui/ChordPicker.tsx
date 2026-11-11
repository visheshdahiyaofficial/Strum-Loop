import { useMemo, useState } from 'react';
import { KEYS, chordName, detectChordName, libraryVoicings, noteName, suffixesFor, transposeName } from '../model/chords';
import type { Frets, Voicing } from '../model/types';
import { voicingMidi } from '../model/voicing';
import { uid } from '../state';
import { ChordDiagram } from './ChordDiagram';

interface Props {
  capo: number;
  custom: Voicing[];
  replacing: boolean;
  onPick: (v: Voicing) => void;
  onPreview: (frets: Frets) => void;
  onSaveCustom: (v: Voicing) => void;
  onDeleteCustom: (id: string) => void;
  onClose: () => void;
}

const COMMON = ['major', 'minor', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', '6', 'm6', '9', 'dim', 'aug'];
const EDIT_FRETS = 15;
const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

export function ChordPicker(props: Props) {
  const { capo, custom, replacing, onPick, onPreview, onSaveCustom, onDeleteCustom, onClose } = props;
  const [tab, setTab] = useState<'library' | 'mine' | 'build'>('library');
  const [root, setRoot] = useState('C');
  const [suffix, setSuffix] = useState('major');
  const [editing, setEditing] = useState<Voicing | null>(null);

  const suffixes = useMemo(() => suffixesFor(root), [root]);
  const voicings = useMemo(() => libraryVoicings(root, suffix), [root, suffix]);
  const verb = replacing ? 'Use' : 'Add';

  const card = (v: Voicing, extra?: React.ReactNode) => (
    <div className="voicing" key={v.id}>
      <button className="voicing-play" onClick={() => onPreview(v.frets)} title="Hear it">
        <span className="chord-name">{v.name}</span>
        <span className="sounding">{capo && transposeName(v.name, capo) !== v.name ? `sounds as ${transposeName(v.name, capo)}` : ' '}</span>
        <ChordDiagram frets={v.frets} size={92} />
      </button>
      <div className="voicing-actions">
        <button className="primary small" onClick={() => onPick(v)}>{verb}</button>
        {extra}
      </div>
    </div>
  );

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Choose a chord">
        <div className="modal-head">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>Chord library</button>
            <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>My chords{custom.length ? ` (${custom.length})` : ''}</button>
            <button role="tab" aria-selected={tab === 'build'} className={tab === 'build' ? 'on' : ''} onClick={() => { setEditing(null); setTab('build'); }}>Build a chord</button>
          </div>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>

        {tab === 'library' && (
          <div className="modal-body">
            <div className="chips">
              {KEYS.map((k) => (
                <button key={k} className={`chip ${k === root ? 'on' : ''}`}
                  onClick={() => { setRoot(k); if (!suffixesFor(k).includes(suffix)) setSuffix('major'); }}>{k}</button>
              ))}
            </div>
            <div className="chips">
              {COMMON.filter((s) => suffixes.includes(s)).map((s) => (
                <button key={s} className={`chip ${s === suffix ? 'on' : ''}`} onClick={() => setSuffix(s)}>{chordName(root, s)}</button>
              ))}
              <select value={COMMON.includes(suffix) ? '' : suffix} onChange={(e) => setSuffix(e.target.value)} aria-label="More chord types">
                <option value="" disabled>More types…</option>
                {suffixes.filter((s) => !COMMON.includes(s)).map((s) => <option key={s} value={s}>{chordName(root, s)}</option>)}
              </select>
            </div>
            <p className="hint">
              {voicings.length} position{voicings.length === 1 ? '' : 's'} of {chordName(root, suffix)}, from the nut up the neck. Click a shape to hear it.
              {capo > 0 && ` Shapes are relative to the capo on fret ${capo}.`}
            </p>
            <div className="voicings">{voicings.map((v) => card(v))}</div>
          </div>
        )}

        {tab === 'mine' && (
          <div className="modal-body">
            {custom.length === 0 ? (
              <p className="empty">No custom chords yet. Use “Build a chord” to make one from any frets you like.</p>
            ) : (
              <div className="voicings">
                {custom.map((v) => card(v, (
                  <>
                    <button className="ghost small" onClick={() => { setEditing(v); setTab('build'); }}>Edit</button>
                    <button className="ghost small" onClick={() => onDeleteCustom(v.id)}>Delete</button>
                  </>
                )))}
              </div>
            )}
          </div>
        )}

        {tab === 'build' && (
          <ChordBuilder key={editing?.id ?? 'new'} capo={capo} initial={editing} verb={verb} onPreview={onPreview}
            onSave={(v, use) => { onSaveCustom(v); if (use) { onPick(v); onClose(); } else { setEditing(null); setTab('mine'); } }} />
        )}
      </div>
    </div>
  );
}

function ChordBuilder({ capo, initial, verb, onPreview, onSave }: {
  capo: number;
  initial: Voicing | null;
  verb: string;
  onPreview: (frets: Frets) => void;
  onSave: (v: Voicing, use: boolean) => void;
}) {
  const [frets, setFrets] = useState<Frets>(initial?.frets ?? [null, null, null, null, null, null]);
  const [name, setName] = useState(initial?.name ?? '');
  const midi = voicingMidi(frets, capo);
  const guess = detectChordName(voicingMidi(frets, 0));
  const finalName = name.trim() || guess || 'Custom chord';
  const any = frets.some((f) => f !== null);
  const set = (s: number, f: number | null) => {
    const next = frets.map((x, i) => (i === s ? (x === f ? null : f) : x));
    setFrets(next);
    if (next[s] !== null) onPreview(next.map((x, i) => (i === s ? x : null)));
  };
  const build = (): Voicing => ({ id: initial?.id ?? 'custom:' + uid(), name: finalName, frets, custom: true });

  return (
    <div className="modal-body builder">
      <p className="hint">
        Click a fret on each string. Click it again (or the ✕) to mute that string. Fret 0 is the open string{capo ? ` (the capo on fret ${capo})` : ''}.
      </p>
      <div className="grid-scroll">
        <div className="fretboard" style={{ ['--frets' as string]: EDIT_FRETS + 1 }}>
          <div className="fb-row fb-nums">
            <span />
            <span />
            {Array.from({ length: EDIT_FRETS + 1 }, (_, f) => <span key={f} className={[3, 5, 7, 9, 12, 15].includes(f) ? 'marker' : ''}>{f}</span>)}
          </div>
          {[5, 4, 3, 2, 1, 0].map((s) => (
            <div className="fb-row" key={s}>
              <span className="fb-name">{STRING_NAMES[s]}</span>
              <button className={`fb-mute ${frets[s] === null ? 'on' : ''}`} onClick={() => setFrets(frets.map((x, i) => (i === s ? null : x)))}
                aria-label={`Mute ${STRING_NAMES[s]} string`}>✕</button>
              {Array.from({ length: EDIT_FRETS + 1 }, (_, f) => (
                <button key={f} className={`fb-cell ${frets[s] === f ? 'on' : ''} ${f === 0 ? 'open' : ''}`}
                  aria-label={`${STRING_NAMES[s]} string fret ${f}`} aria-pressed={frets[s] === f} onClick={() => set(s, f)}>
                  {frets[s] === f ? noteName(40 + [0, 5, 10, 15, 19, 24][s] + capo + f) : ''}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="builder-foot">
        <ChordDiagram frets={frets} size={92} />
        <div className="builder-info">
          <div className="notes">{any ? midi.map(noteName).join(' · ') : 'No strings chosen yet'}</div>
          <div className="guess">{any ? (guess ? `Looks like ${capo ? transposeName(guess, capo) : guess}${capo ? ` (shape: ${guess})` : ''}` : 'No standard name for these notes') : ''}</div>
          <label className="namefield">
            Name
            <input value={name} placeholder={guess ?? 'Custom chord'} onChange={(e) => setName(e.target.value)} maxLength={24} />
          </label>
          <div className="row">
            <button className="ghost" disabled={!any} onClick={() => onPreview(frets)}>▶ Hear it</button>
            <button className="ghost" disabled={!any} onClick={() => onSave(build(), false)}>Save to My chords</button>
            <button className="primary" disabled={!any} onClick={() => onSave(build(), true)}>Save &amp; {verb.toLowerCase()}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
