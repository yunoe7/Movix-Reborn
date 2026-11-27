# Cloudflare Proxy (`cloudflareproxy/`)

## Rôle

Ce dossier contient un Worker Cloudflare de relais CORS (`cloudflareproxy403`,
voir `wrangler.toml`). Il ne sert **aucune** fonctionnalité actuelle de
Movix-Reborn : les lecteurs utilisent `API/proxiesembed/` et/ou l'extension
navigateur, qui sont des services distincts. Ne pas confondre ce Worker avec le
Worker applicatif `movix-reborn` (`wrangler.jsonc`) ni avec `proxiesembed`.

La politique en vigueur est **deny-all** : aucune origine et aucune cible ne
sont autorisées. Le Worker refuse donc tout relais tant qu'une configuration
explicite n'a pas été ajoutée.

## Fonctionnement

- `GET` et `HEAD` sont les seules méthodes de relais autorisées.
- `OPTIONS` est géré comme une pré-requête, mais uniquement pour une origine
  explicitement autorisée ; les méthodes et en-têtes annoncés sont fixes.
- `POST`, `PUT`, `PATCH`, `DELETE`, `TRACE` et toute autre méthode sont refusés
  (`405`). L'en-tête `Allow` est exactement `GET, HEAD`.
- L'en-tête `Origin` est comparé par **égalité exacte** à `ALLOWED_ORIGINS`.
  Il n'est jamais réfléchi depuis la requête : la valeur renvoyée dans
  `Access-Control-Allow-Origin` provient de la constante autorisée.
- La cible est l'unique paramètre de requête `uri`. Elle est décodée une fois,
  sans joker ni double décodage accepté.
- La cible doit respecter `ALLOWED_PROTOCOLS` (`https:` uniquement), sans
  identifiant d'autorité (`user:pass@`) ni fragment.
- `ALLOWED_TARGETS` contient des objets
  `{ origin: 'https://hote-exact', pathPrefix: '/chemin/' }`. La correspondance
  porte sur l'origine exacte, puis sur un préfixe de chemin littéral si fourni.
