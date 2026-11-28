# Rapport de livraison — remédiation `fix/global-sync-reliability`

## Verdict

**Prêt pour PR** : aucune constatation critique ou haute n’est restée ouverte après la revue finale et sa passe de confirmation. **Aucun push, aucune PR, aucun merge, aucun déploiement, aucune modification de `main`** n’a été effectué. Aucun serveur de développement ni panneau navigateur n’a été ouvert.

- Branche : `fix/global-sync-reliability`
- Base conservée : `b35ab4df` (ainsi que `ac945e2a`, `ae02bee1`)
- Arbre de travail propre après les commits.

## Commits locaux

| Commit | Portée |
| --- | --- |
| `14270bc5` | Plan de remédiation et matrice des 30 modes de défaillance |
| `737fc5e3` | WatchParty serveur : durabilité, `journalSeq`, arbitrage, verrou mono-instance, ACK |
| `7847fe2e` | WatchParty client : intentions, retry `STALE_SEQUENCE`, ACK, dédup Pro |
| `4e007dab` | Sync/outbox/profils/Wrapped/VIP : isolation, migration, TTL, propriétaire capturé |
| `4ffc1bec` | Mobile/WebView/userscript/TV : bridge GM, snapshot, suppression, alignement |

Le présent rapport est ajouté dans un dernier commit documentaire.

## Tests réellement exécutés

Baseline avant remédiation : WatchParty **69/69**, lot sync/mobile/Wrapped/VIP **43/43**. Après remédiation :

| Commande | Résultat |
| --- | --- |
| `node --test API/watchpartyAPI/__tests__/watchpartySocket.test.mjs tests/watchparty*.test.mjs` | **104/104** |
| `node --test tests/syncOutboxReplay.test.mjs tests/syncProfileIsolation.test.mjs tests/syncPolicyContract.test.mjs tests/wrappedSessionReliability.test.mjs tests/wrappedTracker.test.ts tests/historyProfileScope.test.mjs tests/vipCacheReliability.test.mjs tests/mobileExtractionPrefs.test.mjs tests/userscriptSyncAlignment.test.mjs tests/syncOwnerMigration.test.mjs tests/wrappedDeferredOwnership.test.mjs tests/mobileGmBridge.test.mjs API/Mainapi/utils/__tests__/syncPolicyPartial.test.js API/Mainapi/routes/__tests__/syncPerformance.test.js` | **96/96** |
| `node --test app/tests/*.mjs` | **160 tests, 158 réussis, 2 échecs préexistants** |
| `npx tsc --noEmit --incremental false -p tsconfig.app.json` | 233 erreurs préexistantes dans 63 fichiers ; **0 erreur nouvelle** dans les fichiers modifiés, sauf `WatchPartyPage.tsx:595` (`TS6133`, préexistant) |
| `npx tsc --noEmit -p tsconfig.json` | réussi (conteneur `files: []`, non probant pour le frontend) |
| `node --check` sur `watchparty.js`, `routes/sync.js`, `utils/syncPolicy.js` | réussi |
| `node app/scripts/build-userscript.js --check` | réussi, userscript 245,7 Ko |
| `git diff --check` | propre |

Les 2 échecs `app/tests` préexistants concernent des helpers absents de `HLSPlayer.tsx` et `app/node_modules/react-native-webview/src/WebViewShared.tsx` manquant dans l’environnement. Aucun E2E navigateur n’a été relancé pendant cette remédiation ; aucun artefact E2E nouveau n’est donc présenté comme réussi.

## État des 30 constats

