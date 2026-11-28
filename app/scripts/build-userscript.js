#!/usr/bin/env node

/**
 * Lit le userscript depuis ../userscript/movix.user.js,
 * supprime le header ==UserScript==,
 * et génère src/injection/userscript-source.ts avec le contenu en string.
 * Avec --check, compare les octets attendus sans écrire.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const userscriptPath = resolve(__dirname, '../../userscript/movix.user.js');
const args = process.argv.slice(2);
const outputArgIndex = args.indexOf('--output');
// `--output` sert aux tests : ils pointent vers un dossier temporaire plutôt
// que vers la source générée ignorée par git.
const outputPath = outputArgIndex >= 0 && args[outputArgIndex + 1]
  ? resolve(args[outputArgIndex + 1])
  : resolve(__dirname, '../src/injection/userscript-source.ts');

let source = readFileSync(userscriptPath, 'utf-8');

// Supprime le bloc ==UserScript== header
source = source.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');

// Échappe les backticks et les ${} pour l'inclusion dans un template literal
const escaped = source
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const output = `/**
 * Source du userscript Movix.
 *
 * AUTO-GÉNÉRÉ par scripts/build-userscript.js
 * Ne pas modifier manuellement.
 *
 * Pour régénérer : node scripts/build-userscript.js
 */

export const USERSCRIPT_SOURCE = \`${escaped}\`;
`;

if (args.includes('--check')) {
  let current = null;
  try {
    current = readFileSync(outputPath, 'utf-8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current === null) {
    // Le fichier est volontairement gitignoré : son absence n'est pas une
    // dérive de contenu, mais il faut le générer avant de builder l'app.
    console.error(`[build-userscript] Source générée absente: ${outputPath}`);
    console.error('[build-userscript] Générer avec: node scripts/build-userscript.js');
    process.exitCode = 2;
  } else if (current !== output) {
    console.error(`[build-userscript] Dérive détectée: ${outputPath}`);
    process.exitCode = 1;
  } else {
    console.log(`[build-userscript] Vérifié: ${outputPath}`);
  }
} else {
  let current = null;
  try {
    current = readFileSync(outputPath, 'utf-8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current !== output) writeFileSync(outputPath, output, 'utf-8');
  console.log(`[build-userscript] Généré: ${outputPath}`);
}
console.log(`[build-userscript] Taille du userscript: ${(source.length / 1024).toFixed(1)} KB`);
