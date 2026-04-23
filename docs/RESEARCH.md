# RESEARCH — HTML → Markdown pour consommation LLM

Synthèse des recherches web du 2026-04-23. Conservée pour éviter de refaire les mêmes recherches.

## Enjeu

Un LLM consommant du HTML brut gaspille 70–95 % de ses tokens dans du bruit (balises, styles inline, nav, pub, scripts, SVG). Convertir en Markdown clair réduit drastiquement la facture et améliore la précision retrieval/answer sur pipelines RAG.

## Chiffres clés (benchmarks lus)

- 80–94 % de réduction de tokens après extraction article + conversion Markdown sur articles/blogs/docs typiques.
- 20–40 % de réduction avec simple nettoyage (pas d'extraction d'article) — gain bien plus faible car nav/footer/scripts restent.
- Cas Cloudflare : 16 180 → 3 150 tokens (-80 %).
- Pages e-commerce complexes : jusqu'à -95 %.
- Markdown vs HTML : +35 % precision retrieval, +28 % answer accuracy (études RAG citées).

## Libs évaluées

### Extraction de contenu

| Lib | Langue | Notes | Choisi ? |
|---|---|---|---|
| **Defuddle** (kepano/Obsidian) | TS pur | "Readability 2.0 pour Markdown". Zero-deps core. Accepte tout DOM (JSDOM/linkedom/happy-dom). Supporte `markdown: true` (Turndown interne) et `separateMarkdown: true`. Standardise math/code/footnotes. Registre d'extracteurs pour sites connus. | **OUI** |
| Mozilla Readability | JS | Standard historique (Firefox Reader View). Moins bon sur math/code modernes, sortie HTML parfois désordonnée pour MD. | non |
| `@mozilla/readability` + post-processing | JS | Plus de travail que Defuddle pour un résultat équivalent. | non |

### Parse HTML / DOM

| Lib | Vitesse | Notes | Choisi ? |
|---|---|---|---|
| **linkedom** | Très rapide | Linked-list DOM, serialisation rapide, ~250 KB. SSR-oriented. Pas d'event propagation mais pas besoin ici. | **OUI** (requis par defuddle/node) |
| parse5 | Rapide, spec-compliant | Plus bas niveau. Cheerio l'utilise sous le capot. | non |
| jsdom | Lent, compat max | Jest default. Overkill. | non |
| happy-dom | Rapide | Vitest default. Très orienté tests DOM. | non |
| cheerio | Rapide | jQuery-like. Pas nécessaire ici car Defuddle fait le gros du travail. | non |

### HTML → Markdown

| Lib | Notes | Choisi ? |
|---|---|---|
| **Turndown** (via Defuddle) | Standard de facto. v7.2.4 (avril 2026). GFM plugin pour tables/strike. | **OUI** (encapsulé dans Defuddle) |
| node-html-markdown | 1.57× plus rapide que Turndown (sans jsdom). | non (complexifierait sans besoin démontré) |
| showdown | Bidirectionnel, moins orienté notre usage. | non |

### Fetch HTTP

| Lib | Notes | Choisi ? |
|---|---|---|
| **Bun `fetch` natif** | Rapide, natif Bun, mêmes perf que undici.request en pratique. | **OUI** |
| undici | 3-5× plus rapide que `http` core Node. Pertinent en Node, pas nécessaire en Bun. | non |

### Tokenizer (benchmark uniquement)

| Lib | Notes | Choisi ? |
|---|---|---|
| **gpt-tokenizer** | Pur JS, pas de WASM. | **OUI** |
| js-tiktoken | Alternative. Comparable. | non |

Seule la **réduction relative** nous intéresse — on gèle un tokenizer et on s'y tient.

## Architecture retenue

1. `Bun.fetch(url)` avec UA Chrome desktop récent.
2. `parseHTML(html)` de linkedom → `Document`.
3. Résolution URLs relatives → absolues sur `<a>` et `<img>` (via `new URL(href, baseUrl)`).
4. `new Defuddle(doc, url, { markdown: true })` → article + metadata + markdown.
5. Préfixer frontmatter YAML (title + url) si demandé.

## Sources principales

- [Defuddle](https://github.com/kepano/defuddle) — kepano/Obsidian Web Clipper.
- [Turndown](https://github.com/mixmark-io/turndown).
- [LinkedOM](https://webreflection.medium.com/linkedom-a-jsdom-alternative-53dd8f699311).
- [SearchCans — HTML vs MD LLM Context](https://www.searchcans.com/blog/html-vs-markdown-llm-context-window-optimization/).
- [Firecrawl — scrape to markdown](https://www.firecrawl.dev/blog/scrape-a-website-to-markdown).
- [Undici benchmark](https://github.com/nodejs/undici/issues/1203).
- [Web2MD token reduction guide](https://web2md.org/blog/reduce-llm-token-usage-practical-guide).
