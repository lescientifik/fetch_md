# MEMORY.md — journal dense, au fil de l'eau

Format : bullet dense, orienté info. Pas de prose. Ajouter à la fin ou sous la bonne rubrique. Ne jamais supprimer les leçons, on peut consolider.

## Décisions architecture
- Stack : Bun (runtime + package manager + test runner). Pas npm.
- Extraction article via `defuddle/node` (kepano, TS pur, zero-deps core). Option `markdown: true` utilise Turndown interne.
- DOM : `linkedom` (5-10× plus rapide que jsdom, serialisation via linked list).
- HTTP : `globalThis.fetch` (Bun natif), User-Agent = Chrome desktop récent pour éviter blocages.
- Tokenizer : `gpt-tokenizer` figé — seule la réduction **relative** compte. Importé UNIQUEMENT dans `scripts/benchmark.ts`, jamais dans `src/` (éviter coût chargement tables).
- Frontmatter YAML minimal : `title` + `url` seulement.

## Progression
- Init : dépôt vide, branche `claude/html-to-markdown-converter-GzMYe` créée par harness.
- Stack finalisée : `defuddle` (core class, via main entry) + `linkedom` + `turndown` + `turndown-plugin-gfm`. **Pas** `defuddle/node` (charge jsdom → 500ms import).
- Tests unitaires : 25 tests sur `processHtml` + 4 sur `fetchMd` = **29/29 pass**.
- Benchmark fixtures : réduction 53-59% (fixtures déjà minimalistes — sur pages réelles gonflées de scripts/ads/nav, attendre 80-94%).
- Benchmark end-to-end local (Bun.serve loopback) : overhead conversion **~7-13 ms** sur articles (parse ~0.5ms, extract ~7-10ms, convert ~2-5ms). Négligeable face à tout fetch réseau réel (100-500ms).
- **Bench URL réelle** (`bun.sh/docs/installation`, 229 125 tokens HTML) en v0.18.1 : **99.0% de réduction** (→ 2 205 tokens MD). fetch ~470-520 ms, conversion ~880 ms. Ratio ~2.9×. **6 fenced code blocks préservés** dont `curl -fsSL https://bun.com/install | bash` (le bug v0.6 est mort).
- `bunx tsc --noEmit` : clean.
- Upgrade `defuddle` 0.6.6 → **0.18.1** (Apr 2026) : code blocks Shiki/Tailwind récupérés grâce à `nonContentPatterns = ['advert','ad-','ads',...]` et navigationIndicators en regex `\b\w\b`. Deux ajustements de fixtures rendus nécessaires par les nouvelles heuristiques :
  - **Titre** : Defuddle strip les suffixes `— YYYY` sur le titre (métadata cleanup). Test assoupli en regex `/^The State of Markdown(?: — 2026)?$/`.
  - **Listes orphelines** : heuristique `blog metadata list` (content-patterns.ts) supprime une `<ul>`/`<ol>` courte près des bords si : 2-8 items, aucun finit par `.!?`, total ≤ 30 mots, **et le previousElementSibling n'est NI un heading NI un paragraphe finissant par `:`**. Échappatoires : paragraphe intro finissant par `:`, ou items contenant de la ponctuation finale. J'ai adapté la fixture (intro « The breakdown is: », items avec phrases descriptives) — c'est plus représentatif d'un vrai article de toute façon.

## Accès réseau
- Wikipedia (`en.wikipedia.org`) bloqué par gateway (403 même avec UA Chrome via curl direct).
- OK : `example.com`, `bun.sh`, `github.com`, `raw.githubusercontent.com`.
- Certains sites (MDN, simonw, HN) ont renvoyé 503 intermittents — rate-limit gateway.

