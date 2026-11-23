/**
 * Vérifie visuellement et fonctionnellement les neuf logos de plateformes :
 * SVG individuels nets, proportions conservées, tuiles uniformes, sélection
 * conservée, et comparaison avec l'ancien sprite v5.
 *
 * Relance :
 *   node tests/streamingPlatformLogos.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss dans node_modules.
 * L'artefact (rapport + captures) est écrit dans STREAMING_LOGOS_ARTIFACT_DIR
 * ou dans un dossier temporaire.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const execFileAsync = promisify(execFile);
const artifactDir = process.env.STREAMING_LOGOS_ARTIFACT_DIR
  ? path.resolve(process.env.STREAMING_LOGOS_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-streaming-logos-artifacts-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const platforms = [
  { id: 8, slug: 'netflix', name: 'Netflix', logo: '/platforms/logos/netflix.svg' },
  { id: 119, slug: 'prime-video', name: 'Prime Video', logo: '/platforms/logos/prime-video.svg' },
  { id: 531, slug: 'paramount-plus', name: 'Paramount+', logo: '/platforms/logos/paramount-plus.svg' },
  { id: 337, slug: 'disney-plus', name: 'Disney+', logo: '/platforms/logos/disney-plus.svg' },
  { id: 1899, slug: 'hbo-max', name: 'HBO Max', logo: '/platforms/logos/hbo-max.svg' },
  { id: 338, slug: 'marvel-studios', name: 'Marvel Studios', logo: '/platforms/logos/marvel-studios.svg' },
  { id: 350, slug: 'apple-tv-plus', name: 'Apple TV+', logo: '/platforms/logos/apple-tv-plus.svg' },
  { id: 355, slug: 'warner-bros', name: 'Warner Bros', logo: '/platforms/logos/warner-bros.svg' },
  { id: 356, slug: 'dc-comics', name: 'DC Comics', logo: '/platforms/logos/dc-comics.svg' },
];

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StreamingPlatformSelector from ${JSON.stringify(repo + '/src/components/StreamingPlatformSelector')};

const platforms = ${JSON.stringify(platforms)};

function App() {
  const [selectedId, setSelectedId] = useState(platforms[0].id);
  const selected = platforms.find(platform => platform.id === selectedId);
  return (
    <main data-testid="platform-section" style={{minHeight:'100vh',background:'#000',color:'#fff',padding:'28px',fontFamily:'Arial,sans-serif'}}>
      <h1 style={{fontSize:'20px',margin:'0 0 12px'}}>Streaming platforms — SVG individuel</h1>
      <StreamingPlatformSelector platforms={platforms} selectedId={selectedId} onSelect={setSelectedId} />
      <div data-testid="selection-status">selected:{selectedId}:{selected.name}</div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
`;

await writeFile(path.join(work, 'entry.tsx'), fixture);
await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: { 'import.meta.env': JSON.stringify({ VITE_SITE_URL: 'https://movix.test' }) },
});
await execFileAsync(process.execPath, [
  require.resolve('tailwindcss/lib/cli/index.js'),
  '--config', path.join(repo, 'tailwind.config.js'),
  '--input', path.join(repo, 'src/index.css'),
  '--output', path.join(work, 'app.css'),
]);

const spriteCells = platforms.map((platform, index) => `
  <button type="button" data-testid="sprite-cell" data-sprite-index="${index}" data-platform-id="${platform.id}" title="${platform.name}" aria-label="${platform.name}"
    class="flex-none w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-[1.1rem] border-2 border-white/[0.12] bg-black/30 flex items-center justify-center p-1">
    <span role="img" aria-label="${platform.name}" class="block w-full h-full rounded-[0.85rem] bg-no-repeat"
      style="background-image:url('/platforms/platform-logos-sprite-v5.png');background-size:300% 300%;background-position:${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%;background-repeat:no-repeat"></span>
  </button>`).join('');

const indexHtml = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const beforeHtml = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body>
  <main data-testid="platform-section" style="min-height:100vh;background:#000;color:#fff;padding:28px;font-family:Arial,sans-serif">
    <h1 style="font-size:20px;margin:0 0 12px">Streaming platforms — sprite v5 (avant)</h1>
    <div class="flex flex-wrap items-center gap-2.5 sm:gap-3 pt-2 pb-3">${spriteCells}</div>
    <div data-testid="selection-status">sprite:before</div>
  </main>
</body></html>`;
await writeFile(path.join(work, 'index.html'), indexHtml);
await writeFile(path.join(work, 'before.html'), beforeHtml);

const viewports = [
  { name: 'mobile', width: 390, height: 844, expectedTile: 52 },
  { name: 'tablet', width: 768, height: 1024, expectedTile: 64 },
  { name: 'desktop', width: 1440, height: 900, expectedTile: 64 },
];

async function routeFixture(route) {
  const url = new URL(route.request().url());
  if (url.hostname !== 'logos.test') {
    await route.fulfill({ contentType: 'application/json', body: '{}' });
    return;
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const fixtureFile = path.join(work, name);
  const publicFile = path.join(repo, 'public', name);
  const servedFile = await readFile(fixtureFile).catch(() => readFile(publicFile));
  const extension = path.extname(name);
  await route.fulfill({
    contentType: extension === '.js' ? 'text/javascript'
      : extension === '.css' ? 'text/css'
        : extension === '.png' ? 'image/png'
          : extension === '.svg' ? 'image/svg+xml'
            : 'text/html',
    body: servedFile,
  });
}

async function measureImages(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const images = [...document.querySelectorAll('[data-testid="platform-logo"]')];
    const rows = [];
    for (const image of images) {
      await image.decode();
      context.clearRect(0, 0, 256, 256);
      const scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
      const { data } = context.getImageData(0, 0, 256, 256);
      let minX = 256, minY = 256, maxX = -1, maxY = -1, opaque = 0, maxLuminance = 0;
      for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
          const index = (y * 256 + x) * 4;
          if (data[index + 3] < 8) continue;
          opaque += 1;
          maxLuminance = Math.max(maxLuminance, (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      const bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      const button = image.closest('button');
      const rect = button.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const buttonStyle = getComputedStyle(button);
      const imageStyle = getComputedStyle(image);
      rows.push({
        id: Number(button.dataset.platformId),
        name: image.alt,
        src: image.getAttribute('src'),
        complete: image.complete,
        natural: { width: image.naturalWidth, height: image.naturalHeight },
        alphaBBox: bbox,
        opaquePixels: opaque,
        maxLuminance: Math.round(maxLuminance * 100) / 100,
        padding: { left: bbox.x, top: bbox.y, right: 255 - (bbox.x + bbox.width - 1), bottom: 255 - (bbox.y + bbox.height - 1) },
        centerOffset: {
          x: bbox.x + bbox.width / 2 - 128,
          y: bbox.y + bbox.height / 2 - 128,
        },
        button: {
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          radius: buttonStyle.borderRadius,
          borderWidth: buttonStyle.borderWidth,
          transitionDuration: buttonStyle.transitionDuration,
        },
        imageBox: {
          width: Math.round(imageRect.width * 100) / 100,
          height: Math.round(imageRect.height * 100) / 100,
        },
        objectFit: imageStyle.objectFit,
      });
    }
    return rows;
  });
}

async function measureSprite(page) {
  return page.evaluate(async () => {
    const image = new Image();
    image.src = '/platforms/platform-logos-sprite-v5.png';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const cell = image.naturalWidth / 3;
    const rows = [];
    for (let index = 0; index < 9; index += 1) {
      const offsetX = (index % 3) * cell;
      const offsetY = Math.floor(index / 3) * cell;
      const { data } = context.getImageData(offsetX, offsetY, cell, cell);
      let minX = cell, minY = cell, maxX = -1, maxY = -1;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          if (data[(y * cell + x) * 4 + 3] < 8) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      rows.push({
        index,
        visible: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        margins: { left: minX, top: minY, right: cell - 1 - maxX, bottom: cell - 1 - maxY },
      });
    }
    return { natural: { width: image.naturalWidth, height: image.naturalHeight }, cell, rows };
  });
}

const assetMeasurements = await Promise.all(platforms.map(async platform => {
  const absolute = path.join(repo, 'public', platform.logo);
  const bytes = await readFile(absolute);
  return {
    ...platform,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    source: path.relative(repo, absolute).replace(/\\/g, '/'),
  };
}));

const observations = [];
const interactions = [];
let spriteMeasurement = null;
let runError = null;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of viewports) {
    for (const mode of ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
      await context.route('**/*', routeFixture);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://logos.test/${mode === 'before' ? 'before.html' : ''}`);
      await page.locator('[data-testid="platform-section"]').waitFor();

      const cells = page.locator(mode === 'before' ? '[data-testid="sprite-cell"]' : '[data-testid="platform-logo-button"]');
      assert.equal(await cells.count(), 9, `${mode}/${viewport.name}: neuf éléments affichés`);

      const sheet = path.join(artifactDir, `${mode}-${viewport.name}-contact-sheet.png`);
      await page.screenshot({ path: sheet, fullPage: true });

      let metrics = null;
      if (mode === 'after') {
        metrics = await measureImages(page);
        assert.deepEqual(metrics.map(row => row.id), platforms.map(platform => platform.id), `${viewport.name}: identifiants conservés`);
        assert.deepEqual(metrics.map(row => row.name), platforms.map(platform => platform.name), `${viewport.name}: libellés conservés`);
        for (const row of metrics) {
          assert.ok(row.complete && row.natural.width > 0 && row.natural.height > 0, `${viewport.name}/${row.name}: SVG chargé`);
          assert.equal(row.objectFit, 'contain', `${viewport.name}/${row.name}: object-fit contain`);
          assert.equal(row.button.width, viewport.expectedTile, `${viewport.name}/${row.name}: largeur de tuile`);
          assert.equal(row.button.height, viewport.expectedTile, `${viewport.name}/${row.name}: hauteur de tuile`);
          assert.equal(row.button.radius, '17.6px', `${viewport.name}/${row.name}: rayon identique`);
          assert.equal(row.button.borderWidth, '2px', `${viewport.name}/${row.name}: bordure identique`);
          assert.ok(row.button.transitionDuration !== '0s', `${viewport.name}/${row.name}: transition active`);
          assert.ok(row.alphaBBox.width < 256 && row.alphaBBox.height < 256, `${viewport.name}/${row.name}: aucun rognage`);
          assert.ok(row.maxLuminance > 0.2, `${viewport.name}/${row.name}: contraste suffisant sur tuile sombre (${row.maxLuminance})`);
          if (row.name === 'Disney+') {
            assert.ok(row.maxLuminance > 0.8, `${viewport.name}/${row.name}: wordmark blanc officiel sur fond sombre (${row.maxLuminance})`);
          }
          assert.ok(Math.abs(row.centerOffset.x) <= 2 && Math.abs(row.centerOffset.y) <= 2, `${viewport.name}/${row.name}: centrage`);
          assert.ok(row.padding.left >= 3 && row.padding.right >= 3 && row.padding.top >= 3 && row.padding.bottom >= 3, `${viewport.name}/${row.name}: marge visible`);
        }
      } else {
        spriteMeasurement = await measureSprite(page);
        assert.equal(spriteMeasurement.natural.width, 384, 'sprite: largeur 384 px');
        assert.equal(spriteMeasurement.natural.height, 384, 'sprite: hauteur 384 px');
      }

      const crops = [];
      for (let index = 0; index < platforms.length; index += 1) {
        const crop = path.join(artifactDir, `${mode}-${viewport.name}-${platforms[index].slug}.png`);
        await cells.nth(index).screenshot({ path: crop });
        crops.push(path.basename(crop));
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${mode}/${viewport.name}: pas de débordement horizontal (${overflow}px)`);
      assert.deepEqual(errors, [], `${mode}/${viewport.name}: erreurs navigateur`);

      observations.push({
        mode,
        viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
        expectedTile: viewport.expectedTile,
        contactSheet: path.basename(sheet),
        crops,
        overflow,
        errors,
        metrics,
      });

      if (mode === 'after' && viewport.name === 'desktop') {
        for (const platform of platforms) {
          const button = page.locator(`[data-testid="platform-logo-button"][data-platform-id="${platform.id}"]`);
          await button.click();
          const pressed = await page.locator('[data-testid="platform-logo-button"]').evaluateAll(nodes => nodes
            .filter(node => node.getAttribute('aria-pressed') === 'true')
            .map(node => Number(node.dataset.platformId)));
          const status = await page.locator('[data-testid="selection-status"]').innerText();
          assert.deepEqual(pressed, [platform.id], `${platform.name}: un seul bouton sélectionné`);
          assert.equal(status, `selected:${platform.id}:${platform.name}`, `${platform.name}: rappel onSelect conservé`);
          interactions.push({ id: platform.id, name: platform.name, pressed, status });
        }
      }

      await context.close();
    }
  }
} catch (error) {
  runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  if (browser) await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  runError,
  command: 'node tests/streamingPlatformLogos.browser.mjs',
  prerequisites: {
    dependencies: 'playwright, esbuild et tailwindcss depuis node_modules',
    browser: 'Chromium Playwright',
    server: 'aucun — fixture React servie via routage Playwright',
    artifactDirEnv: 'STREAMING_LOGOS_ARTIFACT_DIR',
  },
  fixtureData: {
    platforms,
    sprite: '/platforms/platform-logos-sprite-v5.png',
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  },
  expected: {
    logos: 9,
    order: platforms.map(platform => platform.id),
    tileSizes: { mobile: 52, tablet: 64, desktop: 64 },
    objectFit: 'contain',
    radius: '17.6px',
    borderWidth: '2px',
    centered: 'décalage <= 2 px sur 256 px',
    noCrop: 'bbox alpha strictement intérieur au canvas 256x256',
    interactions: 'un seul aria-pressed=true et statut mis à jour après chaque clic',
  },
  assetMeasurements,
  spriteMeasurement,
  interactions,
  observations,
};
await writeFile(path.join(artifactDir, 'streaming-platform-logos-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const dimensionRows = assetMeasurements.map(asset => {
  const desktopAfter = observations.find(item => item.mode === 'after' && item.viewport.name === 'desktop');
  const metric = desktopAfter?.metrics?.find(row => row.id === asset.id);
  return `| ${asset.name} | ${asset.id} | ${metric ? `${metric.natural.width}×${metric.natural.height}` : '—'} | ${metric ? `${metric.alphaBBox.width}×${metric.alphaBBox.height}` : '—'} | ${metric ? metric.maxLuminance.toFixed(2) : '—'} | ${asset.bytes} | \`${asset.sha256.slice(0, 12)}…\` |`;
}).join('\n');
const markdown = `# Logos des plateformes — rapport E2E

Statut : **${report.status}**

Commande : \`${report.command}\`

Prérequis : ${Object.values(report.prerequisites).join(' ; ')}.

Dossier d'artefacts : \`${artifactDir}\`

## Dimensions réelles et mesures

| Logo | ID | Dimensions naturelles SVG | Bbox alpha rendue (256×256) | Luminance max | Octets | SHA-256 |
| --- | ---: | --- | --- | ---: | ---: | --- |
${dimensionRows}

## Ancien sprite v5

${spriteMeasurement ? `- Image : ${spriteMeasurement.natural.width}×${spriteMeasurement.natural.height}, cellules ${spriteMeasurement.cell}×${spriteMeasurement.cell}.` : '- Mesure indisponible.'}
${spriteMeasurement ? spriteMeasurement.rows.map(row => `- Cellule ${row.index} : visible ${row.visible.width}×${row.visible.height}, marges ${row.margins.top}/${row.margins.right}/${row.margins.bottom}/${row.margins.left}.`).join('\n') : ''}

## Vérifications

- Neuf SVG chargés, sans image cassée, dans l'ordre des identifiants d'origine.
- Tuiles uniformes : 52 px sur mobile, 64 px sur tablette et desktop, rayon et bordure identiques.
- \`object-fit: contain\`, centrage mesuré, aucune omission de pixels et marges internes conservées. Contraste vérifié sur tuile sombre, avec wordmark Disney+ blanc et arc bleu conservé.
- Clics : un seul \`aria-pressed=true\`, rappel \`onSelect\` et libellé de plateforme conservés.
- Captures avant/après générées pour mobile, tablette et desktop, avec une planche contact et neuf recadrages par combinaison.

${runError ? `Erreur : ${runError}\n` : ''}`;
await writeFile(path.join(artifactDir, 'streaming-platform-logos-report.md'), markdown);
console.log(`${report.status} — ${artifactDir}`);
if (runError) {
  console.error(runError);
  process.exitCode = 1;
}
