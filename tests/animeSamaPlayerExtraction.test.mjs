// Contrat de résolution des lecteurs Anime-Sama côté SPA.
//
// Les scénarios navigateur (`playwright`) ne sont pas disponibles dans tous les
// environnements ; ce banc teste les frontières observables sans lancer de
// serveur ni fabriquer d'URL :
//   - registre « embed -> flux » alimenté par une réponse catalogue ;
//   - extracteurs désactivés (aucun appel réseau, aucun flux inventé) ;
//   - contrat de résultat consommé par WatchMovie/WatchTv ;
//   - détection Supervideo/Dropload via le registre réel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const MAIN_API = 'https://api.movix.test';
const SUPERVIDEO_EMBED = 'https://supervideo.cc/embed-abc123';
const DROPLOAD_EMBED = 'https://dropload.tv/embed-def456';
const HLS = 'https://flux.test/anime/saison1/ep1/master.m3u8';

const transpile = (file) => ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const makeWindow = () => ({
  addEventListener: () => {},
  hasMovixNexusExtractor: true,
  movixExtractM3u8: null,
});

function loadHosterRegistry(win = makeWindow()) {
  const sourcePriority = {
    BUILTIN_HOSTER_IDS: [
      'voe', 'vidmoly', 'uqload', 'sibnet', 'veev', 'doodstream',
      'lulustream', 'vidara', 'seekstreaming', 'vidzy', 'fsvid',
      'smoothpre', 'minochinos', 'supervideo', 'dropload', 'oneupload',
    ],
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'window', transpile('src/utils/hosterRegistry.ts'))(
    () => sourcePriority, mod, mod.exports, win,
  );
  return mod.exports;
}

function loadExtractionModule() {
  const win = makeWindow();
  const hosterRegistry = loadHosterRegistry(win);
  const state = { bridgeCalls: [], serverExtraction: false };
  const prefs = {
    patternOverrides: {},
    customHosters: {},
    categories: { anime: { hosterOrder: [] } },
  };
  const stubs = {
    './extractionPrefs': { isM3u8ExtractorEnabled: () => true },
    './serverResolveRequest': { usesServerExtraction: () => state.serverExtraction },
    './hosterRegistry': hosterRegistry,
    './sourcePriorityPrefs': { getSourcePriorityPrefs: () => prefs },
    './sourceAutoSelect': { sortHostersByPriority: (items) => items },
    './embeddedSubtitles': { registerEmbeddedSubtitles: () => {} },
    './seekStreamingCandidates': {
      hasCompleteBulkCoverage: () => false,
      isSeekStreamingEmbedUrl: () => false,
      normalizeSeekStreamingCandidates: (candidates) => candidates,
    },
  };
  const mod = { exports: {} };
  win.movixExtractM3u8 = async (type, url) => {
    state.bridgeCalls.push({ type, url });
    return { success: false, error: 'hébergeur temporairement indisponible' };
  };
  new Function('require', 'module', 'exports', 'window', transpile('src/utils/extractM3u8.ts'))(
    (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      throw new Error(`Dépendance non simulée : ${name}`);
    },
    mod, mod.exports, win,
  );
  return { api: mod.exports, state };
}

test('Supervideo et Dropload sont reconnus par le registre d’hébergeurs', () => {
  const { detectHoster } = loadHosterRegistry();
  assert.equal(detectHoster(SUPERVIDEO_EMBED, {}), 'supervideo');
  assert.equal(detectHoster(DROPLOAD_EMBED, {}), 'dropload');
});

test('une référence lien: résolue par le serveur est consommée sans réseau, même si l’extracteur est désactivé', async () => {
  const { api, state } = loadExtractionModule();
  // Forme exacte de la réponse /anime/episode/:slug quand resolve=1 + VIP.
  api.registerServerResolvedSources({ m3u8ByPlayer: { [SUPERVIDEO_EMBED]: HLS } });

  const result = await api.extractM3u8FromEmbed({ player: 'Supervideo', link: SUPERVIDEO_EMBED }, MAIN_API);

  assert.equal(result.success, true);
  assert.equal(result.m3u8Url, HLS, 'la m3u8 résolue doit être rendue telle quelle');
  assert.deepEqual(state.bridgeCalls, [], 'aucun bridge/extracteur local ne doit être appelé');
});

test('un extracteur désactivé rend un échec explicite, sans URL fabriquée ni appel réseau', async () => {
  const { api, state } = loadExtractionModule();

  const supervideo = await api.extractM3u8FromEmbed({ player: 'Supervideo', link: SUPERVIDEO_EMBED }, MAIN_API);
  const dropload = await api.extractM3u8FromEmbed({ player: 'Dropload', link: DROPLOAD_EMBED }, MAIN_API);

  for (const result of [supervideo, dropload]) {
    assert.equal(result.success, false);
    assert.equal(result.reason, 'disabled', 'un extracteur retiré n’est pas une panne réseau');
    assert.match(result.error, /désactivées/i);
    assert.equal(result.hlsUrl, undefined);
    assert.equal(result.m3u8Url, undefined);
  }
  assert.deepEqual(state.bridgeCalls, [], 'le bridge local ne doit pas être sollicité');
});

test('un hébergeur temporairement indisponible ne produit aucune URL HLS', async () => {
  const { api, state } = loadExtractionModule();
  // Aucune m3u8 dans le registre : le bridge local répond 503. Le résultat
  // reste un échec distinct d’un extracteur désactivé.
  const progress = await api.extractM3u8OnDetection(
    [{ player: 'Voe', link: 'https://voe.test/embed-503' }],
    MAIN_API,
  );

  assert.equal(progress.length, 1);
  assert.equal(progress[0].status, 'error');
  assert.notEqual(progress[0].result?.reason, 'disabled');
  assert.equal(api.extractedStreamUrl(progress[0].result), null, 'aucune URL ne doit être inventée en repli');
  assert.ok(state.bridgeCalls.length > 0, 'la passe locale a bien essayé le bridge');
});

test('le contrat de résultat accepte hlsUrl et m3u8Url, mais jamais un champ absent', () => {
  const { api } = loadExtractionModule();
  assert.equal(api.extractedStreamUrl({ success: true, hlsUrl: HLS }), HLS);
  assert.equal(api.extractedStreamUrl({ success: true, m3u8Url: HLS }), HLS);
  assert.equal(api.extractedStreamUrl({ success: true }), null);
  assert.equal(api.extractedStreamUrl({ success: false, hlsUrl: HLS }), null, 'un échec ne fournit pas de flux');
  assert.equal(api.extractedStreamUrl(null), null);
});

test('un flux HLS valide reste utilisable tel quel par le lecteur', () => {
  const { api } = loadExtractionModule();
  const result = api.extractedStreamUrl({ success: true, m3u8Url: HLS });
  assert.ok(result);
  assert.match(result, /\.m3u8(?:\?|$)/, 'le flux est une playlist HLS explicite');
  assert.equal(result, HLS, 'aucune réécriture ne doit être appliquée ici');
});
