# Moteur typographique saisonnier — LOT 4B

Ce module applique les typographies **publiées** par le resolver LOT 2 aux trois catégories autorisées du catalogue : `pageTitle`, `sectionTitle`, `categoryTitle`. Il est rattaché au moteur graphique LOT 4A et ne constitue ni un second système de configuration ni un second resolver.

## Invariants

- Une seule source de vérité : `snapshot.typography` produit par `GET /api/seasonal-theme/resolve`. Aucune priorité, aucun conflit et aucune fenêtre ne sont recalculés côté client.
- Une seule typographie gagnante par catégorie ; l'ordre du resolver est respecté sans rerank.
- Catalogue fermé : `inter`, `creepster`, `archivo-black`. Aucune autre famille n'est chargée ni appliquée.
- Aucun texte n'est modifié : ni `textContent`, ni traduction, ni nom de film, ni donnée utilisateur, ni pseudo-élément de contenu, ni nœud dupliqué.
- Polices auto-hébergées, chargées uniquement quand une configuration publiée et une route autorisée l'exigent. `inter` reste le fallback immédiat.
- Routes exclues : aucun marqueur, aucun `FontFace`, aucune requête de police, aucun style global. L'aperçu administratif est la seule exception, isolée dans son panneau. L'ambiance Halloween historique applique la même frontière : son WOFF2 Creepster n'est demandé que sur une route autorisée.
- TV et `prefers-reduced-motion` : identité typographique statique, sans animation.
- Désactivation, urgence ou erreur : restauration immédiate des styles de référence.

## Analyse des défaillances avant tests

Les défaillances identifiées avant implémentation sont consignées dans `docs/seasonal-theme-typography-plan.md` (note de travail non suivie par Git, `docs/` étant ignoré). Elles couvrent notamment : resolver indisponible, urgence, police inconnue, catégorie inconnue, conflits locaux, routes exclues, fuite du brouillon d'aperçu, échec de chargement d'une police, double chargement, Google Fonts, FOUT/FOIT, mutation de texte, débordement responsive, glyphes accentués, TV/reduced-motion, concurrence avec les ambiances historiques, nettoyage incomplet, effets incompatibles, comparaison des trois catégories, i18n, absence de polices dans le build, marquage non audité, graisses fictives et effets sur contrôles interactifs.

Les E2E LOT 0/3 sont statiques et l'E2E LOT 4A vérifie les calques graphiques, mais aucun ne charge de police, ne compare le `textContent` des titres, n'inspecte les requêtes réseau de polices ni ne valide l'isolement de l'aperçu. Les tests LOT 4B sont donc nécessaires en complément.

## Implémentation

| Fichier | Rôle |
| --- | --- |
| `registry.ts` | Catalogue fermé, familles, graisses, `unicode-range` et URLs locales. |
| `resolve.ts` | Projection fail-closed de `snapshot.typography` vers les trois catégories ; aucun rerank. |
| `fontLoader.ts` | `FontFace` différé, cache des promesses, repli Inter sur échec. |
| `styles.ts` | Feuille temporaire ciblant uniquement `data-seasonal-typography`, avec restauration idempotente. |
| `controller.ts` | Cycle de vie public : chargement, application, nettoyage sur urgence/route/démontage. |
| `draftPreview.ts` | Miroir **preview-only** du resolver LOT 2 pour le brouillon administratif ; jamais utilisé en public. |
| `../../components/adminDecor/SeasonalTypographySample.tsx` | Comparaison isolée des trois catégories, styles en ligne retirés au démontage. |

Les fichiers WOFF2 sont servis depuis `public/fonts/seasonal-theme/` : Inter 400/500/600/700/800/900, Creepster 400 et Archivo Black 400, sous-ensemble `latin`. Leurs licences OFL-1.1 et la provenance sont dans `public/fonts/seasonal-theme/CREDITS.md`. Aucun `latin-ext`, aucun italique et aucune URL distante ne sont déclarés.

