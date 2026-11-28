# Plan de fiabilisation et de test de la synchronisation

Ce document précède les modifications de code. Il recense les modes de défaillance identifiés, ceux que les suites actuelles couvrent déjà, et les tests à ajouter avant chaque correction. Les tests isolés ne remplacent pas les scénarios navigateur/E2E lorsqu'un rendu ou une interaction réelle est impliquée.

## État du checkout

- Branche : `fix/global-sync-reliability`, créée depuis `origin/main` après récupération.
- Base : `02483248656e05acfe1394418a7c265a6e3eafbc`.
- Aucune modification de `main`, aucun push, aucune PR, aucun merge et aucun déploiement.
- Baseline exécutée avant modification :
  - WatchParty : `node --test API/watchpartyAPI/__tests__/watchpartySocket.test.mjs tests/watchparty*.test.mjs` → **56/56 réussis**.
  - Sync/historique/préférences : échecs préexistants dans `API/Mainapi/routes/__tests__/syncPerformance.test.js` (le contexte VM ne fournit pas `process.env`) et `tests/storageCrashRegression.test.ts` (callback `fetchLogos` introuvable). Ces échecs sont antérieurs à ce lot et doivent être distingués des régressions.
  - Typecheck TypeScript : réussi (`npx tsc --noEmit -p tsconfig.json`).
  - Lint : 972 problèmes préexistants (666 erreurs, 306 avertissements). Aucune nouvelle erreur ne doit être introduite.

## Lot API sync déjà corrigé

- Commit `ac945e2a` sur `fix/global-sync-reliability` (aucun push).
- Contrat de clés unique dans `shared/syncKeys.json`, partagé par `API/Mainapi/utils/syncPolicy.js` et `src/utils/syncStorage.ts` ; `movixCalendarEntries` et `favorite_movies` sont synchronisables des deux côtés, `is_vip` n'est plus une clé writable.
- `/api/sync` applique désormais les opérations valides d'un lot même si d'autres sont refusées ; la réponse contient `partial: true` et `rejected[{index, code, message, status}]` uniquement en cas de rejet individuel. Les erreurs globales (`INVALID_OPS`, `TOO_MANY_OPS`) restent bloquantes.
- L'outbox du navigateur ne conserve que les opérations réellement rejetées ; l'identité du profil est capturée à l'enqueue, vérifiée avant envoi et préservée en cas de changement de profil concurrent.
- Invalidation du cache des listes partagées déplacée avant le retour de `writeLockedProfileSnapshot` ; cache VIP purgé pour l'ancienne et la nouvelle `access_code`.
- Tests réellement exécutés après correction : `21/21` (`syncPolicyContract`, `syncOutboxReplay`, `syncPolicyPartial`, `syncPerformance`), `20/20` (`syncHistoryMirror`), typecheck TypeScript réussi. Le fixture VM de `syncHistoryMirror.test.js` a reçu le même `process.env` que celui déjà corrigé dans `syncPerformance.test.js`.

## Lot WatchParty corrigé (en attente de commit)

- Persistance : `API/watchpartyAPI/watchparty.js` écrit désormais un snapshot JSON atomique (`*.tmp` + `fsync` + `rename`) et un journal NDJSON fsyncé par mutation. Le journal est rejoué après le snapshot au démarrage ; les suppressions de salle sont journalisées. Les identifiants de socket sont neutralisés à la restauration, les `Set` de tokens sont reconstruits et les timers sont purgés avant sérialisation.
- Commandes de lecture : séquence serveur, `commandId`, accusé `playback:ack`, arbitration par file par salle, rejet des doublons et des séquences anciennes. L'accusé n'est envoyé qu'après fsync. `ended` force toujours `isPlaying: false`. `media:change` incrémente `mediaEpoch`, émet `playback:scheduleCancelled` et réinitialise le moteur côté client.
- Interactions : dénominateur de vote recalculé après départ/kick, `room:closed` conserve la forme `{ reason }`, taille minimale d'un salon portée à 2, approbation d'une demande de contrôle inexistante refusée, buffering horodaté avec séquence/époque.
- Frontend : le lecteur direct émet `ended` et `playback:buffering` (`onWaiting`/`onPlaying`) ; `sendPlayback` joindre `commandId`/`seq` ; `resetPlaybackEngine` purge snapshot, position VidRift et file du worker ; le worker ignore les schedules d'une époque antérieure et les dédup par séquence/époque.
- Limite conservée : cohérence multi-instance non implémentée ; pas de Redis, MySQL ni Durable Object introduit dans `API/watchpartyAPI`.

Tests réellement exécutés après correction (artefact reproductible) :

