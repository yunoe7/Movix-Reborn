/**
 * Harnais partagé des E2E de référence du moteur décoratif saisonnier.
 *
 * Ce fichier appartient au LOT 0 : il ne modifie aucune source de production.
 * Il fournit un montage navigateur déterministe (horloge figée, réseau
 * intercepté, fichiers compilés en dehors du dépôt) et un rapport bilingue
 * Markdown/JSON avec statuts explicites : pass / fail / blocked / not-run.
 *
 * Aucun résultat n'est fabriqué : une fonctionnalité absente est marquée
 * `blocked`, une divergence observée est marquée `fail`, et un scénario
 * impossible à exécuter est marqué `not-run`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(REPO, 'src');
export const NODE_MODULES = path.join(REPO, 'node_modules');
export const ARTIFACT_ROOT = path.join(os.tmpdir(), 'opencode', 'seasonal-theme-e2e');

const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;

export const playwright = runtimeRequire('playwright-core');

export function artifactDirFor(key) {
  const envKey = `SEASONAL_THEME_${key.toUpperCase()}_DIR`;
  return path.resolve(process.env[envKey] || path.join(ARTIFACT_ROOT, key));
}

export function readRepoFile(relativePath) {
  return readFile(path.join(REPO, relativePath), 'utf8');
}

export function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function gitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function resolveChrome() {
  const candidates = [
    process.env.SEASONAL_THEME_CHROME,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (require('node:fs').existsSync(candidate)) return candidate;
    } catch {
      // On essaie le candidat suivant.
    }
  }
  return undefined;
}

const trackedResources = new Set();

export function trackResource(resource) {
  if (resource) trackedResources.add(resource);
  return resource;
}

/** Ferme même les fixtures laissées ouvertes par une assertion qui échoue. */
export async function releaseTrackedResources() {
  for (const resource of [...trackedResources].reverse()) {
    try {
      await resource.close();
    } catch {
      // Ressource déjà fermée explicitement par le scénario.
    }
  }
  trackedResources.clear();
}

export async function launchBrowser() {
  const executablePath = resolveChrome();
  return trackResource(await playwright.chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }));
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
}

/** Monte une page de fixture sans serveur : tout est servi via Playwright. */
export async function mountFixture(context, { workDir, requests }) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = {
      method: request.method(),
      url: request.url(),
      hostname: url.hostname,
      pathname: url.pathname,
    };
    requests?.push(entry);

    if (url.hostname !== 'seasonal.test') {
      await route.abort('blockedbyclient');
      return;
    }

    const pathname = decodeURIComponent(url.pathname);
    let filePath;
    if (pathname.startsWith('/src/') || pathname.startsWith('/node_modules/')) {
      filePath = path.resolve(REPO, `.${pathname}`);
    } else {
      filePath = path.resolve(workDir, `.${pathname === '/' ? '/index.html' : pathname}`);
    }

    const allowed = [path.resolve(workDir), REPO];
    const inside = allowed.some((root) => filePath === root || filePath.startsWith(`${root}${path.sep}`));
    let body = null;
    if (inside) {
      try {
        body = await readFile(filePath);
      } catch {
        body = null;
      }
    }
    if (!body) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
      return;
    }
    await route.fulfill({ status: 200, contentType: contentTypeFor(filePath), body });
  });
}

export async function writeFixtureFiles(workDir, { html }) {
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, 'index.html'), html, 'utf8');
}

export async function buildFixtureBundle(workDir, entryFile, { outfile = 'app.js', define = {} } = {}) {
  const fixtureStub = {
    name: 'seasonal-theme-fixture-stub',
    setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'seasonal-theme' }));
      builder.onLoad({ filter: /.*/, namespace: 'seasonal-theme' }, () => ({
        contents: 'export default {};',
        loader: 'js',
        resolveDir: REPO,
      }));
      // Les images importées par les composants sont des URL Vite ; la fixture
      // les remplace par un pixel transparent, sans toucher aux fichiers réels.
      builder.onResolve({ filter: /\.(webp|png|jpe?g|gif|avif|svg|woff2?|ttf|otf)$/i },
        () => ({ path: 'empty-asset', namespace: 'seasonal-theme-asset' }));
      builder.onLoad({ filter: /.*/, namespace: 'seasonal-theme-asset' }, () => ({
        contents: 'export default "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";',
        loader: 'js',
      }));
    },
  };

  const output = path.join(workDir, outfile);
  await build({
    entryPoints: [entryFile],
    outfile: output,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    logLevel: 'silent',
    nodePaths: [NODE_MODULES],
    alias: { '@': SRC },
    define: {
      'import.meta.env': JSON.stringify({
        VITE_MAIN_API: 'https://main-api.test',
        VITE_SITE_URL: 'https://seasonal.test',
        DEV: false,
        MODE: 'test',
      }),
      ...define,
    },
    plugins: [fixtureStub],
  });
  return output;
}

