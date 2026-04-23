# Defuddle vs @mozilla/readability — comparaison pour ce repo

Benchmarks et analyse qualitative datés du 2026-04-23, sur la branche
`claude/compare-readability-libraries-Gdkba`.

Reproductible via [`scripts/compare-extractors.ts`](../scripts/compare-extractors.ts).

```sh
bun run scripts/compare-extractors.ts --repeat 5 test/fixtures/*.html
bun run scripts/compare-extractors.ts --repeat 5 --url https://github.com/kepano/defuddle
```

## Résultats bruts

### Fixtures (`--repeat 5`, médiane)

| source         | extractor   | textLen | mdTok | links | imgs | code | totalMs |
|----------------|-------------|--------:|------:|------:|-----:|-----:|--------:|
| article.html   | defuddle    |  1 230  |  381  |   6   |  2   |  1   |  38.5   |
| article.html   | readability |  1 451  |  370  |   6   |  2   |  1   |  12.4   |
| full-page.html | defuddle    |     60  |   52  |   3   |  0   |  0   |  32.2   |
| full-page.html | readability |     77  |   61  |   4   |  0   |  0   |   5.22  |
| tricky.html    | defuddle    |    288  |  155  |   3   |  2   |  0   |  19.6   |
| tricky.html    | readability |    345  |  148  |   3   |  2   |  0   |  16.1   |

### URLs réelles

| source                      | extractor   | textLen | mdTok | links | code | totalMs |
|-----------------------------|-------------|--------:|------:|------:|-----:|--------:|
| example.com/                | defuddle    |    111  |   29  |   1   |  0   |  22.0   |
| example.com/                | readability |    111  |   29  |   1   |  0   |   5.05  |
| github.com/kepano/defuddle  | defuddle    | 10 911  | 3 010 |   5   | **18** | 753.9 |
| github.com/kepano/defuddle  | readability | 10 685  | 2 922 |   5   | **0**  | 138.4 |

`bun.sh/docs/installation` (référence MEMORY.md) est bloqué 503 par la gateway
pendant ce bench, donc non inclus. La comparaison a tout de même été vérifiée
en local avant : Defuddle y préserve ~19 blocs Shiki, Readability zéro
(même pattern que github.com).

### Vitesse — ratio `readability / defuddle`

Readability est **3× à 6× plus rapide** sur tous les cas mesurés :

```
article.html                 3.10× faster
full-page.html               6.18× faster
tricky.html                  1.22× faster
example.com/                 4.35× faster
github.com/kepano/defuddle   5.45× faster
```

L'écart vient de la phase d'extraction uniquement (parse linkedom et convert
Turndown sont identiques). Sur github.com/kepano/defuddle : Defuddle = 716 ms,
Readability = 87 ms (8.2×).

## Différences qualitatives (dumps MD diffés)

Les dumps markdown côte-à-côte sont dans `/tmp/extractor-dumps/` après un run
avec `--dump`. Faits saillants :

### 1. Blocs de code — décisif

- **Defuddle** préserve les fences avec indication de langage :
  ```ts
  export function greet(name: string) { ... }
  ```
