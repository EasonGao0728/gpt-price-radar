import { MARKETS, GLOBAL_MARKET, PRICE_MAX_AGE_DAYS, FX_MAX_AGE_DAYS } from './config.mjs';
import { isCurrency } from './currency.mjs';
import { parseNumber } from './currency.mjs';
import { validateConfigProof, checkoutConfigUrl } from './web.mjs';

export function ageDays(iso, now = new Date()) {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? (now.getTime() - time) / 86400000 : Infinity;
}

export function fxRate(fx, from, to, now = new Date()) {
  if (!['USD', 'CNY'].includes(to)) return null;
  if (from === to) return { rate: 1, dates: [], stale: false };
  const a = from === 'USD' ? { rate: 1, date: null } : fx.rates[from];
  const b = to === 'USD' ? { rate: 1, date: null } : fx.rates[to];
  if (!a || !b || !(a.rate > 0) || !(b.rate > 0)) return null;
  const dates = [a.date, b.date].filter(Boolean);
  return { rate: b.rate / a.rate, dates, stale: dates.some(date => ageDays(date, now) > FX_MAX_AGE_DAYS || ageDays(date,now)<0) };
}

export function convert(amount, from, to, fx, now) {
  const rate = fxRate(fx, from, to, now);
  return rate ? { ...rate, amount: amount * rate.rate } : null;
}

export function isVerifiedMonthly(record) {
  if(record.verification==='official_config')return record.origin==='official_checkout_config'&&record.channel==='web'&&record.period==='month'&&record.sourceDocumentId&&['included','excluded'].includes(record.taxStatus)&&record.offerType==='standard';
  return record.verification === 'verified' && record.period === 'month'
    && record.periodEvidence?.url && record.periodEvidence?.note
    && record.taxEvidence?.url && record.taxEvidence?.note && record.reviewedAt
    && ['included', 'excluded'].includes(record.taxStatus)
    && record.offerType === 'standard';
}

// A reference quote is explicitly a public listing, never an inferred monthly price.
export function selectRows(dataset, fx, options = {}, now = new Date()) {
  const { plan = 'plus', target = 'CNY', mode = 'reference', channel = 'ios', area = '', search = '', tax = 'included' } = options;
  const grouped = new Map();
  for (const record of dataset.observations) {
    if (record.planId !== plan || record.channel !== channel) continue;
    if(record.origin==='reviewed_submission'&&!options.includeCandidates)continue;
    if (mode === 'verified' && (!isVerifiedMonthly(record) || record.taxStatus !== tax)) continue;
    const market = record.region === 'global' ? GLOBAL_MARKET : MARKETS.find(m => m.code === record.region);
    if (!market) continue;
    if (area && market.area !== area) continue;
    if (search && !`${market.name} ${market.nameEn} ${market.code} ${record.currency}`.toLowerCase().includes(search.toLowerCase())) continue;
    const converted = convert(record.amount, record.currency, target, fx, now);
    const priceStale = ageDays(record.observedAt, now) > PRICE_MAX_AGE_DAYS || ageDays(record.observedAt,now)<0;
    // Old observations remain inspectable, but never enter the current ranking.
    const rankable = Boolean(record.region !== 'global' && record.origin!=='reviewed_submission' && converted && !converted.stale && !priceStale && (record.verification!=='official_config'||record.taxStatus===tax));
    const row = { ...record, kind: 'quote', market, converted, priceStale, rankable };
    const previous = grouped.get(record.region);
    if (!previous || (row.rankable && !previous.rankable) || (row.rankable === previous.rankable && row.converted && (!previous.converted || row.converted.amount < previous.converted.amount)) || (!row.converted && !previous.converted && record.currency === previous.currency && record.amount < previous.amount)) grouped.set(record.region, row);
  }
  if (mode === 'reference' && channel === 'android') for (const record of dataset.ranges ?? []) {
    if (grouped.has(record.region)) continue;
    const market = MARKETS.find(m => m.code === record.region);
    if (!market || (area && market.area !== area)) continue;
    if (search && !`${market.name} ${market.nameEn} ${market.code} ${record.currency}`.toLowerCase().includes(search.toLowerCase())) continue;
    const low=convert(record.min,record.currency,target,fx,now),high=convert(record.max,record.currency,target,fx,now);
    const fxStale=Boolean(low?.stale||high?.stale);
    grouped.set(record.region, { ...record, kind: 'range', market, converted: null, convertedMin:fxStale?null:low, convertedMax:fxStale?null:high, fxStale, priceStale: ageDays(record.observedAt, now) > PRICE_MAX_AGE_DAYS||ageDays(record.observedAt,now)<0, rankable: false });
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
    return (a.converted?.amount ?? Infinity) - (b.converted?.amount ?? Infinity) || a.region.localeCompare(b.region);
  });
}

