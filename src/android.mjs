import { pageCurrency, resolveCurrency, parseNumber } from './currency.mjs';

export function parseAndroid(html) {
  const currency = pageCurrency(html);
  for (const [, callback] of html.matchAll(/<script[^>]*>(AF_initDataCallback\([\s\S]*?)<\/script>/g)) {
    if (!/key:\s*'ds:5'/.test(callback)) continue;
    const start = callback.indexOf('data:'), end = callback.lastIndexOf(', sideChannel:');
    if (start < 0 || end < 0) continue;
    let data;
    try { data = JSON.parse(callback.slice(start + 5, end)); } catch { continue; }
    const raw = data?.[1]?.[2]?.[19]?.[0];
    if (typeof raw !== 'string' || !raw.endsWith(' per item')) return null;
    const parts = raw.replace(/ per item$/, '').split(/\s+-\s+/);
    if (parts.length !== 2) throw new Error('Unrecognized main-app IAP range');
    const min = parseNumber(parts[0], currency), max = parseNumber(parts[1], currency);
    if (min > max) throw new Error('Invalid main-app IAP range');
    return { ...resolveCurrency(raw, currency), min, max, rawRange: raw, scope: 'all_in_app_products', period: 'unknown', taxStatus: 'unknown' };
  }
  return null;
}
