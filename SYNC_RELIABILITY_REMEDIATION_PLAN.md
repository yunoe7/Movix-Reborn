# Plan de remédiation — Revue indépendante `fix/global-sync-reliability`

Ce document précède les modifications de code. Il recense les 30 constats de la revue indépendante finale, indique ce que les suites actuelles couvrent déjà, et définit les tests ciblés à écrire **avant** chaque correction. Les tests isolés ne remplacent pas les scénarios navigateur/E2E lorsque le rendu ou une interaction réelle est impliquée.

## État du checkout avant remédiation

- Branche : `fix/global-sync-reliability` (aucune création de branche, aucun push, aucune PR, aucun merge, aucun déploiement).
- Base initiale : `02483248`. Commits conservés : `ac945e2a`, `ae02bee1`, `b35ab4df`.
- HEAD avant remédiation : `b35ab4df`.
- `git status --short` vide avant remédiation.
- Baseline réellement exécutée :
  - `node --test API/watchpartyAPI/__tests__/watchpartySocket.test.mjs tests/watchparty*.test.mjs` → **69/69 réussis**.
  - `node --test tests/syncOutboxReplay.test.mjs tests/syncProfileIsolation.test.mjs tests/syncPolicyContract.test.mjs tests/wrappedSessionReliability.test.mjs tests/wrappedTracker.test.ts tests/historyProfileScope.test.mjs tests/vipCacheReliability.test.mjs tests/mobileExtractionPrefs.test.mjs tests/userscriptSyncAlignment.test.mjs` → **43/43 réussis**.
  - `npx tsc --noEmit -p tsconfig.json` → réussi.

Modes de défaillance déjà identifiés dans la revue et échappant aux suites existantes : crash entre fsync et rename, recul d’horloge, commandes concurrentes, changement de média pendant un `seek` asynchrone, double hôte, expulsion avec commande en vol, perte d’intention utilisateur pendant une suppression distante, lots d’outbox mixtes, logout pendant un flush, Wrapped réattribué au retry, préférences natives non vues par le userscript déjà chargé.

## Matrice des constats et tests à ajouter avant correction