```powershell
npx tsc --noEmit -p tsconfig.json
node --test tests/watchparty*.test.mjs API/watchpartyAPI/__tests__/watchpartySocket.test.mjs
```

Résultat : typecheck réussi ; **69/69 tests WatchParty réussis**, dont 5 nouveaux scénarios de crash/arbitrage/`ended`/changement de média/annulation Pro et 3 scénarios client (fin de lecture, buffering, purge du worker). Avant correction, les 4 nouveaux tests socket échouaient comme prévu ; le test de purge Pro échouait également. Aucun secret ni artefact de cache n'est inclus dans le commit.

## Modes de défaillance identifiés

### WatchParty – persistance et redémarrage

1. Snapshot JSON non atomique lu puis supprimé au démarrage : un crash pendant l'écriture ou avant la suppression peut perdre le dernier état.
2. Aucune écriture incrémentale : les changements entre deux snapshots sont perdus.
3. Timers sérialisés puis restaurés comme des objets morts ou au contraire exclus sans reconstitution depuis les échéances absolues.
4. Redémarrage avec participants dont les `socket.id` n'existent plus ; risque de salon fantôme ou d'impossibilité pour l'hôte de récupérer son rôle.
5. Plusieurs instances du serveur : `Map` locale et absence d'adaptateur Socket.IO distribué. Le multi-instance fiable n'est pas implémenté et ne doit pas être annoncé comme tel.

### WatchParty – cohérence de lecture

6. `last-write-wins` sans séquence ni accusé : une commande lente ou désordonnée peut remplacer une commande plus récente.
7. L'émetteur d'une commande peut recevoir et réappliquer sa propre commande, provoquant des oscillations.
8. `ended` et `buffering` ne sont pas émis par le lecteur direct, alors que VidRift émet `ended`.
9. Un changement de média ne purge pas systématiquement les schedules `playback:schedule` en attente.
10. Worker JS et moteur WASM peuvent diverger sur l'annulation des schedules et le recalage d'horloge.

### WatchParty – reconnexion et interactions

11. Refresh : conservation du rôle hôte, des tokens et de la liste des participants non vérifiée après remplacement du `socket.id`.
12. Transfert d'hôte, kick et expiration de room peuvent laisser des timers, tokens ou listeners actifs.
13. Dénominateur de vote et état « prêt » doivent être recalculés à partir des participants réellement présents.

### Comptes, profils et API de synchronisation

14. Allowlists divergentes : `movixCalendarEntries` côté frontend seulement, `favorite_movies` côté backend seulement, `is_vip` synchronisé alors que le flag doit rester sous autorité serveur.
15. Un lot contenant une clé invalide est rejeté globalement ; les opérations valides sont perdues et l'outbox est vidée.
16. Invalidation du cache des listes partagées inatteignable depuis `/api/sync`.
17. Identité de profil incohérente entre `selected_profile_id` global et identité scopée utilisée par le fournisseur de contexte.
18. CRUD concurrents de profils et sync concurrente peuvent écraser des données sans verrou ou avec un verrou mal partagé.

### Favoris, historique, progression, VIP et Wrapped

19. `historyService` et le suivi Wrapped lisent une identité de profil globale au lieu de l'identité scopée.
20. Activité Wrapped potentiellement perdue si l'envoi échoue, ou comptée deux fois en cas de reconnexion.
21. Statut VIP restauré depuis un ancien `localStorage` ou conservé trop longtemps en cache après révocation serveur.
22. Progression après fermeture brutale limitée aux seules données réellement envoyées au serveur.

### Préférences, mobile, TV et extensions

23. Outbox, debounce, `BroadcastChannel` et polling de secours peuvent perdre des écritures lors d'un changement de profil ou d'un conflit entre onglets.
24. Le bridge WebView mobile stocke certaines préférences en mémoire ; elles disparaissent au redémarrage.
25. URLs API, miroirs et Service Worker peuvent réintroduire d'anciens domaines ou des réponses périmées.
26. Les extensions Chrome/Firefox et le userscript doivent rester alignés sans casser l'extraction.

## Couverture actuelle et tests à ajouter avant correction

