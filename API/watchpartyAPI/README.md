# WatchParty API

La WatchParty est le service temps réel de Movix. C'est lui qui gère les rooms, le chat, les rôles, les votes, la synchro de lecture et la persistance minimale entre deux redémarrages.

Le service est volontairement concentré dans un seul fichier ESM, `watchparty.js`, qui combine Express, serveur HTTP et namespace Socket.IO.

## Ce que la WatchParty gère

- création de room avec code d'invitation
- synchro lecture / pause / seek
- deux modes de sync : `classic` et `pro`
- chat live, réactions et participants
- contrôle par hôte, co-hosts ou mode démocratique
- pause timer et vote de pause
- rooms publiques et liste des rooms visibles, diffusée en temps réel aux lobbies connectés
- sauvegarde JSON sur disque au shutdown

## Démarrage

Depuis la racine du repo:

```bash
npm install
cp API/watchpartyAPI/.env.example API/watchpartyAPI/.env
node API/watchpartyAPI/watchparty.js
```

Notes utiles :

- le port par défaut est `25566`
- `API/watchpartyAPI/` n'a pas son propre `package.json`
- les dépendances sont résolues depuis le `node_modules` racine

## Configuration

Les variables exposées par `API/watchpartyAPI/.env.example` sont :

- `WATCHPARTY_PORT`
- `WATCHPARTY_CORS_CREDENTIALS`
- `WATCHPARTY_REST_CORS_ORIGIN`
- `WATCHPARTY_SOCKET_CORS_ORIGIN`
- `WATCHPARTY_SOCKET_CORS_METHODS`
- `WATCHPARTY_ADMIN_SECRET`
- `WATCHPARTY_MAX_BODY`, `WATCHPARTY_MAX_ROOMS`, `WATCHPARTY_MAX_ROOMS_PER_IP`

Le frontend doit renseigner `VITE_WATCHPARTY_API` avec l'origine de ce service.
Il ne retombe jamais sur `VITE_MAIN_API` : la Main API ne sert aucune route
`/api/watchparty/*` et renvoyait un 404 silencieux. Une réponse `404` signifie
donc une URL ou une configuration de base incorrecte ; un `502` signifie que le
service WatchParty (ou son proxy amont) est momentanément indisponible. Les deux
statuts sont remontés tels quels à l'interface, sans fallback masqué.

L'IP client utilisée par le rate limiting est lue dans `CF-Connecting-IP`, avec
`X-Forwarded-For` puis `req.ip` en repli — aucun réglage `trust proxy` à faire,
il suffit que nginx transmette ces en-têtes.

Sans `WATCHPARTY_REST_CORS_ORIGIN` / `WATCHPARTY_SOCKET_CORS_ORIGIN`, seul
`localhost:3000` est autorisé. Mettre `*` ou `true` désactive automatiquement
les credentials CORS (une origine reflétée avec credentials est exploitable).

Ces deux variables acceptent, séparés par des virgules : une origine
(`https://movix.fun`), un domaine nu (`movix.fun`), ou l'URL d'une **liste de
miroirs** (`https://movix.online/address.json`). Une URL avec un chemin est
reconnue comme une liste et téléchargée au démarrage puis toutes les 10 minutes.

Le serveur y retient `primary` et `active` et ignore délibérément `blocked` :
basculer un domaine dans `blocked` suffit à lui retirer l'accès CORS au
rafraîchissement suivant. Si le téléchargement échoue, la dernière liste valide
reste active et une nouvelle tentative a lieu au bout d'une minute. Conserver
une origine statique à côté de l'URL protège du cas où la liste serait
injoignable au tout premier démarrage.

Rappel : le CORS est appliqué par le navigateur, pas par le serveur. Il empêche
un site tiers de piloter le navigateur d'un utilisateur, mais n'arrête pas un
client hors navigateur (`curl`, script) — c'est le token de room qui protège
réellement l'accès.

