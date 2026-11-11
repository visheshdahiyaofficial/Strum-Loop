import { useState } from 'react';
import { resolveVoicing, transposeName } from '../model/chords';
import type { Song, Voicing } from '../model/types';
import { ChordDiagram } from './ChordDiagram';

interface Props {
  song: Song;
  custom: Voicing[];
  activeSlot: number;
  setSong: (fn: (s: Song) => Song) => void;
  onPreview: (v: Voicing) => void;
  onAdd: () => void;
  onChange: (slotId: string) => void;
}

const WHOLE_BARS = [1, 2, 3, 4, 6, 8];

/** Chord lengths offered for a grid of n steps per bar: 1/n … (n-1)/n, then whole bars.
 *  A length left over from another grid that doesn't fit this one is kept as its own entry. */
export function barOptions(grid: number, current: number): { value: number; label: string }[] {
  const opts: { value: number; label: string }[] = [];
  for (let k = 1; k < grid; k++) opts.push({ value: k / grid, label: `${k}/${grid} bar` });
  for (const b of WHOLE_BARS) opts.push({ value: b, label: b === 1 ? '1 bar' : `${b} bars` });
  if (!opts.some((o) => Math.abs(o.value - current) < 1e-9)) {
    opts.push({ value: current, label: `${+current.toFixed(2)} bar${current === 1 ? '' : 's'}` });
    opts.sort((a, b) => a.value - b.value);
  }
  return opts;
}

export function Sequence({ song, custom, activeSlot, setSong, onPreview, onAdd, onChange }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) =>
    setSong((s) => {
      if (to < 0 || to >= s.slots.length || from === to) return s;
      const slots = [...s.slots];
      const [x] = slots.splice(from, 1);
      slots.splice(to, 0, x);
      return { ...s, slots };
    });

  return (
    <div className="sequence">
      {song.slots.map((slot, i) => {
        const v = resolveVoicing(slot.voicingId, custom);
        const sounding = v && song.capo ? transposeName(v.name, song.capo) : null;
        const options = barOptions(song.pattern.steps, slot.bars);
        const chosen = options.findIndex((o) => Math.abs(o.value - slot.bars) < 1e-9);
        return (
          <div key={slot.id} className={`slot ${i === activeSlot ? 'active' : ''} ${drag === i ? 'dragging' : ''}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}>
            <div className="slot-head">
              <span className="slot-num">{i + 1}</span>
              <button className="icon" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move earlier">‹</button>
              <button className="icon" onClick={() => move(i, i + 1)} disabled={i === song.slots.length - 1} aria-label="Move later">›</button>
              <button className="icon" aria-label="Remove chord"
                onClick={() => setSong((s) => ({ ...s, slots: s.slots.filter((x) => x.id !== slot.id) }))}>×</button>
            </div>
            {v ? (
              <button className="slot-body" onClick={() => onPreview(v)} title="Hear this chord">
                <span className="chord-name">{v.name}</span>
                <span className="sounding">{sounding && sounding !== v.name ? `sounds as ${sounding}` : ' '}</span>
                <ChordDiagram frets={v.frets} size={84} />
              </button>
            ) : (
              <div className="slot-body missing">Chord was deleted</div>
            )}
            <div className="slot-foot">
              <select value={chosen} aria-label="Length in bars"
                onChange={(e) => {
                  const bars = options[Number(e.target.value)].value;
                  setSong((s) => ({ ...s, slots: s.slots.map((x) => (x.id === slot.id ? { ...x, bars } : x)) }));
                }}>
                {options.map((o, k) => <option key={k} value={k}>{o.label}</option>)}
              </select>
              <button className="ghost small" onClick={() => onChange(slot.id)}>Change</button>
            </div>
          </div>
        );
      })}
      <button className="slot add" onClick={onAdd}>
        <span className="plus">+</span>
        Add chord
      </button>
    </div>
  );
}
