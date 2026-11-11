import { PRESETS, emptyPattern, fitPattern } from '../model/pattern';
import { BEATS_PER_BAR, MAX_GRID, STEPS_PER_BAR, type Pattern, type Song, type StrumKind } from '../model/types';
import { uid } from '../state';

interface Props {
  song: Song;
  saved: Pattern[];
  /** playhead step within the bar, or -1 */
  activeStep: number;
  setSong: (fn: (s: Song) => Song) => void;
  onSave: (p: Pattern) => void;
  onDelete: (id: string) => void;
}

const NEXT: Record<StrumKind, StrumKind> = { '-': 'D', D: 'U', U: 'X', X: '-' };
const GLYPH: Record<StrumKind, string> = { '-': '', D: '↓', U: '↑', X: '✕' };
const LABEL: Record<StrumKind, string> = { '-': 'rest', D: 'down strum', U: 'up strum', X: 'muted strum' };
const ROWS = ['Bass', '6 · E', '5 · A', '4 · D', '3 · G', '2 · B', '1 · e'];

/** Steps per beat when beats land on grid steps, else 0 (e.g. a 6 grid in 4/4). */
function stepsPerBeat(steps: number, sig: Song['timeSig']): number {
  return steps % BEATS_PER_BAR[sig] === 0 ? steps / BEATS_PER_BAR[sig] : 0;
}

function beatLabel(i: number, steps: number, sig: Song['timeSig']): string {
  const sub = stepsPerBeat(steps, sig);
  if (!sub) return String(i + 1);
  if (i % sub === 0) return String(i / sub + 1);
  if (sub === 4) return ['', 'e', '&', 'a'][i % 4];
  if (sub === 2) return '&';
  return '·';
}

const GRID_CHOICES = [4, 6, 8, 12, 16, 24, 32];

