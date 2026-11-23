# Logos des plateformes — provenance

Ces neuf SVG sont utilisés par le sélecteur de plateformes de la page d’accueil. Ils remplacent l’ancien sprite PNG `platform-logos-sprite-v5.png`, dont les cellules carrées forçaient des proportions et des marges visuelles incohérentes.

## Sources

| Fichier | Source | Auteur / titulaire | Statut Wikimedia Commons |
| --- | --- | --- | --- |
| `netflix.svg` | [Netflix 2016 N logo.svg](https://commons.wikimedia.org/wiki/File:Netflix_2016_N_logo.svg) | Netflix | Domaine public |
| `prime-video.svg` | [Prime Video logo (2024).svg](https://commons.wikimedia.org/wiki/File:Prime_Video_logo_(2024).svg) | Amazon.com, Inc. | Domaine public |
| `paramount-plus.svg` | [Paramount+ logo.svg](https://commons.wikimedia.org/wiki/File:Paramount%2B_logo.svg) | Paramount Global | Domaine public |
| `disney-plus.svg` | [Disney+ logo.svg](https://commons.wikimedia.org/wiki/File:Disney%2B_logo.svg) | Disney Enterprises, Inc. | Domaine public |
| `hbo-max.svg` | [HBO Max (2025).svg](https://commons.wikimedia.org/wiki/File:HBO_Max_%282025%29.svg) | Warner Bros. Discovery / Skydance Corporation ; vectorisation LucasJance2006 et Lee6597 | Domaine public |
| `marvel-studios.svg` | [Marvel Studios logo.svg](https://commons.wikimedia.org/wiki/File:Marvel_Studios_logo.svg) | The Walt Disney Company | Domaine public |
| `apple-tv-plus.svg` | [Apple TV Plus Logo.svg](https://commons.wikimedia.org/wiki/File:Apple_TV_Plus_Logo.svg) | Apple Inc. | Domaine public |
| `warner-bros.svg` | [Warner Bros. logo 2023.svg](https://commons.wikimedia.org/wiki/File:Warner_Bros._logo_2023.svg) | Warner Bros. Entertainment | Domaine public |
| `dc-comics.svg` | [DC Comics logo.svg](https://commons.wikimedia.org/wiki/File:DC_Comics_logo.svg) | Warner Bros. Discovery / Pentagram | Domaine public |

Les pages Commons classent ces fichiers comme marques déposées (« trademarked ») malgré leur statut de domaine public pour le droit d’auteur. Les marques restent la propriété de leurs titulaires respectifs ; ces fichiers servent uniquement à identifier les plateformes dans l’interface.

## Transformations appliquées

- Conservation du tracé vectoriel d’origine, sans rasterisation ni approximation.
- Agrandissement contrôlé du `viewBox` pour obtenir une marge interne cohérente autour de chaque logo ; proportions d’origine conservées.
- Fond transparent conservé ; aucun fond blanc ajouté.
- Recolorisation uniforme autorisée par les variantes officielles monochrome sur fond sombre :
  - Prime Video et Apple TV+ : blanc pur ;
  - HBO Max : blanc pur, conformément à la variante « Pure white » documentée par le [guide de marque HBO Max](https://brand.hbomax.com/logos) pour les fonds sombres ;
  - Disney+ : wordmark blanc, tandis que l'arc « + » garde son dégradé bleu d'origine.
- Les autres logos conservent leurs couleurs officielles présentes dans la source : rouge Netflix, bleu Paramount+, rouge Marvel, bleu/jaune Warner Bros. et bleu DC Comics.

Aucun logo n’a été redessiné, déformé ou étiré. Les dimensions naturelles et mesures de rendu sont consignées dans le rapport E2E `tests/streamingPlatformLogos.browser.mjs`.