export function selectComparisonRows(dataset,fx,options={},now=new Date()){
  const maps=Object.fromEntries(['web','ios','android'].map(channel=>[channel,new Map(selectRows(dataset,fx,{...options,channel,mode:'reference',search:'',area:''},now).filter(r=>r.region!=='global').map(r=>[r.region,r]))]));
  return MARKETS.filter(m=>(!options.area||m.area===options.area)&&(!options.search||`${m.name} ${m.nameEn} ${m.code} ${m.currency} ${maps.web.get(m.code)?.currency??''} ${maps.ios.get(m.code)?.currency??''}`.toLowerCase().includes(options.search.toLowerCase()))).map(m=>({market:m,web:maps.web.get(m.code)??null,ios:maps.ios.get(m.code)??null,android:maps.android.get(m.code)??null}));
}
export function toComparisonCsv(rows,target){
  const escape=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const header=['region','web_amount','web_currency','web_period','web_tax','web_source','ios_listed_amount','ios_currency','ios_period','ios_source','android_plan_amount','android_currency','android_period','android_all_product_min','android_all_product_max','android_scope','android_source',`web_converted_${target}`];
  const values=rows.map(r=>[r.market.code,r.web?.amount,r.web?.currency,r.web?.period,r.web?.taxStatus,r.web?.sourceUrl,r.ios?.amount,r.ios?.currency,r.ios?.period,r.ios?.sourceUrl,r.android?.kind==='quote'?r.android.amount:'',r.android?.currency,r.android?.period,r.android?.kind==='range'?r.android.min:'',r.android?.kind==='range'?r.android.max:'',r.android?.scope,r.android?.sourceUrl,r.web?.converted?.amount]);
  return '\uFEFF'+[header,...values].map(r=>r.map(escape).join(',')).join('\r\n');
}