function rewriteCssUrls(css) {
  return css
    .replace(/url\(\s*(['"]?)\.\.\/assets\//g, "url($1/src/assets/")
    .replace(/url\(\s*(['"]?)\.\/assets\//g, "url($1/src/assets/")
    .replace(/url\(\s*(['"]?)\.\.\//g, "url($1/src/")
    .replace(/url\(\s*(['"]?)\.\//g, "url($1/src/styles/");
}

export async function buildFixtureCss(workDir, { contentFiles = [] } = {}) {
  const requireFromRepo = createRequire(path.join(REPO, 'package.json'));
  const tailwindCli = requireFromRepo.resolve('tailwindcss/lib/cli/index.js');
  const tailwindPath = path.join(workDir, 'tailwind.css');
  const contentArg = contentFiles.length
    ? contentFiles.map((file) => path.join(REPO, file)).join(',')
    : path.join(REPO, 'src/index.css');

  execFileSync(process.execPath, [
    tailwindCli,
    '--config', path.join(REPO, 'tailwind.config.js'),
    '--input', path.join(REPO, 'src/index.css'),
    '--output', tailwindPath,
    '--content', contentArg,
  ], { cwd: REPO, stdio: 'ignore' });

  const chunks = [rewriteCssUrls(await readFile(tailwindPath, 'utf8'))];
  for (const file of [
    'src/styles/halloween.css',
    'src/styles/halloween-ui.css',
    'src/styles/halloween-decor.css',
    'src/components/christmas-atmosphere.css',
  ]) {
    chunks.push(rewriteCssUrls(await readRepoFile(file)));
  }
  chunks.push(`
    html, body, #root { min-height: 100%; background: #07070a; color: #f8fafc; }
    #fixture-root { padding: 24px; min-height: 100vh; }
    #player { position: relative; height: 360px; border: 1px solid #334155; background: #000; }
    #player-center { position: absolute; inset: 40% 40%; }
    .fixture-focus:focus-visible { outline: 3px solid #fbbf24; outline-offset: 3px; }
    .fixture-card { border: 1px solid #334155; padding: 16px; margin-top: 12px; }
  `);
  const output = path.join(workDir, 'app.css');
  await writeFile(output, chunks.join('\n'), 'utf8');
  return output;
}

export function fixtureHtml({ title = 'Seasonal fixture', body = '<div id="root"></div>' } = {}) {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/app.css"></head>
<body>${body}<script type="module" src="/app.js"></script></body></html>`;
}

/** Fige Date.now() et new Date() sans toucher aux horloges des timers. */
export function freezeDateInit(iso) {
  const fixed = new Date(iso).getTime();
  return `(() => {
    const fixed = ${JSON.stringify(fixed)};
    class FrozenDate extends Date {
      constructor(...args) {
        if (args.length === 0) super(fixed);
        else super(...args);
      }
      static now() { return fixed; }
    }
    window.Date = FrozenDate;
  })();`;
}

export function stubFontFailureInit() {
  return `(() => {
    const block = (prototype) => {
      const originalAppendChild = prototype.appendChild;
      prototype.appendChild = function (node) {
        if (node && node.tagName === 'LINK' && String(node.href).includes('fonts.googleapis.com')) {
          return node;
        }
        return Reflect.apply(originalAppendChild, this, arguments);
      };
    };
    block(Document.prototype);
    block(Element.prototype);
  })();`;
}

export function storageInit(values) {
  return `(() => {
    const values = ${JSON.stringify(values)};
    for (const [key, value] of Object.entries(values)) {
      try { localStorage.setItem(key, value); } catch {}
    }
  })();`;
}

/** Compte les canvas et les boucles créées après le chargement de la page. */
export function instrumentationInit() {
  return `(() => {
    const canvases = [];
    let intervals = 0;
    let timeouts = 0;
    let animationFrames = 0;
    const originalCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function (localName) {
      const element = Reflect.apply(originalCreateElement, this, arguments);
      if (String(localName).toLowerCase() === 'canvas') canvases.push(element);
      return element;
    };
    const originalSetInterval = window.setInterval;
    window.setInterval = function (...args) { intervals += 1; return Reflect.apply(originalSetInterval, this, args); };
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = function (...args) { timeouts += 1; return Reflect.apply(originalSetTimeout, this, args); };
    const originalRaf = window.requestAnimationFrame;
    if (originalRaf) {
      window.requestAnimationFrame = function (...args) { animationFrames += 1; return Reflect.apply(originalRaf, this, args); };
    }
    window.__seasonalMetrics = () => ({
      canvases: canvases.length,
      canvasBytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
      intervals,
      timeouts,
      animationFrames,
      hiddenCanvases: canvases.filter((canvas) => !canvas.isConnected).length,
    });
  })();`;
}

const FIXTURE_CONTENT_FILES = [
  'src/index.css',
  'src/styles/halloween-ui.css',
  'src/styles/halloween-decor.css',
  'src/components/Header.tsx',
  'tests/seasonalThemeFixtures/atmosphere.tsx',
];

export async function createAtmosphereFixture(report, options = {}) {
  const {
    date = '2026-10-28T12:00:00+02:00',
    storage = {},
    query = '',
    viewport = { width: 1280, height: 900 },
    reducedMotion = 'no-preference',
    instrument = false,
    blockFonts = false,
    extraInit = [],
    waitForReady = true,
    trace = false,
  } = options;

  const workDir = path.join(report.artifactDir, `fixture-${report.checks.length}`);
  await writeFixtureFiles(workDir, { html: fixtureHtml() });
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/atmosphere.tsx'));
  await buildFixtureCss(workDir, { contentFiles: FIXTURE_CONTENT_FILES });

  const browser = await launchBrowser();
  const context = trackResource(await browser.newContext({ viewport, reducedMotion }));
  await context.addInitScript(freezeDateInit(date));
  await context.addInitScript(storageInit(storage));
  if (instrument) await context.addInitScript(instrumentationInit());
  if (blockFonts) await context.addInitScript(stubFontFailureInit());
  for (const script of extraInit) await context.addInitScript(script);

  const requests = [];
  await mountFixture(context, { workDir, requests });
  if (trace) await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://seasonal.test/${query}`);
  if (waitForReady) {
    await page.waitForFunction(() => Boolean(window.__seasonal));
  }
  return { browser, context, page, requests, errors, workDir };
}

export class Report {
  constructor(meta) {
    this.meta = meta;
    this.artifactDir = artifactDirFor(meta.key);
    this.checks = [];
    this.risks = [];
    this.artifacts = [];
    this.context = {};
    this.startedAt = new Date().toISOString();
    this.head = gitHead();
    this.branch = gitBranch();
  }

  static serialize(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  check(id, options) {
    const { title, expected, observed, status = 'pass', reason = '', severity = 'normal' } = options;
    assert.ok(['pass', 'fail', 'blocked', 'not-run'].includes(status), `statut inattendu: ${status}`);
    this.checks.push({
      id,
      title,
      expected: Report.serialize(expected),
      observed: Report.serialize(observed),
      status,
      reason,
      severity,
    });
    return status;
  }

  pass(id, title, expected, observed, extra = {}) {
    return this.check(id, { title, expected, observed, status: 'pass', ...extra });
  }

  fail(id, title, expected, observed, reason = '', severity = 'normal') {
    return this.check(id, { title, expected, observed, status: 'fail', reason, severity });
  }

  blocked(id, title, expected, observed, reason) {
    return this.check(id, { title, expected, observed, status: 'blocked', reason });
  }

  notRun(id, title, expected, reason) {
    return this.check(id, { title, expected, observed: 'non exécuté', status: 'not-run', reason });
  }

  risk(text) {
    this.risks.push(text);
  }

  setContext(key, value) {
    this.context[key] = value;
  }

  addArtifact(relativePath) {
    this.artifacts.push(relativePath);
  }

  counts() {
    return this.checks.reduce((acc, check) => {
      acc[check.status] += 1;
      return acc;
    }, { pass: 0, fail: 0, blocked: 0, 'not-run': 0 });
  }

  async screenshot(page, name, options = {}) {
    const relative = `captures/${name}.png`;
    await mkdir(path.join(this.artifactDir, 'captures'), { recursive: true });
    await page.screenshot({ path: path.join(this.artifactDir, relative), ...options });
    this.addArtifact(relative);
    return relative;
  }

  async startTrace(context) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }

  async stopTrace(context) {
    const relative = 'trace.zip';
    await context.tracing.stop({ path: path.join(this.artifactDir, relative) });
    this.addArtifact(relative);
  }

  async write() {
    await mkdir(this.artifactDir, { recursive: true });
    const counts = this.counts();
    const payload = {
      ...this.meta,
      generatedAt: new Date().toISOString(),
      startedAt: this.startedAt,
      git: { branch: this.branch, head: this.head },
      artifactDir: this.artifactDir,
      counts,
      checks: this.checks,
      risks: this.risks,
      artifacts: this.artifacts,
      context: this.context,
      exitPolicy: 'Les statuts fail/bloquent sont documentés ; SEASONAL_THEME_STRICT=1 échoue sur tout fail.',
    };
    await writeFile(path.join(this.artifactDir, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    const lines = [
      `# ${this.meta.title}`,
      '',
      `- Branche : \`${this.branch}\``,
      `- Commit : \`${this.head}\``,
      `- Généré le : ${payload.generatedAt}`,
      `- Dossier d'artefacts : \`${this.artifactDir}\``,
      `- Commande de relance : \`${this.meta.command}\``,
      '',
      '## Résumé',
      '',
      `| Pass | Fail | Blocked | Not run |`,
      `| ---: | ---: | ---: | ---: |`,
      `| ${counts.pass} | ${counts.fail} | ${counts.blocked} | ${counts['not-run']} |`,
      '',
      'Un `fail` décrit une divergence réellement observée. Un `blocked` signale une fonctionnalité prévue mais absente du checkout ; un `not-run` signale un scénario non exécutable avec les moyens du LOT 0.',
      '',
      '## Prérequis',
      '',
      ...this.meta.prerequisites.map((item) => `- ${item}`),
      '',
      '## Fixtures et données',
      '',
      ...this.meta.fixtures.map((item) => `- ${item}`),
      '',
      '## Contrôles',
      '',
      '| ID | Statut | Titre | Attendu | Observé / raison |',
      '| --- | --- | --- | --- | --- |',
      ...this.checks.map((check) => {
        const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
        const observed = check.observed + (check.reason ? ` — ${check.reason}` : '');
        return `| ${check.id} | ${check.status} | ${cell(check.title)} | ${cell(check.expected)} | ${cell(observed)} |`;
      }),
      '',
      '## Artefacts',
      '',
      ...(this.artifacts.length ? this.artifacts.map((item) => `- \`${item}\``) : ['- aucun']),
      '',
      '## Risques identifiés',
      '',
      ...(this.risks.length ? this.risks.map((item) => `- ${item}`) : ['- aucun']),
      '',
    ];
    await writeFile(path.join(this.artifactDir, 'REPORT.md'), lines.join('\n'), 'utf8');
    return payload;
  }
}

export async function runScenario(meta, fn) {
  const report = new Report(meta);
  try {
    await mkdir(report.artifactDir, { recursive: true });
    await fn(report);
  } catch (error) {
    report.fail('HARNESS-ERROR', 'Exécution du scénario', 'Le scénario se termine sans erreur de harnais', error?.stack || String(error), 'Erreur d’outillage, pas un résultat produit.', 'critical');
    process.exitCode = 1;
  } finally {
    await releaseTrackedResources();
  }
  const payload = await report.write();
  if (process.env.SEASONAL_THEME_STRICT === '1' && payload.counts.fail > 0) process.exitCode = 1;
  if (process.env.SEASONAL_THEME_STRICT_GAPS === '1'
    && payload.counts.fail + payload.counts.blocked + payload.counts['not-run'] > 0) {
    process.exitCode = 1;
  }
  return payload;
}

export function commonPrerequisites() {
  return [
    'Node 20+, `playwright-core` et `esbuild` déjà présents dans `node_modules` (aucune installation).',
    'Chrome/Chromium local ; surcharge possible avec `SEASONAL_THEME_CHROME=<chemin>`.',
    'Aucun serveur de développement, aucun compte de production, aucun secret.',
  ];
}

export function gitStaticCheck(report, id, title, relativePath, predicate, expected, reasonIfMissing = '') {
  const source = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: REPO, encoding: 'utf8' });
  const observed = predicate(source) ? 'condition présente dans HEAD' : 'condition absente de HEAD';
  report.check(id, {
    title,
    expected,
    observed: reasonIfMissing && !predicate(source) ? `${observed} ; ${reasonIfMissing}` : observed,
    status: predicate(source) ? 'pass' : 'fail',
  });
  return source;
}