| Lot | Tests existants utiles | Lacunes à combler avant correction |
| --- | --- | --- |
| Persistance WatchParty | `tests/watchpartyPersistence.test.mjs`, `API/watchpartyAPI/__tests__/watchpartySocket.test.mjs` | Crash simulé pendant écriture, rejeu journal après snapshot, restauration des timers et récupération hôte après redémarrage réel du processus. |
| Lecture WatchParty | `tests/watchpartySyncReliability.test.mjs`, `tests/watchpartySyncProEngine.test.mjs`, `tests/watchpartyVidRiftMessaging.test.mjs` | Deux/trois participants branchés au vrai serveur, commandes concurrentes, événements désordonnés, `ended`, `buffering`, changement de média avec schedule en attente, accusés. |
| Reconnexion/interactions | Tests socket existants (rôle hôte, kick, vote, média) | Refresh avec changement de `socket.id`, déconnexion réseau puis retour, transfert d'hôte et fermeture, nettoyage des listeners/timers. |
| API sync/profils | `API/Mainapi/routes/__tests__/syncPerformance.test.js`, `syncHistoryMirror.test.js` | Clés invalides traitées individuellement, ops conservées, cache invalidé, VIP non synchronisable, isolation entre deux profils/utilisateurs. Corriger le fixture VM préexistant. |
| Historique/VIP/Wrapped | `tests/historyService.test.ts`, `tests/wrappedTracker.test.ts`, `tests/wrappedService.test.ts`, routes dédiées | Profil scopé, activité persistée avant envoi, absence de double comptage, révocation VIP effective. |
| Préférences/plateformes | `tests/storageSyncPatch.test.ts`, `tests/storageFallback.test.mjs`, tests extension/userscript | Changement de profil entre onglets, redémarrage WebView, clés manquantes et alignement des trois variantes d'extension. |

## Limites d'infrastructure

- MySQL existe dans `API/Mainapi` et reste la source fiable des données de compte ; le serveur WatchParty n'a pas de dépendance MySQL et n'a pas été autorisé à en introduire une.
- Redis est présent dans `API/Mainapi` pour verrous et limitations, mais aucun adaptateur Socket.IO distribué n'est installé dans `API/watchpartyAPI`.
- Aucun Durable Object ni service externe n'est configuré pour WatchParty.
- En conséquence, le correctif local garantit la durabilité sur une instance et documente explicitement que la cohérence multi-instance reste non implémentée. Aucun test ne doit prétendre valider un scénario multi-instance réel.

## Lot comptes, profils, historique, Wrapped, VIP et plateformes corrigé

Tous les tests ci-dessous ont été écrits et vus rouges avant correction, puis relancés en vert.

- Propriétaire capturé à l'écriture dans `src/App.tsx` (`pendingDiffs`, `progressOpsMapRef`, `enqueueGeneralOp`) : un changement de profil ou de compte avant le `pagehide` ne réattribue plus une écriture au profil courant. Le `flush` partitionne les opérations par propriétaire, écrit des outboxes séparées (`__movix_sync_outbox:<type>:<userId>:<profileId>`) et ne POSTe que les groupes du compte authentifié.
- `handleAuthChanged` draine les écritures en attente avant de refermer le gate ; le nettoyage d'isolation de `ProfileContext` passe par `runProfileIsolationWipe()` (`src/utils/profileIsolation.ts`) et ne génère aucun `remove` synchronisé.
- `replayOutboxIfAny` parcourt les outboxes scopées, exige le triplet complet `userType`/`userId`/`profileId`, ignore les files incomplètes et conserve l'outbox sur un refus d'appartenance (403/404 profil) au lieu de la détruire.
- `historyService` et `readWrappedSession` (`src/utils/wrappedSession.ts`) lisent la sélection account-scopée ; la clé globale `selected_profile_id` n'est plus utilisée quand un compte est résolu. Le tracker Wrapped n'acquitte pas un 403 d'appartenance et retente les secondes dont la cible a changé pendant un envoi (`src/utils/wrappedTrackerCore.ts`).
- Le cache VIP (`src/utils/vipUtils.ts`) est indexé par `access_code`, y compris les promesses en vol : changer de clé force une nouvelle vérification serveur et ne rejoue pas le verdict de l'ancienne clé.
- Les préférences d'extraction native sont poussées dans la WebView (`pushGmValueToWebViews`) et lues par `GM_getValue` depuis le snapshot natif : plus de redémarrage nécessaire. La copie du userscript embarquée dans l'app TV reste volontairement épinglée en `1.7.3` (commit `24770213`) ; l'invariant vérifié est la parité des handlers `SET_EXTRACTION_PREFS`/`DEFAULT_EXTRACTION_PREFS` et la présence du correctif `gk`, pas l'égalité des versions.

Tests isolés réellement exécutés après correction :

```powershell
node --test tests/syncOutboxReplay.test.mjs tests/syncProfileIsolation.test.mjs
node --test tests/wrappedSessionReliability.test.mjs tests/wrappedTracker.test.ts tests/historyProfileScope.test.mjs tests/historyService.test.ts
node --test tests/mobileExtractionPrefs.test.mjs tests/vipCacheReliability.test.mjs tests/userscriptSyncAlignment.test.mjs
npx tsc --noEmit -p tsconfig.json
```