## Démo — `demo.md`
- Construit avec [simonw/showboat](https://github.com/simonw/showboat) (`uvx showboat`). Document markdown exécutable : chaque bloc bash est un snapshot reproducible.
- 9 exec blocs : layout, `bun test` (29 pass), bench fixtures, bench example.com, bench bun.sh/docs (99.1%), échantillon Markdown, test préservation anchors, grep footer, bench-local.
- `uvx showboat verify demo.md` re-run tous les blocs et diff : les blocs `bench` diffèrent toujours (timings non-déterministes), mais les comptes de tokens et le statut des tests restent stables.
- `uvx showboat extract demo.md` imprime la séquence de commandes pour recréer le doc de zéro.

## Leçons techniques apprises
- `defuddle/node` importe jsdom en top-level → **500ms** d'overhead d'import. Inacceptable.
- Solution : importer `Defuddle` (default export du bundle webpack) et appeler `new Defuddle(linkedomDoc, { url }).parse()` + Turndown manuel. Nécessite deux shims sur le Document linkedom :
  - `document.defaultView.getComputedStyle = () => EMPTY_STYLE_PROXY` (Proxy retourne "")
  - `document.styleSheets = []` (défini avec `Object.defineProperty`)
- Sans shim : Defuddle logue des erreurs `getComputedStyle is not a function` et `Array.from(null)` sur `styleSheets`. Ces erreurs sont catchées en interne mais bruitent stderr. Les shims rendent les code paths CSS no-op sans erreur.
- Pour silencer les logs résiduels de Defuddle (ex: "Initial parse returned very little content"), wrapper `withSilencedConsole(() => defuddle.parse())`.
- Defuddle **retire les paragraphes byline** (`<p class="byline">`) du contenu — considérés métadonnées. Les liens auteur disparaissent. Pour test "préservation hosts", exclure `<p class="byline">` du source.
- WHATWG URL normalise `https://host.tld` → `https://host.tld/` (ajoute le slash final). Tests doivent tolérer via regex.
- `turndown-plugin-gfm` par défaut émet `~text~` (single tilde) pour strikethrough. Non-GFM-standard. Override via `turndown.addRule('strikethroughGfm', { filter: ['del','s','strike'], replacement: c => \`~~${c}~~\` })`.
- Instance Turndown réutilisée globalement (module-scope) — économise ~5ms par appel.
- Fixed-lang code blocks : Turndown ne préserve pas `class="language-X"` par défaut. Règle custom `fencedCodeWithLang` extrait `/language-([\w+-]+)/` depuis `<code class>` et préfixe la fence. 
- Bun exécute `import '../src/x.ts'` nativement, tests en `bun:test` (API Jest-like).

## Leçons / pièges
- Résoudre URLs relatives → absolues **avant** passage à Turndown, sinon les liens externes risquent d'être transformés en chemins relatifs dans le MD.
- Defuddle peut être agressif sur pages atypiques (SPA, listings). Garder mode `full` accessible.
- Tous les tests doivent tourner sur fixtures HTML locales, pas sur URLs réelles.
- Critère dur : test qui vérifie que tous les hosts externes `https?://` du HTML d'origine sont préservés dans le MD.
- **Gestion des versions de dépendances — règle dure** : pour toute nouvelle dépendance, ne JAMAIS inventer un numéro de version dans `package.json`. Toujours soit (a) `bun add <pkg>` sans version (bun résout la dernière), soit (b) vérifier la version courante via `npm view <pkg> version` ou la page releases GitHub **avant** d'écrire le `package.json`. Conséquence concrète observée : en écrivant `"defuddle": "^0.6.0"` par réflexe (numéro vu dans un billet de blog de recherche, sans vérification), on a installé **0.6.6 au lieu de 0.18.1** — 12 minor releases de retard, ~4 mois d'écart, plusieurs correctifs critiques manqués (anti-faux-positifs Tailwind via v0.11, regex à frontière de mot v0.15, remplacement de `'ad'` par `'advert'/'ad-'/'ads'`, support Chroma/CodeMirror). Résultat : une heure de debug sur un bug (code blocks de bun.sh/docs effacés à cause du pattern `'ad'` matchant `shadow-none`/`leading-6`) déjà corrigé upstream. Coût évitable.

## Session 2026-04-23 — implémentation dual-extractor (Defuddle + Readability)
- Option `extractor?: 'defuddle' | 'readability'` ajoutée à `HtmlToMarkdownOptions` (défaut `'defuddle'`). Remonte naturellement via `FetchMdOptions extends HtmlToMarkdownOptions`.
- `@mozilla/readability` promu **runtime dep** (était devDep).
- Adaptateurs dans `src/extractors/` : `types.ts` (interface `Extractor = ({document, url}) → {title?, contentHtml}`), `defuddle.ts` (contient `withSilencedConsole` déplacée depuis `processHtml.ts`), `readability.ts`, `index.ts` (registre + `DEFAULT_EXTRACTOR` + `getExtractor`). Exports publics complétés dans `src/index.ts`.
- `processHtml.ts` : simplifié, la branche `mode === 'article'` dispatche via `getExtractor(name)`. Shim CSS + noise removal + URL absolutization restent partagés (pré-extraction).
- `scripts/compare-extractors.ts` : une seule fonction `run(html, url, name)` qui délègue au registre central. Plus de duplication avec les adaptateurs.
- Tests : nouveau fichier `test/extractors.test.ts` (16 tests) — registre, dispatch, cas Readability sur `article.html`/`tricky.html`, assertions différentielles (```ts` chez Defuddle, fence vide chez Readability ; dédup H1 chez Readability). **45/45 tests pass** (29 existants + 16 nouveaux).
- E2E smoke via `Bun.serve` loopback : Defuddle 93 ms extract → `The State of Markdown` (date strippée), Readability 18 ms → `The State of Markdown — 2026` (date préservée). ```ts``` seulement côté Defuddle.
- Zéro breaking change : les tests existants passent tels quels parce que le défaut reste Defuddle.

## Session 2026-04-23 — bench Defuddle vs @mozilla/readability
- Branche : `claude/compare-readability-libraries-Gdkba`.
- Ajouté `@mozilla/readability` 0.6.0 en **devDep** (pas runtime) — utilisée uniquement par `scripts/compare-extractors.ts`.
- Readability 0.6.0 fonctionne avec linkedom **sans patch** (shims Defuddle existants inoffensifs). Pas besoin de jsdom.
- API quasi-identique : `new Readability(doc).parse() → { content, title, textContent, byline, siteName, lang, publishedTime }`. Accepte Document tiers (zero-dep).
- Script `scripts/compare-extractors.ts` : même Turndown + mêmes shims des 2 côtés, ne mesure que la différence d'extraction. Warmup avant mesure, `--repeat N` prend la médiane. Counters : mdTokens, liens externes uniques `https?://`, images, fences ```, textLen.
- Résultats vitesse (totalMs médiane, extraction seule fait l'écart) : **Readability 3-6× plus rapide** partout.
  - article.html : 38.5→12.4 (3.10×). full-page.html : 32.2→5.22 (6.18×). tricky.html : 19.6→16.1 (1.22×).
  - example.com : 22.0→5.05 (4.35×). github.com/kepano/defuddle : 753.9→138.4 (5.45×, extract seule 716→87 = 8.2×).
- Résultats fidélité (différences décisives) :
  - **Code blocks** : github.com readme → Defuddle 18 fences, Readability **0** (aplatit `<div class=highlight><pre>` en paragraphes inline). `language-ts` class : Defuddle préserve la langue en fence, Readability strip.
  - **Task lists** : Defuddle garde `- [x]/- [ ]`, Readability strip l'input et laisse `- Done` / `- Todo`.
  - **Nav résiduel** : sur listing court, Readability garde `<header>` (+ lien "Store"), Defuddle strip.
  - **Titre H1** : Readability dé-dup (le retire du body puisque = article.title), Defuddle garde en `##`. Choix arguable pour RAG (dédup peut être un +).
  - **Byline** : Defuddle strip `<p class=byline>`, Readability garde.
- Token reduction overall ~±3% entre les deux — les deux font le même gros boulot, mais **la qualité technique diffère fortement sur code-heavy pages**.
- Verdict → `docs/COMPARISON.md` : **Defuddle par défaut, Readability en opt-in** (adapter pattern ~80 LOC). Ne pas swapper complètement (perte de code blocks = régression majeure pour RAG). Ne pas faire de détection auto (trop de magie).
- Pièges rencontrés :
  - Gateway bloque souvent les fetch Bun avec 503 transitoires (bun.sh, vuejs, react.dev, parfois example.com). curl passe, donc pas un blocage ciblé — probablement rate-limit TLS fingerprint. `sleep 10` avant run suffit d'habitude.
  - **Readability mute le DOM** (`parse()` déplace/supprime des nœuds). L'adapter doit re-parser à chaque appel — fait naturellement dans le bench mais à noter si on veut partager un Document entre extractors en runtime.
  - `JSDOMParser.js` dans le package n'est pas utilisé ici — on passe un Document linkedom et ça suffit.

## Bug debug — bun.sh code blocks (résolu upstream)
- Symptôme : sur la conversion de `https://bun.sh/docs/installation`, les 19 blocs `<pre class="shiki">` disparaissent du markdown ; reste le label « terminal » isolé entre paragraphes.
- Isolation via patch temporaire de `Element.remove` (tracer les ancêtres qui emportent les pre) → `ContentScorer.scoreAndRemove` supprime le `<div class="... dark:bg-codeblock ... shadow-none ... leading-6 ...">` wrapper de chaque Shiki pre, avec un score −16 (seuil −0).
- Root cause en 0.6.6 : `nonContentPatterns = ['ad', 'banner', ...]` + `className.includes(pattern)` naïf. Le pattern `'ad'` (pour "advertisement") matche `le**ad**ing-6` ET `sh**ad**ow-none` dans les classes Tailwind. −8 chacun, total −16 → remove.
- Fix upstream (main, v0.12+) : `nonContentPatterns = ['advert', 'ad-', 'ads', ...]` — aucun ne matche les tokens Tailwind. En plus, les `navigationIndicators` sur le texte passent d'un `includes()` à `new RegExp('\\b' + indicator + '\\b')` (frontière de mot).
- Traces upstream : PR #184 (Tailwind/Webflow), PR #152 (refactor scoring), PR #215 (code tabs OpenAI docs), notes de release v0.11 "Tailwind: Improve patterns" et v0.15 "Fix content scoring removing blocks with navigation-like words".
- Aucun issue explicite sur `shadow-*`/`leading-*` × `'ad'` trouvé — le fix s'est fait dans un refactor plus large sans post-mortem détaillé. Repro bun.sh/docs disponible si jamais on veut déposer une issue/release-note.
