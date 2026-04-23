import type { Extractor, ExtractorName } from './types.ts';
import { extractDefuddle } from './defuddle.ts';
import { extractReadability } from './readability.ts';

export type { Extractor, ExtractorInput, ExtractorName, ExtractorOutput } from './types.ts';
export { extractDefuddle } from './defuddle.ts';
export { extractReadability } from './readability.ts';

const REGISTRY: Record<ExtractorName, Extractor> = {
  defuddle: extractDefuddle,
  readability: extractReadability,
};

export const DEFAULT_EXTRACTOR: ExtractorName = 'defuddle';

export function getExtractor(name: ExtractorName): Extractor {
  return REGISTRY[name];
}
