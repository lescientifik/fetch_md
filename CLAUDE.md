# CLAUDE.md — guide pour agents Claude sur ce dépôt

## Règles de maintenance de fichiers markdown

- **Si tu crées un fichier markdown, ajoute-le ici avec une ligne de description**, sinon tu ne le reliras jamais.
- **Maintiens `MEMORY.md` au fur et à mesure** — actions, découvertes, erreurs, leçons. Ultra-dense en information, avide en tokens. Ne batch pas : note dès qu'un fait mérite d'être retenu.

## Fichiers markdown du dépôt

- [`MEMORY.md`](./MEMORY.md) — journal dense : décisions, progression, pièges. À relire au début de chaque session avant tout travail.
- [`docs/RESEARCH.md`](./docs/RESEARCH.md) — synthèse recherche web sur HTML→MD pour LLM : libs évaluées (Defuddle, Turndown, Readability, linkedom, undici), benchmarks de réduction de tokens, justification des choix.
- [`docs/FETCH_PLAN.md`](./docs/FETCH_PLAN.md) — plan d'implémentation initial : API, étapes, fichiers, vérification.

## Architecture actuelle

- `src/fetchMd.ts` — fetch (Bun/globalThis fetch avec UA Chrome) puis délégation à `htmlToMarkdown`.
- `src/processHtml.ts` — fonction pure : `parseHTML` (linkedom) + shim CSS + `Defuddle` (extraction article) + `turndown` (conversion MD) + résolution URLs relatives→absolues + frontmatter.
- `src/frontmatter.ts` — YAML minimal (title + url).
- `src/timing.ts` — helpers `now()` / `elapsed()`.
- `scripts/benchmark.ts` — CLI tokens + timings.
- `scripts/bench-local.ts` — bench end-to-end via `Bun.serve`.
- `test/processHtml.test.ts` + `test/fetchMd.test.ts` — 29 tests sur fixtures locales.

## Projet — vue rapide

Objectif : `fetchMd(url)` en TypeScript — télécharge une page web et produit un Markdown clair pour consommation LLM. Extraction d'article (Defuddle) + conversion MD (Turndown via Defuddle). Frontmatter YAML minimal (title + url). Préservation stricte des liens externes, tableaux, images.

## Stack

- **Bun** (runtime, deps, tests). Pas de npm, pas de build step.
- **Dépendances runtime** : `defuddle`, `linkedom`.
- **Dépendances dev** : `typescript`, `@types/bun`, `gpt-tokenizer`.

## Commandes

```sh
bun install                                        # installer deps
bun test                                           # lancer les tests unitaires (29 tests)
bun run bench test/fixtures/*.html                 # benchmark tokens sur fixtures
bun run bench --url https://example.com            # benchmark tokens + timings sur URL réelle
bun run scripts/bench-local.ts test/fixtures/*.html # benchmark end-to-end avec Bun.serve local (overhead fetchMd vs fetch brut)
bunx tsc --noEmit                                  # vérification types
```

## Conventions

- ESM uniquement. Pas de CommonJS.
- `gpt-tokenizer` est importé **exclusivement** depuis `scripts/benchmark.ts` (évite le coût des tables dans le chemin chaud).
- Les tests tapent sur `htmlToMarkdown` (fonction pure, fixtures locales), pas sur `fetchMd` avec URLs réelles.
- URLs relatives → absolues **avant** conversion Markdown, via `new URL(href, baseUrl)`.
- User-Agent par défaut = Chrome desktop récent (pas un UA custom minimal, sinon rendus dégradés / blocages).

## Branche de travail

`claude/html-to-markdown-converter-GzMYe` — tous les commits et pushs vont sur cette branche.
