import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

const proxies = [
  "socks5h://158.220.101.43:1080",
  "socks5h://170.233.72.43:1080",
];

function testProxy(proxy, index) {
  return new Promise((resolve) => {
    const req = https.get(
      "https://api.ipify.org?format=json",
      {
        agent: new SocksProxyAgent(proxy),
        timeout: 10000,
        headers: { "user-agent": "Movix-SOCKS5-diagnostic/1.0" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              console.log(`PROXY ${index}: OK — HTTPS 200 — sortie ${parsed.ip || "IP non fournie"}`);
              resolve(true);
            } catch {
              console.log(`PROXY ${index}: ECHEC — réponse JSON invalide`);
              resolve(false);
            }
          } else {
            console.log(`PROXY ${index}: ECHEC — HTTP ${res.statusCode}`);
            resolve(false);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("TIMEOUT après 10 s")));
    req.on("error", (error) => {
      console.log(`PROXY ${index}: ECHEC — ${error.message}`);
      resolve(false);
    });
  });
}

(async () => {
  const results = [];
  for (let i = 0; i < proxies.length; i += 1) {
    results.push(await testProxy(proxies[i], i + 1));
  }
  console.log(`BILAN: ${results.filter(Boolean).length}/${results.length} proxy(s) fonctionnel(s) depuis le runner GitHub`);
  if (!results.some(Boolean)) process.exitCode = 1;
})();
