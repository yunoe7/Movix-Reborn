import https from "node:https";
import { createRequire } from "node:module";

const require = createRequire("/tmp/socks-probe/package.json");
const { SocksProxyAgent } = require("socks-proxy-agent");

const LIST_URL = "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt";
const MAX_CANDIDATES = 20;
const TIMEOUT_MS = 9000;

async function loadCandidates() {
  const response = await fetch(LIST_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Liste SOCKS5 inaccessible: HTTP ${response.status}`);
  const text = await response.text();
  return [...new Set(text.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean))]
    .filter((line) => /^\\d{1,3}(?:\\.\\d{1,3}){3}:\\d+$/.test(line))
    .slice(0, MAX_CANDIDATES)
    .map((address) => `socks5h://${address}`);
}

function testProxy(proxy, index) {
  return new Promise((resolve) => {
    const req = https.get("https://api.ipify.org?format=json", {
      agent: new SocksProxyAgent(proxy),
      timeout: TIMEOUT_MS,
      headers: { "user-agent": "Movix-SOCKS5-diagnostic/1.0" },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const ip = JSON.parse(body).ip || "IP inconnue";
            console.log(`OK ${proxy.replace("socks5h://", "")} — HTTPS 200 — sortie ${ip}`);
            resolve({ proxy, ok: true });
          } catch {
            console.log(`ECHEC ${proxy} — réponse invalide`);
            resolve({ proxy, ok: false });
          }
        } else {
          console.log(`ECHEC ${proxy} — HTTP ${res.statusCode}`);
          resolve({ proxy, ok: false });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => {
      console.log(`ECHEC ${proxy.replace("socks5h://", "")} — ${error.message}`);
      resolve({ proxy, ok: false });
    });
  });
}

const candidates = await loadCandidates();
console.log(`Candidats chargés: ${candidates.length} SOCKS5 (liste publique pré-vérifiée)`);
if (!candidates.length) throw new Error("Aucun candidat SOCKS5 reçu");
const results = await Promise.all(candidates.map((proxy, i) => testProxy(proxy, i + 1)));
const working = results.filter((result) => result.ok).map((result) => result.proxy);
console.log(`BILAN HTTPS: ${working.length}/${results.length} fonctionnel(s)`);
if (working.length) {
  console.log("PROXIES À RETENIR POUR TESTS UNIQUEMENT:");
  for (const proxy of working) console.log(proxy);
}
if (!working.length) process.exitCode = 1;
