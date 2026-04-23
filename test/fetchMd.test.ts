import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fetchMd } from '../src/fetchMd.ts';

const article = readFileSync(new URL('./fixtures/article.html', import.meta.url), 'utf8');

describe('fetchMd', () => {
  test('fetches, converts, and reports timings (Bun.serve)', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const receivedUa = req.headers.get('user-agent') ?? '';
        return new Response(article, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'x-echo-ua': receivedUa,
          },
        });
      },
    });
    try {
      const url = `http://localhost:${server.port}/post`;
      const result = await fetchMd(url);
      expect(result.url).toBe(url);
      expect(result.markdown).toContain('The State of Markdown');
      expect(result.markdown).toContain('[CommonMark](https://commonmark.org/)');
      // Defuddle ≥ 0.12 may strip the "— YYYY" suffix from titles during normalization.
      expect(result.metadata.title).toMatch(/^The State of Markdown(?: — 2026)?$/);
      expect(result.timings.fetchMs).toBeGreaterThan(0);
      expect(result.timings.totalMs).toBeGreaterThanOrEqual(
        result.timings.fetchMs + result.timings.parseMs,
      );
      expect(result.stats.htmlBytes).toBeGreaterThan(result.stats.mdBytes);
    } finally {
      server.stop(true);
    }
  });

  test('sends a real-browser User-Agent by default', async () => {
    let seenUa = '';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seenUa = req.headers.get('user-agent') ?? '';
        return new Response('<html><head><title>T</title></head><body><article><h1>T</h1><p>x</p></article></body></html>', {
          headers: { 'content-type': 'text/html' },
        });
      },
    });
    try {
      await fetchMd(`http://localhost:${server.port}/`);
      expect(seenUa).toContain('Mozilla/5.0');
      expect(seenUa).toContain('Chrome');
      expect(seenUa).not.toContain('fetch-md');
    } finally {
      server.stop(true);
    }
  });

  test('respects a custom userAgent option', async () => {
    let seenUa = '';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seenUa = req.headers.get('user-agent') ?? '';
        return new Response('<html><body><article><h1>h</h1><p>x</p></article></body></html>', {
          headers: { 'content-type': 'text/html' },
        });
      },
    });
    try {
      await fetchMd(`http://localhost:${server.port}/`, { userAgent: 'MyBot/1.0' });
      expect(seenUa).toBe('MyBot/1.0');
    } finally {
      server.stop(true);
    }
  });

  test('throws on non-2xx responses', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('nope', { status: 404 }),
    });
    try {
      const url = `http://localhost:${server.port}/`;
      await expect(fetchMd(url)).rejects.toThrow(/HTTP 404/);
    } finally {
      server.stop(true);
    }
  });
});
