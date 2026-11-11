import { useState } from 'react';
import { resolveVoicing } from '../model/chords';
import type { ProjectItem } from '../model/project';
import { sectionToLoop, strummingToPattern, tabToBlocks } from '../model/songImport';
import type { Song } from '../model/types';
import { isComplete, strokeOf, type FoundSong, type TabData } from '../model/ug';

interface Props {
  onLoadLoop: (song: Song) => void;
  onAddBlocks: (items: ProjectItem[], title: string) => void;
}

type Status = 'idle' | 'searching' | 'loading' | 'found' | 'missing' | 'error';

const MISSING = 'We don’t have this song yet.';
const GLYPH = { D: '↓', U: '↑', X: '✕', '-': '·' } as const;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Lookup failed (${res.status}).`);
  return body as T;
}

/** Tries a song's chord sheets, most popular first, until one has chords, tempo and strumming. */
async function loadSong(song: FoundSong): Promise<TabData | null> {
  for (const v of song.versions) {
    const { tab } = await getJson<{ tab: TabData | null }>(`/api/songs/tab?url=${encodeURIComponent(v.url)}`);
    if (isComplete(tab) && tabToBlocks(tab).length) return tab;
  }
  return null;
}

export function SongSearch({ onLoadLoop, onAddBlocks }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [songs, setSongs] = useState<FoundSong[]>([]);
  const [picked, setPicked] = useState(-1);
  const [tab, setTab] = useState<TabData | null>(null);
  const [done, setDone] = useState('');
  const busy = status === 'searching' || status === 'loading';

  const open = async (list: FoundSong[], i: number) => {
    setPicked(i);
    setTab(null);
    setDone('');
    setStatus('loading');
    try {
      const t = await loadSong(list[i]);
      setTab(t);
      setStatus(t ? 'found' : 'missing');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setStatus('searching');
    setSongs([]);
    setTab(null);
    setPicked(-1);
    setDone('');
    try {
      const { songs: found } = await getJson<{ songs: FoundSong[] }>(`/api/songs/search?q=${encodeURIComponent(q)}`);
      setSongs(found);
      if (!found.length) setStatus('missing');
      else await open(found, 0);
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  };

  const blocks = tab ? tabToBlocks(tab) : [];
  const strummings = tab ? tab.strummings.filter((s) => s.bpm > 0 && s.codes.some((c) => strokeOf(c).kind !== '-')) : [];

  return (
    <div className="songsearch">
      <form className="search-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input type="search" value={query} placeholder="Song name, e.g. Wonderwall" aria-label="Song name"
          onChange={(e) => setQuery(e.target.value)} />
        <button className="primary" type="submit" disabled={busy || !query.trim()}>
          {status === 'searching' ? 'Searching…' : 'Find song'}
        </button>
      </form>

      {songs.length > 1 && (
        <div className="chips">
          {songs.map((s, i) => (
            <button key={s.versions[0].url} className={`chip ${i === picked ? 'on' : ''}`} disabled={busy} onClick={() => void open(songs, i)}>
              {s.title} <span className="by">– {s.artist}</span>
            </button>
          ))}
        </div>
      )}

      {status === 'loading' && <p className="hint" role="status">Getting chords, tempo and strumming…</p>}
      {status === 'missing' && <p className="missing-song" role="status">{MISSING}</p>}
      {status === 'error' && <p className="missing-song" role="alert">{error}</p>}

      {tab && status === 'found' && (
        <div className="found">
          <div className="found-head">
            <div>
              <div className="found-title">{tab.title} <span className="by">– {tab.artist}</span></div>
              <div className="meta">
                {strummings[0].bpm} BPM · {tab.capo ? `capo ${tab.capo}` : 'no capo'}{tab.key ? ` · key ${tab.key}` : ''} ·{' '}
                <a href={tab.url} target="_blank" rel="noreferrer">from Ultimate Guitar</a>
              </div>
            </div>
            <button className="primary" onClick={() => { onAddBlocks(blocks, tab.title); setDone(`Added ${blocks.length} blocks to the project timeline.`); }}>
              + Add whole song to project
            </button>
          </div>

          <div className="strums">
            {strummings.map((s, i) => {
              const { pattern, bars } = strummingToPattern(s);
              return (
                <div className="strum-line" key={i}>
                  <span className="row-label">{s.part || 'Strumming'}</span>
                  <span className="strum-glyphs" aria-label={`Strumming pattern for ${s.part || 'the song'}`}>
                    {pattern.strum.map((x, k) => (
                      <span key={k} className={`g k${x.kind === '-' ? 'R' : x.kind} ${x.accent ? 'acc' : ''}`}>{GLYPH[x.kind]}</span>
                    ))}
                  </span>
                  <span className="meta">{s.bpm} BPM{bars > 1 ? ` · the site’s pattern is ${bars} bars long; the first bar is used` : ''}</span>
                </div>
              );
            })}
          </div>

          <div className="sections">
            {tab.sections.map((sec, i) => {
              const loop = sectionToLoop(tab, sec);
              if (!loop) return null;
              const names = loop.song.slots.map((s) => resolveVoicing(s.voicingId, [])?.name ?? '?');
              return (
                <div className="section-row" key={i}>
                  <span className="sec-name">{sec.name}</span>
                  <span className="sec-chords">{names.join(' · ')}{loop.repeats > 1 ? `  ×${loop.repeats}` : ''}</span>
                  <button className="ghost small" onClick={() => { onLoadLoop(loop.song); setDone(`Loaded “${sec.name}” into the editor.`); }}>
                    Load into editor
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint">
            {done ? <strong>{done} </strong> : null}
            The site doesn’t say how long each chord lasts, so every chord starts at 1 bar; change that under Chord order.
          </p>
        </div>
      )}
    </div>
  );
}