## Contrôle d'accès

Connaître un `roomId` ne donne aucun droit. Chaque room délivre deux sortes de
jetons, et il en faut un pour lire `GET /room/:roomId` (header
`x-watchparty-token`) comme pour ouvrir la socket (`auth.token` en Socket.IO v4,
`query.token` conservé pour les clients v3) :

- **`hostToken`** — renvoyé une seule fois par `POST /create`, à son créateur. Il
  désigne l'hôte : c'est son porteur qui devient `hostId` à la connexion, quel
  que soit son ordre d'arrivée.
- **token d'accès** — renvoyé par `POST /join` contre un code d'invitation
  valide. Donne le statut de membre, jamais celui d'hôte. Révoqué lors d'un kick.

Côté front, ces jetons sont conservés en `sessionStorage`
(`src/utils/watchparty.ts`) pour survivre à un rafraîchissement de page.

## Surface HTTP

| Route | Accès | Rôle |
| --- | --- | --- |
| `POST /api/watchparty/create` | public (10/min/IP) | Crée une room, renvoie `roomId`, `roomCode` et `hostToken` |
| `POST /api/watchparty/join` | public (30/min/IP) | Rejoint une room via code, renvoie un token d'accès |
| `GET /api/watchparty/room/:roomId` | token de room | Retourne l'état détaillé d'une room (dont les URLs de flux) |
| `GET /api/watchparty/info/:code` | public (10/s/IP) | Retourne les infos publiques d'une room via son code |
| `GET /api/watchparty/public` | public (10/s/IP) | Liste les rooms publiques |
| `GET /api/watchparty/all` | `x-admin-secret` (5/s/IP) | Liste toutes les rooms, privées incluses — désactivée si `WATCHPARTY_ADMIN_SECRET` est vide |

Le `roomCode` est généré par le serveur (CSPRNG) ; celui éventuellement envoyé
par le client est ignoré.

## Surface Socket.IO

Le namespace dédié aux rooms est `/watchparty`. Le namespace
`/watchparty-lobby` est ouvert sans token : il ne diffuse que la projection
publique des salons (`id`, code, titre, média, hôte, affiche, nombre de
participants) via `lobby:rooms`. Aucun secret ni URL de flux n'y transite.

Le client envoie `roomId`, `nickname` et `token` dans `auth` (Socket.IO v4).
Les versions précédentes utilisaient `query`, mais cette option est attachée au
manager partagé par origine : lorsqu'un lobby se connecte avant la room, le
second socket réutilise le manager sans les paramètres et est rejeté avec
`Invalid room ID`. Le serveur accepte désormais les deux canaux, `auth` ayant
la priorité.

Les familles d'événements à connaître :

- room : `room:info`, `room:participants`, `room:chat`, `room:chatToggled`, `room:close`, `room:setVisibility`, `room:setMaxParticipants`
- playback : `playback:update`, `playback:getState`, `playback:state`, `playback:schedule`, `playback:buffering`, `playback:ack` (`accepted`, `durable`, `code` : `STALE_SEQUENCE`, `INVALID_SEQUENCE`, `DUPLICATE_COMMAND`, `SUPERSEDED`, `PERSISTENCE_FAILED`)
- contrôle : `control:request`, `control:approve`, `control:deny`, `control:revoke`, `control:setMode`, `host:transfer`
- sync pro : `sync:setMode`, `sync:probe`, `sync:probeResult`
- collaboration : `ready:toggle`, `room:startCountdown`, `room:cancelCountdown`, `room:countdown`, `reaction:send`, `reaction:received`, `media:change`
- chat / modération : `chat:message` (avec `replyToId` optionnel), `message:delete`, `participant:kick`
- vote / pause : `pause:start`, `pause:cancel`, `pause:timerStarted`, `pause:timerFinished`, `vote:request`, `vote:cast`

## Persistance et cycle de vie

