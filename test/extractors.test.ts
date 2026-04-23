import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { htmlToMarkdown } from '../src/processHtml.ts';
import {
  DEFAULT_EXTRACTOR,
  extractDefuddle,
  extractReadability,
  getExtractor,
} from '../src/extractors/index.ts';

const article = readFileSync(new URL('./fixtures/article.html', import.meta.url), 'utf8');
const tricky = readFileSync(new URL('./fixtures/tricky.html', import.meta.url), 'utf8');

const BASE = 'https://src.example/post/';

describe('extractor registry', () => {
  test('default is defuddle', () => {
    expect(DEFAULT_EXTRACTOR).toBe('defuddle');
  });

  test('getExtractor returns the right adapter', () => {
    expect(getExtractor('defuddle')).toBe(extractDefuddle);
    expect(getExtractor('readability')).toBe(extractReadability);
  });

  test('omitting the option matches extractor: defuddle', () => {
    const a = htmlToMarkdown(article, BASE).markdown;
    const b = htmlToMarkdown(article, BASE, { extractor: 'defuddle' }).markdown;
    expect(a).toBe(b);
  });
});

describe('htmlToMarkdown — extractor: readability', () => {
  const { markdown, metadata } = htmlToMarkdown(article, BASE, { extractor: 'readability' });

  test('produces non-empty markdown and a title', () => {
    expect(markdown.length).toBeGreaterThan(200);
    // Readability preserves the full "— 2026" suffix (Defuddle strips it).
    expect(metadata.title).toMatch(/State of Markdown/);
  });

  test('preserves the GFM pipe table', () => {
    expect(markdown).toContain('| Feature | CommonMark | GFM |');
    expect(markdown).toContain('| Tables | no | yes |');
  });

  test('preserves external anchors (modulo WHATWG URL normalization)', () => {
    expect(markdown).toMatch(/\[CommonMark\]\(https:\/\/commonmark\.org\/?\)/);
    expect(markdown).toContain('[GFM](https://github.github.com/gfm/)');
  });

  test('resolves relative URLs to absolute just like defuddle does', () => {
    expect(markdown).toContain('![Diagram](https://src.example/images/diagram.png)');
    expect(markdown).toContain('[our guide](https://src.example/docs/guide)');
  });

  test('emits a fenced code block (language hint stripped)', () => {
    expect(markdown).toContain('```');
    expect(markdown).toContain('export function greet(name: string)');
  });

  test('dedupes the H1 — article title does not repeat as a heading in the body', () => {
    const body = markdown.slice(markdown.indexOf('---\n', 4) + 4);
    expect(body).not.toMatch(/^##?\s+The State of Markdown/m);
  });

  test('shared cleanup still drops scripts and styles', () => {
    expect(markdown).not.toContain('window.analytics');
    expect(markdown).not.toContain('color: red');
    expect(markdown.toLowerCase()).not.toContain('<script');
  });

  test('emits frontmatter with title + url', () => {
    expect(markdown.startsWith('---\n')).toBe(true);
    expect(markdown).toContain(`url: "${BASE}"`);
  });
});

describe('htmlToMarkdown — tricky fixture via readability', () => {
  const { markdown } = htmlToMarkdown(tricky, 'https://t.example/', { extractor: 'readability' });

  test('preserves inline code and emphasis', () => {
    expect(markdown).toContain('`const x = 1;`');
    expect(markdown).toMatch(/\*\*bold\*\*/);
  });

  test('keeps mailto and fragment links', () => {
    expect(markdown).toContain('[contact](mailto:hi@example.org)');
    expect(markdown).toContain('[jump](#section)');
    expect(markdown).toContain('[ext frag](https://ext.example/path#frag)');
  });

  test('keeps tables with colspan', () => {
    expect(markdown).toContain('merged');
    expect(markdown).toContain('A');
    expect(markdown).toContain('B');
    expect(markdown).toContain('C');
  });
});

describe('extractor differences — defuddle vs readability', () => {
  const d = htmlToMarkdown(article, BASE, { extractor: 'defuddle' }).markdown;
  const r = htmlToMarkdown(article, BASE, { extractor: 'readability' }).markdown;

  test('defuddle preserves language hint, readability strips it', () => {
    // Both must fence the code block, but only defuddle carries the "ts" hint
    // (readability removes the `class="language-ts"` during its cleanup pass).
    expect(d).toContain('```ts');
    expect(d).toMatch(/```ts\nexport function greet/);
    expect(r).not.toContain('```ts');
    expect(r).toContain('```');
    expect(r).toContain('export function greet(name: string)');
  });

  test('both still preserve the same set of external origins', () => {
    for (const origin of ['https://commonmark.org', 'https://github.github.com',
                          'https://cdn.example.com', 'https://other-domain.net']) {
      expect(d.includes(origin)).toBe(true);
      expect(r.includes(origin)).toBe(true);
    }
  });
});
