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
- **Bench URL réelle** (`bun.sh/docs/installation`, 229 125 tokens HTML) : **99.1% de réduction** (→ 1 965 tokens MD). fetch 162–810 ms, conversion 322–638 ms. Ratio ~1.8-3×.
- `bunx tsc --noEmit` : clean.

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
