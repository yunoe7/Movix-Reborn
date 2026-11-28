# Polices typographiques saisonnières — provenance et licences

Ces fichiers sont servis localement depuis `/fonts/seasonal-theme/`. Aucune police saisonnière n'est chargée depuis Google Fonts ou un CDN tiers à l'exécution.

| Famille | Fichiers | Provenance | Licence |
| --- | --- | --- | --- |
| Inter | `inter-latin-{400,500,600,700,800,900}-normal.woff2` | Paquet npm `@fontsource/inter` 5.2.8, lui-même issu du projet Inter. Copyright 2016 The Inter Project Authors. | SIL Open Font License 1.1 — `licenses/INTER-LICENSE.txt` |
| Creepster | `creepster-latin-400-normal.woff2` | Paquet npm `@fontsource/creepster` 5.3.0. Copyright (c) 2011, Font Diner, Inc (diner@fontdiner.com), avec Reserved Font Names « Creepster ». | SIL Open Font License 1.1 — `licenses/CREEPSTER-LICENSE.txt` |
| Archivo Black | `archivo-black-latin-400-normal.woff2` | Paquet npm `@fontsource/archivo-black` 5.2.8, lui-même issu du projet Omnibus-Type. Copyright 2017 The Archivo Black Project Authors. | SIL Open Font License 1.1 — `licenses/ARCHIVO-BLACK-LICENSE.txt` |

## Restrictions de nommage

Le nom « Creepster » est un Reserved Font Name. Les fichiers distribués ici sont les fichiers WOFF2 non modifiés du paquet Fontsource ; aucune police dérivée n'est publiée sous ce nom.

## Couverture des caractères

- Les sous-ensembles `latin` couvrent les caractères français courants, y compris `é`, `à`, `ç` et l'apostrophe typographique (`U+2000-206F`). Creepster ne publie pas de sous-ensemble `latin-ext` : le moteur ne déclare donc pas de couverture qu'il ne possède pas et conserve Inter comme repli pour les caractères hors de son `unicode-range`.
- Les graisses déclarées par le moteur correspondent exactement aux fichiers présents : Inter 400 à 900, Creepster 400, Archivo Black 400. Aucun fichier italique n'est chargé : le catalogue ne sélectionne que des styles normaux.