| # | Gravité | Lot | Constats | Couverture existante insuffisante | Test ciblé à écrire avant correction |
| --- | --- | --- | --- | --- | --- |
| 1 | critique | WP serveur | `fsync` de fichier sans `fsync` du répertoire après `rename`/`unlink` | `watchpartyPersistence.test.mjs` vérifie seulement la sérialisation | `tests/watchpartyDurability.test.mjs` : crash simulé entre fsync et rename, puis restauration |
| 2 | haute | WP serveur | `Date.now()` comme ordre logique du journal | Aucun test avec horloge reculante | `tests/watchpartyDurability.test.mjs` : `journalSeq` monotone, horloge reculante, tri logique |
| 3 | haute | WP serveur | Mutations autoritaires non journalisées, timers non restaurés | `watchpartySocket.test.mjs` teste le nominal | `tests/watchpartyDurability.test.mjs` : média, countdown, pause auto, vote, redémarrage |
| 4 | haute | WP serveur/cours | Course `playback:update` / `media:change` | Test nominal du changement de média seulement | `tests/watchpartyDurability.test.mjs` : seek en attente + media:change → `SUPERSEDED`, aucun schedule ancien |
| 5 | haute | WP serveur | Deux écrivains sur le même cache en multi-instance | Aucun test multi-instance réel | Test de garde mono-instance : refus de deux instances sur un même `WATCHPARTY_CACHE_DIR`, documentation explicite |
| 6 | haute | WP serveur | Tokens/URLs en clair dans le journal | Aucun contrôle de permissions ni de contenu | `tests/watchpartyDurability.test.mjs` : mode `0o700`/`0o600`, absence de tokens dans le journal |
| 7 | moyenne | WP serveur | ACK `accepted` malgré échec de persistance | Aucun test disque plein | `tests/watchpartyDurability.test.mjs` : `ENOSPC` → `PERSISTENCE_FAILED` |
| 8 | moyenne | WP serveur/client | Tempête de fsync sur heartbeats | Heartbeat testé fonctionnellement seulement | `tests/watchpartyDurability.test.mjs` : comptage des appels de persistance pour heartbeat vs transitions |
| 9 | moyenne | WP serveur | Double hôte et kick avec commande en vol | Reconnexion nominale seulement | `tests/watchpartyDurability.test.mjs` + socket : double token, participant expulsé |
| 10 | moyenne | WP serveur | `.processed` orphelin après crash | Aucun test de rotation interrompue | `tests/watchpartyDurability.test.mjs` : orphelin au démarrage, rotation suivante réussie |
| 11 | moyenne | WP serveur/client | Anciens clients sans ACK/seq non realignés | Compatibilité clients non ACK partiellement couverte | `tests/watchpartyClientIntent.test.mjs` : client legacy sans ACK reçoit un état corrigé |
| 12 | faible | WP serveur | `seq` non borné, dédup prototype | Aucun test | `tests/watchpartyDurability.test.mjs` : `MAX_SAFE_INTEGER` rejeté, `commandId='__proto__'` traité comme normal |
| 13 | haute | WP client | `STALE_SEQUENCE` perd l’intention utilisateur | ACK testé côté serveur seulement | `tests/watchpartyClientIntent.test.mjs` : retry sûr avec `commandId` logique stable |
| 14 | haute | WP client | Clic local ignoré pendant suppression distante | Fenêtres de suppression testées, pas l’intention utilisateur | `tests/watchpartyClientIntent.test.mjs` : intention mise en file puis rejouée si divergente |
| 15 | moyenne | WP client | `seq: 0` envoyé quand inconnu | Buffering nominal testé | `tests/watchpartyClientIntent.test.mjs` : buffering sans séquence connue |
| 16 | moyenne | WP client | État React du sender non réconcilié sur ACK | Ref autoritaire testée, pas `room.playbackState` | `tests/watchpartyClientIntent.test.mjs` : ACK applique aussi l’état React |
| 17 | faible | WP client | Déduplication Pro trop agressive sans `seq`/`mediaEpoch` | `watchpartySyncProEngine.test.mjs` nominal seulement | `tests/watchpartyClientIntent.test.mjs` : deux schedules legacy distincts non dédupliqués |
| 18 | haute | Outbox | Double outbox legacy + scopée rejouée deux fois | `syncOutboxReplay.test.mjs` couvre le replay simple | `tests/syncOwnerMigration.test.mjs` : migration one-shot puis suppression de la copie legacy |
| 19 | haute | Outbox | Lot mixte P1/P2 réattribué au premier propriétaire | Isolation de base testée, pas un lot mixte | `tests/syncOwnerMigration.test.mjs` : P1 puis P2 dans le même compte |
| 20 | haute | Outbox | `auth_changed` vide les files après flush avorté | Flush de déconnexion nominal testé | `tests/syncOwnerMigration.test.mjs` : logout/login pendant flush |
| 21 | moyenne | Outbox | Persistance refusée si token change pendant la requête | Non couvert | `tests/syncOwnerMigration.test.mjs` : token T1 → T2 en vol |
| 22 | moyenne | API sync | Rejets permanents conservés avec `ts` réinitialisé | Rejets partiels testés, pas TTL | `tests/syncOwnerMigration.test.mjs` : `createdAt` vs `lastAttemptAt`, éviction 4xx |
| 23 | haute | Wrapped | Secondes différées réattribuées au profil courant | `wrappedTracker.test.ts` couvre le changement de cible, pas de compte | `tests/wrappedDeferredOwnership.test.mjs` : P1→P2, logout, reconnexion autre compte, borne/TTL/dédup |
| 24 | moyenne | VIP | `is_vip` renvoie `200 + partial` ambigu pour anciens clients | Contrat d’allowlist testé, pas la réponse | `tests/syncPolicyContract.test.mjs` : réponse explicite `rejected`, doc du contrat |
| 25 | faible | Outbox | Ancienne outbox sans `userId` jamais évincée | `syncOutboxReplay` vérifie l’absence de replay, pas l’éviction | `tests/syncOwnerMigration.test.mjs` : TTL appliqué avant `continue` |
| 26 | haute | Mobile | Poussée native invisible pour le userscript chargé | `mobileExtractionPrefs.test.mjs` couvre `GM_getValue`, pas le script monté | `tests/mobileGmBridge.test.mjs` : événement de changement reçu sans reload |
| 27 | haute | Mobile | Refs WebView enregistrées seulement au premier message | Non couvert | `tests/mobileGmBridge.test.mjs` : WebView montée avant tout message, puis poussée |
| 28 | moyenne | Mobile | `GM_deleteValue` laisse une valeur fantôme | Non couvert | `tests/mobileGmBridge.test.mjs` : suppression sur les trois copies |
| 29 | moyenne | Mobile | AsyncStorage non awaité, reset et valeurs corrompues | Test de poussée nominal seulement | `tests/mobileGmBridge.test.mjs` : erreur d’écriture, reset, normalisation |
| 30 | faible | TV/userscript | Alignement partiel, `--check` confond source absente et dérive | `userscriptSyncAlignment.test.mjs` partiel | `tests/userscriptSyncAlignment.test.mjs` étendu + `tests/mobileGmBridge.test.mjs` : distinction `ENOENT`, TV `1.7.3` conservée |

## Décisions d’architecture à ne pas inventer

- WatchParty reste mono-instance pour la durabilité. Aucun Redis, MySQL, Durable Object ni adaptateur Socket.IO distribué n’est introduit. Le serveur doit refuser explicitement deux instances partageant le même `WATCHPARTY_CACHE_DIR` plutôt que de prétendre les fédérer.
- `access_code` reste une clé synchronisable ; le modèle produit global par appareil ou par profil n’est pas tranché ici. `is_vip` reste sous autorité serveur et n’est jamais writable depuis le client.
- La copie TV du userscript reste volontairement épinglée en `1.7.3`. Aucune régénération de cette copie n’est effectuée sans décision explicite.
- AsyncStorage reste la source de vérité persistante des préférences natives ; la WebView reçoit une copie normalisée après confirmation de l’écriture.

## Tests E2E et artefacts

Le scénario navigateur existant `node tests/syncReliability.browser.mjs` reste la référence E2E pour l’isolation des profils et le contrat VIP. Il sera relancé si les modifications touchent les chemins qu’il exerce, avec artefacts reproductibles dans `<workspace>/../movix-artifacts/sync-reliability`. Aucun test ne sera présenté comme réussi s’il n’a pas été réellement exécuté.
