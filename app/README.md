# Movix — Application Mobile

Application iOS & Android pour Movix. WebView avec l'extension Movix intégrée (remplacement du userscript Tampermonkey) et changeur DNS 1.1.1.1.

> ⚠️ **Statut iOS : build automatisé non signé**
>
> GitHub Actions compile et teste l'application sur macOS, puis publie une IPA non signée avec sa somme SHA-256. Cette IPA est impossible à installer tant qu'un utilisateur ne l'a pas signée par ses propres moyens.

## Architecture

```
app/
├── src/
│   ├── App.tsx                    # Navigation (Browser + Settings)
│   ├── screens/
│   │   ├── BrowserScreen.tsx      # WebView principal + toolbar
│   │   └── SettingsScreen.tsx     # Toggle DNS + infos extension
│   ├── components/
│   │   ├── WebViewBrowser.tsx     # WebView avec injection userscript
│   │   └── BrowserToolbar.tsx     # Barre de navigation
│   ├── services/
│   │   ├── bridge.ts             # Bridge RN ↔ WebView (remplace GM_xmlhttpRequest)
│   │   └── dns.ts                # Wrapper module DNS natif
│   ├── injection/
│   │   ├── bridge-runtime.ts     # JS injecté dans le WebView (API GM_*)
│   │   ├── inject.ts             # Assembleur bridge + userscript
│   │   └── userscript-source.ts  # Source du userscript (auto-généré)
│   └── config/
│       └── index.ts              # Configuration de l'app
├── android/                       # Code natif Android (VPN DNS)
├── ios/                           # Code natif iOS (NEDNSSettings)
└── scripts/
    └── build-userscript.js        # Génère userscript-source.ts
```

### Comment ça marche

1. **WebView** charge `movix.tax`
2. **Bridge runtime** est injecté AVANT le chargement de la page — fournit `GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `unsafeWindow`
3. **Userscript original** est injecté et fonctionne comme dans Tampermonkey
4. Quand le userscript fait une requête via `GM_xmlhttpRequest`, le bridge envoie un message à React Native
5. **React Native** fait la requête HTTP nativement (pas de CORS) et renvoie la réponse
6. **DNS 1.1.1.1** : sur Android via un VPN local, sur iOS via `NEDNSSettingsManager`

## Prérequis

- Node.js 18+
- React Native CLI (`npm install -g @react-native-community/cli`)
- **Android** : Android Studio, JDK 17, Android SDK 35, NDK 26.1 et CMake 3.22 (le build télécharge [libcurl-impersonate](https://github.com/lexiforest/curl-impersonate), utilisée par le proxy média)
- **iOS** : Xcode 15+, CocoaPods (`gem install cocoapods`)

## Installation

```bash
cd app

# Installer les dépendances
npm install

# Générer le userscript source
node scripts/build-userscript.js

# iOS seulement
cd ios && pod install && cd ..
```

## Lancement

```bash
# Android
npm run android

# iOS
npm run ios

# Metro bundler seul
npm run start
```

## Build de production

### Android (APK / AAB)

```bash
cd android
./gradlew assembleRelease    # APK
./gradlew bundleRelease      # AAB (Play Store)
```

L'APK sera dans `android/app/build/outputs/apk/release/`.

### iOS

Le workflow GitHub Actions **iOS unsigned IPA** produit un artefact nommé `Movix-unsigned-<version>-<run-number>`. Depuis la racine du dépôt, remplacez les valeurs entre chevrons par celles du run à télécharger :

```bash
gh run download <run-id> \
  --name "Movix-unsigned-<version>-<run-number>" \
  --dir Movix-unsigned-<version>-<run-number>
cd Movix-unsigned-<version>-<run-number>
shasum -a 256 -c Movix-unsigned.ipa.sha256
```

Le téléchargement contient `Movix-unsigned.ipa` et `Movix-unsigned.ipa.sha256`. **L'IPA est non signée et son installation est impossible tant qu'un utilisateur ne l'a pas signée par ses propres moyens.**

Sur un tag `ios-v*`, le job de publication commite en plus l'archive dans le dépôt sous `app/movix-ios-unsigner.ipa`, à côté de `app/movix-android.apk`. Elle y est donc téléchargeable en direct, sans passer par `gh` :

```bash
curl -LO https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app/movix-ios-unsigner.ipa
```

C'est le même fichier que celui attaché à la release, vérifié par son empreinte SHA-256 avant d'être indexé.

### SideStore / AltStore

Le job de publication régénère aussi la source AltStore/SideStore (`app/movix-ios-source.json`, même format pour les deux stores) dans le même commit que l'IPA — version, taille et URL restent donc toujours cohérentes. URL de la source :

```
https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app/movix-ios-source.json
```

Dans SideStore ou AltStore : **Sources → + → coller cette URL**. Movix apparaît dans le store, s'installe et se met à jour comme n'importe quelle app : le store signe l'IPA avec l'identifiant Apple de l'utilisateur au moment de l'installation (compte gratuit : 3 apps maximum, re-signature automatique tous les 7 jours). Liens à mettre sur une page web pour ajouter la source en un tap :

- `sidestore://source?url=https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app/movix-ios-source.json`
- `altstore://source?url=https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app/movix-ios-source.json`

