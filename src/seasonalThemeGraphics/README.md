# Moteur graphique saisonnier — LOT 4A

Ce module transforme la configuration **publiée** par la console LOT 1/2 en effets visibles sur les pages publiques autorisées. Il ne publie rien, ne lit aucune préférence locale comme source d'autorité et ne recalcule aucune priorité : le resolver LOT 2 (`GET /api/seasonal-theme/resolve`) reste l'unique source de vérité.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `routes.ts` | Politique d'initialisation par route. Les exclusions sont évaluées avant les métadonnées : `allow: true` ne réactive jamais une route protégée. |
| `platform.ts` | Détection desktop/tablette/mobile/TV et politique de mouvement (`full`, `reduced`, `static`). |
| `performance.ts` | Budgets (42/28/18/0 particules), DPR borné, plafond canvas 12 MiB, planificateur RAF pause/resume/stop. |
| `loader.ts` | Chargement fail-closed du resolver public, avec `AbortSignal`. Erreur, charge utile invalide ou urgence désactivent toute décoration. |
| `registry.ts` | Registre fermé des 15 décorations du catalogue LOT 2. Filtre inconnus, désactivés, doublons et animations sans repli statique **sans rerank**. |
| `renderers.ts` | Calques DOM statiques (fond, coins décoratifs, lumières) et unique canvas de particules. Aucun composant React par particule. |
| `engine.ts` | Cycle de vie : chargement, rendu, polling 20 s, rafraîchissement au retour d'onglet/ focus, arrêt d'urgence, nettoyage intégral. |
| `context.ts` / `SeasonalGraphicsProvider.tsx` | Montage global dans `App.tsx` (sous `IntroProvider`) et état partagé. Sur route exclue : ni calque, ni canvas, ni listener, ni requête. |
| `seasonalGraphics.css` | Styles non interactifs (`aria-hidden`, `pointer-events: none`), neutralisés sur TV et `prefers-reduced-motion`. |

La famille `typography` est reconnue structurellement mais **n'a pas de rendu visuel** : c'est le LOT 4B. Aucune police, couleur de texte ou effet typographique n'est appliqué ici.

## Sécurité et cohabitation

- Routes sans moteur : lecteurs (`/watch`, `/ftv/watch`), WatchParty, administration, auth/OAuth, paiement/VIP, liens de compte, `/wrapped` et pages sensibles. Les protections existantes du lecteur et de WatchParty ne sont pas modifiées.
- Quand une configuration publiée ou une urgence prend l'autorité, `suppressLegacy` suspend `HalloweenAtmosphere` et `ChristmasAtmosphere` pour éviter un double rendu. Les anciens systèmes restent montés et conservent leurs protections hors configuration publiée.
- L'aperçu administratif LOT 3 reste volontairement isolé : il affiche la structure du brouillon et ne monte pas le moteur, afin qu'aucune configuration non publiée ne puisse atteindre une page publique.
- Les assets ne sont chargés que depuis `/assets/seasonal-theme/` avec un motif strict ; une option absente ou invalide ne charge rien.

## Vérification

```sh
node --test tests/seasonalThemeGraphics.test.ts
npx eslint src/seasonalThemeGraphics tests/seasonalThemeGraphics.test.ts
npx tsc --noEmit -p tsconfig.json
$env:SEASONAL_THEME_GRAPHICS_DIR='<hors-depot>'; node tests/seasonalThemeGraphics.browser.mjs
```

Le scénario navigateur monte le vrai provider avec un resolver déterministe local. Il produit `REPORT.md`, des captures (Halloween, coexistence, urgence, TV, reduced motion, mobile, FR, EN) et vérifie 26 contrôles : rendu, non-interactivité, conflits résolus par le backend, urgence/reprise, routes exclues, nettoyage, fail-closed, budgets et i18n visuel FR/EN. Aucun serveur, compte, secret ou donnée de production n'est nécessaire.

## Restes explicites (hors LOT 4A)

- **LOT 4B** : rendu visuel des typographies (`creepster`, `archivo-black`, effets `glow`/`frost`) et aperçu graphique administratif complet.
- **LOT 5** : retrait des atmosphères historiques et de leurs clés `localStorage`, bootstrap `main.tsx` (classes/polices avant connaissance de la route), citrouille du Header et de la progression HLS, popup publicitaire Halloween, `AmbientLayer`, April Fools, fantôme 404, et métadonnées `seasonalDecor` dans `src/routing/registry.tsx`.
- Propagation d'urgence multi-workers < 1 s non mesurable ici : le polling public est de 20 s, avec rafraîchissement immédiat au retour d'onglet et au focus.
