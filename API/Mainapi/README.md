# Main API Movix

C'est le cœur applicatif du projet. Si le frontend affiche un catalogue, authentifie un user, synchronise du `localStorage`, gère les commentaires, le Wishboard, le Top 10, le Live TV, le debrid ou les pages VIP, il finit très souvent ici.

Le service tourne en mode cluster via `server.js` : un master lance plusieurs workers, surveille les redémarrages et gère un graceful shutdown. `app.js` monte ensuite Express, Redis, le pool MySQL, les caches disque et les routes injectées par dépendances.

## Ce que le service gère

- auth, sessions et profils
- recherche, metadata TMDB et agrégation de sources
- sync frontend <-> backend pour une partie de l'état utilisateur
- commentaires, likes, listes partagées, Wishboard et soumission de liens
- Live TV, proxies, debrid et intégrations de scraping
- VIP, invoices, wrapped et features communautaires

## Démarrage

```bash
cd API/Mainapi
cp .env.example .env
npm install
npm run dev
```

Ne lance pas le service avec un `.env` vide : MySQL, Redis, JWT, TMDB et plusieurs routes métier en dépendent directement.

Notes utiles :

- le serveur HTTP écoute actuellement sur `http://localhost:25565`
- `server.js` bind aujourd'hui le port `25565` en dur
- `NUM_WORKERS` permet de régler le nombre de workers du cluster ; `WORKER_MAX_RSS_MB` remplace, un par un, les workers qui dépassent ce seuil de mémoire
- MySQL et Redis sont nécessaires pour une grosse partie des routes

## Architecture

