import { MARKETS, PRICE_MAX_AGE_DAYS, FX_MAX_AGE_DAYS } from './config.mjs';

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
  return { rate: b.rate / a.rate, dates, stale: dates.some(date => ageDays(date, now) > FX_MAX_AGE_DAYS) };
}

export function convert(amount, from, to, fx, now) {
  const rate = fxRate(fx, from, to, now);
  return rate ? { ...rate, amount: amount * rate.rate } : null;
}

export function isVerifiedMonthly(record) {
  return record.verification === 'verified' && record.period === 'month'
    && record.periodEvidence?.url && record.periodEvidence?.note
    && record.taxEvidence?.url && record.taxEvidence?.note && record.reviewedAt
    && ['included', 'excluded'].includes(record.taxStatus)
    && record.offerType === 'standard';
}

// A reference quote is explicitly a public listing, never an inferred monthly price.
export function selectRows(dataset, fx, options = {}, now = new Date()) {
  const { plan = 'plus', target = 'CNY', mode = 'reference', search = '', tax = 'included' } = options;
  const grouped = new Map();
  for (const record of dataset.observations) {
    if (record.planId !== plan || record.channel !== 'ios') continue;
    if (mode === 'verified' && (!isVerifiedMonthly(record) || record.taxStatus !== tax)) continue;
    const market = MARKETS.find(m => m.code === record.region);
    if (!market) continue;
    if (search && !`${market.name} ${market.nameEn} ${market.code} ${market.currency}`.toLowerCase().includes(search.toLowerCase())) continue;
    const converted = convert(record.amount, record.currency, target, fx, now);
    const priceStale = ageDays(record.observedAt, now) > PRICE_MAX_AGE_DAYS;
    // Old observations remain inspectable, but never enter the current ranking.
    const rankable = Boolean(converted && !converted.stale && !priceStale);
    const row = { ...record, market, converted, priceStale, rankable };
    const previous = grouped.get(record.region);
    if (!previous || record.amount < previous.amount) grouped.set(record.region, row);
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
    return (a.converted?.amount ?? Infinity) - (b.converted?.amount ?? Infinity) || a.region.localeCompare(b.region);
  });
}

export function toCsv(rows, target) {
  const escape = x => {
    let value = String(x ?? '');
    if (/^[=+@\-\t\r]/.test(value)) value = `'${value}`;
    return `"${value.replaceAll('"', '""')}"`;
  };
  const columns = ['region', 'plan', 'channel', 'source_name', 'amount', 'currency', 'period', 'verification', 'tax', `converted_${target}`, 'price_observed_at', 'fx_dates', 'source_url'];
  const values = rows.map(r => [r.region, r.planId, r.channel, r.sourceName, r.amount, r.currency, r.period, r.verification, r.taxStatus, r.converted?.amount.toFixed(4) ?? '', r.observedAt, r.converted?.dates.join(';') ?? '', r.sourceUrl]);
  return '\uFEFF' + [columns, ...values].map(row => row.map(escape).join(',')).join('\r\n');
}

export function validateDataset(data) {
  if (data.schemaVersion !== 1 || !Array.isArray(data.observations) || !Array.isArray(data.markets)) throw new Error('Unsupported dataset schema');
  const ids = new Set();
  for (const r of data.observations) {
    const market = MARKETS.find(m => m.code === r.region);
    if (!market || market.currency !== r.currency) throw new Error(`Currency/region mismatch: ${r.id}`);
    if (!r.id || ids.has(r.id)) throw new Error(`Duplicate/missing observation ID: ${r.id}`);
    ids.add(r.id);
    if (!Number.isFinite(r.amount) || r.amount <= 0) throw new Error(`Invalid amount: ${r.id}`);
    if (!['plus', 'pro-100', 'pro-200', 'pro-500'].includes(r.planId)) throw new Error(`Invalid plan: ${r.id}`);
    const url = new URL(r.sourceUrl);
    if (url.hostname !== 'apps.apple.com' || !url.pathname.startsWith(`/${r.region}/`) || !url.pathname.endsWith('/id6448311069')) throw new Error(`Unexpected source: ${r.id}`);
    if (!Number.isFinite(Date.parse(r.observedAt)) || !/^[a-f0-9]{64}$/.test(r.sourceSha256)) throw new Error(`Missing provenance: ${r.id}`);
    if (!['unknown', 'month', 'year'].includes(r.period)) throw new Error(`Invalid period: ${r.id}`);
    if (!['observed', 'verified'].includes(r.verification)) throw new Error(`Invalid verification: ${r.id}`);
    if (!['included', 'excluded', 'unknown'].includes(r.taxStatus) || r.channel !== 'ios') throw new Error(`Invalid tax/channel: ${r.id}`);
    if (r.verification === 'verified' && (!r.periodEvidence?.url || !r.periodEvidence?.note || !r.taxEvidence?.url || !r.taxEvidence?.note || !r.reviewedAt)) throw new Error(`Verified prices require period/tax evidence and review date: ${r.id}`);
  }
  return true;
}

export function validateFx(fx) {
  if (fx.base !== 'USD' || !fx.rates?.CNY || !Number.isFinite(Date.parse(fx.fetchedAt))) throw new Error('Invalid FX snapshot');
  for (const [currency, row] of Object.entries(fx.rates)) {
    if (!/^[A-Z]{3}$/.test(currency) || !(row.rate > 0) || !Number.isFinite(row.rate) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid FX quote: ${currency}`);
  }
  return true;
}
