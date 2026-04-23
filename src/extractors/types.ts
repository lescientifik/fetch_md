/** Supported article extractors. Add a new name → register in `./index.ts`. */
export type ExtractorName = 'defuddle' | 'readability';

export interface ExtractorInput {
  /**
   * Live Document (linkedom or any compatible implementation). Noise removal
   * (`<script>`, `<style>`, …) and URL absolutization are expected to have run
   * on it *before* the extractor sees it — adapters stay focused on extraction.
   */
  document: Document;
  /** Absolute base URL of the page. Used for metadata + URL resolution. */
  url: string;
}

export interface ExtractorOutput {
  /** Detected article title (trimmed), if any. */
  title?: string;
  /**
   * Extracted article HTML. The caller converts it to Markdown via Turndown;
   * adapters MUST NOT emit Markdown directly.
   */
  contentHtml: string;
}

export type Extractor = (input: ExtractorInput) => ExtractorOutput;
