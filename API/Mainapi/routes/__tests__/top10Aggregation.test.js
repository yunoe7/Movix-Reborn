const test = require("node:test");
const assert = require("node:assert/strict");
const { router, initTop10Routes } = require("../../top10Routes");

async function invoke(path, query = {}) {
  const statements = [];
  const pool = {
    async execute(sql, params) {
      statements.push({ sql, params });
      return [[]];
    },
  };
  initTop10Routes(pool, null);
  const layer = router.stack.find((entry) => entry.route?.path === path);
  assert.ok(layer, `route ${path} exists`);
  const handler = layer.route.stack.find((entry) => entry.method === "get").handle;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ query }, res);
  assert.equal(res.statusCode, 200);
  return { statements, payload: res.payload };
}

test("Top 10 films cumule les lignes par utilisateur et titre avant le seuil de 20 min", async () => {
  const { statements, payload } = await invoke("/movies");
  assert.equal(payload.top10.length, 0);
  assert.match(statements[0].sql, /GROUP BY user_id, content_id/);
  assert.match(statements[0].sql, /HAVING SUM\(watch_duration\) >= \?/);
  assert.doesNotMatch(statements[0].sql, /watch_duration >= \?/);
  assert.equal(statements[0].params.at(-1), 1200);
});

for (const category of ["tv", "anime"]) {
  test(`Top 10 ${category} applique les 5 min après cumul par épisode`, async () => {
    const { statements } = await invoke(`/${category}`);
    assert.match(statements[0].sql, /GROUP BY user_id, content_id, season_number, episode_number/);
    assert.match(statements[0].sql, /HAVING SUM\(watch_duration\) >= \?/);
    assert.equal(statements[0].params.at(-1), 300);
  });
}

test("les statistiques globales utilisent le seuil adapté au type et cumulent avant filtrage", async () => {
  const { statements } = await invoke("/stats");
  const sql = statements[0].sql;
  assert.match(sql, /CASE WHEN content_type = 'movie' THEN 1200 ELSE 300 END/);
  assert.match(sql, /GROUP BY user_id, content_id/);
  assert.match(sql, /HAVING SUM\(watch_duration\)/);
  assert.doesNotMatch(sql, /WHERE watch_duration >=/);
});

test("les statistiques d'une catégorie filtrent bien le type demandé", async () => {
  const { statements } = await invoke("/stats", { type: "movies" });
  assert.match(statements[0].sql, /content_type = \?/);
  assert.deepEqual(statements[0].params, ["movie"]);
});
