import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MARKETS, APP_ID } from '../src/config.mjs';
import { parseApple } from '../src/apple.mjs';
import { validateDataset, validateFx } from '../src/domain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(root, 'data');
await mkdir(dataDir, { recursive: true });
const args = new Set(process.argv.slice(2));
const requested = process.argv.find(x => x.startsWith('--markets='))?.slice(10).split(',');
if (requested?.some(code => !MARKETS.some(m => m.code === code))) throw new Error('Unknown market code');
const selected = MARKETS.filter(m => !requested || requested.includes(m.code));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function readJson(file, fallback) { try { return JSON.parse(await readFile(path.join(dataDir, file), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function atomicJson(file, value) {
  const target = path.join(dataDir, file);
  await writeFile(`${target}.tmp`, JSON.stringify(value, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
}
async function fetchText(url, timeout = 25000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'GPTPriceRadar/0.1 (public pricing research)', 'Accept-Language': 'en-US,en;q=0.8' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

let successes = 0;
let unavailable = 0;
if (!args.has('--fx-only')) {
  const previous = await readJson('prices.json', { schemaVersion: 1, observations: [], markets: [] });
  let observations = [...previous.observations];
  const statuses = new Map(previous.markets.map(m => [m.code, m]));
  for (const market of selected) {
    const sourceUrl = `https://apps.apple.com/${market.code}/app/chatgpt/id${APP_ID}`;
    const attemptedAt = new Date().toISOString();
    try {
      const html = await fetchText(sourceUrl);
      const prices = parseApple(html, market);
      const sourceSha256 = createHash('sha256').update(html).digest('hex');
      const records = prices.map((p, i) => ({
        id: `ios-${market.code}-${p.planId}-${i}`, region: market.code, channel: 'ios',
        ...p, currency: market.currency, period: 'unknown', verification: 'observed',
        taxStatus: 'unknown', offerType: 'unknown', periodEvidence: null, taxEvidence: null,
        observedAt: attemptedAt, sourceUrl, sourceSha256,
        notes: '公开 App Store 列价；列表未提供订阅周期、税费口径或适用条件。'
      }));
      // Reviews belong to a specific observed price. Never carry a verified status onto changed data.
      observations = observations.filter(r => r.region !== market.code).concat(records.map(r => {
        const old = previous.observations.find(p => p.region === r.region && p.planId === r.planId && p.amount === r.amount && p.currency === r.currency && p.sourceName === r.sourceName && p.displayPrice === r.displayPrice);
        return old?.verification === 'verified' ? { ...r, verification: old.verification, period: old.period, taxStatus: old.taxStatus, offerType: old.offerType, periodEvidence: old.periodEvidence, taxEvidence: old.taxEvidence, reviewedAt: old.reviewedAt } : r;
      }));
      statuses.set(market.code, { code: market.code, status: 'ok', attemptedAt, observedAt: attemptedAt, count: records.length });
      successes++;
      console.log(`${market.code.toUpperCase()}: ${records.length} public price observations`);
    } catch (error) {
      const old = previous.markets.find(m => m.code === market.code);
      const isUnavailable = error.message === 'HTTP 404';
      if (isUnavailable) unavailable++;
      statuses.set(market.code, { code: market.code, status: isUnavailable ? 'unavailable' : 'error', attemptedAt, observedAt: old?.observedAt ?? null, error: error.message });
      console.warn(`${market.code.toUpperCase()}: ${error.message}; retaining previous observations`);
    }
    await sleep(1400);
  }
  const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), observations, markets: [...statuses.values()] };
  validateDataset(result);
  await atomicJson('prices.json', result);
}

let fxOk = false;
if (!args.has('--prices-only')) {
  try {
    const quotes = [...new Set(['CNY', ...MARKETS.map(m => m.currency)])].filter(c => c !== 'USD').join(',');
    // ECB alone does not cover TWD; the central-bank aggregate covers all configured currencies.
    const sourceUrl = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${quotes}&expand=providers`;
    const rows = JSON.parse(await fetchText(sourceUrl));
    const rates = Object.fromEntries(rows.map(r => [r.quote, { rate: r.rate, date: r.date, providers: r.providers ?? [] }]));
    const fx = { schemaVersion: 1, base: 'USD', provider: 'Frankfurter / central-bank aggregate', sourceUrl, fetchedAt: new Date().toISOString(), frequency: 'daily', rates };
    validateFx(fx);
    await atomicJson('fx.json', fx);
    fxOk = true;
    console.log(`FX: ${rows.length} currencies, daily reference rates`);
  } catch (error) { console.warn(`FX update failed: ${error.message}; retaining previous snapshot`); }
}

if (!args.has('--prices-only') && !fxOk) process.exitCode = 1;
if (!args.has('--fx-only') && successes + unavailable < selected.length) process.exitCode = 1;