Résultats : **13/13** (outbox/isolation : `syncOutboxReplay` 6/6 et `syncProfileIsolation` 7/7), **5/5** (session Wrapped), **12/12** (tracker Wrapped), **2/2** (profil historique), **38/38** (`historyService.test.ts`), **2/2** (préférences mobiles), **3/3** (cache VIP), **3/3** (alignement userscript TV), typecheck racine réussi. La suite large (`906` tests Node du dépôt plus les tests WatchParty et sync API) donne **885 réussis / 21 échecs préexistants** dans des modules non touchés (hlsCasting, playerCrashRegression, pushNotificationDomain, rememberLastPlayer, safeEmbedUrl, storageCrashRegression, subtitlePreferences, subtitleProviders, subtitleTranslate, tvRouteScope, tvScope). Aucune de ces zones n'a été modifiée par ce lot.

## E2E navigateur avec artefact reproductible

Commande de relance (prérequis : Chrome, `playwright-core` installé localement sans modifier `package.json`, Vite) :

```powershell
node tests/syncReliability.browser.mjs
```

Le script construit le vrai bundle SPA avec `VITE_MAIN_API` local, sert une API factice et pilote Chrome. Données factices : compte `oauth` `user-e2e`, profils `profile-a`/`profile-b`, clés VIP `KEY-VALID`/`KEY-INVALID`. Aucun secret n'est écrit dans le rapport (en-têtes et jetons rognés). Artefacts par défaut dans `<workspace>/../movix-artifacts/sync-reliability` (ou `SYNC_E2E_ARTIFACT_DIR`) : `report.json`, `trace.zip`, `build.log`, captures `01-owner-flush.png`, `02-vip-key-change.png`, `final.png`.

Résultats attendus et observés :

- `GET /api/history/continue` porte `profileId=profile-a` (sélection account-scopée) → observé sur les deux requêtes.
- `POST /api/sync` après changement du profil courant en `profile-b` porte `profileId=profile-a` pour `favorite_movies`, et l'outbox scopée `...:profile-a` est conservée → observé.
- Aucune opération `is_vip` n'est envoyée au serveur → observé.
- La vérification VIP passe de `KEY-VALID` à `KEY-INVALID` et révoque `is_vip` → observé ; des requêtes `GET /api/check-vip` portant successivement les deux en-têtes distincts.
- Aucune exception JavaScript de page → `pageErrors=[]` ; les erreurs console restantes proviennent des appels TMDB externes non stubés par la fixture.

## Contrôles statiques complémentaires

- `npx tsc --noEmit -p tsconfig.json` : réussi.
- ESLint ciblé sur tous les fichiers modifiés et nouveaux, comparé aux mêmes fichiers lus dans `HEAD` via `eslint --stdin --stdin-filename` : **aucune erreur ni aucun avertissement supplémentaire** (`+0 / +0`). Les erreurs `no-explicit-any` ajoutées puis corrigées concernaient un paramètre de callback dans `src/App.tsx` et la valeur poussée dans `app/src/services/bridge.ts` (désormais `unknown`).
- `npx tsc --noEmit -p app/tsconfig.json` : 53 lignes d'erreurs restantes, toutes dans des zones préexistantes (modules React Native absents de ce checkout et `any` implicites historiques). Les trois erreurs temporairement introduites dans `SettingsScreen.tsx` et `bridge.ts` ont été corrigées et ne figurent plus dans la sortie. La racine ne dépend pas de ces types pour le bundle web.
- `node app/scripts/build-userscript.js --check` : échec sur une dérive préexistante entre `userscript/movix.user.js` et `app/src/injection/userscript-source.ts`. Les deux fichiers sont inchangés dans ce lot ; aucune régénération sans rapport n'a été effectuée.

## Risques et limites documentés

- `access_code` reste une clé synchronisable dans le contrat actuel : le modèle produit (clé globale par appareil ou clé par profil) n'a pas été tranché. Ce lot ne modifie pas ce choix et ne retire pas `is_vip` pendant l'hydratation.
- La cohérence WatchParty multi-instance reste non implémentée (aucun adaptateur Socket.IO distribué autorisé).
- La copie TV du userscript n'est pas régénérée : seule la parité des comportements liés à la synchronisation est garantie ; les correctifs d'extraction propres à `1.7.9` ne sont pas reportés.
- Le module `playwright-core` est une dépendance locale d'exécution du script E2E, volontairement absente de `package.json` et du lockfile.