- les rooms sont gardées en mémoire dans un `Map` propre au processus. Le service
  est **mono-instance** : un verrou `.watchparty.lock` dans `WATCHPARTY_CACHE_DIR`
  refuse un second écrivain sur le même répertoire. Un PID étranger encore vivant
  est toujours refusé ; l'âge du verrou ne sert qu'à récupérer un verrou orphelin
  dont le PID n'existe plus (ou illisible). Ne partagez jamais ce répertoire entre
  deux processus, même avec des sticky sessions : la liste publique et les ACK ne
  sont pas fédérés entre instances.
- `WATCHPARTY_CACHE_DIR` (par défaut `API/watchpartyAPI/cache`) contient deux
  artefacts complémentaires :
  - `watchparty-rooms.json` : snapshot atomique (`rename` + fsync du fichier et
    du répertoire), versionné, avec `journalSeq` monotone ;
  - `watchparty-rooms.journal.ndjson` : deltas journalisés et fsyncés avant ACK.
    Les écritures sont sérialisées, la rotation est atomique, les anciens
    journaux `.processed.*` sont purgés au démarrage.
- **l'append journal fsyncé est le point de commit**, toujours **avant** toute
  écriture de snapshot. Si l'append échoue, aucun snapshot n'est écrit et la
  mutation n'est pas publiée. Si le snapshot demandé par la mutation ou la
  compaction qui suit échoue **après** l'append, la mutation reste valable :
  l'erreur est journalisée, une compaction ultérieure est reprogrammée et aucun
  `PERSISTENCE_FAILED` n'est renvoyé. Au redémarrage, les enregistrements déjà
  inclus dans le snapshot sont ignorés : pas de double application.
- les snapshots ne lisent jamais le `Map` de runtime, qui contient des états
  spéculatifs. Une copie « committed » par room est figée au moment de la
  mutation et publiée seulement après l'append réussi ; `journalSeq` du snapshot
  suit le dernier append commité. Ainsi, même une compaction déclenchée par une
  autre room ne peut pas figer une commande encore en attente de fsync.
- le journal ne contient ni token, ni URL de flux, ni paramètre de requête
  sensible. L'enregistrement `room-created` est construit à partir d'une liste
  blanche de métadonnées (identifiant, code, nom, dates, visibilité, syncMode,
  titre/métadonnées du média) : aucune clé `src`, `url`, `file`, `poster`,
  `token` ni `createdByIp` n'est journalisée, y compris dans les sources imbriquées.
  Les tokens stockés dans le snapshot sont des empreintes SHA-256, jamais les
  secrets.
- toute mutation de lecture passe par `enqueuePlaybackCommand` et par une file
  de persistance unique. Une commande durable n'est accusée (`playback:ack`)
  qu'après fsync du journal ; un échec **d'écriture** renvoie
  `PERSISTENCE_FAILED` et restaure l'état précédent. Une commande devenue
  périmée pendant l'écriture renvoie `SUPERSEDED`, sans `playback:state` ni
  `playback:schedule` périmé : un `media:change` reçu pendant le fsync d'un seek
  invalide immédiatement ce seek, même si son handler est encore en file.
  Le champ `durable` vaut `true` uniquement pour une mutation journalisée
  acceptée ; rejets et heartbeats sont accusés avec `durable: false` (champ
  optionnel, donc compatible avec les clients anciens).
- après **chaque** `await`, les handlers de contrôle revérifient la participation,
  la validité du token et le couple `seq`/`mediaEpoch` attendu
  (`assertStillAuthorized`). Un participant expulsé ou remplacé pendant la
  persistance ne peut donc ni muter ni diffuser ; l'état spéculatif est restauré.
- les clients anciens sans `seq` restent acceptés : le serveur attribue une
  séquence sûre, renvoie l'état corrigé à l'émetteur et diffuse
  `originCommandId`. `seq` doit rester un entier sûr dans la fenêtre autorisée ;
  les identifiants de commande sont dédupliqués via un objet sans prototype.
