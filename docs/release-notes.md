# Notes de version Movix

Le fichier `public/release-notes.json` alimente la notification de mise à jour et son historique.

## Préparer une publication

Avant de déployer, renseigner :

- `version` : numéro lisible (par exemple `2.9.0`). Laisser vide pour afficher les 8 premiers caractères du build.
- `severity` : `normal`, `important` ou `critical`.
- `mandatory` : `true` pour empêcher de masquer une mise à jour obligatoire.
- `summary` : phrase courte présentée dans la notification.
- `changes` : liste des nouveautés et corrections de cette version.
- `history` : versions précédentes, de la plus récente à la plus ancienne, avec `version`, `date`, `summary` et `changes`.

Exemple d'entrée d'historique :

```json
{
  "version": "2.8.0",
  "date": "2026-11-01",
  "summary": "Navigation et lecteur améliorés.",
  "changes": ["Recherche plus rapide", "Corrections de stabilité"]
}
```

## Comportement côté utilisateur

- La vérification continue de comparer le `buildId` du navigateur avec celui publié dans `/version.json`.
- « Plus tard » masque la notification pendant quatre heures sur cet appareil.
- « Voir les nouveautés » ouvre le détail de la version et l'historique publié.
- Le rechargement avertit si une vidéo/audio est en cours ou si des champs/éditeurs semblent modifiés.
- Une mise à jour critique ou marquée `mandatory: true` ne peut pas être masquée.
- Les métadonnées sont intégrées à `/version.json` au build ; le navigateur ne lit pas directement le fichier source.
