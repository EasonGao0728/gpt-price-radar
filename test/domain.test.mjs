import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectRows,selectComparisonRows,toComparisonCsv, convert, isVerifiedMonthly, validateDataset, validateFx, toCsv } from '../src/domain.mjs';
import { parseAmount, parseApple } from '../src/apple.mjs';
import { MARKETS } from '../src/config.mjs';
import { parseAndroid } from '../src/android.mjs';
import { parseOfficialWebBaseline,parseCheckoutConfig,makeCheckoutRecords,canonicalJson } from '../src/web.mjs';
import {createHash}from'node:crypto';
const ld = currency => `<script type="application/ld+json">${JSON.stringify({'@type':'SoftwareApplication',name:'ChatGPT',offers:{price:0,priceCurrency:currency}})}</script>`;

const now = new Date('2026-10-24T04:00:00Z');
const fx = { base: 'USD', fetchedAt: '2026-10-24T03:00:00Z', rates: { CNY: { rate: 7, date: '2026-10-23' }, JPY: { rate: 150, date: '2026-10-23' }, TRY: { rate: 50, date: '2026-10-23' } } };
function record(region, amount, extra = {}) {
  return { id: `${region}-${amount}`, region, channel: 'ios', planId: 'plus', sourceName: 'ChatGPT Plus', amount, currency: MARKETS.find(m => m.code === region).currency, period: 'unknown', taxStatus: 'unknown', verification: 'observed', offerType: 'unknown', observedAt: '2026-10-24T03:00:00Z', sourceUrl: `https://apps.apple.com/${region}/app/chatgpt/id6448311069`, sourceSha256: 'a'.repeat(64), ...extra };
}
const data = (...observations) => ({ schemaVersion: 1, observations, markets: [] });
const verified = { verification: 'verified', period: 'month', taxStatus: 'included', offerType: 'standard', periodEvidence: { url: 'https://example.com/period', note: 'Monthly explicitly shown' }, taxEvidence: { url: 'https://example.com/tax', note: 'Tax included explicitly shown' }, reviewedAt: '2026-10-24T03:00:00Z' };

