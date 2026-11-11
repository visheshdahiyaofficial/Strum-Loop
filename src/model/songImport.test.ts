import { describe, expect, it } from 'vitest';
import { resolveVoicing } from './chords';
import { libraryIdFor, reduceCycle, sectionToLoop, strummingFor, strummingToPattern, tabToBlocks } from './songImport';
import { extractStore, isComplete, isTabUrl, parseSearch, parseSections, parseTab, strokeOf, type TabData } from './ug';

// A made-up page in the site's format (placeholder words stand in for lyric lines).
const content = [
  'intro text that is not a chord line',
  '',
  '[Intro]',
  '[ch]Em7[/ch]   [ch]G[/ch]   [ch]Dsus4[/ch]   [ch]A7sus4[/ch]',
  '[ch]Em7[/ch]   [ch]G[/ch]   [ch]Dsus4[/ch]   [ch]A7sus4[/ch]',
  '',
  '[Verse 1]',
  '[tab][ch]Em7[/ch]       [ch]G[/ch]',
  'words words words[/tab]',
  '[tab]     [ch]Xyz9[/ch]        [ch]F#m[/ch]',
  'words words[/tab]',
  '',
  '[Chorus]',
  'words only, no chords here',
].join('\r\n');

const pageData = {
  tab: { song_name: 'Test Song', artist_name: 'Nobody', tonality_name: 'Em' },
  tab_view: {
    wiki_tab: { content },
    meta: { capo: 2, tonality: 'F#m' },
    strummings: [
      { part: 'Verse', denuminator: 16, bpm: 88, is_triplet: 0, measures: [1, 202, 1, 202, 3, 202, 202, 101, 1, 101, 1, 202, 3, 202, 202, 101, 1, 101, 1, 202, 3, 202, 1, 101, 202, 103, 202, 101, 1, 101, 1, 101].map((measure) => ({ measure })) },
      { part: 'Whole Song', denuminator: 8, bpm: 120, is_triplet: 0, measures: [1, 202, 1, 101, 2, 101, 1, 101].map((measure) => ({ measure })) },
    ],
    applicature: {
      Em7: [{ frets: [3, 3, 0, 2, 2, 0] }, { frets: [0, 3, 0, 2, 2, 0] }],
      Dsus4: [{ frets: [3, 3, 2, 0, -1, -1] }],
    },
  },
};
const url = 'https://tabs.ultimate-guitar.com/tab/nobody/test-song-chords-1';
const html = (data: unknown) =>
  `<div class="js-store" data-content="${JSON.stringify({ store: { page: { data } } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`;

describe('reading the site', () => {
  it('pulls the embedded data out of a page', () => {
    expect(extractStore(html({ a: 'x & "y"' }))).toEqual({ a: 'x & "y"' });
    expect(extractStore('<html>no data</html>')).toBeNull();
  });

  it('only accepts chord-page addresses on the tabs host', () => {
    expect(isTabUrl(url)).toBe(true);
    expect(isTabUrl('https://www.ultimate-guitar.com/pro/?tab_id=1')).toBe(false);
    expect(isTabUrl('https://tabs.ultimate-guitar.com.evil.test/tab/x')).toBe(false);
    expect(isTabUrl('http://tabs.ultimate-guitar.com/tab/x')).toBe(false);
    expect(isTabUrl('file:///etc/passwd')).toBe(false);
  });

  it('groups search results by song and ranks versions by votes', () => {
    const r = (song_id: number, song_name: string, votes: number, extra = {}) => ({
      type: 'Chords', tab_access_type: 'public', song_id, song_name, artist_name: 'A', votes, rating: 4.5,
      tab_url: `https://tabs.ultimate-guitar.com/tab/a/${song_name}-chords-${votes}`, ...extra,
    });
    const songs = parseSearch({
      results: [
        r(1, 'small', 5), r(2, 'big', 100), r(2, 'big', 900), r(2, 'big', 50, { type: 'Tab' }),
        r(3, 'pro', 9999, { tab_url: 'https://www.ultimate-guitar.com/pro/?tab_id=3' }), { marketing_type: 'official' },
      ],
    });
    expect(songs.map((s) => s.title)).toEqual(['big', 'small']);
    expect(songs[0].versions.map((v) => v.votes)).toEqual([900, 100]);
    expect(parseSearch(null)).toEqual([]);
  });

  it('keeps chord names per section and drops everything else', () => {
    const s = parseSections(content);
    expect(s.map((x) => x.name)).toEqual(['Intro', 'Verse 1']);
    expect(s[0].chords).toEqual(['Em7', 'G', 'Dsus4', 'A7sus4', 'Em7', 'G', 'Dsus4', 'A7sus4']);
    expect(s[1].chords).toEqual(['Em7', 'G', 'Xyz9', 'F#m']);
    expect(JSON.stringify(s)).not.toMatch(/words/);
  });

  it('decodes stroke codes', () => {
    expect([1, 3, 2, 101, 103, 102, 202, 201, 0].map((c) => strokeOf(c).kind + (strokeOf(c).accent ? '>' : '')).join(' '))
      .toBe('D D> X U U> X - - -');
  });

  it('parses a chord page and knows when a song is incomplete', () => {
    const tab = parseTab(extractStore(html(pageData)), url)!;
    expect(tab).toMatchObject({ title: 'Test Song', artist: 'Nobody', capo: 2, key: 'F#m', url });
    expect(tab.shapes.Em7).toEqual([0, 2, 2, 0, 3, 3]); // reversed to low E → high E
    expect(tab.shapes.Dsus4).toEqual([null, null, 0, 2, 3, 3]);
    expect(isComplete(tab)).toBe(true);
    expect(isComplete({ ...tab, strummings: [] })).toBe(false); // no strumming
    expect(isComplete({ ...tab, strummings: tab.strummings.map((s) => ({ ...s, bpm: 0 })) })).toBe(false); // no tempo
    expect(isComplete({ ...tab, sections: [] })).toBe(false); // no chords
    expect(isComplete(null)).toBe(false);
    expect(parseTab({}, url)).toBeNull();
  });
});