Neuf points de marquage publics ont été retenus après audit : trois `pageTitle` (HeroSlider, HeroPromoContent, GenrePage), trois `sectionTitle` (EmblaCarousel, EmblaCarouselGenres, plates-formes de Home) et trois `categoryTitle` (CarouselTitle, InlineStreamingCatalog, catégories ProviderContent). `HeroPromoContent` ne marque que la slide publique : son rendu d'aperçu (`preview`) partagé avec l'admin reste sans marqueur. Les lecteurs, WatchParty, l'admin, l'auth, le paiement, Wrapped, les profils, la recherche, les filtres et les fiches ne portent aucun marqueur.

## Vérifications

```powershell
node --test tests/seasonalThemeTypography.test.ts
$env:CODEX_PRIMARY_RUNTIME_NODE_MODULES='<runtime-playwright-core-hors-depot>'
$env:SEASONAL_THEME_TYPOGRAPHY_DIR='<hors-depot>'; $env:SEASONAL_THEME_STRICT_GAPS='1'; node tests/seasonalThemeTypography.browser.mjs
$env:SEASONAL_THEME_GRAPHICS_DIR='<hors-depot>'; $env:SEASONAL_THEME_STRICT='1'; node tests/seasonalThemeGraphics.browser.mjs
$env:SEASONAL_THEME_ADMIN_DIR='<hors-depot>'; $env:SEASONAL_THEME_STRICT='1'; node tests/seasonalThemeAdmin.browser.mjs
npx eslint src/seasonalThemeGraphics src/components/adminDecor src/utils/halloweenThemeAssets.ts src/components/HalloweenAtmosphere.tsx src/main.tsx tests/seasonalThemeTypography.test.ts tests/seasonalThemeHarness.mjs tests/seasonalThemeFixtures tests/seasonalThemeTypography.browser.mjs tests/seasonalThemeAdmin.browser.mjs
npx tsc --noEmit -p tsconfig.app.json
$env:VITE_SITE_URL='https://seasonal.test'; $env:VITE_MAIN_API='https://main-api.test'; npm run build
git diff --check
```

Les rapports E2E sont écrits hors du dépôt, avec commande de relance, horloge figée, requêtes réseau, captures et trace. Aucun serveur ni secret n'est requis. `playwright-core` n'étant pas dans les dépendances du dépôt, il est installé hors dépôt et exposé par `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. La commande de relance est générée depuis l'environnement courant : elle contient les chemins réels et les variables strictes utilisés, jamais un placeholder non exécutable.

État réel des contrôles statiques sur ce checkout :

- ESLint ciblé LOT 4B : **0 erreur, 0 avertissement**. Les neuf composants seulement marqués `data-seasonal-typography` conservent des erreurs `no-explicit-any` et des avertissements préexistants sur des lignes non modifiées par LOT 4B.
- `tsc --noEmit -p tsconfig.app.json` : 268 erreurs préexistantes dans le dépôt, dont `adminDecor/AdminDecor.tsx:862` (`Palette`, ligne identique à la base LOT 4A). Aucune erreur dans les nouveaux modules `typography/`, dans `halloweenThemeAssets.ts`, `HalloweenAtmosphere.tsx`, `main.tsx` ni dans les tests LOT 4B. `tsconfig.json` ne contient que des références vides et ne vérifie rien sans `-p tsconfig.app.json`.
- Build Vite : réussi avec des URL factices locales pour les deux variables obligatoires ; avertissements préexistants de taille de chunks et de Tailwind. Le bundle contient uniquement les WOFF2 attendus sous `dist/fonts/seasonal-theme/` et aucune URL Google Fonts.

## Reporté au LOT 5

- La migration complète des ambiances historiques localStorage vers le resolver publié reste hors périmètre : seuls leurs chargements de police et leurs points de suspension sont alignés ici.
- L'aperçu graphique LOT 4A dans l'admin n'est pas étendu ; seul l'aperçu typographique LOT 4B est rendu.
- La couverture `latin-ext` n'est pas déclarée : elle nécessiterait des fichiers et une validation de glyphes supplémentaires.