test('cross-currency conversion uses the correct rate direction', () => {
  assert.equal(convert(3000, 'JPY', 'USD', fx, now).amount, 20);
  assert.equal(convert(3000, 'JPY', 'CNY', fx, now).amount, 140);
  assert.equal(convert(20, 'USD', 'CNY', fx, now).amount, 140);
  assert.equal(convert(20, 'USD', 'USD', fx, now).amount, 20);
});
test('reference view selects minimum public listing per market without inferring a period', () => {
  const rows = selectRows(data(record('us', 200), record('us', 19.99), record('jp', 3000)), fx, {}, now);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].region, 'us');
  assert.equal(rows[0].amount, 19.99);
  assert.equal(rows[0].period, 'unknown');
});
test('changing target currency preserves the ordering with the same snapshot', () => {
  const prices = data(record('us', 19.99), record('jp', 2900), record('tr', 999.99));
  const inCny = selectRows(prices, fx, { target: 'CNY' }, now).map(r => r.region);
  const inUsd = selectRows(prices, fx, { target: 'USD' }, now).map(r => r.region);
  assert.deepEqual(inCny, inUsd);
});
test('unknown periods, promotions and missing evidence cannot enter monthly ranking', () => {
  const pending = record('us', 19.99);
  const qualified = record('jp', 3000, verified);
  const promotion = record('tr', 100, { ...verified, offerType: 'promotion' });
  assert.equal(isVerifiedMonthly(pending), false);
  assert.ok(!isVerifiedMonthly({ ...qualified, taxEvidence: null }));
  const rows = selectRows(data(pending, qualified, promotion), fx, { mode: 'verified' }, now);
  assert.deepEqual(rows.map(r => r.region), ['jp']);
});
test('verified monthly ranking isolates tax basis and plan tier', () => {
  const rows = selectRows(data(record('us', 20, verified), record('jp', 3000, { ...verified, taxStatus: 'excluded' }), record('tr', 100, { ...verified, planId: 'pro-100' })), fx, { mode: 'verified', tax: 'included' }, now);
  assert.deepEqual(rows.map(r => r.region), ['us']);
});
test('stale prices, stale FX and absent FX never enter current rankings', () => {
  const prices = data(record('us', 1, { observedAt: '2026-10-01T00:00:00Z' }), record('jp', 3000), record('tw', 690));
  const rows = selectRows(prices, { ...fx, rates: { ...fx.rates, JPY: { rate: 150, date: '2026-10-01' } } }, {}, now);
  assert.equal(rows.filter(r => r.rankable).length, 0);
  assert.equal(rows.length, 3);
});
test('search matches region names and currency codes', () => {
  const rows = selectRows(data(record('us', 20), record('jp', 3000)), fx, { search: 'jpy' }, now);
  assert.deepEqual(rows.map(r => r.region), ['jp']);
});
test('ranking uses full precision rather than displayed rounded amounts', () => {
  const rows = selectRows(data(record('us', 20.00001), record('jp', 3000)), fx, {}, now);
  assert.equal(rows[0].region, 'jp');
});
test('CSV preserves provenance and neutralizes spreadsheet formulas', () => {
  const rows = selectRows(data(record('us', 20, { sourceName: '=HYPERLINK("bad")' })), fx, {}, now);
  const csv = toCsv(rows, 'CNY');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('source_url'));
  assert.ok(csv.includes('unknown'));
});
test('regional amount parsing handles comma decimals and large currencies', () => {
  for (const [code, text, expected] of [['us', '$19.99', 19.99], ['jp', '¥3,000', 3000], ['tr', '₺999,99', 999.99], ['br', 'R$ 99,90', 99.90], ['de', '1.199,99 €', 1199.99], ['in', '₹1,999', 1999], ['kr', '₩29,000', 29000], ['id','Rp349ribu',349000],['id','Rp1,79jt',1790000],['id','Rp1,889juta',1889000]]) {
    assert.equal(parseAmount(text, MARKETS.find(m => m.code === code)), expected);
  }
});
test('Apple parser isolates supported subscriptions and retains same-name prices', () => {
  const pair = (name, value) => `<div class="text-pair svelte-x"><span>${name}</span> <span>${value}</span></div>`;
  const rows = parseApple(ld('USD') + pair('ChatGPT Plus', '$19.99') + pair('ChatGPT Plus', '$200.00') + pair('100 Credits', '$4.00') + pair('ChatGPT Go', '$8.00'), MARKETS[0]);
  assert.equal(rows.length, 2);
  assert.throws(() => parseApple(ld('USD')+'<html>rate limited</html>', MARKETS[0]), /No ChatGPT Plus/);
});
test('Apple serialized shelf parser does not depend on stylesheet class names', () => {
  const payload = { data: [{ data: { shelfMapping: { information: { items: [{ items: [
    { leadingText: 'ChatGPT Plus', trailingText: '$19.99' },
    { leadingText: 'ChatGPT Plus', trailingText: '$200.00' },
    { leadingText: '100 Credits', trailingText: '$4.00' }
  ] }] } } } }] };
  const rows = parseApple(ld('USD')+`<script id="serialized-server-data">${JSON.stringify(payload)}</script>`, MARKETS[0]);
  assert.deepEqual(rows.map(r => r.amount), [19.99, 200]);
});
test('storefront currency is read from evidence, independently of national legal tender',()=>{
  const pair='<div class="text-pair"><span>ChatGPT Plus</span><span>USD 19.99</span></div>';
  const rows=parseApple(ld('USD')+pair,MARKETS.find(m=>m.code==='bo'));
  assert.equal(rows[0].currency,'USD');assert.equal(rows[0].currencyEvidence.scope,'iap_text');
  assert.throws(()=>parseApple(ld('EUR')+pair,MARKETS[0]),/conflicts/);
  assert.throws(()=>parseApple(pair,MARKETS[0]),/currency/);
});
test('Android parser extracts only main-app aggregate ranges, never the free download price',()=>{
  const main=[];main[1]=[];main[1][2]=[];main[1][2][19]=['$8.00 - $500.00 per item'];
  const callback=(key,data)=>`<script>AF_initDataCallback({key: '${key}', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
  const parsed=parseAndroid(ld('USD')+callback('ds:8',main)+callback('ds:5',main));
  assert.equal(parsed.min,8);assert.equal(parsed.max,500);assert.equal(parsed.scope,'all_in_app_products');
  assert.equal(parseAndroid(ld('USD')+callback('ds:8',main)),null);
});
test('Android ranges cannot enter Plus/Pro or verified-monthly rankings',()=>{
  const prices={schemaVersion:2,observations:[],markets:[],ranges:[{region:'us',channel:'android',scope:'all_in_app_products',currency:'USD',min:8,max:500,period:'unknown',observedAt:now.toISOString()}]};
  const reference=selectRows(prices,fx,{channel:'android'},now);assert.equal(reference.length,1);assert.equal(reference[0].rankable,false);
  assert.equal(selectRows(prices,fx,{channel:'android',mode:'verified'},now).length,0);
  assert.equal(selectRows(prices,fx,{channel:'ios'},now).length,0);
});
test('GLOBAL web baselines remain separate from country rankings and channel filters',()=>{
  const prices=data({...record('us',20),id:'web-global-plus',region:'global',channel:'web',scope:'global_reference',period:'month'});
  const rows=selectRows(prices,fx,{channel:'web'},now);assert.equal(rows[0].rankable,false);assert.equal(rows[0].market.code,'global');
  assert.equal(selectRows(prices,fx,{channel:'ios'},now).length,0);
});
test('web baseline parser requires explicit per-month context',()=>{
  const html='<h3>Plus</h3><span>$20</span><span>/month</span><h3>Pro</h3>Plans at $100, $200, or $500 USD per month';
  assert.deepEqual(parseOfficialWebBaseline(html).map(r=>r.amount),[20,100,200,500]);
  assert.throws(()=>parseOfficialWebBaseline('<h3>Plus</h3>$20'),/not recognized/);
});
test('area filters isolate configured regions',()=>{
  const prices=data(record('us',20),record('jp',3000));
  assert.deepEqual(selectRows(prices,fx,{area:'asia'},now).map(r=>r.region),['jp']);
});
test('self-reported review fields cannot establish a verified regional price',()=>{
  const quote=record('jp',3000,{...verified,id:'reviewed-web-jp-plus',channel:'web',origin:'reviewed_submission',sourceUrl:'https://example.com/checkout-evidence'});
  assert.throws(()=>validateDataset(data(quote)),/Self-declared/);
  const candidate={...quote,verification:'observed'};assert.ok(validateDataset(data(candidate)));
  assert.equal(selectRows(data(candidate),fx,{channel:'web'},now).length,0);
  assert.equal(selectRows(data(candidate),fx,{channel:'web',includeCandidates:true},now)[0].rankable,false);
  assert.throws(()=>validateDataset(data({...quote,origin:'guessed'})),/official configuration/);
});
test('future-dated FX cannot rank prices',()=>{
  const nextDayFx={...fx,rates:{...fx.rates,JPY:{rate:150,date:'2026-10-25'}}};
  assert.equal(selectRows(data(record('jp',3000)),nextDayFx,{},now)[0].rankable,false);
});
const sourceBody={country_code:'IN',currency_config:{symbol_code:'INR',tax_type:'gst',tax_percent:18,plus:{month:{amount:1999,tax:'inclusive',psp_override:{amount:1694.07,tax:'exclusive'}},year:{amount:1665.83,tax:'inclusive'}},prolite:{month:{amount:10699,tax:'inclusive'}},pro:{month:{amount:19900,tax:'inclusive'}},promax:{month:{amount:52900,tax:'inclusive'}}}};
function officialFixture(){
  const sourceUrl='https://chatgpt.com/backend-anon/checkout_pricing_config/configs/IN';
  const sha256=createHash('sha256').update(canonicalJson(sourceBody)).digest('hex');
  const doc={kind:'official_checkout_config',body:sourceBody,sourceUrl,observedAt:now.toISOString(),sha256,hashKind:'canonical_json'};
  return{schemaVersion:3,observations:makeCheckoutRecords(sourceBody,'in','fixture',doc),ranges:[],markets:[],documents:{fixture:doc}};
}
test('official month parser does not substitute annual equivalent, minor units or PSP override',()=>{
  const rows=parseCheckoutConfig(sourceBody,'in');assert.deepEqual(rows.map(r=>r.amount),[1999,10699,19900,52900]);
  assert.equal(rows[0].taxStatus,'included');assert.equal(rows[0].currency,'INR');assert.equal(rows[0].period,'month');
  assert.throws(()=>parseCheckoutConfig(sourceBody,'jp'),/country mismatch/);
});
test('tax basis is taken per plan and rollout conditions are retained',()=>{
  const body={country_code:'TR',pricing_rollout_gate:'example_gate',currency_config:{symbol_code:'USD',plus:{month:{amount:20,tax:'exclusive'}},prolite:{month:{amount:120,tax:'inclusive'}}}};
  const rows=parseCheckoutConfig(body,'tr');assert.deepEqual(rows.map(r=>r.taxStatus),['excluded','included']);assert.ok(rows.every(r=>r.pricingRolloutGate==='example_gate'&&r.checkoutEligibility==='not_verified'));
});
test('official configuration quotes are cross-checked against the retained source document',()=>{
  const fixture=officialFixture();assert.ok(validateDataset(fixture));assert.ok(isVerifiedMonthly(fixture.observations[0]));
  const tampered=structuredClone(fixture);tampered.observations[0].amount=1;tampered.observations[0].displayPrice='₹1';
  assert.throws(()=>validateDataset(tampered),/disagrees with official source/);
  const missing=structuredClone(fixture);missing.documents={};assert.throws(()=>validateDataset(missing),/Missing official/);
});
test('source price text and numeric amount cannot silently disagree',()=>{
  const row=record('us',19.99,{displayPrice:'$19.99'});assert.ok(validateDataset(data(row)));
  assert.throws(()=>validateDataset(data({...row,amount:.01})),/differs from source price text/);
});
test('Android stale FX does not remain displayed as a normal range conversion',()=>{
  const fixture={schemaVersion:2,observations:[],markets:[],ranges:[{region:'us',channel:'android',currency:'USD',min:8,max:500,scope:'all_in_app_products',period:'unknown',observedAt:'2026-10-24T03:00:00Z'}]};
  const later=new Date('2026-10-30T06:00:00Z');const row=selectRows(fixture,fx,{channel:'android'},later)[0];
  assert.equal(row.fxStale,true);assert.equal(row.convertedMin,null);assert.equal(row.convertedMax,null);
});
test('comparison view keeps all three channels without cloning a GLOBAL price into countries',()=>{
  const fixture=officialFixture();fixture.observations.push(record('us',19.99));
  const rows=selectComparisonRows(fixture,fx,{plan:'plus',search:'India'},now);assert.equal(rows.length,1);assert.equal(rows[0].web.amount,1999);assert.equal(rows[0].ios,null);assert.equal(rows[0].android,null);
  assert.ok(toComparisonCsv(rows,'CNY').includes('web_period'));assert.ok(toComparisonCsv(rows,'CNY').includes('INR'));
});
test('validation rejects currency mismatches and unsupported verified claims', () => {
  assert.throws(() => validateDataset(data(record('us', 20, { currency: 'EUR' }))), /mismatch/);
  assert.throws(() => validateDataset(data(record('us', 20, { verification: 'verified' }))), /evidence/);
  assert.throws(() => validateFx({ ...fx, rates: { CNY: { rate: -1, date: '2026-10-23' } } }), /Invalid/);
});
test('committed datasets are valid and contain actual observed prices', async () => {
  const prices = JSON.parse(await readFile(new URL('../data/prices.json', import.meta.url), 'utf8'));
  const actualFx = JSON.parse(await readFile(new URL('../data/fx.json', import.meta.url), 'utf8'));
  assert.ok(validateDataset(prices));
  assert.ok(validateFx(actualFx));
  assert.ok(prices.observations.length > 0);
  assert.ok(prices.observations.every(r => r.sourceSha256.length === 64));
});
