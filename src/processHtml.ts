import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
// @ts-expect-error -- turndown-plugin-gfm has no types
import { gfm } from 'turndown-plugin-gfm';
import { buildFrontmatter } from './frontmatter.ts';
import { DEFAULT_EXTRACTOR, getExtractor, type ExtractorName } from './extractors/index.ts';
import { elapsed, now } from './timing.ts';

export type Mode = 'article' | 'full';

export interface HtmlToMarkdownOptions {
  mode?: Mode;
  includeFrontmatter?: boolean;
  /**
   * Which article extractor to use in `mode: 'article'`. Defaults to
   * `'defuddle'`. `'readability'` is ~5× faster but loses fenced code-block
   * language hints and most code-block boxes on sites like GitHub READMEs or
   * Shiki-rendered docs. See `docs/COMPARISON.md`.
   */
  extractor?: ExtractorName;
}

export interface HtmlToMarkdownTimings {
  parseMs: number;
  extractMs: number;
  convertMs: number;
}

export interface HtmlToMarkdownResult {
  markdown: string;
  metadata: { title?: string; url: string };
  timings: HtmlToMarkdownTimings;
}

// ------------------------------------------------------------------
// Turndown — configured once and reused across calls (~5ms saved per call).
// GFM plugin adds tables + strikethrough + task lists.
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
// Override strikethrough to use standard GFM double-tilde.
turndown.addRule('strikethroughGfm', {
  filter: (node) => node.nodeName === 'DEL' || node.nodeName === 'S' || node.nodeName === 'STRIKE',
  replacement: (content) => `~~${content}~~`,
});
// Preserve language hints on fenced code blocks (class="language-ts" → ```ts).
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
// Shim linkedom's document so Defuddle's CSS-related code becomes a no-op.
// ------------------------------------------------------------------
const EMPTY_STYLE = new Proxy({} as CSSStyleDeclaration, {
  get: () => '',
});

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
// Noise removal + URL absolutization. Both operate on the live DOM.
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
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('data:')
  ) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function resolveUrls(doc: Document, baseUrl: string): void {
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  for (const el of anchors) {
    const abs = absolutize(el.getAttribute('href'), baseUrl);
    if (abs) el.setAttribute('href', abs);
  }
  const imgs = Array.from(doc.querySelectorAll('img'));
  for (const el of imgs) {
    const src = el.getAttribute('src') ?? el.getAttribute('data-src');
    const abs = absolutize(src, baseUrl);
    if (abs) el.setAttribute('src', abs);
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const rewritten = srcset
        .split(',')
        .map((part: string) => {
          const t = part.trim();
          if (!t) return '';
          const [u, ...rest] = t.split(/\s+/);
          if (!u) return t;
          const abs2 = absolutize(u, baseUrl);
          return abs2 ? [abs2, ...rest].join(' ') : t;
        })
        .filter(Boolean)
        .join(', ');
      el.setAttribute('srcset', rewritten);
    }
  }
}

// ------------------------------------------------------------------
// Public API.
// ------------------------------------------------------------------
export function htmlToMarkdown(
  html: string,
  url: string,
  options: HtmlToMarkdownOptions = {},
): HtmlToMarkdownResult {
  const mode: Mode = options.mode ?? 'article';
  const includeFrontmatter = options.includeFrontmatter ?? true;

  // Parse
  const parseStart = now();
  const { document } = parseHTML(html);
  shimDocument(document as unknown as Document);
  const parseMs = elapsed(parseStart);

  // Extract
  const extractStart = now();
  removeNoise(document as unknown as Document);
  resolveUrls(document as unknown as Document, url);

  let contentHtml: string;
  let title: string | undefined = document.querySelector('title')?.textContent?.trim() || undefined;

  if (mode === 'article') {
    const extract = getExtractor(options.extractor ?? DEFAULT_EXTRACTOR);
    const result = extract({ document: document as unknown as Document, url });
    contentHtml = result.contentHtml;
    if (result.title) title = result.title;
    if (!contentHtml || contentHtml.trim().length === 0) {
      contentHtml = document.body?.innerHTML ?? '';
    }
  } else {
    contentHtml = document.body?.innerHTML ?? html;
  }
  const extractMs = elapsed(extractStart);

  // Convert
  const convertStart = now();
  const body = turndown.turndown(contentHtml).trim();
  const markdown = includeFrontmatter
    ? buildFrontmatter({ title, url }) + body + '\n'
    : body + '\n';
  const convertMs = elapsed(convertStart);

  return {
    markdown,
    metadata: { title, url },
    timings: { parseMs, extractMs, convertMs },
  };
}