- Une simple comparaison de préfixe est insuffisante : les segments encodés
  `%2e%2e`, `%2f` et `%5c`, les doubles encodages, les segments `.` / `..`, les
  séparateurs `\` et les caractères de contrôle sont rejetés. Le préfixe doit
  correspondre à la fois sur la forme encodée et sur la forme décodée.
- Seuls `Accept`, `Accept-Language`, `If-Modified-Since`, `If-None-Match` et
  `Range` sont relayés vers la cible. `Authorization`, `Cookie`,
  `CF-Connecting-IP`, `X-Forwarded-*`, `Origin`, `Referer` et l'ancien
  `x-cors-headers` ne sont jamais transmis ni écho.
- `redirect: 'manual'` est utilisé et toute réponse `3xx` est rejetée (`502`) :
  aucune redirection ne peut contourner la liste des cibles.
- Seuls quelques en-têtes de réponse nécessaires à la lecture sont copiés.
  Ils ne sont **pas nécessairement tous accessibles au JavaScript du
  navigateur** sans `Access-Control-Expose-Headers`. `Set-Cookie`, les en-têtes
  `cf-*`, `cors-received-headers`, l'IP, le pays et le datacenter ne sont jamais
  renvoyés. `Cache-Control: no-store` est réaffirmé après la copie et le
  `statusText` amont n'est pas relayé.

## Politique actuelle

```js
const ALLOWED_ORIGINS = Object.freeze([]);
const ALLOWED_TARGETS = Object.freeze([]);
const ALLOWED_PROTOCOLS = Object.freeze(['https:']);
```

Conséquences :

- origine inconnue → `403` ;
- origine `www.` d'un domaine connu → `403` (aucune variante n'est implicite) ;
- cible publique arbitraire → `403` ;
- cible privée ou locale → `403` ;
- liste de cibles vide → `403`, quel que soit le format de la requête GET/HEAD/OPTIONS ;
- `POST`, `PUT`, `PATCH`, `DELETE` et `TRACE` → `405`.

Il n'existe aucun joker, aucune regex, aucun sous-domaine implicite, aucune
variable d'environnement de repli et aucun chemin d'exception. Une liste vide
ne peut pas être contournée.

## Procédure sécurisée pour autoriser une cible

1. Identifier l'origine exacte du client (`scheme + host + port`) et l'URL cible
   exacte. Ne pas utiliser de domaine approximatif ni supposer `www.`.
2. Ajouter l'origine à `ALLOWED_ORIGINS` **si elle n'y est pas déjà**.
3. Ajouter une entrée explicite à `ALLOWED_TARGETS`, par exemple :
   `{ origin: 'https://hote-exact', pathPrefix: '/chemin/autorise/' }`.
4. Documenter le besoin dans un commentaire du fichier et dans ce README.
5. Exécuter les tests de sécurité et le build (ci-dessous). Aucun test ne doit
   être désactivé pour faire passer une nouvelle entrée.
6. Vérifier qu'aucune fonctionnalité existante n'est modifiée : ce Worker ne
   doit pas être utilisé par les lecteurs, l'extension ou l'app mobile.
7. Le déploiement Cloudflare nécessite une autorisation explicite séparée.
   Aucun changement de dashboard ni de configuration de production ne doit être
   fait depuis ce lot.

## Tests de sécurité à exécuter avant toute modification future

Depuis la racine du dépôt :

```bash
node tests/cloudflareProxyPolicy.test.mjs
npx wrangler deploy --dry-run --config cloudflareproxy/wrangler.toml --env="" --outdir <répertoire-temporaire>
npx wrangler dev --local --config cloudflareproxy/wrangler.toml
```

La suite de tests lance deux environnements Wrangler locaux, chacun dans un
répertoire temporaire supprimé à la fin. Ainsi aucun `.wrangler` n'est créé dans
le dépôt et aucune configuration de production n'est modifiée.

- **Configuration de production copiée** : le Worker est copié octet pour octet
  avec `ALLOWED_ORIGINS = []` et `ALLOWED_TARGETS = []`. Elle vérifie le
  deny-all, les origines inconnues, les variantes `www.`, toutes les méthodes
  interdites et l'absence de fuite dans les erreurs.
- **Configuration temporaire isolée** : seules les deux constantes sont
  remplacées par `https://allowed.test` et une cible `https://127.0.0.1:<port>`
  locale. Aucun domaine réel n'est autorisé. Un serveur HTTPS local, sans
  accès Internet, exerce réellement :
  - `GET` et `HEAD` avec origine et cible autorisées ;
  - `OPTIONS` avec origine autorisée ;
  - refus d'origine et de cible non autorisées ;
  - refus de `POST`, `PUT`, `PATCH`, `DELETE` et `TRACE` ;
  - transmission uniquement des headers autorisés, sans `Cookie`,
    `Authorization` ni `X-Forwarded-*` ;
  - absence de `Set-Cookie`, de headers Cloudflare et de métadonnées sensibles ;
  - conservation de `Cache-Control: no-store` malgré un header amont contraire ;
  - blocage d'une vraie redirection `302` : `502`, aucun `Location`, aucune
    requête vers la destination ;
  - refus de HTTP, d'identifiants `user:pass@`, de fragments, de ports non
    standards et des segments encodés/doubles encodés.

Les certificats `tests/fixtures/cloudflareProxyTest.crt` et
`cloudflareProxyTest.key` sont des fixtures auto-signées, valables uniquement
pour ces tests. Elles sont injectées dans le processus Wrangler isolé via
`NODE_EXTRA_CA_CERTS` ; elles ne sont aucunement une configuration de
production ni un secret applicatif.

Toute modification future doit conserver ces assertions. Si une origine ou une
cible est ajoutée, ajouter un test positif correspondant sans affaiblir les
tests négatifs existants.