| # | État | Note |
| --- | --- | --- |
| 1 | Corrigé | `fsync` fichier puis `rename` puis `syncDirectory` ; rotation atomique ; orphelins `.processed` purgés. |
| 2 | Corrigé | `journalSeq` monotone, replay logique ; `ts` uniquement diagnostic. Limite legacy documentée. |
| 3 | Corrigé pour la lecture, partiel pour le social | Timers, média, votes, countdown journalisés ; chat/visibilité/rôles restent volatils après crash brutal. |
| 4 | Corrigé | File sérialisée par room, `SUPERSEDED`, `media:change` invalide synchronement le seek en vol. |
| 5 | Corrigé | Verrou `wx` + PID, refus d’un second processus, mode mono-instance documenté. |
| 6 | Corrigé | `0700`/`0600`, tokens hashés, liste blanche du journal sans URL/IP/token imbriqués. |
| 7 | Corrigé | Append fsyncé comme point de commit ; `PERSISTENCE_FAILED` sur échec d’append ; heartbeat `durable:false`. |
| 8 | Corrigé | Aucune écriture journal pour les heartbeats ; ACK distingus par `durable`. |
| 9 | Corrigé | Migration d’hôte explicite, garde post-`await` sur les 7 handlers de contrôle, kick avec révocation. |
| 10 | Corrigé | Rotation `.processed.<pid>.<uuid>` et nettoyage au démarrage. |
| 11 | Corrigé | Clients legacy sans ACK/seq : serveur attribue la séquence et renvoie l’état corrigé. |
| 12 | Corrigé | `Number.isSafeInteger`, fenêtre de séquence, dédup prototype-safe. |
| 13 | Corrigé | `commandId` stable, retry `STALE_SEQUENCE` corrélé et one-shot, TTL 5 s. |
| 14 | Corrigé | Intentions utilisateur mises en file pendant la fenêtre distante et rejouées si la cible n’est pas atteinte. |
| 15 | Corrigé | Aucun `seq: 0` émis quand la séquence est inconnue ; réception legacy tolérée. |
| 16 | Corrigé | ACK réconcilie `room.playbackState` avec garde de fraîcheur `seq`/`updatedAt`. |
| 17 | Corrigé | Dédup Pro conditionnée à `seq`/`mediaEpoch`/`commandId`/`serverNow` ; repli WASM→JS conservé. |
| 18 | Corrigé | Outbox `v:2` scopée ; migration legacy one-shot puis suppression de la copie historique. |
| 19 | Corrigé | Regroupement par `__owner` dans tous les chemins de flush, y compris les lots mixtes. |
| 20 | Corrigé | Drain persistant avant mutation d’auth via `authDrainRef`, testé sans injection locale. |
| 21 | Corrigé | Propriétaire capturé à l’écriture, persistance autorisée même si le token change en vol. |
| 22 | Corrigé | Rejets permanents centralisés ; `createdAt` stable, `lastAttemptAt` rafraîchi, TTL 7 jours et cap. |
| 23 | Corrigé | Identité Wrapped capturée au cumul ; file différée TTL/cap/dédup ; 401 retryable, 403 permanent. |
| 24 | Corrigé | `is_vip` reste `serverManaged` ; code historique conservé avec marqueur additif et doc du contrat. |
| 25 | Corrigé | TTL appliqué avant le `continue` pour les anciennes outboxes sans `userId`. |
| 26 | Corrigé | `movix:gm-value-changed` exécuté par le userscript, configuration mise à jour sans reload. |
| 27 | Corrigé | Refs WebView enregistrées au montage ; snapshot natif injecté au document-start et abonné aux changements. |
| 28 | Corrigé | `GM_deleteValue` nettoie cache, `localStorage`, snapshot natif, carte native et AsyncStorage. |
| 29 | Corrigé | AsyncStorage source de vérité, écriture confirmée avant push, normalisation et reset fiables. |
| 30 | Corrigé | Alignement TV et userscript renforcé ; `--check` distingue absence (`2`), dérive (`1`), conformité (`0`). |

## Fichiers modifiés

- **WatchParty serveur** : `API/watchpartyAPI/watchparty.js`, `API/watchpartyAPI/README.md`, `API/watchpartyAPI/__tests__/watchpartySocket.test.mjs`, `tests/watchpartyDurability.test.mjs`, `.gitignore`.
- **WatchParty client** : `src/pages/WatchPartyPage.tsx`, `src/workers/watchpartySync.worker.ts`, `src/utils/watchparty.ts`, `tests/watchpartyClientIntent.test.mjs`, `tests/watchpartyClientReliability.test.mjs`, `tests/watchpartySyncProEngine.test.mjs`, `tests/watchpartySyncReliability.test.mjs`.
- **Sync/profils/Wrapped/VIP** : `src/App.tsx`, `src/context/ProfileContext.tsx`, `src/utils/syncStorage.ts`, `src/utils/wrappedTrackerCore.ts`, `src/hooks/useWrappedTracker.ts`, `API/Mainapi/routes/sync.js`, `API/Mainapi/utils/syncPolicy.js`, `API/Mainapi/README.md`, `tests/sync*.test.mjs`, `tests/wrapped*.test.mjs`.
- **Mobile/userscript/TV** : `app/src/services/bridge.ts`, `app/src/injection/bridge-runtime.ts`, `app/src/screens/SettingsScreen.tsx`, `app/src/components/WebViewBrowser.tsx`, `src/utils/resetAllSettings.ts`, `app/scripts/build-userscript.js`, `userscript/movix.user.js`, `userscript/README.md`, `app/README.md`, `tests/mobile*.test.mjs`, `tests/userscriptSyncAlignment.test.mjs`.
- **Documentation** : `SYNC_RELIABILITY_REMEDIATION_PLAN.md`, `SYNC_RELIABILITY_REMEDIATION_REPORT.md`.

