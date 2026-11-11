/** Encodes float channels as an uncompressed 24-bit PCM WAV, the format every DAW imports. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const ch = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = 3;
  const dataSize = frames * ch * bytes;
  const out = new Uint8Array(44 + dataSize);
  const v = new DataView(out.buffer);
  const tag = (pos: number, s: string) => { for (let i = 0; i < s.length; i++) out[pos + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true); v.setUint16(34, 24, true);
  tag(36, 'data'); v.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      const n = Math.round(s * 8388607);
      out[p++] = n & 255; out[p++] = (n >> 8) & 255; out[p++] = (n >> 16) & 255;
    }
  }
  return out;
}
