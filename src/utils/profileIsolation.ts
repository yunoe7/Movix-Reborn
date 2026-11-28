// Nettoyage du stockage lors d'un changement de compte. Les `removeItem`
// déclenchés pendant cette fenêtre ne sont pas des actions utilisateur : ils ne
// doivent jamais alimenter la file de synchronisation, quel que soit l'ordre
// d'enregistrement des listeners `auth_changed`.
let wipeDepth = 0;

export function isProfileIsolationWipeActive(): boolean {
  return wipeDepth > 0;
}

export function runProfileIsolationWipe<T>(run: () => T): T {
  wipeDepth += 1;
  try {
    return run();
  } finally {
    wipeDepth -= 1;
  }
}