L'identifiant de la source (`com.movix.source`) et celui de l'app (`com.movix.app`) ne doivent jamais changer : les stores s'en servent comme clés primaires.

### Scarlet

Scarlet a son propre format ; le même job génère `app/movix-scarlet-source.json`, qui pointe vers la même IPA :

```
https://raw.githubusercontent.com/movixstream/MovixOpenSource/main/app/movix-scarlet-source.json
```

Différence importante : Scarlet signe avec un **certificat d'entreprise partagé**, pas avec le compte Apple de l'utilisateur. Rien à installer sur un ordinateur, aucune limite de 3 apps, aucune re-signature hebdomadaire — mais quand Apple révoque ce certificat, toutes les apps installées via Scarlet cessent de s'ouvrir d'un coup, jusqu'à ce que Scarlet en obtienne un nouveau. SideStore/AltStore reste donc la voie recommandée.

## DNS 1.1.1.1

### Android
- Utilise `VpnService` pour créer un VPN local
- Seul un serveur DNS virtuel (`10.215.173.2`) est routé dans le tunnel : le reste du trafic n'y passe pas
- Les requêtes DNS partent chiffrées en DNS-over-HTTPS vers `https://1.1.1.1/dns-query` (puis `1.0.0.1`) ; l'UDP port 53 en clair ne sert qu'en dernier recours, si le HTTPS échoue (pause DoH de 30 s)
- Aucune donnée ne transite par un serveur tiers
- L'utilisateur doit approuver la connexion VPN
- Au démarrage, l'app attend que le tunnel soit monté (6 s max) avant de charger Movix : le changement de réseau coupait sinon les premières requêtes

### iOS
- Utilise `NEDNSSettingsManager` (iOS 14+)
- DNS-over-HTTPS vers `cloudflare-dns.com`
- Nécessite l'entitlement `com.apple.developer.networking.dns-settings`
- Requiert un profil de provisioning avec cette capability

## Mise à jour du userscript

Quand le userscript (`../userscript/movix.user.js`) est modifié :

```bash
node scripts/build-userscript.js
```

Puis rebuild l'app. `src/injection/userscript-source.ts` est généré et gitignoré,
il ne doit jamais être édité à la main. Pour vérifier qu'il est à jour sans
écrire :

```bash
node scripts/build-userscript.js --check
```

Codes de sortie de `--check` : `0` = conforme, `1` = dérive de contenu,
`2` = source générée absente (à régénérer). L'option `--output <chemin>` permet
aux tests de viser un fichier temporaire.

### Préférences d'extraction et pont GM

`AsyncStorage` est la source de vérité persistante dans l'app : une préférence
est écrite et confirmée avant d'être poussée dans la WebView. Le pont émet
`movix:gm-value-changed` avec `{ key, value }` en plus de renseigner
`window.__MOVIX_SET_NATIVE_GM_VALUE__` : le userscript met ainsi à jour sa
configuration en mémoire sans rechargement. Au document-start, la WebView reçoit
déjà `window.__MOVIX_NATIVE_GM_STORAGE__` depuis le cache natif restauré, sans
attendre le premier message GM. La WebView s'abonne à `subscribeGmStorageChanges`
pour rafraîchir ce snapshot dans un état React : une navigation suivant une
poussée native réinjecte donc la valeur courante, pas un document-start périmé.
`GM_deleteValue` supprime la valeur du cache WebView, du `localStorage`, du
snapshot natif et de la carte native (avec
`AsyncStorage.removeItem`). Le reset global émet `movix:gm-value-changed` avec
`value: null`, ce qui supprime aussi la copie native persistée.

La copie TV (`../app-tv/app/src/main/assets/extract/movix.user.js`) reste
volontairement épinglée en 1.7.3 tandis que la source est en 1.7.9 : ne pas la
remplacer aveuglément. Les tests d'alignement vérifient la divergence documentée
et la politique commune `SET_EXTRACTION_PREFS` / `DEFAULT_EXTRACTION_PREFS`.

## Notes

- Le `DnsPackage.kt` doit être enregistré dans `MainApplication.kt` (ajouté au `getPackages()`)
- Pour iOS, le bridging header doit pointer vers `Movix-Bridging-Header.h`
- L'app reste dans le VPN DNS (sinon le WebView contournerait le DNS) ; ses propres sockets vers Cloudflare sont protégées par `protect()` pour éviter les boucles
- Le mode audio en arrière-plan est activé pour la lecture vidéo continue
