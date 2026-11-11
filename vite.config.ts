import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { extractStore, isTabUrl, parseSearch, parseTab, searchUrl } from './src/model/ug.ts';

/** Song lookup. A browser page cannot read another site directly, so the local
 *  server fetches the Ultimate Guitar page and hands back only what the app
 *  needs: chord names, sections, tempo, capo and strumming (never lyrics).
 *    GET /api/songs/search?q=<song name>   → { songs }
 *    GET /api/songs/tab?url=<chord page>   → { tab }                         */
function songLookup(): Plugin {
  const cache = new Map<string, { at: number; html: string }>();
  const page = async (url: string): Promise<string> => {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.html;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; chord-practice-app)', Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`the site answered ${res.status}`);
    const html = await res.text();
    cache.set(url, { at: Date.now(), html });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return html;
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      const u = new URL(req.url ?? '/', 'http://localhost');
      if (u.pathname === '/search') {
        const q = (u.searchParams.get('q') ?? '').trim().slice(0, 120);
        if (!q) return send(400, { error: 'Type a song name first.' });
        return send(200, { songs: parseSearch(extractStore(await page(searchUrl(q)))) });
      }
      if (u.pathname === '/tab') {
        const url = u.searchParams.get('url') ?? '';
        if (!isTabUrl(url)) return send(400, { error: 'Not a chord page address.' });
        return send(200, { tab: parseTab(extractStore(await page(url)), url) });
      }
      send(404, { error: 'Unknown lookup.' });
    } catch (e) {
      send(502, { error: `Could not reach Ultimate Guitar (${(e as Error).message}).` });
    }
  };
  return {
    name: 'strumloop-song-lookup',
    configureServer(server) { server.middlewares.use('/api/songs', handle); },
    configurePreviewServer(server) { server.middlewares.use('/api/songs', handle); },
  };
}

export default defineConfig({
  plugins: [react(), songLookup()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