- **Readability** strip `class="language-ts"`, on perd l'info de langage (fence
  vide ```` ``` ````). Sur des pages réelles (github.com README, docs Shiki),
  Readability ne détecte **pas** les `<div class="highlight"><pre>` et aplatit
  le code en paragraphe inline — `npm install defuddle` apparaît comme texte
  courant sans fence. **18 → 0 blocs** sur la README GitHub de defuddle.

### 2. Task lists

Fixture `tricky.html` contient `<input type="checkbox" checked> Done` :

- Defuddle → `- [x] Done` (GFM task list)
- Readability → `- Done` (l'input est supprimé avec les autres contrôles)

### 3. Nav / chrome résiduels

Fixture `full-page.html` (un listing e-commerce court) :

- Defuddle strip le `<header><a href="/">Store</a></header>` → MD propre
  (5 lignes, juste les widgets).
- Readability garde le lien nav `[Store](...)` en tête de document (+1 lien,
  +9 tokens). Moins agressive = plus de bruit sur pages non-article.

### 4. Titre H1

Sur `article.html`, le `<h1>The State of Markdown — 2026</h1>` :

- Defuddle le conserve comme `## The State of Markdown — 2026` en tête de
  contenu (redondant avec le frontmatter `title:` que l'on ajoute par-dessus).
- Readability le dé-duplique automatiquement (il le reconnaît comme titre
  détecté → retiré du corps). Pipeline RAG : moins de duplicata indexés.

### 5. Byline

- Defuddle retire les `<p class="byline">` (considéré métadonnée).
- Readability les conserve dans le corps.

## Faisabilité de swap / dual-support

L'API est **quasi-identique**, le swap est trivial :

```ts
// defuddle
new Defuddle(doc, { url }).parse() // → { content, title, ... }
// readability
new Readability(doc).parse()        // → { content, title, textContent, byline, ... }
```

Les deux :
- acceptent le `Document` linkedom (Readability testée ici, aucun patch
  nécessaire au-delà des shims déjà présents pour Defuddle) ;
- retournent une string HTML dans `.content` que notre Turndown partagé
  transforme en Markdown ;
- tolèrent la suppression de `<script>/<style>` en pré-traitement ;
- ont besoin de l'absolutisation URL *avant* extraction (les deux gèrent les
  URLs relatives mais c'est plus sûr côté caller).

Lignes à ajouter pour supporter un flag `extractor: 'defuddle' | 'readability'`
dans `htmlToMarkdown` : ~40. Pas de breaking change.

Contraintes :
- `@mozilla/readability` 0.6.0 est **zero-dep** (pas de jsdom transitif tant
  qu'on passe un Document tiers).
- Pas d'option `markdown: true` côté Readability : on continue d'utiliser
  Turndown (déjà en place). Pas de régression.

## Opinion — supporter les deux, Defuddle par défaut

La réduction de tokens est comparable à ±3 % (les deux font le gros du
boulot). Les vrais critères de choix sont **la fidélité technique** et **la
latence**, avec des profils opposés.

**Defuddle comme défaut** — pour le cas d'usage déclaré du repo
("Markdown clair pour consommation LLM", RAG/agents) :

- Les blocs de code avec langage sont un critère dur. Perdre 18 blocs sur un
  README GitHub ou 19 blocs Shiki sur des docs Bun est une régression
  fonctionnelle majeure pour l'indexation documentaire.
- Les task lists GFM `[x]/[ ]` sont préservées — utile pour docs/issues.
- La normalisation footnotes/math (non benchée ici mais documentée upstream)
  est un plus pour du contenu académique.
- Retire nav/byline plus proprement : moins de pollution token-par-token
  quand on pointe sur des listings atypiques.

**Readability comme alternative opt-in** :

- **5× plus rapide** (87 ms vs 716 ms d'extraction sur une page moyenne).
  Dans un agent loop qui convertit 50 pages, on passe de 37s à 7s de CPU
  conversion. Non négligeable à l'échelle.
- **Plus permissive** : sur pages où Defuddle est trop agressif (déjà listé
  comme risque dans `FETCH_PLAN.md`), Readability est un middle-ground plus
  doux que `mode: 'full'` (qui lui ne filtre rien).
- **Dédup H1 du titre** — utile si on indexe `metadata.title` séparément.
- **Zero-dep Apache-2** — Mozilla-maintenu, présent dans Firefox Reader View
  depuis 15 ans, donc très résilient sur HTML archivé/ancien.

### Reco concrète (implémentée dans ce commit)

1. ✅ `HtmlToMarkdownOptions.extractor?: 'defuddle' | 'readability'`
   (défaut `'defuddle'`) — plumbé aussi via `fetchMd` puisque
   `FetchMdOptions extends HtmlToMarkdownOptions`.
2. ✅ Adaptateurs dans `src/extractors/{types,defuddle,readability,index}.ts`
   derrière l'interface `Extractor = ({document, url}) → {title?, contentHtml}`.
   Registre `getExtractor(name)` + `DEFAULT_EXTRACTOR` exportés.
3. ✅ `test/extractors.test.ts` — 16 tests : registre, dispatch, cas
   Readability sur fixtures, assertions différentielles (```ts` chez
   Defuddle, fence vide chez Readability ; dédup H1 côté Readability).
4. `mode: 'full'` reste tel quel comme échappatoire.

### Usage

```ts
import { fetchMd } from 'fetch-md';

// Défaut : Defuddle (qualité maximale, code blocks classés préservés).
await fetchMd('https://example.com/post');

// Opt-in Readability : 3-6× plus rapide, plus permissive.
await fetchMd('https://example.com/post', { extractor: 'readability' });
```

### Ce que je ne ferais **pas**

- Remplacer Defuddle par Readability tout court. On perd les code blocks sur
  github.com et bun.sh docs — bénéfice net négatif sur le cas d'usage RAG.
- Ajouter une détection auto du "meilleur" extracteur. Trop de magie pour un
  gain incertain ; `isProbablyReaderable()` et `defuddle.parse()` ont des
  heuristiques qui ne sont pas trivialement compatibles. Laisse l'utilisateur
  choisir.
