# FETCH_PLAN — Plan d'implémentation

Voir aussi [`RESEARCH.md`](./RESEARCH.md) pour les choix de libs et les benchmarks.

## Objectif

`fetchMd(url)` TypeScript : télécharge HTML → retourne Markdown clair pour LLM. Fast, préserve tableaux / images / liens externes, testé sur fixtures locales.

## Stack

- **Runtime** : Bun (deps, TS natif, tests via `bun:test`).
- **Runtime deps** : `defuddle`, `linkedom`.
- **Dev deps** : `typescript`, `@types/bun`, `gpt-tokenizer` (benchmark uniquement).

## Arborescence

```
src/
  index.ts          # exports publics
  fetchMd.ts        # fonction principale (fetch + délégation)
  processHtml.ts    # fonction pure htmlToMarkdown
  frontmatter.ts    # sérialisation YAML minimale (title, url)
  timing.ts         # helper performance.now
scripts/
  benchmark.ts      # CLI : URL ou fixtures → tableau de timings + réduction tokens
test/
  processHtml.test.ts
  fixtures/*.html
docs/
  RESEARCH.md
  FETCH_PLAN.md
CLAUDE.md
MEMORY.md
package.json
tsconfig.json
```

## API

```ts
interface FetchMdOptions {
  includeFrontmatter?: boolean;    // default true
  mode?: 'article' | 'full';       // default 'article'
  fetch?: typeof globalThis.fetch; // injection tests
  signal?: AbortSignal;
  userAgent?: string;              // default = Chrome desktop récent
}

interface FetchMdResult {
  url: string;
  markdown: string;
  metadata: { title?: string; url: string };
  timings: { fetchMs: number; parseMs: number; extractMs: number; convertMs: number; totalMs: number };
  stats: { htmlBytes: number; mdBytes: number };
}

fetchMd(url, options?): Promise<FetchMdResult>
htmlToMarkdown(html, url, options?): { markdown, metadata, timings }
```

## Étapes

1. Bootstrap Bun + tsconfig.
2. Implémenter `processHtml.ts` (pur) : parse linkedom → resolve URLs → Defuddle markdown:true.
3. Implémenter `frontmatter.ts`.
4. Implémenter `fetchMd.ts` avec UA navigateur.
5. Tests `bun:test` sur fixtures : tables, images (rel/abs), liens (rel/ext), code blocks, listes, strike, blockquote, purge script/style, frontmatter, preservation liens externes (critère dur).
6. Benchmark `scripts/benchmark.ts` avec gpt-tokenizer (figé).
7. Itération perf si `totalMs > 2× fetchMs`.
8. Commit + push.

## Vérification

- `bun test` passe (≥ 12 tests).
- `bun run bench test/fixtures/*.html` — réduction moyenne > 70 %.
- `bun run bench --url <page réelle>` — `totalMs ≈ fetchMs`.
- `bunx tsc --noEmit` — pas d'erreur.
- Grep : tous les `https?://<host>` externes du HTML source présents dans le MD.

## Risques suivis

- Defuddle trop agressif sur SPA / listings → `mode: 'full'` disponible en fallback.
- Tokenizer dans chemin chaud → jamais importé depuis `src/`.
- Rendus dégradés si UA custom trop minimaliste → UA navigateur réel par défaut.
