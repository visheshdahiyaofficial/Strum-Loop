export interface ManifestNote {
  layer: 'mf' | 'ff';
  string: number;
  fret: number;
  midi: number;
  file: string;
  dur: number;
  /** measured tuning error of the recording, in cents */
  cents: number;
}

export interface Manifest {
  source: string;
  layers: string[];
  openMidi: number[];
  maxFret: number[];
  notes: ManifestNote[];
}

export interface Sample {
  buffer: AudioBuffer;
  /** seconds into the buffer where the pluck starts (skips encoder padding) */
  offset: number;
  /** playback-rate factor that brings the recording to concert pitch */
  tune: number;
}

const key = (layer: string, string: number, fret: number) => `${layer}:${string}:${fret}`;

function attackOffset(buffer: AudioBuffer): number {
  const d = buffer.getChannelData(0);
  const n = Math.min(d.length, Math.round(buffer.sampleRate * 0.25));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  let i = 0;
  while (i < n && Math.abs(d[i]) < peak * 0.05) i++;
  return Math.max(0, i / buffer.sampleRate - 0.002);
}

export class SampleBank {
  manifest!: Manifest;
  private samples = new Map<string, Sample>();
  /** true once every recording is decoded and ready to play */
  loaded = false;

  get maxFret(): number[] {
    return this.manifest.maxFret;
  }

  async load(ctx: BaseAudioContext, onProgress: (done: number, total: number) => void): Promise<void> {
    const base = `${import.meta.env.BASE_URL}samples/`;
    const res = await fetch(base + 'manifest.json');
    if (!res.ok) throw new Error(`Could not load the sample manifest (${res.status}). Run "npm run samples" first.`);
    this.manifest = await res.json();
    const notes = this.manifest.notes;
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < notes.length) {
        const n = notes[next++];
        const r = await fetch(base + n.file);
        if (!r.ok) throw new Error(`Missing sample ${n.file} (${r.status})`);
        const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
        this.samples.set(key(n.layer, n.string, n.fret), {
          buffer,
          offset: attackOffset(buffer),
          tune: 2 ** (-n.cents / 1200),
        });
        onProgress(++done, notes.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    this.loaded = true;
  }

  get(layer: 'mf' | 'ff', string: number, fret: number): Sample | undefined {
    return this.samples.get(key(layer, string, fret)) ?? this.samples.get(key('mf', string, fret));
  }
}