describe('turning a found song into loops', () => {
  const tab = parseTab(pageData, url) as TabData;

  it('maps chord-sheet names to library chords', () => {
    const name = (n: string) => { const id = libraryIdFor(n); return id && `${resolveVoicing(id, [])!.name}`; };
    expect(name('G')).toBe('G');
    expect(name('F#m')).toBe('F#m');
    expect(name('Gbm')).toBe('F#m');
    expect(name('A#')).toBe('Bb');
    expect(name('Dbmaj7')).toBe('C#maj7');
    expect(name('Asus')).toBe('Asus4');
    expect(name('C/E')).toBe('C/E');
    expect(name('Am/C')).toBe('Am/C');
    expect(name('Emin7')).toBe('Em7');
    expect(name('Xyz9')).toBeNull();
    expect(name('Gweird')).toBe('G'); // unknown extension: plain chord on the same root
    expect(name('Amweird')).toBe('Am');
  });

  it('finds the repeating unit of a section', () => {
    expect(reduceCycle(['Em', 'G', 'Em', 'G', 'Em', 'G'])).toEqual({ cycle: ['Em', 'G'], repeats: 3 });
    expect(reduceCycle(['Em', 'G', 'D'])).toEqual({ cycle: ['Em', 'G', 'D'], repeats: 1 });
    expect(reduceCycle(['A', 'A', 'A', 'A'])).toEqual({ cycle: ['A'], repeats: 4 });
  });

  it('converts strumming to a one-bar pattern', () => {
    const verse = strummingToPattern(tab.strummings[0]);
    expect(verse.timeSig).toBe('4/4');
    expect(verse.bars).toBe(2);
    expect(verse.pattern.steps).toBe(16);
    expect(verse.pattern.strum.map((s) => s.kind).join('')).toBe('D-D-D--UDUD-D--U');
    expect(verse.pattern.strum[4].accent).toBe(true);
    const whole = strummingToPattern(tab.strummings[1]);
    expect(whole.pattern.steps).toBe(8);
    expect(whole.pattern.strum.map((s) => s.kind).join('')).toBe('D-DUXUDU');
    const waltz = strummingToPattern({ part: '', bpm: 100, denominator: 8, triplet: false, codes: [1, 202, 1, 101, 1, 101] });
    expect([waltz.timeSig, waltz.pattern.steps]).toEqual(['3/4', 6]);
    const shuffle = strummingToPattern({ part: '', bpm: 100, denominator: 8, triplet: true, codes: Array(12).fill(1) });
    expect(shuffle.pattern.steps).toBe(12);
  });

  it('picks the strumming meant for each section', () => {
    expect(strummingFor('Verse 1', tab)!.part).toBe('Verse');
    expect(strummingFor('Chorus', tab)!.part).toBe('Whole Song');
    expect(strummingFor('Solo', { ...tab, strummings: [tab.strummings[0]] })!.part).toBe('Verse');
  });

  it('builds a loop per section with the site fingerings, tempo and capo', () => {
    const intro = sectionToLoop(tab, tab.sections[0])!;
    expect(intro.repeats).toBe(2);
    expect(intro.song).toMatchObject({ name: 'Test Song – Intro', bpm: 120, capo: 2, timeSig: '4/4' });
    const v = intro.song.slots.map((s) => resolveVoicing(s.voicingId, [])!);
    expect(v.map((x) => x.name)).toEqual(['Em7', 'G', 'Dsus4', 'A7sus4']);
    expect(v[0].frets).toEqual([0, 2, 2, 0, 3, 3]); // the site's own shape
    expect(intro.song.slots[1].voicingId).toBe('lib:G:major:0'); // no shape given: library chord
    const verse = sectionToLoop(tab, tab.sections[1])!;
    expect(verse.song.bpm).toBe(88);
    expect(verse.song.slots.map((s) => resolveVoicing(s.voicingId, [])!.name)).toEqual(['Em7', 'G', 'F#m']); // unknown chord skipped
    const blocks = tabToBlocks(tab);
    expect(blocks.map((b) => [b.song.name, b.repeats])).toEqual([['Test Song – Intro', 2], ['Test Song – Verse 1', 1]]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2);
  });

  it('rejects malformed self-describing chord ids', () => {
    expect(resolveVoicing('shape:Em7:0,2,2,0,3,3', [])!.frets).toEqual([0, 2, 2, 0, 3, 3]);
    expect(resolveVoicing('shape:D:x,x,0,2,3,2', [])!.frets).toEqual([null, null, 0, 2, 3, 2]);
    expect(resolveVoicing('shape:Bad:1,2,3', [])).toBeUndefined();
    expect(resolveVoicing('shape:Bad:1,2,3,4,5,99', [])).toBeUndefined();
  });
});
