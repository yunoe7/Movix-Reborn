# Secours Anime-Sama (adaptateur isolé)

## État actuel

L'adaptateur `animeSamaFallback.js` est **désactivé par défaut** et n'est pas branché aux routes de production. Il cible l'API Atomic-tech/Anime-Sama, qui scrape elle-même Anime-Sama : ce n'est pas une origine indépendante.

## Pourquoi il reste isolé

Le contrat documenté de l'API externe annonce une enveloppe de recherche, mais ne garantit pas une structure stable des champs ni la compatibilité de ses lecteurs avec le format Movix. Le secours ne doit donc jamais injecter des données inconnues dans le cache principal, l'index TMDB, les saisons ou le lecteur.

## Activation

Aucune activation en production à ce stade. Pour les essais isolés uniquement, fournir `ANIME_SAMA_FALLBACK_URL` avec une URL HTTPS. L'adaptateur impose :
- HTTPS uniquement ;
- délai réseau borné (1 à 10 secondes) ;
- coalescence des recherches simultanées ;
- pause courte après deux échecs ;
- validation stricte des URLs de fiches Anime-Sama ;
- rejet des domaines externes, des chemins de saison et des protocoles non HTTP ;
- aucune écriture dans le cache ou la base de données Movix.

## Prochaine étape obligatoire

Tester l'endpoint réel et documenter ses réponses exactes (recherche, fiche, saisons, épisode, liens VF/VOSTFR), puis écrire des tests de contrat avec des réponses réelles anonymisées. L'intégration dans les routes existantes ne sera envisagée qu'après validation de la forme de données et du comportement de lecture.

## Licence

Aucun code des dépôts tiers n'est copié ici. L'adaptateur est une intégration HTTP indépendante.
