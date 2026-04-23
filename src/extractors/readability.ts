import { Readability } from '@mozilla/readability';
import type { Extractor } from './types.ts';

// Readability mutates the DOM during parse (elements get removed/reparented).
// The htmlToMarkdown pipeline re-parses per call, so every invocation sees a
// fresh Document — safe to mutate.
export const extractReadability: Extractor = ({ document }) => {
  const art = new Readability(document).parse();
  const title = art?.title && art.title.trim() ? art.title.trim() : undefined;
  return { title, contentHtml: art?.content || '' };
};
