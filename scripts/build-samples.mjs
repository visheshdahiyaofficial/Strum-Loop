#!/usr/bin/env node
// Slices the University of Iowa MIS guitar recordings (one chromatic run per
// string per file) into one sample per string per fret, verifies each slice's
// pitch, and encodes them for the web app.
//
//   raw-samples/unzipped/**/Guitar.<dyn>.<string>.<range>.aif
//     -> public/samples/<layer>/s<6..1>_f<NN>.m4a + public/samples/manifest.json
//
// Needs macOS `afconvert`. No npm dependencies.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'raw-samples', 'unzipped');
const WORK = path.join(ROOT, 'raw-samples', 'work');
const OUT = path.join(ROOT, 'public', 'samples');
const LAYERS = (process.env.LAYERS ?? 'mf,ff').split(',');
const VERBOSE = !!process.env.VERBOSE;

const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // string index 0 = low E ... 5 = high E
const STRING_TAG = { sulE: 0, sulA: 1, sulD: 2, sulG: 3, sulB: 4, sul_E: 5 };
const MAX_LEN_S = 5;
// The recorded guitar sits up to ~40 cents flat; anything further from the
// expected note than this is treated as a different note.
const PITCH_TOLERANCE_CENTS = 58;

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(name) {
  const m = /^([A-G])(b|#)?(\d)$/.exec(name);
  if (!m) throw new Error(`bad note name ${name}`);
  return NOTE_PC[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + (Number(m[3]) + 1) * 12;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a WAV: ${file}`);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(pos + 10), sr: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') data = b.subarray(pos + 8, Math.min(b.length, pos + 8 + size));
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`unsupported WAV: ${file}`);
  const n = Math.floor(data.length / 2 / fmt.ch);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2);
    x[i] = s / fmt.ch / 32768;
  }
  return { x, sr: fmt.sr };
}

function writeWav(file, x, sr) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

// 4th-order Butterworth-ish high-pass: removes room rumble below the string's range.
function highPass(x, sr, fc) {
  const y = Float32Array.from(x);
  for (let pass = 0; pass < 2; pass++) {
    const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
    }
  }
  return y;
}

// Sample positions where the level jumps sharply: candidate pluck attacks.
function onsets(x, sr) {
  const hop = Math.round(sr * 0.01);
  const env = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += x[j] * x[j];
    env.push(Math.sqrt(s / hop));
  }
  const peak = env.reduce((a, b) => Math.max(a, b), 0);
  const out = [];
  let last = -100;
  for (let i = 0; i < env.length - 3; i++) {
    let prev = 0;
    for (let k = Math.max(0, i - 8); k <= i - 2; k++) prev = Math.max(prev, env[k]);
    const cur = Math.max(env[i], env[i + 1], env[i + 2]);
    if (cur > 2.5 * prev && cur > peak * 0.008 && i - last > 25) {
      out.push(i * hop);
      last = i;
    }
  }
  return out;
}

// Deviation in cents of the strongest periodicity near the expected pitch.
function pitchCents(x, sr, start, midi) {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const lagExp = sr / f0;
  const lo = Math.max(2, Math.floor(lagExp * 2 ** (-3 / 12)));
  const hi = Math.ceil(lagExp * 2 ** (3 / 12));
  const s = start + Math.round(sr * 0.06);
  const n = Math.min(8192, x.length - s - hi - 2);
  if (n < 1024) return { cents: NaN, r: 0 };
  const r = [];
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = s; i < s + n; i++) {
      const a = x[i], b = x[i + lag];
      ab += a * b; aa += a * a; bb += b * b;
    }
    r.push(ab / Math.sqrt(aa * bb + 1e-20));
  }
  let k = 1;
  for (let i = 1; i < r.length - 1; i++) if (r[i] > r[k]) k = i;
  if (k === 1 || k === r.length - 2) return { cents: NaN, r: r[k] }; // peak on the edge: not this note
  const d = r[k - 1] - 2 * r[k] + r[k + 1];
  const frac = d === 0 ? 0 : (0.5 * (r[k - 1] - r[k + 1])) / d;
  const lag = lo - 1 + k + frac;
  return { cents: 1200 * Math.log2(lagExp / lag), r: r[k] };
}

// Walks the candidate attacks in time order and assigns each expected note to
// the first later attack that actually sounds that pitch.
function assign(x, sr, lo, hi) {
  const cands = onsets(x, sr);
  const found = [];
  let ci = 0;
  for (let midi = lo; midi <= hi; midi++) {
    let hit = null;
    while (ci < cands.length && !hit) {
      const { cents, r } = pitchCents(x, sr, cands[ci], midi);
      if (Math.abs(cents) <= PITCH_TOLERANCE_CENTS && r >= 0.5) hit = { at: cands[ci], cents, r };
      ci++;
    }
    if (!hit) {
      throw new Error(`no attack found for midi ${midi} (found ${found.length} of ${hi - lo + 1}; ${cands.length} candidate attacks)`);
    }
    found.push({ midi, ...hit });
  }
  return found;
}

function main() {
  if (!fs.existsSync(RAW)) throw new Error(`missing ${RAW} — download and unzip the Iowa guitar set first`);
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  const re = /^Guitar\.(pp|mf|ff)\.(sul_?[EADGB])\.([A-G][b#]?\d)([A-G][b#]?\d)?(?:\.mono)?\.aiff?$/;
  const files = walk(RAW)
    .map((p) => ({ p, m: re.exec(path.basename(p)) }))
    .filter((f) => f.m && LAYERS.includes(f.m[1]));
  if (!files.length) throw new Error('no matching Guitar.*.aif files found');

  const slices = []; // { layer, string, fret, midi, x, sr, cents }
  const problems = [];
  for (const { p, m } of files) {
    const [, layer, tag, from, to] = m;
    const string = STRING_TAG[tag];
    const lo = noteToMidi(from), hi = noteToMidi(to ?? from);
    const wav = path.join(WORK, path.basename(p).replace(/\.aiff?$/, '.wav'));
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', p, wav]);
    const raw = readWav(wav);
    fs.rmSync(wav);
    const sr = raw.sr;
    const x = highPass(raw.x, sr, 440 * 2 ** ((OPEN_MIDI[string] - 69) / 12) * 0.8);
    let found;
    try {
      found = assign(x, sr, lo, hi);
    } catch (e) {
      problems.push(`${path.basename(p)}: ${e.message}`);
      continue;
    }
    found.forEach(({ midi, at, cents, r }, i) => {
      const fret = midi - OPEN_MIDI[string];
      // Precise attack: first sample over 5% of the note's early peak.
      const from0 = Math.max(0, at - Math.round(sr * 0.02));
      const look = Math.min(x.length, at + Math.round(sr * 0.2));
      let pk = 0;
      for (let j = from0; j < look; j++) pk = Math.max(pk, Math.abs(x[j]));
      let on = from0;
      while (on < look && Math.abs(x[on]) < pk * 0.05) on++;
      const start = Math.max(0, on - Math.round(sr * 0.002));
      const nextStart = i + 1 < found.length ? found[i + 1].at - Math.round(sr * 0.06) : x.length;
      const end = Math.min(start + MAX_LEN_S * sr, nextStart, x.length);
      const y = Float32Array.from(x.subarray(start, end));
      if (y.length < sr * 0.8) problems.push(`${path.basename(p)} midi ${midi}: only ${(y.length / sr).toFixed(2)}s long`);
      const fin = Math.round(sr * 0.001);
      const fout = Math.min(Math.round(sr * 0.25), Math.floor(y.length / 3));
      for (let j = 0; j < fin; j++) y[j] *= j / fin;
      for (let j = 0; j < fout; j++) y[y.length - 1 - j] *= j / fout;
      // Loudness of the first 400 ms, used to even out the player's uneven plucks.
      const nl = Math.min(y.length, Math.round(sr * 0.4));
      let e = 0;
      for (let j = 0; j < nl; j++) e += y[j] * y[j];
      const rms = Math.sqrt(e / nl);
      if (VERBOSE) console.log(`${layer} s${6 - string} f${fret} midi ${midi} at ${(at / sr).toFixed(1)}s len ${(y.length / sr).toFixed(2)}s cents ${cents.toFixed(0)} r ${r.toFixed(2)}`);
      slices.push({ layer, string, fret, midi, x: y, sr, cents, rms });
    });
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
    process.exit(1);
  }

  // Bring every note to the same loudness, then scale the whole set to peak at 0.9.
  let peak = 0;
  for (const s of slices) {
    const g = 0.1 / s.rms;
    for (let j = 0; j < s.x.length; j++) { s.x[j] *= g; peak = Math.max(peak, Math.abs(s.x[j])); }
  }
  const gain = 0.9 / peak;

  fs.rmSync(OUT, { recursive: true, force: true });
  const notes = [];
  for (const s of slices) {
    for (let j = 0; j < s.x.length; j++) s.x[j] *= gain;
    fs.mkdirSync(path.join(OUT, s.layer), { recursive: true });
    const name = `s${6 - s.string}_f${String(s.fret).padStart(2, '0')}`;
    const wav = path.join(WORK, `${s.layer}_${name}.wav`);
    const rel = `${s.layer}/${name}.m4a`;
    writeWav(wav, s.x, s.sr);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', wav, path.join(OUT, rel)]);
    fs.rmSync(wav);
    notes.push({
      layer: s.layer, string: s.string, fret: s.fret, midi: s.midi, file: rel,
      dur: +(s.x.length / s.sr).toFixed(3), cents: Math.round(s.cents),
    });
  }
  notes.sort((a, b) => a.layer.localeCompare(b.layer) || a.string - b.string || a.fret - b.fret);

  // Every string must have a gap-free run of frets starting at the open string.
  const maxFret = [];
  for (const layer of LAYERS) {
    for (let s = 0; s < 6; s++) {
      const frets = notes.filter((n) => n.layer === layer && n.string === s).map((n) => n.fret);
      frets.forEach((f, i) => { if (f !== i) throw new Error(`${layer} string ${s}: fret gap at ${i}`); });
      maxFret[s] = Math.min(maxFret[s] ?? Infinity, frets.length - 1);
    }
  }
  const manifest = {
    source: 'University of Iowa Electronic Music Studios — Musical Instrument Samples (Guitar, Raimundo 118)',
    layers: LAYERS, openMidi: OPEN_MIDI, maxFret, notes,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  fs.rmSync(WORK, { recursive: true, force: true });

  const bytes = walk(OUT).reduce((a, p) => a + fs.statSync(p).size, 0);
  const cents = slices.map((s) => s.cents).sort((a, b) => a - b);
  const short = slices.reduce((a, s) => Math.min(a, s.x.length / s.sr), Infinity);
  console.log(`wrote ${notes.length} samples (${(bytes / 1e6).toFixed(1)} MB)`);
  console.log(`max fret per string (low E → high E): ${maxFret.join(', ')}`);
  console.log(`tuning offset: min ${cents[0].toFixed(0)}, median ${cents[cents.length >> 1].toFixed(0)}, max ${cents.at(-1).toFixed(0)} cents; shortest sample ${short.toFixed(2)}s`);
}

main();
