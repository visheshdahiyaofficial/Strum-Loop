import type { Frets } from '../model/types';

/** Standard chord box: strings left (low E) to right (high E), nut at the top. */
export function ChordDiagram({ frets, size = 96 }: { frets: Frets; size?: number }) {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const max = fretted.length ? Math.max(...fretted) : 0;
  const min = fretted.length ? Math.min(...fretted) : 1;
  const base = max <= 5 ? 1 : min;
  const rows = Math.max(5, max - base + 1);
  const W = 100, H = 124, left = 18, right = 86, top = 22, bottom = 112;
  const sx = (i: number) => left + (i * (right - left)) / 5;
  const fy = (r: number) => top + (r * (bottom - top)) / rows;
  return (
    <svg className="diagram" viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} role="img"
      aria-label={`Chord shape ${frets.map((f) => (f === null ? 'x' : f)).join(' ')}`}>
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line key={r} x1={left} x2={right} y1={fy(r)} y2={fy(r)} className={r === 0 && base === 1 ? 'nut' : 'fretline'} />
      ))}
      {frets.map((_, i) => (
        <line key={i} x1={sx(i)} x2={sx(i)} y1={top} y2={bottom} className="stringline" />
      ))}
      {base > 1 && <text x={right + 4} y={fy(0.5) + 3} className="basefret">{base}</text>}
      {frets.map((f, i) =>
        f === null ? (
          <text key={i} x={sx(i)} y={top - 7} textAnchor="middle" className="mark">×</text>
        ) : f === 0 ? (
          <circle key={i} cx={sx(i)} cy={top - 10} r={3.4} className="open" />
        ) : (
          <circle key={i} cx={sx(i)} cy={fy(f - base + 0.5)} r={5.6} className="dot" />
        ),
      )}
    </svg>
  );
}