```text
API/Mainapi/
|-- server.js                 # Master cluster + workers + graceful shutdown
|-- app.js                    # Bootstrap Express, middleware, deps partagées
|-- mysqlPool.js              # Pool MySQL unique
|-- config/redis.js           # Redis
|-- middleware/               # CORS, sécurité, auth
|-- routes/                   # Modules avec configure(deps)
|-- commentsRoutes.js         # Commentaires
|-- likesRoutes.js            # Likes / dislikes
|-- sharedListsRoutes.js      # Listes partagées
|-- liveTvRoutes.js           # Live TV
|-- wishboardRoutes.js        # Wishboard
|-- top10Routes.js            # Classements
|-- wrappedRoutes.js          # Wrapped
|-- linkSubmissionsRoutes.js  # Soumission de liens
|-- utils/                    # Cache, proxies, axios helpers, VIP, etc.
|-- cache/                    # Caches disque
`-- exportscripts/            # SQL et scripts de migration
```

Le pattern important dans `routes/` : beaucoup de modules exposent `configure(deps)`. C'est `app.js` qui injecte les clients HTTP, le cache, les helpers et les constantes partagées avant montage.

## Variables d'environnement à renseigner en premier

Le fichier `API/Mainapi/.env.example` est la référence complète. En pratique, les groupes de variables à traiter en premier sont :

- cœur applicatif : `JWT_SECRET`, `TMDB_API_KEY`, `FRONTEND_BASE_URL`
- données : `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- cache et coordination : `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `NUM_WORKERS`
- scraping / proxy : `PROXY_SERVER_URL`, `IPTV_STREAM_PROXY`, `SOCKS5_PROXIES`, `HTTP_PROXIES`
- anti-abuse / forms : `TURNSTILE_SECRET_KEY`, `TURNSTILE_INVISIBLE_SECRETKEY`, puis `TURNSTILE_DOMAINS_n`, `TURNSTILE_SECRET_KEY_n` et `TURNSTILE_INVISIBLE_SECRETKEY_n` (n de 2 à 10) au-delà de 10 domaines : la clé suit l'`Origin` de la requête (`utils/turnstile.js`)
- connexion Discord / Google : `DISCORD_CLIENT_ID`, `GOOGLE_CLIENT_ID` (les mêmes que `src/config/discord.ts` et `src/config/google.ts`)
- paiement / VIP : variables `VIP_*`, `BLOCKCYPHER_TOKEN`

Certaines intégrations sont très spécifiques à des sources données, par exemple les cookies `DARKIWORLD_*` ou `XTREAM_*`.



Les sources de streaming gardent leurs résultats en cache (Redis si disponible, sinon mémoire du worker) et passent par les proxys de `SOCKS5_PROXIES` / `HTTP_PROXIES`. Cpasmal est coupé par défaut (`CPASMAL_ENABLED=true` pour le réactiver) ; activée, une route Cpasmal sans cache répond `202` avec `Retry-After` : rappeler la même URL.

## Fichiers SQLite pour Darkino / DarkiWorld

La source téléchargements (`routes/darkiworld.js` et `utils/darkiworldSqlite.js`) lit des snapshots SQLite locaux : `mirror.sqlite`, `darkino.sqlite` et `links_small.sqlite`. Ces fichiers ne sont pas versionnés dans le dépôt public.

1. Télécharger [l’archive des fichiers SQLite sur Pixeldrain](https://pixeldrain.com/u/n2M1s1MA).
2. Extraire les fichiers `.sqlite` dans `API/Mainapi/darkino-backups/`.
3. Pour utiliser un autre dossier, définir `DARKIWORLD_SQLITE_DIR` avec son chemin absolu, par exemple `/home/container/darkino-backups`.

Démarrer ou redémarrer Main API après l’installation des fichiers. Sans ces snapshots, les liens absents du cache local peuvent renvoyer `sqlite_miss`. Avec `HYDRACKER_BLACKOUT=true` (valeur par défaut), aucune résolution en direct auprès d’Hydracker ou de DarkiWorld ne prend le relais.

## Points d'entrée utiles

- auth et profils : `routes/authRoutes.js`, `routes/sessions.js`, `routes/profiles.js`
- persistance frontend : `routes/sync.js`, historique et progression : `routes/history.js`
- recherche et catalogues : `routes/search.js`, `routes/tmdb.js`
- scraping / lecture : `routes/cpasmal.js`, `routes/wiflix.js`, `liveTvRoutes.js`
- communautaire : `commentsRoutes.js`, `likesRoutes.js`, `sharedListsRoutes.js`, `wishboardRoutes.js`, `linkSubmissionsRoutes.js`
- VIP / paiements : `utils/vipDonations.js`, `routes/vipDonations.js` ; réglages des dons gérés depuis l'admin (montant libre, moyens actifs, cartes cadeaux, contacts) : `utils/vipDonationSettings.js`
- publicités réglées depuis l'admin (emplacements, rotation, ciblage, statistiques) : `routes/monetization.js`, `utils/monetizationSettings.js`, `utils/monetizationPicker.js`, `utils/monetizationStats.js`
- parrainage (code par compte, jours VIP pour le parrain et le filleul, activé depuis l'admin ; temps de visionnage pris au Wrapped) : `routes/referral.js`, `utils/referralProgress.js`, `utils/referralSettings.js`, `utils/referralRules.js`
- promos du grand carrousel (slides ajoutées en haut des pages Accueil, Films, Séries, Plateformes et Animés, réglées depuis l'admin carrousel par carrousel ; images et clics par jour gardés en base) : `routes/heroPromos.js`, `utils/heroPromoSettings.js`, tables du groupe `heroPromo` (`db/schema/heroPromo.js`). Un lien vers un autre site passe par `GET /api/hero-promos/<id>/go`, qui compte le clic puis redirige, comme `/api/go` pour les pubs

## Historique et progression

L'historique, la progression et les marques « Déjà vu » sont stockés en MySQL (`db/schema/history.js`) : `watch_progress`, `watch_history`, `watch_marks`, plus un cache TMDB permanent (`tmdb_media`, `tmdb_episodes`). Les clients continuent d'écrire via `/api/sync` ; le serveur recopie ces clés dans les tables et importe une fois les anciennes données de chaque profil.

Code : `routes/history.js`, `utils/historyStore.js` (rangée « Reprendre »), `utils/historyOverview.js` (onglet Historique du profil), `utils/historyImport.js`, `utils/mediaStore.js` (cache TMDB).

### Contrat de réponse partielle `/api/sync`

`POST /api/sync` applique chaque opération valide et renvoie `200` avec `success: true`. Les opérations refusées par la politique (`API/Mainapi/shared/syncKeys.json`) sont rapportées dans `rejected` avec `index`, `code`, `message`, `status` et `partial: true` ; les anciens clients qui ignorent ces champs continuent à fonctionner.

`is_vip` est une vérité calculée côté serveur (`serverManaged` dans `API/Mainapi/shared/syncKeys.json`) : le client ne peut ni l'écrire ni le synchroniser. Un envoi de cette clé est refusé avec le code historique `INVALID_SYNC_KEY`, `serverManagedRejected: true` et un message explicite. La réponse inclut en plus `serverManagedRejected: ["is_vip"]` pour que les clients récents puissent distinguer un refus de politique d'une erreur temporaire. Les erreurs réseau, `401/403/404/408/429` et `5xx` restent rejouables par l'outbox ; les `4xx` de politique sont abandonnées.

Le fichier `API/Mainapi/shared/syncKeys.json` est la source canonique unique, partagée par `utils/syncPolicy.js` et `src/utils/syncStorage.ts`. Aucune copie indépendante n'est maintenue.

Dans le service Railway de la Main API, le root directory est `/API/Mainapi`. Le contrat y est donc chargé depuis `/app/shared/syncKeys.json`, à l'intérieur du root directory, via `require('../shared/syncKeys.json')`. Cette résolution ne dépend pas du `.dockerignore` situé à la racine du dépôt.

Le build Docker du frontend part, lui, de la racine du dépôt. Comme `src/utils/syncStorage.ts` importe le contrat canonique, `.dockerignore` réinclut uniquement les répertoires parents nécessaires et `API/Mainapi/shared/syncKeys.json` ; le reste de `API/` reste exclu. Le test `API/Mainapi/utils/__tests__/syncPolicyModuleResolution.test.js` vérifie la résolution relative du module et l'unicité du contrat. Il ne valide ni Railpack ni le contexte Docker réel.

Routes sous `/api/history`, pour les comptes connectés (OAuth ou BIP39) :

| Route | Rôle |
| --- | --- |
| `GET /continue` | rangée « Reprendre » |
| `GET /list` | onglet Historique (filtre `status`, pagination) |
| `GET /title` | avancement d'un film ou d'une série |
| `GET` / `POST /progress` | position de lecture |
| `DELETE /continue/:type/:id`, `DELETE /continue` | retirer une carte, ou toutes |
| `DELETE /title/:type/:id` | supprimer un titre de l'historique |

## Liaison d'une télé

`routes/tvLink.js` relie l'appli TV à un compte avec un code à 5 caractères affiché sur la télé : `POST /api/tv/link/start` et `/poll` côté télé, `GET /info` et `POST /confirm` côté site. Nécessite Redis.

## À garder en tête

- Le backend actif est ici, pas dans l'ancien contenu direct de `API/`.
- Plusieurs tables MySQL sont initialisées automatiquement au démarrage.
- Une partie du comportement applicatif dépend de caches disque et de proxys externes ; un bug peut venir d'ailleurs que du code route lui-même.
- Si une feature touche la lecture vidéo, regarde aussi `API/proxiesembed/` et parfois l'extension navigateur.
