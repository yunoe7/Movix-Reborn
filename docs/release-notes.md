# Notes de version Movix

Les notes de version se gèrent directement depuis l'administration Movix, dans **Plateforme → Notes de version**.

## Préparer une publication

1. Ouvrir l'administration avec un compte administrateur.
2. Choisir **Notes de version** dans le groupe Plateforme.
3. Renseigner le numéro de version (facultatif), le résumé, les nouveautés et corrections.
4. Choisir l'importance et activer si nécessaire la mise à jour obligatoire.
5. Ajouter les anciennes versions dans l'historique.
6. Cliquer sur **Enregistrer les notes**.

Les notes sont stockées côté API dans Redis. Elles peuvent être préparées avant le déploiement ; le prochain build fournit le nouveau `buildId`, tandis que l'API fournit les notes saisies dans l'administration. Il n'est donc plus nécessaire de modifier `public/release-notes.json` pour les publications habituelles.

## Champs disponibles

- **Version** : numéro lisible (par exemple `2.9.0`). Si vide, Movix utilise les 8 premiers caractères du build.
- **Importance** : normale, importante ou critique.
- **Mise à jour obligatoire** : empêche de reporter la notification. Une version critique est toujours obligatoire.
- **Résumé** : texte court présenté dans la notification.
- **Nouveautés et corrections** : liste libre de points affichés dans le détail.
- **Historique** : versions précédentes avec date, résumé et liste des changements.

## Comportement côté utilisateur

- La vérification compare toujours le `buildId` du navigateur avec celui publié dans `/version.json`.
- Les notes dynamiques sont chargées depuis l'API publique `/api/version/release-notes`.
- « Plus tard » masque la notification pendant quatre heures sur cet appareil.
- « Voir les nouveautés » ouvre le détail de la version et l'historique.
- Le rechargement avertit si une vidéo/audio est en cours ou si des champs/éditeurs semblent modifiés.
- Une mise à jour critique ou marquée obligatoire ne peut pas être masquée.

## Fichier JSON historique

`public/release-notes.json` reste une valeur de secours intégrée au build. Pour les mises à jour courantes, utiliser l'éditeur d'administration.
