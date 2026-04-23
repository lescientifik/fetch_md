#!/usr/bin/env bun
/**
 * Compare Defuddle vs @mozilla/readability on identical inputs.
 *
 * Measures, per source:
 *   - speed          : parse / extract / convert-to-md / total (ms)
 *   - text recovered : textContent length, MD byte length, MD tokens
 *   - links captured : count of external https?:// anchors in the MD
 *   - images         : count of <img> in the MD
 *   - code blocks    : count of ``` fences in the MD
 *
 * Usage:
 *   bun run scripts/compare-extractors.ts test/fixtures/*.html
 *   bun run scripts/compare-extractors.ts --url https://bun.sh/docs/installation
 *   bun run scripts/compare-extractors.ts --url <url> test/fixtures/article.html ...
 *   bun run scripts/compare-extractors.ts --repeat 5 test/fixtures/*.html
 *
 * The converter (Turndown + GFM + language-preserving fences) is identical for
 * both extractors, so timing and output differences reflect extraction choices.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
// @ts-expect-error -- turndown-plugin-gfm has no types
import { gfm } from 'turndown-plugin-gfm';
import { countTokens } from 'gpt-tokenizer';
import { elapsed, now } from '../src/timing.ts';
import { DEFAULT_USER_AGENT } from '../src/fetchMd.ts';
import { getExtractor, type ExtractorName } from '../src/extractors/index.ts';

// ------------------------------------------------------------------
// Shared Turndown (same rules as src/processHtml.ts so the MD is comparable).
// ------------------------------------------------------------------
const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  linkStyle: 'inlined',
});
turndown.use(gfm);
turndown.addRule('strikethroughGfm', {
  filter: (node) => node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
  replacement: (content) => `~~${content}~~`,
});
turndown.addRule('fencedCodeWithLang', {
  filter: (node) =>
    node.nodeName === 'PRE' && !!node.firstChild && (node.firstChild as HTMLElement).nodeName === 'CODE',
  replacement: (_content, node) => {
    const code = (node as HTMLElement).firstChild as HTMLElement;
    const className = code.getAttribute('class') ?? '';
    const match = className.match(/(?:^|\s)language-([A-Za-z0-9_+-]+)/);
    const lang = match?.[1] ?? '';
    const text = code.textContent ?? '';
    return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
  },
});

// ------------------------------------------------------------------
// DOM shims for linkedom so Defuddle's CSS paths become no-ops.
// Readability tolerates linkedom out of the box, but the shims are harmless.
// ------------------------------------------------------------------
const EMPTY_STYLE = new Proxy({} as CSSStyleDeclaration, { get: () => '' });

function shimDocument(doc: Document): void {
  const view = (doc as { defaultView?: Window | null }).defaultView;
  if (view && typeof (view as { getComputedStyle?: unknown }).getComputedStyle !== 'function') {
    (view as unknown as { getComputedStyle: (el: Element) => CSSStyleDeclaration }).getComputedStyle =
      () => EMPTY_STYLE;
  }
  if (!(doc as { styleSheets?: unknown }).styleSheets) {
    Object.defineProperty(doc, 'styleSheets', { value: [], configurable: true });
  }
}

// ------------------------------------------------------------------
// Noise removal + URL absolutization on the live DOM.
// Applied ONCE per (source, extractor) run — readability mutates the DOM
// so each extractor must see its own parsed copy.
// ------------------------------------------------------------------
const NOISE_TAGS = ['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas'];

function removeNoise(doc: Document): void {
  for (const tag of NOISE_TAGS) {
    const nodes = doc.querySelectorAll(tag);
    for (let i = nodes.length - 1; i >= 0; i--) nodes[i]!.remove();
  }
}

function absolutize(value: string | null, baseUrl: string): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t || t.startsWith('#') || t.startsWith('javascript:') || t.startsWith('mailto:') ||
      t.startsWith('tel:') || t.startsWith('data:')) return null;
  try { return new URL(t, baseUrl).toString(); } catch { return null; }
}

function resolveUrls(doc: Document, baseUrl: string): void {
  for (const el of Array.from(doc.querySelectorAll('a[href]'))) {
    const abs = absolutize(el.getAttribute('href'), baseUrl);
    if (abs) el.setAttribute('href', abs);
  }
  for (const el of Array.from(doc.querySelectorAll('img'))) {
    const src = el.getAttribute('src') ?? el.getAttribute('data-src');
    const abs = absolutize(src, baseUrl);
    if (abs) el.setAttribute('src', abs);
  }
}

// ------------------------------------------------------------------
// Single driver — delegates the extract step to the shared adapters in
// src/extractors/ so the bench tracks any future changes to them.
// ------------------------------------------------------------------
interface ExtractionResult {
  title: string | undefined;
  contentHtml: string;
  textLen: number;
  parseMs: number;
  extractMs: number;
  convertMs: number;
  totalMs: number;
  markdown: string;
}

function run(html: string, url: string, name: ExtractorName): ExtractionResult {
  const t0 = now();
  const { document } = parseHTML(html);
  shimDocument(document as unknown as Document);
  const parseMs = elapsed(t0);

  const t1 = now();
  removeNoise(document as unknown as Document);
  resolveUrls(document as unknown as Document, url);
  const { title: extractedTitle, contentHtml } =
    getExtractor(name)({ document: document as unknown as Document, url });
  const title = extractedTitle ??
    document.querySelector('title')?.textContent?.trim() ?? undefined;
  // textLen on a throwaway parse of the extracted HTML — cheap and fair to both.
  const { document: holder } = parseHTML(`<div>${contentHtml}</div>`);
  const textLen = (holder.querySelector('div')?.textContent ?? '').length;
  const extractMs = elapsed(t1);

  const t2 = now();
  const markdown = turndown.turndown(contentHtml).trim();
  const convertMs = elapsed(t2);

  return { title, contentHtml, textLen, parseMs, extractMs, convertMs,
           totalMs: parseMs + extractMs + convertMs, markdown };
}

// ------------------------------------------------------------------
// Output feature counters.
// ------------------------------------------------------------------
function countExternalLinks(md: string): number {
  // Match markdown [text](url) where url is https?://
  const re = /\]\((https?:\/\/[^\s)]+)\)/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) seen.add(m[1]!);
  return seen.size;
}

function countImages(md: string): number {
  return (md.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
}

function countCodeFences(md: string): number {
  return Math.floor((md.match(/^```/gm) ?? []).length / 2);
}

interface Row {
  source: string;
  extractor: ExtractorName;
  textLen: number;
  mdTokens: number;
  mdBytes: number;
  links: number;
  images: number;
  codeBlocks: number;
  parseMs: number;
  extractMs: number;
  convertMs: number;
  totalMs: number;
}

function measure(source: string, html: string, url: string, extractor: ExtractorName,
                 repeat: number): Row {
  const runs: ExtractionResult[] = [];
  for (let i = 0; i < repeat; i++) {
    runs.push(run(html, url, extractor));
  }
  // Take median-ish: pick the minimum totalMs (warmed caches, excludes GC hiccups).
  runs.sort((a, b) => a.totalMs - b.totalMs);
  const best = runs[Math.floor(runs.length / 2)]!;
  return {
    source,
    extractor,
    textLen: best.textLen,
    mdTokens: countTokens(best.markdown),
    mdBytes: new TextEncoder().encode(best.markdown).length,
    links: countExternalLinks(best.markdown),
    images: countImages(best.markdown),
    codeBlocks: countCodeFences(best.markdown),
    parseMs: best.parseMs,
    extractMs: best.extractMs,
    convertMs: best.convertMs,
    totalMs: best.totalMs,
  };
}

// ------------------------------------------------------------------
// Args + driver.
// ------------------------------------------------------------------
function parseArgs(argv: string[]): { urls: string[]; paths: string[]; repeat: number; dump?: string } {
  const urls: string[] = [];
  const paths: string[] = [];
  let repeat = 3;
  let dump: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--url') urls.push(argv[++i]!);
    else if (a === '--repeat') repeat = Math.max(1, parseInt(argv[++i]!, 10) || 1);
    else if (a === '--dump') dump = argv[++i];
    else paths.push(a);
  }
  return { urls, paths, repeat, dump };
}

function fmtMs(n: number): string {
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}

function printTable(rows: Row[]): void {
  const headers = ['source', 'extractor', 'textLen', 'mdTok', 'mdBytes', 'links', 'imgs',
                   'code', 'parseMs', 'extractMs', 'convertMs', 'totalMs'];
  const data = rows.map((r) => [
    r.source,
    r.extractor,
    r.textLen.toLocaleString(),
    r.mdTokens.toLocaleString(),
    r.mdBytes.toLocaleString(),
    String(r.links),
    String(r.images),
    String(r.codeBlocks),
    fmtMs(r.parseMs),
    fmtMs(r.extractMs),
    fmtMs(r.convertMs),
    fmtMs(r.totalMs),
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  let prev = '';
  for (const row of data) {
    if (prev && prev !== row[0]) console.log(line(widths.map(() => ' ')));
    console.log(line(row));
    prev = row[0]!;
  }
}

function printDeltas(rows: Row[]): void {
  const bySource = new Map<string, { defuddle?: Row; readability?: Row }>();
  for (const r of rows) {
    const e = bySource.get(r.source) ?? {};
    e[r.extractor] = r;
    bySource.set(r.source, e);
  }
  console.log('\nΔ readability − defuddle (positive = readability yields more):');
  const headers = ['source', 'Δ textLen', 'Δ mdTok', 'Δ links', 'Δ imgs', 'Δ code', 'Δ totalMs', 'speed'];
  const data: string[][] = [];
  for (const [src, pair] of bySource) {
    if (!pair.defuddle || !pair.readability) continue;
    const d = pair.defuddle, r = pair.readability;
    const ratio = r.totalMs / Math.max(0.001, d.totalMs);
    data.push([
      src,
      signed(r.textLen - d.textLen),
      signed(r.mdTokens - d.mdTokens),
      signed(r.links - d.links),
      signed(r.images - d.images),
      signed(r.codeBlocks - d.codeBlocks),
      (r.totalMs - d.totalMs >= 0 ? '+' : '') + fmtMs(r.totalMs - d.totalMs),
      ratio < 1 ? `${(1 / ratio).toFixed(2)}× faster` : `${ratio.toFixed(2)}× slower`,
    ]);
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i]!)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of data) console.log(line(row));
}

function signed(n: number): string {
  return (n >= 0 ? '+' : '') + n.toLocaleString();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await globalThis.fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': DEFAULT_USER_AGENT,
               accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
               'accept-language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return await res.text();
}

async function main(): Promise<void> {
  const { urls, paths, repeat, dump } = parseArgs(process.argv.slice(2));
  if (urls.length === 0 && paths.length === 0) {
    console.error('Usage: bun run scripts/compare-extractors.ts [--url URL]... [--repeat N] [--dump DIR] [fixtures...]');
    process.exit(2);
  }

  const sources: Array<{ name: string; html: string; url: string }> = [];
  for (const p of paths) {
    const html = readFileSync(resolve(p), 'utf8');
    sources.push({ name: basename(p), html, url: `https://fixture.example/${basename(p)}` });
  }
  for (const u of urls) {
    const html = await fetchHtml(u);
    const parsed = new URL(u);
    sources.push({ name: parsed.hostname + parsed.pathname.slice(0, 24), html, url: u });
  }

  // Warmup: one full run of each extractor on the first source (drops JIT cost).
  if (sources.length > 0) {
    run(sources[0]!.html, sources[0]!.url, 'defuddle');
    run(sources[0]!.html, sources[0]!.url, 'readability');
  }

  const rows: Row[] = [];
  for (const s of sources) {
    rows.push(measure(s.name, s.html, s.url, 'defuddle', repeat));
    rows.push(measure(s.name, s.html, s.url, 'readability', repeat));
    if (dump) {
      const safe = s.name.replace(/[^a-z0-9._-]/gi, '_');
      Bun.write(`${dump}/${safe}.defuddle.md`, run(s.html, s.url, 'defuddle').markdown);
      Bun.write(`${dump}/${safe}.readability.md`, run(s.html, s.url, 'readability').markdown);
    }
  }

  // Sort: group by source, defuddle first for readability.
  rows.sort((a, b) => a.source.localeCompare(b.source) ||
    (a.extractor === b.extractor ? 0 : a.extractor === 'defuddle' ? -1 : 1));

  printTable(rows);
  printDeltas(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
