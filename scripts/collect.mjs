import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MARKETS, APP_ID, PLANS } from '../src/config.mjs';
import { parseApple } from '../src/apple.mjs';
import { parseAndroid } from '../src/android.mjs';
import { parseOfficialWebBaseline, OFFICIAL_PRICE_URL,checkoutConfigUrl,makeCheckoutRecords,canonicalJson } from '../src/web.mjs';
import { validateDataset, validateFx } from '../src/domain.mjs';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
await mkdir(dataDir, { recursive: true });
const args = new Set(process.argv.slice(2));
const requested = process.argv.find(x => x.startsWith('--markets='))?.slice(10).split(',');
const channelArg = process.argv.find(x => x.startsWith('--channels='))?.slice(11).split(',') ?? ['ios', 'android', 'web'];
if (requested?.some(code => !MARKETS.some(m => m.code === code)) || channelArg.some(c => !['ios','android','web'].includes(c))) throw new Error('Unknown market/channel');
const selected = MARKETS.filter(m => !requested || requested.includes(m.code));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cooldowns = new Map();
async function readJson(file, fallback) { try { return JSON.parse(await readFile(path.join(dataDir, file), 'utf8')); } catch(e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function atomicJson(file, data) { const target = path.join(dataDir, file); await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2) + '\n'); await rename(`${target}.tmp`, target); }
async function fetchText(url) {
  const host=new URL(url).hostname;
  const wait=(cooldowns.get(host)??0)-Date.now();
  if(wait>60000)throw new Error('Source rate-limit cooldown; defer until next collection');
  if(wait>0)await sleep(wait);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(18000), headers: { 'User-Agent': 'GPTPriceRadar/0.2 public pricing research', 'Accept-Language': 'en-US,en;q=0.8' } });
      if (!r.ok) {
        if(r.status===429){const header=r.headers.get('retry-after');const seconds=Number(header);const until=header?(Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(header)):Date.now()+5000;cooldowns.set(host,Math.max(Date.now()+5000,until||0));}
        const error = new Error(`HTTP ${r.status}`); error.status = r.status; throw error;
      }
      if (new URL(url).hostname === 'apps.apple.com' && new URL(r.url).pathname.split('/')[1] !== new URL(url).pathname.split('/')[1]) throw new Error('Storefront redirect mismatch');
      return await r.text();
    } catch (e) {
      // A rate limit, access challenge or absent page is recorded without bypass or immediate retry.
      if (attempt || [403, 404, 429].includes(e.status)) throw e;
      await sleep(1200);
    }
  }
}
async function pool(items, task) {
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => { while (cursor < items.length) { const item = items[cursor++]; await task(item); await sleep(650); } }));
}
const fingerprint = text => createHash('sha256').update(text).digest('hex');
let failures = 0;
let criticalFailure = false;
const successes = { ios: 0, android: 0, web: 0 };
if (!args.has('--fx-only')) {
  const previous = await readJson('prices.json', { schemaVersion: 2, observations: [], ranges: [], markets: [] });
  let observations = previous.observations.filter(r => r.origin !== 'reviewed_submission');
  let ranges = previous.ranges ?? [];
  const documents={...(previous.documents??{})};
  const statuses = new Map(previous.markets.map(m => [`${m.channel ?? 'ios'}:${m.code}`, { ...m, channel: m.channel ?? 'ios' }]));
  const jobs = [];
  for (const channel of channelArg.filter(c => c !== 'web')) jobs.push(pool(selected, async market => {
    const sourceUrl = channel === 'ios' ? `https://apps.apple.com/${market.code}/app/chatgpt/id${APP_ID}` : `https://play.google.com/store/apps/details?id=com.openai.chatgpt&gl=${market.code.toUpperCase()}&hl=en`;
    const attemptedAt = new Date().toISOString();
    try {
      const html = await fetchText(sourceUrl), sourceSha256 = fingerprint(html);
      let count = 0;
      if (channel === 'ios') {
        const records = parseApple(html, market).map((p, i) => ({ id: `ios-${market.code}-${p.planId}-${i}`, region: market.code, channel, ...p, period: 'unknown', verification: 'observed', taxStatus: 'unknown', offerType: 'unknown', periodEvidence: null, taxEvidence: null, observedAt: attemptedAt, sourceUrl, sourceSha256, origin: 'apple_public', notes: '公开列价；周期和税费未知。币种来自单品ISO或同页商店币种，详情保留证据范围。' }));
        observations = observations.filter(r => !(r.region === market.code && r.channel === channel)).concat(records);
        count = records.length;
      } else {
        const range = parseAndroid(html);
        ranges = ranges.filter(r => r.region !== market.code);
        if (range) { ranges.push({ id: `android-${market.code}-all-products`, region: market.code, channel, ...range, observedAt: attemptedAt, sourceUrl, sourceSha256 }); count = 1; }
      }
      statuses.set(`${channel}:${market.code}`, { code: market.code, channel, status: count ? 'ok' : 'no_public_range', attemptedAt, observedAt: attemptedAt, count, sourceUrl });
      successes[channel]++;
      console.log(`${channel}/${market.code}: ${count} ${channel === 'ios' ? 'quotes' : 'aggregate ranges'}`);
    } catch (e) {
      const old = statuses.get(`${channel}:${market.code}`);
      const unavailable = e.status === 404;
      if (!unavailable) failures++;
      statuses.set(`${channel}:${market.code}`, { code: market.code, channel, status: unavailable ? 'unavailable' : 'error', attemptedAt, observedAt: old?.observedAt ?? null, error: e.message, sourceUrl });
      console.warn(`${channel}/${market.code}: ${e.message}; previous observation preserved`);
    }
  }));
  if (channelArg.includes('web')) jobs.push((async () => {
    const attemptedAt = new Date().toISOString();
    try {
      const html = await fetchText(OFFICIAL_PRICE_URL), sourceSha256 = fingerprint(html);
      const baselines = parseOfficialWebBaseline(html).map(p => ({ id: `web-global-${p.planId}`, region: 'global', channel: 'web', scope: 'global_reference', ...p, sourceName: PLANS.find(x => x.id === p.planId)?.sourceName ?? p.planId, displayPrice: `$${p.amount.toFixed(2)}`, verification: 'observed', taxStatus: 'unknown', offerType: 'standard', periodEvidence: { url: OFFICIAL_PRICE_URL, note: '官方明确的 USD per month 基线；不是任何地区的结账报价。' }, taxEvidence: null, sourceUrl: OFFICIAL_PRICE_URL, sourceSha256, observedAt: attemptedAt, origin: 'official_web_baseline' }));
      observations = observations.filter(r => !(r.channel === 'web' && r.region === 'global')).concat(baselines);
      statuses.set('web:global', { code: 'global', channel: 'web', status: 'ok', attemptedAt, observedAt: attemptedAt, count: baselines.length, sourceUrl: OFFICIAL_PRICE_URL });
      console.log(`web/global: ${baselines.length} official monthly USD baselines (not regional ranking)`);
      successes.web++;
    } catch (e) { failures++; const old = statuses.get('web:global'); statuses.set('web:global', { code:'global', channel:'web', status:'error', attemptedAt, observedAt:old?.observedAt??null, error:e.message, sourceUrl:OFFICIAL_PRICE_URL }); }
    let regionSuccesses=0,accessFailures=0;
    await pool(selected,async m=>{
      const sourceUrl=checkoutConfigUrl(m.code),checkedAt=new Date().toISOString();
      if(accessFailures>=3){const old=statuses.get(`web:${m.code}`);statuses.set(`web:${m.code}`,{code:m.code,channel:'web',status:'access_blocked',observedAt:old?.observedAt??null,reason:'自动采集环境无法读取官方接口；未刷新原观测时间。',sourceUrl});return;}
      try{
        const body=JSON.parse(await fetchText(sourceUrl));
        const sha256=fingerprint(canonicalJson(body)),docId=`web-${m.code}-${sha256.slice(0,16)}`;
        const doc={kind:'official_checkout_config',sourceUrl,observedAt:checkedAt,sha256,hashKind:'canonical_json',retrievedVia:'direct HTTPS GET of official anonymous endpoint',body};
        const records=makeCheckoutRecords(body,m.code,docId,doc);
        documents[docId]=doc;
        observations=observations.filter(r=>!(r.channel==='web'&&r.region===m.code)).concat(records);
        statuses.set(`web:${m.code}`,{code:m.code,channel:'web',status:'official_config',attemptedAt:checkedAt,observedAt:checkedAt,count:records.length,sourceUrl});
        regionSuccesses++;successes.web++;console.log(`web/${m.code}: ${records.length} official monthly configs`);
      }catch(e){failures++;if([401,403,429].includes(e.status)||e.message.includes('fetch failed')||e.message.includes('timeout'))accessFailures++;const old=statuses.get(`web:${m.code}`);statuses.set(`web:${m.code}`,{code:m.code,channel:'web',status:'error',attemptedAt:checkedAt,observedAt:old?.observedAt??null,error:e.message,sourceUrl});console.warn(`web/${m.code}: ${e.message}; original price date retained`);}
    });
    console.log(`Regional web configurations refreshed: ${regionSuccesses}/${selected.length}; official baseline success is recorded separately from regional refresh.`);
    successes.webRegional=regionSuccesses;
  })());
  await Promise.all(jobs);
  criticalFailure = channelArg.some(c => !successes[c]);
  const manual = await readJson('quotes.json', { schemaVersion: 1, quotes: [] });
  for(const q of manual.quotes)statuses.set(`${q.channel}:${q.region}`,{code:q.region,channel:q.channel,status:'reviewed_quote',observedAt:q.observedAt,reviewedAt:q.reviewedAt,sourceUrl:q.sourceUrl});
  const usedDocuments=new Set(observations.map(r=>r.sourceDocumentId).filter(Boolean));
  const retainedDocuments=Object.fromEntries(Object.entries(documents).filter(([id])=>usedDocuments.has(id)));
  const result = { schemaVersion: 3, generatedAt: new Date().toISOString(), observations: observations.concat(manual.quotes), ranges, documents:retainedDocuments, markets: [...statuses.values()], collectionSummary: { configuredMarkets:MARKETS.length, sourceSuccesses:successes, recordedFailures:failures } };
  validateDataset(result); await atomicJson('prices.json', result);
  console.log(`Total: ${result.observations.length} exact/name-specific observations; ${ranges.length} Android all-product ranges.`);
}
if (!args.has('--prices-only')) {
  try {
    const prices = await readJson('prices.json', { observations: [], ranges: [] });
    const quotes = [...new Set(['CNY', ...MARKETS.map(m => m.currency), ...prices.observations.map(r => r.currency), ...(prices.ranges ?? []).map(r => r.currency)])].filter(c => c !== 'USD').sort().join(',');
    const asOf=new Date().toISOString().slice(0,10);
    const sourceUrl = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${quotes}&expand=providers&date=${asOf}`;
    const result = JSON.parse(await fetchText(sourceUrl)).filter(r=>r.date<=asOf);
    const fx = { schemaVersion:1, base:'USD', provider:'Frankfurter / central-bank aggregate', sourceUrl, fetchedAt:new Date().toISOString(), frequency:'daily', rates:Object.fromEntries(result.map(r => [r.quote,{rate:r.rate,date:r.date,providers:r.providers??[]}])) };
    validateFx(fx); await atomicJson('fx.json',fx); console.log(`FX: ${result.length} currencies`);
  } catch(e) { failures++; criticalFailure=true; console.warn(`FX: ${e.message}; previous snapshot preserved`); }
}
if (failures) { console.warn(`${failures} transient/access/parse failures were recorded. Valid observations were retained.`); if (!args.has('--allow-partial') || criticalFailure) process.exitCode=1; }
