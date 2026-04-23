import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { htmlToMarkdown } from '../src/processHtml.ts';
import { buildFrontmatter } from '../src/frontmatter.ts';

const article = readFileSync(new URL('./fixtures/article.html', import.meta.url), 'utf8');
const tricky = readFileSync(new URL('./fixtures/tricky.html', import.meta.url), 'utf8');
const listing = readFileSync(new URL('./fixtures/full-page.html', import.meta.url), 'utf8');

const BASE = 'https://src.example/post/';

describe('htmlToMarkdown — article fixture', () => {
  const { markdown, metadata } = htmlToMarkdown(article, BASE);

  test('extracts the title', () => {
    expect(metadata.title).toBe('The State of Markdown — 2026');
    expect(metadata.url).toBe(BASE);
  });

  test('emits YAML frontmatter with title + url only', () => {
    expect(markdown.startsWith('---\n')).toBe(true);
    const fm = markdown.split('---\n')[1]!;
    expect(fm).toContain('title: "The State of Markdown — 2026"');
    expect(fm).toContain(`url: "${BASE}"`);
    // No extra fields (no author, description, published).
    expect(fm).not.toContain('author:');
    expect(fm).not.toContain('description:');
    expect(fm).not.toContain('published:');
  });

  test('renders the GFM pipe table', () => {
    expect(markdown).toContain('| Feature | CommonMark | GFM |');
    // Separator row with dashes.
    expect(markdown).toMatch(/\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|/);
    expect(markdown).toContain('| Tables | no | yes |');
  });

  test('resolves relative image URLs to absolute', () => {
    expect(markdown).toContain('![Diagram](https://src.example/images/diagram.png)');
  });

  test('keeps absolute image URLs untouched', () => {
    expect(markdown).toContain('![Hero](https://cdn.example.com/hero.jpg)');
  });

  test('resolves relative anchor URLs', () => {
    expect(markdown).toContain('[our guide](https://src.example/docs/guide)');
  });

  test('preserves external links (modulo WHATWG URL normalization)', () => {
    // WHATWG URL appends '/' to root paths, so https://commonmark.org → https://commonmark.org/
    expect(markdown).toMatch(/\[CommonMark\]\(https:\/\/commonmark\.org\/?\)/);
    expect(markdown).toContain('[GFM](https://github.github.com/gfm/)');
    expect(markdown).toContain('[other-domain.net](https://other-domain.net/resource?x=1)');
  });

  test('emits fenced code block with language', () => {
    expect(markdown).toContain('```ts');
    expect(markdown).toContain('export function greet(name: string)');
    expect(markdown).toContain('```');
  });

  test('renders nested ul/ol correctly (indented)', () => {
    expect(markdown).toContain('Fruit');
    expect(markdown).toContain('Apple');
    expect(markdown).toContain('Banana');
    expect(markdown).toContain('Vegetables');
    // ordered list items inside ul — expect "1." and "2."
    expect(markdown).toMatch(/1\.\s+Carrot/);
    expect(markdown).toMatch(/2\.\s+Daikon/);
  });

  test('renders blockquote with > prefix on each paragraph', () => {
    expect(markdown).toMatch(/>\s+First paragraph inside a blockquote\./);
    expect(markdown).toMatch(/>\s+Second paragraph inside the same blockquote\./);
  });

  test('renders strikethrough as GFM ~~text~~', () => {
    expect(markdown).toContain('~~gone~~');
    expect(markdown).toContain('~~this one too~~');
  });

  test('drops script, style, noscript, and HTML comments', () => {
    expect(markdown).not.toContain('window.analytics');
    expect(markdown).not.toContain('color: red');
    expect(markdown).not.toContain('console.log');
    expect(markdown.toLowerCase()).not.toContain('<script');
    expect(markdown).not.toMatch(/<!--/);
  });

  test('strips site chrome (nav, footer) in article mode', () => {
    // "home | about" was the nav, shouldn't survive.
    expect(markdown).not.toMatch(/home\s*\|\s*about/);
    // Footer-only privacy link shouldn't appear.
    expect(markdown).not.toContain('[privacy](https://example.com/privacy)');
  });

  test('preserves every external host referenced in article body paragraphs', () => {
    // Extract body paragraphs of the <article>, excluding <p class="byline"> (bylines are
    // treated as metadata by Defuddle and removed from the content).
    const articleBody = article.slice(article.indexOf('<article'), article.indexOf('</article>'));
    const bodyWithoutByline = articleBody.replace(/<p\s+class="byline"[\s\S]*?<\/p>/g, '');
    const hosts = new Set<string>();
    for (const m of bodyWithoutByline.matchAll(/https?:\/\/[^"'\s<>]+/g)) {
      try {
        hosts.add(new URL(m[0]).origin);
      } catch {}
    }
    for (const origin of hosts) {
      expect(markdown.includes(origin)).toBe(true);
    }
  });

  test('timings are all non-negative numbers', () => {
    const { timings } = htmlToMarkdown(article, BASE);
    expect(timings.parseMs).toBeGreaterThanOrEqual(0);
    expect(timings.extractMs).toBeGreaterThanOrEqual(0);
    expect(timings.convertMs).toBeGreaterThanOrEqual(0);
  });
});

describe('htmlToMarkdown — tricky fixture', () => {
  const { markdown } = htmlToMarkdown(tricky, 'https://t.example/');

  test('handles inline code and emphasis', () => {
    expect(markdown).toContain('`const x = 1;`');
    expect(markdown).toMatch(/\*\*bold\*\*/);
    expect(markdown).toMatch(/\*italic\*/);
  });

  test('keeps mailto: links', () => {
    expect(markdown).toContain('[contact](mailto:hi@example.org)');
  });

  test('keeps bare fragment anchors as-is', () => {
    expect(markdown).toContain('[jump](#section)');
  });

  test('preserves fragment on external URLs', () => {
    expect(markdown).toContain('[ext frag](https://ext.example/path#frag)');
  });

  test('resolves srcset-fallback src', () => {
    expect(markdown).toContain('(https://t.example/fallback.png)');
  });

  test('renders table even with colspan (some formatting OK)', () => {
    expect(markdown).toContain('merged');
    // At least A/B/C appear
    expect(markdown).toContain('A');
    expect(markdown).toContain('B');
    expect(markdown).toContain('C');
  });
});

describe('htmlToMarkdown — mode: full', () => {
  test('keeps all content when article extraction is off', () => {
    const { markdown } = htmlToMarkdown(listing, 'https://store.example/', { mode: 'full' });
    expect(markdown).toContain('[Widget 1](https://store.example/widget/1)');
    expect(markdown).toContain('[Widget 2](https://store.example/widget/2)');
    expect(markdown).toContain('[Partner widget](https://partner.example/widget/3)');
    // Ad link should still be there in full mode.
    expect(markdown).toContain('[Ad banner](https://ads.example/campaign)');
  });
});

describe('htmlToMarkdown — frontmatter', () => {
  test('escapes double quotes in title', () => {
    const html = '<html><head><title>She said "hi"</title></head><body><article><h1>Title</h1><p>x</p></article></body></html>';
    const { markdown } = htmlToMarkdown(html, 'https://a.example/');
    expect(markdown).toContain('title: "She said \\"hi\\""');
  });

  test('can be disabled via includeFrontmatter:false', () => {
    const { markdown } = htmlToMarkdown(
      '<html><head><title>T</title></head><body><article><h1>T</h1><p>hi</p></article></body></html>',
      'https://a.example/',
      { includeFrontmatter: false },
    );
    expect(markdown.startsWith('---')).toBe(false);
  });
});

describe('buildFrontmatter', () => {
  test('always includes url; omits empty title', () => {
    const s = buildFrontmatter({ url: 'https://x/' });
    expect(s).toContain('url: "https://x/"');
    expect(s).not.toContain('title:');
  });
});
