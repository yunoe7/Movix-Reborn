# Moteur graphique saisonnier — LOT 4A/4B et intégration LOT 5

Ce module transforme la configuration **publiée** par la console LOT 1/2 en effets visibles sur les pages publiques autorisées. Il ne publie rien, ne lit aucune préférence locale comme source d'autorité et ne recalcule aucune priorité : le resolver LOT 2 (`GET /api/seasonal-theme/resolve`) reste l'unique source de vérité.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `routes.ts` | Politique stricte d'initialisation par route. Les exclusions sont évaluées avant les métadonnées : `allow: true` ne réactive jamais une route protégée. |
| `src/routing/seasonalScope.ts` | Catalogue déclaratif fermé LOT 5 (`full`/`minimal`/`suppress`) consommé avant React par `main.tsx`, le provider et les atmosphères historiques. Route non déclarée = `suppress`. Le registre renseigne `seasonalDecor` depuis ce catalogue. |
| `platform.ts` | Détection desktop/tablette/mobile/TV et politique de mouvement (`full`, `reduced`, `static`). |
| `performance.ts` | Budgets (42/28/18/0 particules), DPR borné, plafond canvas 12 MiB, planificateur RAF pause/resume/stop. |
| `loader.ts` | Chargement fail-closed du resolver public, avec `AbortSignal`. Erreur, charge utile invalide ou urgence désactivent toute décoration. |
| `registry.ts` | Registre fermé des 15 décorations du catalogue LOT 2. Filtre inconnus, désactivés, doublons et animations sans repli statique **sans rerank**. |
| `renderers.ts` | Calques DOM statiques (fond, coins décoratifs, lumières) et unique canvas de particules. Aucun composant React par particule. |
| `engine.ts` | Cycle de vie : chargement, rendu, polling 20 s, rafraîchissement au retour d'onglet/ focus, arrêt d'urgence, nettoyage intégral. Il pilote aussi le contrôleur typographique LOT 4B à partir du **même** snapshot ; la révision n'est enregistrée qu'après chargement effectif des polices. |
| `context.ts` / `SeasonalGraphicsProvider.tsx` | Montage global dans `App.tsx` (sous `IntroProvider`) et état partagé. Sur route exclue : ni calque, ni canvas, ni listener, ni requête. |
| `seasonalGraphics.css` | Styles non interactifs (`aria-hidden`, `pointer-events: none`), neutralisés sur TV et `prefers-reduced-motion`. |

La famille `typography` est pilotée par le contrôleur de `typography/` (LOT 4B), sans seconde instance ni second resolver : une seule configuration publiée alimente les calques et la feuille temporaire. Aucune couleur, taille ou donnée de texte n'est modifiée.

## Sécurité et cohabitation

- Routes sans moteur : lecteurs (`/watch`, `/ftv/watch`), WatchParty, administration, auth/OAuth, paiement/VIP, liens de compte, `/wrapped`, routes non déclarées et pages sensibles. La liste stricte prime sur les métadonnées et sur les réglages locaux. Aucun appel `/resolve`, `FontFace`, canvas ou listener du moteur n'est créé sur ces routes.
- Quand une configuration publiée ou une urgence prend l'autorité, `suppressLegacy` suspend `HalloweenAtmosphere` et `ChristmasAtmosphere` pour éviter un double rendu. Sur une route exclue, `main.tsx` ne pose ni classe ni marqueur avant React, et les deux atmosphères retirent les leurs. Les comportements non décoratifs restent intacts : réglages `settings_*`, sync, bandeau du 31 octobre, citrouille de l'en-tête et de la progression HLS, popup pub sur route autorisée, rangée et araignée Halloween, fantôme 404.
- L'aperçu administratif LOT 3 reste volontairement isolé : il affiche la structure du brouillon et ne monte pas le moteur, afin qu'aucune configuration non publiée ne puisse atteindre une page publique.
- Les assets ne sont chargés que depuis `/assets/seasonal-theme/` avec un motif strict ; une option absente ou invalide ne charge rien.

## Vérification

```sh
node --test tests/seasonalThemeGraphics.test.ts tests/seasonalThemeIntegration.test.ts
npx eslint src/seasonalThemeGraphics src/routing/seasonalScope.ts tests/seasonalThemeGraphics.test.ts tests/seasonalThemeIntegration.test.ts
npx tsc --noEmit -p tsconfig.app.json
$env:SEASONAL_THEME_GRAPHICS_DIR='<hors-depot>'; node tests/seasonalThemeGraphics.browser.mjs
$env:SEASONAL_THEME_INTEGRATION_DIR='<hors-depot>'; node tests/seasonalThemeIntegration.browser.mjs
```

Le scénario navigateur monte le vrai provider avec un resolver déterministe local. Il produit `REPORT.md`, des captures (Halloween, coexistence, urgence, TV, reduced motion, mobile, FR, EN) et vérifie 26 contrôles : rendu, non-interactivité, conflits résolus par le backend, urgence/reprise, routes exclues, nettoyage, fail-closed, budgets et i18n visuel FR/EN. Aucun serveur, compte, secret ou donnée de production n'est nécessaire.

## Intégration LOT 5

`src/routing/seasonalScope.ts` est la politique unique, évaluée avant toute initialisation. `main.tsx` (pré-React), `SeasonalGraphicsProvider`, `HalloweenAtmosphere` et `ChristmasAtmosphere` la consomment. Les décorations historiques ne sont ni doublées ni réactivées par une configuration non publiée ; l'aperçu admin reste isolé (`draftPreview`, aucun appel public). Le scénario `tests/seasonalThemeIntegration.browser.mjs` couvre 16 contrôles avec artefacts (rapport, traces et captures), dont la coexistence, les cas individuels, les conflits, les routes exclues, le nettoyage, le reduced motion, la TV statique, le responsive, le lecteur et l'aperçu admin.

## Restes explicites (hors LOT 5)

- Les statuts `blocked`/`fail` historiques des scénarios LOT 0/2/3 ne sont pas requalifiés : worker/Redis, hooks et salle WatchParty réelle à deux pairs nécessitent une infrastructure absente du checkout.
- Propagation d'urgence multi-workers < 1 s non mesurable ici : le polling public est de 20 s, avec rafraîchissement immédiat au retour d'onglet et au focus.