- au redémarrage, le replay suit `journalSeq` (pas `Date.now()`), puis les timers
  de pause, countdown et deadline de vote sont restaurés. Un countdown restauré
  est conservé lors de la première connexion et réémis au nouvel arrivant ; seul
  un countdown créé par un participant est annulé quand la liste des prêts change.
  Les identifiants de socket ne survivant pas, participants / hôte / co-hosts sont
  réinitialisés, mais les empreintes de tokens restent valides. Un vote ancien est
  résolu sans pouvoir être accepté sur d'anciens identifiants de socket.
- les fichiers du cache sont créés en `0700` (répertoire) / `0600` (fichiers)
  lorsque la plateforme le permet. Les droits d'un snapshot ou d'un journal
  préexistant sont renormalisés à chaque démarrage. Windows ne prend pas en
  charge le fsync d'un répertoire : la tentative est faite sans faire échouer
  l'écriture.
- la suppression d'une room (fermeture par l'hôte, inactivité, expiration) est
  journalisée et **attendue** avant le `room:closed` et le retrait du `Map` : une
  suppression non persistée laisse la salle en mémoire.
- limite résiduelle : les très anciens journaux sans `journalSeq` sont encore
  filtrés par `ts > savedAt` lors de la migration. Ils sont purgés juste après la
  restauration, mais un horloge système très décalée peut sauter un delta legacy.
- les rooms vides sont nettoyées après 5 minutes
- un cleanup périodique ferme aussi les rooms trop vieilles ou inactives
- l'historique de chat est plafonné à 100 messages, messages système compris

## Robustesse des événements Socket.IO

Socket.IO appelle les handlers dans un `process.nextTick` sans `try/catch` : une
exception synchrone y devient un `uncaughtException`. Tout handler doit donc
normaliser son payload (`const { x } = payload || {}`) — un `= {}` en paramètre
par défaut ne couvre pas `null`. Un garde-fou `process.on('uncaughtException')`
existe en dernier recours, mais ne doit pas servir de filet de routine.

## Frontend lié

Si tu touches la WatchParty, vérifie aussi :

- `src/pages/WatchPartyPage.tsx` (lobby, salle, création, visibilité, lecture VidRift et synchro)
- `src/config/runtime.ts` (`VITE_WATCHPARTY_API`, sans repli sur la Main API)
- `src/utils/watchparty.ts` (tokens de room)
- `src/utils/watchpartySync.ts`
- `src/utils/vidriftMessaging.ts` (origines strictes des `postMessage`)
- `src/components/VidRiftPlayer.tsx`
- `src/workers/watchpartySync.worker.ts`

Le lecteur VidRift est une iframe externe. Le parent n'envoie jamais de
`postMessage` avec `'*'` : l'origine cible est dérivée de l'iframe réelle puis
validée contre la liste des origines VidRift autorisées ; les messages entrants
sont acceptés seulement depuis cette frame et cette origine. Une URL d'embed
invalide ne monte pas d'iframe (`src=""`). Le chargement et les erreurs internes
du bundle VidRift restent hors du périmètre de ce service.

## Tests ciblés

```powershell
node --test API\watchpartyAPI\__tests__\watchpartySocket.test.mjs tests\watchpartyPublicRooms.test.mjs tests\watchpartyVidRiftMessaging.test.mjs
node --test tests\watchpartyPublicRooms.browser.mjs
```

Le second scénario lance un build Vite, un serveur WatchParty local et deux contextes Playwright. Il prouve qu'un second navigateur voit un salon public sans rechargement, qu'un salon privé reste invisible et que la fermeture par l'hôte retire le salon du lobby. Le rapport et la trace sont écrits dans `%TEMP%\opencode\watchparty-public-rooms-e2e`. Les secrets sont remplacés par `<redacted>` dans le rapport.