export function toCsv(rows, target) {
  const escape = x => {
    let value = String(x ?? '');
    if (/^[=+@\-\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const columns = ['region', 'kind', 'scope', 'plan', 'channel', 'source_name', 'amount', 'currency', 'period', 'verification', 'tax', `converted_${target}`, 'range_min', 'range_max', `converted_range_min_${target}`, `converted_range_max_${target}`, 'price_observed_at', 'fx_dates', 'source_url'];
  const values = rows.map(r => [r.region, r.kind ?? 'quote', r.scope ?? 'regional', r.planId ?? '', r.channel, r.sourceName ?? '', r.amount ?? '', r.currency, r.period, r.verification ?? 'observed_range', r.taxStatus, r.converted?.amount.toFixed(4) ?? '', r.min ?? '', r.max ?? '', r.convertedMin?.amount.toFixed(4) ?? '', r.convertedMax?.amount.toFixed(4) ?? '', r.observedAt, (r.converted?.dates ?? r.convertedMin?.dates ?? []).join(';'), r.sourceUrl]);
  return '\uFEFF' + [columns, ...values].map(row => row.map(escape).join(',')).join('\r\n');
}

export function validateDataset(data) {
  if (![1, 2, 3].includes(data.schemaVersion) || !Array.isArray(data.observations) || !Array.isArray(data.markets)) throw new Error('Unsupported dataset schema');
  const ids = new Set();
  for (const r of data.observations) {
    const market = r.region === 'global' ? GLOBAL_MARKET : MARKETS.find(m => m.code === r.region);
    if (!market || !isCurrency(r.currency)) throw new Error(`Currency/region mismatch: ${r.id}`);
    if (r.channel === 'ios' && r.currency !== market.currency && r.currencyEvidence?.value !== r.currency) throw new Error(`Currency/region mismatch without storefront evidence: ${r.id}`);
    if(r.currencyEvidence&&r.currencyEvidence.value!==r.currency)throw new Error(`Currency differs from retained evidence: ${r.id}`);
    if(data.schemaVersion===3&&r.channel==='ios'&&!r.currencyEvidence)throw new Error(`Missing storefront currency evidence: ${r.id}`);
    if (!r.id || ids.has(r.id)) throw new Error(`Duplicate/missing observation ID: ${r.id}`);
    ids.add(r.id);
    if (!Number.isFinite(r.amount) || r.amount <= 0) throw new Error(`Invalid amount: ${r.id}`);
    if(r.displayPrice&&Math.abs(parseNumber(r.displayPrice,r.currency)-r.amount)>Math.max(1e-8,r.amount*1e-10))throw new Error(`Amount differs from source price text: ${r.id}`);
    if (!['plus', 'pro-100', 'pro-200', 'pro-500'].includes(r.planId)) throw new Error(`Invalid plan: ${r.id}`);
    validateSource(r);
    if (!Number.isFinite(Date.parse(r.observedAt)) || !/^[a-f0-9]{64}$/.test(r.sourceSha256)) throw new Error(`Missing provenance: ${r.id}`);
    if (!['unknown', 'month', 'year'].includes(r.period)) throw new Error(`Invalid period: ${r.id}`);
    if (!['observed', 'verified','official_config'].includes(r.verification)) throw new Error(`Invalid verification: ${r.id}`);
    if(r.verification==='official_config')validateConfigProof(r,data.documents);
    if(r.verification==='verified')throw new Error(`Self-declared verified prices are not independent official evidence: ${r.id}`);
    if (!['included', 'excluded', 'unknown'].includes(r.taxStatus) || !['ios', 'web', 'android'].includes(r.channel)) throw new Error(`Invalid tax/channel: ${r.id}`);
    if (r.verification === 'verified' && (!r.periodEvidence?.url || !r.periodEvidence?.note || !r.taxEvidence?.url || !r.taxEvidence?.note || !Number.isFinite(Date.parse(r.reviewedAt)))) throw new Error(`Verified prices require period/tax evidence and review date: ${r.id}`);
    for(const evidence of [r.periodEvidence,r.taxEvidence])if(evidence?.url&&new URL(evidence.url).protocol!=='https:')throw new Error(`Evidence must use HTTPS: ${r.id}`);
  }
  for (const r of data.ranges ?? []) {
    if (!MARKETS.some(m => m.code === r.region) || r.channel !== 'android' || r.scope !== 'all_in_app_products' || !isCurrency(r.currency) || !(r.min > 0) || !Number.isFinite(r.max) || r.max < r.min || r.period !== 'unknown') throw new Error(`Invalid aggregate range: ${r.id}`);
    if (ids.has(r.id)) throw new Error(`Duplicate range ID: ${r.id}`);
    ids.add(r.id); validateSource(r);
    const bounds=r.rawRange?.replace(/ per item$/,'').split(/\s+-\s+/);
    if(bounds?.length!==2||parseNumber(bounds[0],r.currency)!==r.min||parseNumber(bounds[1],r.currency)!==r.max)throw new Error(`Range differs from raw official text: ${r.id}`);
    if (!Number.isFinite(Date.parse(r.observedAt)) || !/^[a-f0-9]{64}$/.test(r.sourceSha256)) throw new Error(`Missing range provenance: ${r.id}`);
  }
  return true;
}

function validateSource(r) {
  const url = new URL(r.sourceUrl);
  if (url.protocol !== 'https:') throw new Error(`Evidence must use HTTPS: ${r.id}`);
  if (r.origin === 'reviewed_submission') {
    if (!r.reviewedAt || !r.periodEvidence?.note || !r.periodEvidence?.url) throw new Error(`Reviewed submissions require period evidence: ${r.id}`);
  } else if (r.channel === 'ios') {
    if (url.hostname !== 'apps.apple.com' || !url.pathname.startsWith(`/${r.region}/`) || !url.pathname.endsWith('/id6448311069')) throw new Error(`Unexpected source: ${r.id}`);
  } else if (r.channel === 'android') {
    if (url.hostname !== 'play.google.com' || url.searchParams.get('id') !== 'com.openai.chatgpt' || url.searchParams.get('gl')?.toLowerCase() !== r.region) throw new Error(`Unexpected Android source: ${r.id}`);
  } else if (r.channel === 'web') {
    if(r.origin==='official_checkout_config'){if(url.href!==checkoutConfigUrl(r.region)||r.scope!=='official_configuration')throw new Error(`Invalid official checkout source: ${r.id}`);}
    else if (r.region !== 'global' || r.scope !== 'global_reference' || url.href !== 'https://learn.chatgpt.com/docs/pricing') throw new Error(`Regional web prices require official configuration evidence: ${r.id}`);
  }
}

export function validateFx(fx) {
  const source=new URL(fx.sourceUrl??'https://api.frankfurter.dev/v2/rates?base=USD');
  if(source.protocol!=='https:'||source.hostname!=='api.frankfurter.dev'||source.pathname!=='/v2/rates')throw new Error('Unapproved FX source');
  if (fx.base !== 'USD' || !fx.rates?.CNY || !Number.isFinite(Date.parse(fx.fetchedAt))) throw new Error('Invalid FX snapshot');
  for (const [currency, row] of Object.entries(fx.rates)) {
    if (!/^[A-Z]{3}$/.test(currency) || !(row.rate > 0) || !Number.isFinite(row.rate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date>new Date().toISOString().slice(0,10)) throw new Error(`Invalid FX quote: ${currency}`);
  }
  return true;
}
