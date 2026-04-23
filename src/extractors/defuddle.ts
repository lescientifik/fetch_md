import Defuddle from 'defuddle';
import type { Extractor } from './types.ts';

// Defuddle logs "Initial parse returned very little content" + a couple of
// getComputedStyle / styleSheets warnings on linkedom Documents (the CSS shims
// in processHtml.ts cover the hard errors). Silence the whole call.
const SILENT_METHODS = ['log', 'warn', 'error', 'info', 'debug'] as const;

function withSilencedConsole<T>(fn: () => T): T {
  const saved: Array<(...args: unknown[]) => void> = [];
  for (const m of SILENT_METHODS) {
    saved.push(console[m]);
    console[m] = () => {};
  }
  try {
    return fn();
  } finally {
    for (let i = 0; i < SILENT_METHODS.length; i++) {
      console[SILENT_METHODS[i]!] = saved[i]!;
    }
  }
}

export const extractDefuddle: Extractor = ({ document, url }) => {
  const result = withSilencedConsole(() => new Defuddle(document, { url }).parse());
  const title = result.title && result.title.trim() ? result.title.trim() : undefined;
  return { title, contentHtml: result.content || '' };
};
