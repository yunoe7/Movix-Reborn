# Secours de recherche Anime-Sama

Le fallback de recherche est intégré à la route `/anime/search/:query`, mais reste **désactivé par défaut**.

## Activation

Définir `ANIME_SAMA_FALLBACK_URL` avec l'origine HTTPS de l'API compatible (par exemple `https://api-anime-sama.onrender.com`). Sans cette variable, la recherche et le comportement actuels restent inchangés.

Le fallback n'est appelé que lorsque la recherche Anime-Sama principale renvoie une erreur ou aucun résultat. Les fiches normalisées passent ensuite par le pipeline existant de cache, de chargement des saisons et de résolution des épisodes. Aucun lecteur alternatif n'est ajouté : le lecteur reste celui d'Anime-Sama déjà utilisé par Movix.

## Garde-fous

- HTTPS uniquement, origine sans chemin, identifiants, query ou fragment.
- Réponse limitée, délai réseau borné, validation stricte des domaines et chemins catalogue.
- Pas de données externes acceptées comme URLs de lecteur.
- Aucun changement du cache si le fallback ne renvoie aucun résultat valide.
- Adaptateur désactivable immédiatement en supprimant `ANIME_SAMA_FALLBACK_URL`.

## Limite connue

Le fournisseur tiers scrape lui-même Anime-Sama ; ce n'est pas une source indépendante. Son contrat réel peut évoluer. Le fallback est donc optionnel et son échec ne doit pas interrompre la recherche principale.
