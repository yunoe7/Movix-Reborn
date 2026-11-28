/**
 * Consolide les neuf rapports LOT 0 en REPORT.md / report.json uniques.
 *
 * Relance :
 *   node tests/seasonalThemeReport.mjs
 *
 * Lit les rapports déjà produits dans le dossier d'artefacts hors dépôt.
 * N'exécute aucun scénario, ne modifie aucune source de production.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ARTIFACT_ROOT,
  gitBranch,
  gitHead,
  resolveChrome,
  commonPrerequisites,
} from './seasonalThemeHarness.mjs';

const KEYS = [
  'core',
  'typography',
  'a11y',
  'player',
  'watchparty',
  'tv',
  'sync',
  'assets',
  'admin',
];

const GUARDS = [
  {
    id: 'GARDE-1',
    title: 'Plusieurs décorations simultanées sans activeThemeId unique',
    checks: ['CORE-04', 'CORE-05', 'ADMIN-11'],
    status: 'partiellement couvert : coexistence observée dans les hooks hérités, registre unique bloqué au LOT 5',
  },
  {
    id: 'GARDE-2',
    title: 'Identité saisonnière TV conservée',
    checks: ['A11Y-07', 'A11Y-08', 'TV-01', 'TV-02', 'TV-03', 'TV-04', 'TV-05'],
    status: 'couvert : palette, police, cadres et navigation mesurés sur 1920×1080 en mode léger',
  },
  {
    id: 'GARDE-3',
    title: 'Arrêt d’urgence multi-workers < 1 s avec Redis/cache incohérent',
    checks: ['CORE-09', 'ADMIN-06', 'ADMIN-07'],
    status: 'non exécutable : contrat documenté, aucun canal de publication dans le checkout',
  },
  {
    id: 'GARDE-4',
    title: 'Migration Halloween/Noël sans double affichage, chargement ni conflit CSS',
    checks: ['CORE-05', 'TYPO-04', 'ADMIN-10', 'ADMIN-11', 'ASSET-03'],
    status: 'partiellement couvert : une seule feuille de police et aucun conflit font-family hérité, alias uniques bloqués au LOT 5',
  },
];

const reports = [];
for (const key of KEYS) {
  const file = path.join(ARTIFACT_ROOT, key, 'report.json');
  reports.push(JSON.parse(await readFile(file, 'utf8')));
}

const counts = reports.reduce((acc, report) => {
  for (const status of ['pass', 'fail', 'blocked', 'not-run']) acc[status] += report.counts[status] || 0;
  return acc;
}, { pass: 0, fail: 0, blocked: 0, 'not-run': 0 });

const nodeVersion = process.version;
const chrome = resolveChrome() || 'inconnu';

const generatedAt = new Date().toISOString();
const payload = {
  title: 'LOT 0 — rapports de référence du moteur décoratif saisonnier',
  generatedAt,
  git: { branch: gitBranch(), head: gitHead() },
  environment: { node: nodeVersion, chrome, runtime: 'playwright-core + esbuild + tailwindcss locaux' },
  exitPolicy: 'Aucun test ne rend vert artificiellement : fail = divergence observée, blocked = fonctionnalité absente, not-run = non exécutable dans LOT 0.',
  prerequisites: commonPrerequisites(),
  counts,
  mandatoryGuards: GUARDS,
  scenarios: reports.map((report) => ({
    key: report.key,
    title: report.title,
    command: report.command,
    artifactDir: report.artifactDir,
    counts: report.counts,
    checks: report.checks,
    artifacts: report.artifacts,
    risks: report.risks,
  })),
};

await mkdir(ARTIFACT_ROOT, { recursive: true });
await writeFile(path.join(ARTIFACT_ROOT, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

const fails = reports.flatMap((report) => report.checks.filter((check) => check.status === 'fail'));
const lines = [
  '# LOT 0 — rapports de référence du moteur décoratif saisonnier',
  '',
  `- Branche : \`${payload.git.branch}\``,
  `- Commit de base : \`${payload.git.head}\``,
  `- Généré le : ${generatedAt}`,
  `- Node : ${nodeVersion}`,
  `- Dossier racine des artefacts : \`${ARTIFACT_ROOT}\``,
  `- Consolidation : \`node tests/seasonalThemeReport.mjs\``,
  '',
  '## Résumé',
  '',
  '| Pass | Fail documenté | Blocked | Not run |',
  '| ---: | ---: | ---: | ---: |',
  `| ${counts.pass} | ${counts.fail} | ${counts.blocked} | ${counts['not-run']} |`,
  '',
  payload.exitPolicy,
  '',
  '## Quatre corrections obligatoires — état des garde-fous',
  '',
  '| Garde-fou | Objectif | Contrôles | État |',
  '| --- | --- | --- | --- |',
  ...GUARDS.map((guard) => `| ${guard.id} | ${guard.title} | ${guard.checks.join(', ')} | ${guard.status} |`),
  '',
  '## Divergences observées (fail documenté, non corrigées en LOT 0)',
  '',
  ...fails.map((check) => `- **${check.id}** — ${check.title} : ${check.reason}`),
  '',
  '## Scénarios et commandes de relance',
  '',
  '| Scénario | Résultat | Commande | Artefacts |',
  '| --- | --- | --- | --- |',
  ...reports.map((report) => {
    const c = report.counts;
    return `| ${report.key} | ${c.pass} pass / ${c.fail} fail / ${c.blocked} blocked / ${c['not-run']} not-run | \`${report.command}\` | \`${report.artifactDir}\` |`;
  }),
  '',
  '## Prérequis',
  '',
  ...commonPrerequisites().map((item) => `- ${item}`),
  '',
  '## Méthode',
  '',
  '- Horloge figée par `Date` injectée avant le chargement de la page.',
  '- Réseau intercepté : seule l’origine `seasonal.test` est servie ; toute origine externe est bloquée et journalisée.',
  '- Données isolées dans `localStorage` de contextes navigateurs jetables ; aucun compte ni secret.',
  '- Composants, hooks, CSS et routes réels du checkout ; seules les feuilles d’assets importées sont stubées dans le bundle de test.',
  '- Captures desktop/mobile/tablette/TV et une trace Playwright sont écrites hors du dépôt.',
  '',
  '## Risques consolidés',
  '',
  ...[...new Set(reports.flatMap((report) => report.risks))].map((risk) => `- ${risk}`),
  '',
];
await writeFile(path.join(ARTIFACT_ROOT, 'REPORT.md'), lines.join('\n'), 'utf8');
console.log(`[seasonal-report] ${ARTIFACT_ROOT}/REPORT.md`);
console.log(`[seasonal-report] ${counts.pass} pass / ${counts.fail} fail / ${counts.blocked} blocked / ${counts['not-run']} not-run`);
