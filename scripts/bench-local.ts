#!/usr/bin/env bun
/**
 * End-to-end benchmark using a local Bun.serve instance that serves each fixture.
 * Measures fetch vs total time to validate "~parity with raw fetch" goal.
 *
 * Usage: bun run scripts/bench-local.ts [fixtures...]
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { countTokens } from 'gpt-tokenizer';
import { fetchMd } from '../src/fetchMd.ts';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: bun run scripts/bench-local.ts <fixture.html> [...]');
  process.exit(2);
}

interface Row {
  file: string;
  rawFetchMs: number;
  totalMs: number;
  fetchMs: number;
  parseMs: number;
  extractMs: number;
  convertMs: number;
  overheadMs: number;
  overheadRatio: number;
  htmlTokens: number;
  mdTokens: number;
  reductionPct: number;
}

const N = 10; // warm-up 2 + 8 measured per fixture
const rows: Row[] = [];

for (const p of paths) {
  const html = readFileSync(resolve(p), 'utf8');
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  });
  const url = `http://localhost:${server.port}/`;

  // Warmup
  for (let i = 0; i < 2; i++) {
    await fetchMd(url);
    await (await fetch(url)).text();
  }

  const fetchMds: number[] = [];
  const totals: number[] = [];
  const fetches: number[] = [];
  const parses: number[] = [];
  const extracts: number[] = [];
  const converts: number[] = [];
  const rawFetches: number[] = [];

  for (let i = 0; i < N - 2; i++) {
    const t0 = performance.now();
    const r = await fetchMd(url);
    totals.push(performance.now() - t0);
    fetches.push(r.timings.fetchMs);
    parses.push(r.timings.parseMs);
    extracts.push(r.timings.extractMs);
    converts.push(r.timings.convertMs);
    fetchMds.push(r.timings.totalMs);

    const t1 = performance.now();
    const raw = await (await fetch(url)).text();
    rawFetches.push(performance.now() - t1);
    void raw;
  }

  server.stop(true);

  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const totalMs = median(totals);
  const rawFetchMs = median(rawFetches);
  const fetchMs = median(fetches);
  const parseMs = median(parses);
  const extractMs = median(extracts);
  const convertMs = median(converts);

  const { htmlToMarkdown } = await import('../src/processHtml.ts');
  const out = htmlToMarkdown(html, `http://fixture/${basename(p)}`);
  const htmlTokens = countTokens(html);
  const mdTokens = countTokens(out.markdown);

  rows.push({
    file: basename(p),
    rawFetchMs,
    totalMs,
    fetchMs,
    parseMs,
    extractMs,
    convertMs,
    overheadMs: totalMs - rawFetchMs,
    overheadRatio: totalMs / rawFetchMs,
    htmlTokens,
    mdTokens,
    reductionPct: 100 * (1 - mdTokens / Math.max(1, htmlTokens)),
  });
}

const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(1));

const headers = [
  'file',
  'rawFetch',
  'fetchMd',
  'overhead',
  'ratio',
  'parse',
  'extract',
  'convert',
  'reduction',
];
const data = rows.map((r) => [
  r.file,
  fmt(r.rawFetchMs),
  fmt(r.totalMs),
  `+${fmt(r.overheadMs)}`,
  `${r.overheadRatio.toFixed(2)}x`,
  fmt(r.parseMs),
  fmt(r.extractMs),
  fmt(r.convertMs),
  `${r.reductionPct.toFixed(1)}%`,
]);
const widths = headers.map((h, i) =>
  Math.max(h.length, ...data.map((row) => row[i]!.length)),
);
const line = (cells: string[]) =>
  cells.map((c, i) => c.padStart(widths[i]!)).join('  ');
console.log(line(headers));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const row of data) console.log(line(row));

console.log('\nNote: median of 8 measured runs (after 2 warmups) per fixture.');
console.log(`Ratio < 2.0x means fetchMd finishes in < 2× the time of a bare fetch.`);