export function PatternEditor({ song, saved, activeStep, setSong, onSave, onDelete }: Props) {
  const p = song.pattern;
  const steps = p.steps;
  const group = stepsPerBeat(steps, song.timeSig) || steps;
  const setGrid = (n: number) => {
    const grid = Math.min(MAX_GRID, Math.max(1, Math.round(n)));
    if (grid !== steps) setSong((s) => ({ ...s, pattern: { ...fitPattern(s.pattern, grid), id: 'custom' } }));
  };
  const setPattern = (fn: (p: Pattern) => Pattern) =>
    setSong((s) => ({ ...s, pattern: { ...fn(s.pattern), id: 'custom' } }));
  const all = [...PRESETS, ...saved];
  const pick = (id: string) => {
    const found = all.find((x) => x.id === id);
    // A preset brings its own grid with it.
    if (found) setSong((s) => ({ ...s, pattern: structuredClone(found) }));
  };
  const isSaved = saved.some((x) => x.id === p.id);

  return (
    <div className="pattern">
      <div className="pattern-bar">
        <div className="seg" role="tablist" aria-label="Pattern type">
          <button role="tab" aria-selected={p.mode === 'strum'} className={p.mode === 'strum' ? 'on' : ''}
            onClick={() => setPattern((x) => ({ ...x, mode: 'strum' }))}>Strum</button>
          <button role="tab" aria-selected={p.mode === 'pick'} className={p.mode === 'pick' ? 'on' : ''}
            onClick={() => setPattern((x) => ({ ...x, mode: 'pick' }))}>Fingerpick</button>
        </div>
        <select value={all.some((x) => x.id === p.id) ? p.id : ''} onChange={(e) => pick(e.target.value)} aria-label="Preset">
          <option value="" disabled>Custom pattern</option>
          <optgroup label="Strumming">
            {PRESETS.filter((x) => x.mode === 'strum').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </optgroup>
          <optgroup label="Fingerpicking">
            {PRESETS.filter((x) => x.mode === 'pick').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="My patterns">
              {saved.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </optgroup>
          )}
        </select>
        <div className="gridsize">
          <label htmlFor="grid">Grid</label>
          <button className="step" onClick={() => setGrid(steps - 1)} disabled={steps <= 1} aria-label="Fewer steps">−</button>
          <input id="grid" type="number" min={1} max={MAX_GRID} value={steps} title="Steps per bar"
            onChange={(e) => e.target.value && setGrid(Number(e.target.value))} />
          <button className="step" onClick={() => setGrid(steps + 1)} disabled={steps >= MAX_GRID} aria-label="More steps">+</button>
          <select value="" aria-label="Common grids" onChange={(e) => setGrid(Number(e.target.value))}>
            <option value="" disabled>steps per bar</option>
            {GRID_CHOICES.map((n) => <option key={n} value={n}>{n}{n === STEPS_PER_BAR[song.timeSig] ? ' (16th notes)' : ''}</option>)}
          </select>
        </div>
        <button className="ghost small" onClick={() => setSong((s) => ({ ...s, pattern: emptyPattern(steps, p.mode) }))}>Clear</button>
        <button className="ghost small" onClick={() => {
          const name = window.prompt('Name this pattern', p.id === 'custom' ? 'My pattern' : p.name);
          if (!name) return;
          const copy = { ...structuredClone(p), id: 'user-' + uid(), name };
          onSave(copy);
          setSong((s) => ({ ...s, pattern: copy }));
        }}>Save as…</button>
        {isSaved && <button className="ghost small" onClick={() => onDelete(p.id)}>Delete</button>}
      </div>

      <div className="grid-scroll">
        <div className="grid" style={{ ['--steps' as string]: steps }}>
          <div className="grid-row labels">
            <span className="row-label" />
            {Array.from({ length: steps }, (_, i) => (
              <span key={i} className={`beat ${i % group === 0 ? 'strong' : ''}`}>{beatLabel(i, steps, song.timeSig)}</span>
            ))}
          </div>

          {p.mode === 'strum' ? (
            <>
              <div className="grid-row">
                <span className="row-label">Strum</span>
                {p.strum.map((s, i) => (
                  <button key={i}
                    className={`cell strum k${s.kind === '-' ? 'R' : s.kind} ${i === activeStep ? 'now' : ''} ${i % group === 0 ? 'beatstart' : ''}`}
                    aria-label={`Step ${i + 1}: ${LABEL[s.kind]}`}
                    onClick={() => setPattern((x) => ({
                      ...x, strum: x.strum.map((y, j) => (j === i ? { ...y, kind: NEXT[y.kind] } : y)),
                    }))}>
                    {GLYPH[s.kind]}
                  </button>
                ))}
              </div>
              <div className="grid-row">
                <span className="row-label">Accent</span>
                {p.strum.map((s, i) => (
                  <button key={i} className={`cell accent ${s.accent ? 'on' : ''} ${i % group === 0 ? 'beatstart' : ''}`}
                    aria-label={`Step ${i + 1} accent`} aria-pressed={s.accent}
                    onClick={() => setPattern((x) => ({
                      ...x, strum: x.strum.map((y, j) => (j === i ? { ...y, accent: !y.accent } : y)),
                    }))}>
                    {s.accent ? '>' : ''}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              {p.pick.map((row, r) => (
                <div className="grid-row" key={r}>
                  <span className="row-label">{ROWS[r]}</span>
                  {row.map((on, i) => (
                    <button key={i}
                      className={`cell pick ${on ? 'on' : ''} ${r === 0 ? 'bass' : ''} ${i === activeStep ? 'now' : ''} ${i % group === 0 ? 'beatstart' : ''}`}
                      aria-label={`${ROWS[r]} step ${i + 1}`} aria-pressed={on}
                      onClick={() => setPattern((x) => ({
                        ...x, pick: x.pick.map((rr, a) => (a === r ? rr.map((v, j) => (j === i ? !v : v)) : rr)),
                      }))} />
                  ))}
                </div>
              ))}
              <div className="grid-row">
                <span className="row-label">Accent</span>
                {p.accents.map((on, i) => (
                  <button key={i} className={`cell accent ${on ? 'on' : ''} ${i % group === 0 ? 'beatstart' : ''}`}
                    aria-label={`Step ${i + 1} accent`} aria-pressed={on}
                    onClick={() => setPattern((x) => ({ ...x, accents: x.accents.map((v, j) => (j === i ? !v : v)) }))}>
                    {on ? '>' : ''}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="hint">
        {p.mode === 'strum'
          ? `The bar is split into ${steps} equal steps; set Grid to any number. Click a step to cycle ↓ down, ↑ up, ✕ muted, empty. Accented steps use the harder-plucked recordings.`
          : `The bar is split into ${steps} equal steps; set Grid to any number. Each row is a string. “Bass” plays the lowest string of whichever chord is sounding, so one pattern fits every chord.`}
      </p>
    </div>
  );
}
