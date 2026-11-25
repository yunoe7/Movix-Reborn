/**
 * Vérifie la parité des traductions et les clés utilisées par le frontend.
 *
 * Contrôles effectués :
 * - clés littérales passées à t()/getFixedT()/i18nKey, tous fichiers src confondus ;
 * - variantes plurielles (_one/_other/_many/...) reconnues comme valides ;
 * - clés dynamiques t(`prefix.${value}.suffix`) : parité FR/EN des clés candidates ;
 * - namespaces explicites passés à useTranslation() (le projet n'en utilise aucun) ;
 * - différences de clés entre les bundles FR et EN.
 *
 * La locale active est vérifiée séparément par le test navigateur i18n.
 *
 * Run: node scripts/check-i18n-keys.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repo, 'src');
const localesDir = path.join(srcDir, 'i18n', 'locales');
const languages = ['fr', 'en'];
const pluralSuffixes = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function stripComments(source) {
  let out = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (char === '/' && next === '*') { state = 'block'; i += 1; out += '  '; continue; }
      if (char === '/' && next === '/') { state = 'line'; i += 1; out += '  '; continue; }
      if (char === '"' || char === "'" || char === '`') { state = 'string'; quote = char; }
      out += char;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') { state = 'code'; out += char; } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { state = 'code'; i += 1; out += '  '; } else out += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (char === '\\') { out += char + (next ?? ''); i += 1; continue; }
    if (char === quote) state = 'code';
    out += char;
  }
  return out;
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full).forEach(file => files.push(file));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, fullKey, out);
    else out.set(fullKey, child);
  }
  return out;
}

function resolveKeyStatus(bundle, key) {
  if (bundle.has(key)) return 'exact';
  if (pluralSuffixes.some(suffix => bundle.has(`${key}${suffix}`))) return 'plural';
  return null;
}

function dynamicKeyRegex(template) {
  const parts = template.split(/(\$\{[^}]*\})/);
  const source = parts.map(part => part.startsWith('${') ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${source}$`);
}

const bundles = Object.fromEntries(languages.map(lng => [
  lng,
  flatten(JSON.parse(fs.readFileSync(path.join(localesDir, `${lng}.json`), 'utf8'))),
]));
const allKeys = new Set(languages.flatMap(lng => [...bundles[lng].keys()]));

const literalUses = new Map();
const dynamicUses = new Map();
const namespaces = [];
for (const file of walk(srcDir)) {
  const relative = path.relative(repo, file).replaceAll('\\', '/');
  const source = stripComments(fs.readFileSync(file, 'utf8'));

  const literalPatterns = [
    /\bt\(\s*['"]([^'"]+)['"]/g,
    /\bi18nKey\s*=\s*['"]([^'"]+)['"]/g,
    /\bi18n\.getFixedT\([^)]*\)\s*\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of literalPatterns) {
    for (const match of source.matchAll(pattern)) {
      const refs = literalUses.get(match[1]) || new Set();
      refs.add(relative);
      literalUses.set(match[1], refs);
    }
  }

  for (const match of source.matchAll(/\bt\(\s*`([^`]+)`/g)) {
    if (!match[1].includes('${')) continue;
    const refs = dynamicUses.get(match[1]) || new Set();
    refs.add(`${relative}:${source.slice(0, match.index).split('\n').length}`);
    dynamicUses.set(match[1], refs);
  }

  for (const match of source.matchAll(/useTranslation\s*\(([^)]+)\)/g)) {
    namespaces.push({ ref: relative, args: match[1].trim().replace(/\s+/g, ' ') });
  }
}

const errors = [];
for (const [key, refs] of literalUses) {
  for (const lng of languages) {
    if (!resolveKeyStatus(bundles[lng], key)) {
      errors.push(`${lng}: clé absente ${key} (${[...refs].join(', ')})`);
    }
  }
}

for (const [template, refs] of dynamicUses) {
  const re = dynamicKeyRegex(template);
  const candidates = [...allKeys].filter(key => re.test(key));
  if (!candidates.length) {
    errors.push(`motif dynamique sans clé candidate ${template} (${[...refs].join(', ')})`);
    continue;
  }
  for (const key of candidates) {
    for (const lng of languages) {
      if (!bundles[lng].has(key)) {
        errors.push(`${lng}: clé dynamique absente ${key} (motif ${template}, ${[...refs].join(', ')})`);
      }
    }
  }
}

if (namespaces.length) {
  for (const { ref, args } of namespaces) errors.push(`namespace useTranslation inattendu ${args} (${ref})`);
}

for (const key of [...bundles.fr.keys()]) {
  if (!bundles.en.has(key)) errors.push(`en: clé absente ${key}`);
}
for (const key of [...bundles.en.keys()]) {
  if (!bundles.fr.has(key)) errors.push(`fr: clé absente ${key}`);
}

if (errors.length) {
  console.error(`Échec i18n : ${errors.length} problème(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`i18n OK — ${literalUses.size} clés littérales, ${dynamicUses.size} motifs dynamiques, ${bundles.fr.size} clés FR, ${bundles.en.size} clés EN, locales ${languages.join('/')}`);