`app/src/injection/userscript-source.ts` est régénéré via `node app/scripts/build-userscript.js` et reste gitignoré.

## Régression et décisions d’architecture

- Aucune régression fonctionnelle détectée dans les suites exécutées ; les échecs et erreurs TypeScript restants sont préexistants et explicitement identifiés.
- WatchParty reste **mono-instance** : un verrou local refuse deux processus partageant `WATCHPARTY_CACHE_DIR`. Aucun Redis, MySQL, Durable Object ni adaptateur Socket.IO distribué n’a été introduit.
- Le snapshot est construit depuis une copie `committedRooms` publiée uniquement après append fsyncé : une mutation spéculative ou rejetée ne peut pas être persistée.
- L’autorité de lecture et de VIP reste côté serveur. Le client ne peut pas écrire `is_vip` ; le code historique `INVALID_SYNC_KEY` est conservé pour les anciens clients.
- Chaque opération d’outbox porte son propriétaire capturé à l’écriture ; aucun lot n’est réattribué au token ou au profil courant.
- AsyncStorage est la source de vérité des préférences natives ; la WebView reçoit une copie normalisée après confirmation de l’écriture.
- La copie TV du userscript reste épinglée en `1.7.3` ; la source embarquée dans l’app est `1.7.9`. Cet écart est volontaire et vérifié par les tests d’alignement.

## Limites et risques restants

- **Multi-instance** : non pris en charge par conception. Deux processus sur le même cache sont refusés ; aucune fédération n’est fournie.
- Les mutations sociales/administratives (chat, visibilité, rôles, limites) ne sont pas journalisées et restent volatiles après crash brutal.
- Les journaux legacy sans `journalSeq` filtrent encore par `ts > savedAt` ; ces journaux sont purgés juste après migration. Limite documentée dans `API/watchpartyAPI/README.md`.
- Les retries de compaction sont intra-processus ; si le disque reste en erreur, le journal grossit jusqu’à une compaction réussie.
- Les secondes Wrapped dont l’identité d’origine n’est plus authentifiable restent en file différée jusqu’à expiration (7 jours) ; aucun rattachement automatique à un autre compte n’est effectué.
- Un `403` Wrapped est traité comme un refus permanent : si le serveur le renvoie pendant une fenêtre d’hydratation, ces secondes ne sont pas récupérées.
- La portée `access_code` (globale par appareil ou par profil) reste une décision produit non tranchée ici ; la clé reste synchronisable par profil.
- Le verrou de rejeu d’outbox repose sur `localStorage` : il couvre les onglets concurrents, pas une infrastructure distribuée.
- Le fichier généré `app/src/injection/userscript-source.ts` étant gitignoré, un checkout propre doit exécuter `node app/scripts/build-userscript.js` avant le build ; `--check` détecte absence ou dérive.
- L’en-tête « Auto-generated by userscript/build-userscript.mjs » de `userscript/movix.user.js` est obsolète : ce générateur n’existe pas dans le checkout. Le fichier versionné est la source de référence, comme précisé dans `userscript/README.md`.
- Aucune validation visuelle navigateur n’a été effectuée pendant cette remédiation ; une passe E2E ciblée reste recommandée avant publication, avec artefacts reproductibles.

## Commandes de relance

```bash
node --test API/watchpartyAPI/__tests__/watchpartySocket.test.mjs tests/watchparty*.test.mjs
node --test tests/syncOutboxReplay.test.mjs tests/syncProfileIsolation.test.mjs tests/syncPolicyContract.test.mjs tests/wrappedSessionReliability.test.mjs tests/wrappedTracker.test.ts tests/historyProfileScope.test.mjs tests/vipCacheReliability.test.mjs tests/mobileExtractionPrefs.test.mjs tests/userscriptSyncAlignment.test.mjs tests/syncOwnerMigration.test.mjs tests/wrappedDeferredOwnership.test.mjs tests/mobileGmBridge.test.mjs API/Mainapi/utils/__tests__/syncPolicyPartial.test.js API/Mainapi/routes/__tests__/syncPerformance.test.js
npx tsc --noEmit --incremental false -p tsconfig.app.json
node app/scripts/build-userscript.js --check
git diff --check
```
