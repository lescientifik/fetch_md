#!/usr/bin/env bun
/**
 * Benchmark: compare HTML vs Markdown token counts and time per pipeline step.
 *
 * Usage:
 *   bun run bench test/fixtures/*.html         # run on local fixtures
 *   bun run bench --url https://example.com    # fetch + convert a real page
 *   bun run bench --url https://example.com --mode full
 *
 * The tokenizer is frozen (gpt-tokenizer, cl100k/o200k-compatible) — only
 * the *relative* reduction matters for this project.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { countTokens } from 'gpt-tokenizer';
import { fetchMd } from '../src/fetchMd.ts';
import { htmlToMarkdown } from '../src/processHtml.ts';
import { elapsed, now } from '../src/timing.ts';

interface Row {
  source: string;
  htmlTokens: number;
  mdTokens: number;
  reductionPct: number;
  fetchMs: number | '-';
  parseMs: number;
  extractMs: number;
  convertMs: number;
  totalMs: number;
}

function parseArgs(argv: string[]): { url?: string; mode: 'article' | 'full'; paths: string[] } {
  let url: string | undefined;
  let mode: 'article' | 'full' = 'article';
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--url') url = argv[++i];
    else if (a === '--mode') mode = (argv[++i] === 'full' ? 'full' : 'article');
    else paths.push(a);
  }
  return { url, mode, paths };
}

function fmt(n: number | '-'): string {
  if (n === '-') return '-';
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}

function printTable(rows: Row[]): void {
  const headers = [
    'source',
    'htmlTok',
    'mdTok',
    'reduction',
    'fetchMs',
    'parseMs',
    'extractMs',
    'convertMs',
    'totalMs',
  ];
  const data = rows.map((r) => [
    r.source,
    r.htmlTokens.toLocaleString(),
    r.mdTokens.toLocaleString(),
    `${r.reductionPct.toFixed(1)}%`,
    fmt(r.fetchMs),
    fmt(r.parseMs),
    fmt(r.extractMs),
    fmt(r.convertMs),
    fmt(r.totalMs),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padStart(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of data) console.log(line(row));
}

async function benchUrl(url: string, mode: 'article' | 'full'): Promise<Row> {
  // Capture the raw HTML once by wrapping fetch, so we only hit the network
  // once per URL.
  let rawHtml = '';
  const capturingFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const res = await globalThis.fetch(input as Parameters<typeof globalThis.fetch>[0], init);
    if (!res.ok) return res;
    rawHtml = await res.clone().text();
    return res;
  }) as typeof globalThis.fetch;
  const r = await fetchMd(url, { mode, fetch: capturingFetch });
  const htmlTokens = countTokens(rawHtml);
  const mdTokens = countTokens(r.markdown);
  const reductionPct = 100 * (1 - mdTokens / Math.max(1, htmlTokens));
  const u = new URL(url);
  return {
    source: u.hostname + u.pathname.slice(0, 24),
    htmlTokens,
    mdTokens,
    reductionPct,
    fetchMs: r.timings.fetchMs,
    parseMs: r.timings.parseMs,
    extractMs: r.timings.extractMs,
    convertMs: r.timings.convertMs,
    totalMs: r.timings.totalMs,
  };
}

function benchFixture(path: string, mode: 'article' | 'full'): Row {
  const html = readFileSync(resolve(path), 'utf8');
  const t0 = now();
  const r = htmlToMarkdown(html, `https://fixture.example/${basename(path)}`, { mode });
  const totalMs = elapsed(t0);
  const htmlTokens = countTokens(html);
  const mdTokens = countTokens(r.markdown);
  const reductionPct = 100 * (1 - mdTokens / Math.max(1, htmlTokens));
  return {
    source: basename(path),
    htmlTokens,
    mdTokens,
    reductionPct,
    fetchMs: '-',
    parseMs: r.timings.parseMs,
    extractMs: r.timings.extractMs,
    convertMs: r.timings.convertMs,
    totalMs,
  };
}

async function main() {
  const { url, mode, paths } = parseArgs(process.argv.slice(2));
  const rows: Row[] = [];

  if (url) rows.push(await benchUrl(url, mode));
  for (const p of paths) rows.push(benchFixture(p, mode));

  if (rows.length === 0) {
    console.error('Usage: bun run bench [--url <URL>] [--mode article|full] [fixtures...]');
    process.exit(2);
  }

  printTable(rows);

  const htmlTotal = rows.reduce((s, r) => s + r.htmlTokens, 0);
  const mdTotal = rows.reduce((s, r) => s + r.mdTokens, 0);
  const avgReduction = 100 * (1 - mdTotal / Math.max(1, htmlTotal));
  console.log('\nSummary:');
  console.log(`  Total HTML tokens : ${htmlTotal.toLocaleString()}`);
  console.log(`  Total MD tokens   : ${mdTotal.toLocaleString()}`);
  console.log(`  Overall reduction : ${avgReduction.toFixed(1)}%`);

  const withFetch = rows.filter((r) => r.fetchMs !== '-') as Array<Row & { fetchMs: number }>;
  if (withFetch.length > 0) {
    const totalFetch = withFetch.reduce((s, r) => s + r.fetchMs, 0);
    const totalTotal = withFetch.reduce((s, r) => s + r.totalMs, 0);
    const overhead = totalTotal - totalFetch;
    console.log(
      `  Conversion overhead vs fetch: +${overhead.toFixed(1)}ms across ${withFetch.length} URL(s) ` +
        `(total ${totalTotal.toFixed(1)}ms, fetch ${totalFetch.toFixed(1)}ms, ratio ${(totalTotal / totalFetch).toFixed(2)}x).`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
