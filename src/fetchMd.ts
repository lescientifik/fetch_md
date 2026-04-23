import { htmlToMarkdown, type HtmlToMarkdownOptions } from './processHtml.ts';
import { elapsed, now } from './timing.ts';

/** User-Agent of a real recent Chrome desktop build — reduces blocking & degraded renders. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchMdOptions extends HtmlToMarkdownOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  userAgent?: string;
  /** Extra request headers (merged over defaults). */
  headers?: Record<string, string>;
}

export interface FetchMdResult {
  url: string;
  markdown: string;
  metadata: { title?: string; url: string };
  timings: {
    fetchMs: number;
    parseMs: number;
    extractMs: number;
    convertMs: number;
    totalMs: number;
  };
  stats: { htmlBytes: number; mdBytes: number };
}

export async function fetchMd(url: string, options: FetchMdOptions = {}): Promise<FetchMdResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const totalStart = now();
  const fetchStart = now();
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: options.signal,
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`fetchMd: HTTP ${response.status} ${response.statusText} for ${url}`);
  }
  const html = await response.text();
  const fetchMs = elapsed(fetchStart);

  const finalUrl = response.url || url;
  const { markdown, metadata, timings } = htmlToMarkdown(html, finalUrl, options);

  const totalMs = elapsed(totalStart);
  return {
    url: finalUrl,
    markdown,
    metadata,
    timings: { fetchMs, ...timings, totalMs },
    stats: { htmlBytes: byteLength(html), mdBytes: byteLength(markdown) },
  };
}

function byteLength(s: string): number {
  // Bun / Node provide Buffer; TextEncoder is cross-platform and cheap.
  return new TextEncoder().encode(s).length;
}
