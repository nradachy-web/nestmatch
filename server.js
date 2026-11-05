// Local server: serves the app and proxies RentCast so the API key never reaches the browser.
// Usage: node server.js   (put RENTCAST_API_KEY=... in a .env file in this folder for live listings)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3008;
const ROOT = __dirname;
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_HOURS = 24; // RentCast's free plan is 50 requests/month, so cache hard

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* no .env */ }
}
loadEnv();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function liveListings(query, res) {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return send(res, 501, { error: 'no_key', message: 'Add RENTCAST_API_KEY to .env and restart the server.' });

  const city = (query.get('city') || '').trim();
  const state = (query.get('state') || '').trim().toUpperCase();
  if (!city || !/^[A-Z]{2}$/.test(state)) return send(res, 400, { error: 'bad_query', message: 'Enter a city and a 2-letter state.' });

  const cacheFile = path.join(CACHE_DIR, `${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${state}.json`);
  try {
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs < CACHE_HOURS * 3600e3) return send(res, 200, fs.readFileSync(cacheFile));
  } catch (e) { /* not cached */ }

  const url = `https://api.rentcast.io/v1/listings/sale?city=${encodeURIComponent(city)}&state=${state}&status=Active&limit=150`;
  try {
    const r = await fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    const text = await r.text();
    if (!r.ok) return send(res, r.status, { error: 'upstream', message: `RentCast returned ${r.status}: ${text.slice(0, 200)}` });
    const body = JSON.stringify({ fetchedAt: new Date().toISOString(), listings: JSON.parse(text) });
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, body);
    send(res, 200, body);
  } catch (e) {
    send(res, 502, { error: 'network', message: e.message });
  }
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/status') return send(res, 200, { live: Boolean(process.env.RENTCAST_API_KEY) });
  if (u.pathname === '/api/listings') return liveListings(u.searchParams, res);

  const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.startsWith('.') || rel.includes('/.') || path.basename(file) === 'server.js') {
    return send(res, 404, 'Not found', 'text/plain');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}).listen(PORT, '127.0.0.1', () => console.log(`NestMatch running at http://localhost:${PORT}`));
