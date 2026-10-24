const validCodes = new Set(Intl.supportedValuesOf('currency'));
export const isCurrency = code => validCodes.has(code) || ['BGN', 'HRK'].includes(code);

export function pageCurrency(html) {
  const codes = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if ((node['@type'] === 'SoftwareApplication' || node['@type'] === 'MobileApplication') && /^ChatGPT$/i.test(node.name ?? '')) {
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const offer of offers) if (isCurrency(offer?.priceCurrency)) codes.add(offer.priceCurrency);
    }
    if (Array.isArray(node)) node.forEach(visit);
    else if (node['@graph']) visit(node['@graph']);
  };
  for (const [, raw] of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { visit(JSON.parse(raw)); } catch { /* A malformed unrelated block cannot establish currency. */ }
  }
  if (codes.size !== 1) throw new Error('Missing or conflicting ChatGPT page currency');
  return [...codes][0];
}

export function resolveCurrency(raw, pageCode) {
  const explicit = [...raw.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]).filter(isCurrency);
  if (new Set(explicit).size > 1 || explicit.some(c => c !== pageCode)) throw new Error('IAP currency conflicts with page currency');
  const symbols = [['€', ['EUR']], ['£', ['GBP']], ['₹', ['INR']], ['₺', ['TRY']], ['₩', ['KRW']], ['￦', ['KRW']], ['₽', ['RUB']], ['R$', ['BRL']], ['zł', ['PLN']], ['¥', ['JPY', 'CNY']]];
  for (const [symbol, allowed] of symbols) if (raw.includes(symbol) && !allowed.includes(pageCode)) throw new Error(`Currency symbol conflicts with ${pageCode}`);
  return { currency: pageCode, currencyEvidence: { scope: explicit.length ? 'iap_text' : 'page_offer', value: pageCode, path: explicit.length ? 'visible IAP ISO code' : 'SoftwareApplication.offers.priceCurrency', inferredForIap: !explicit.length } };
}

export function parseNumber(raw, currency = 'USD') {
  let multiplier=1;
  if(currency==='IDR'){
    const unit=raw.match(/(ribu|rb|juta|jt|miliar|milyar)\.?\s*$/i)?.[1]?.toLowerCase();
    if(unit)multiplier=['ribu','rb'].includes(unit)?1000:['juta','jt'].includes(unit)?1000000:1000000000;
  }
  let text = raw.normalize('NFKC').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776));
  text = text.replaceAll('٫', '.').replaceAll('٬', ',').replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
  const lastDot = text.lastIndexOf('.'), lastComma = text.lastIndexOf(',');
  const last = Math.max(lastDot, lastComma);
  if (last >= 0) {
    const decimals = text.length - last - 1;
    const precision = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    const hasBoth = lastDot >= 0 && lastComma >= 0;
    const isDecimal = decimals === 1 || decimals === 2 || (decimals === 3 && (multiplier>1 || (precision === 3 && (hasBoth || lastDot >= 0))));
    text = isDecimal ? text.slice(0, last).replaceAll(/[.,]/g, '') + '.' + text.slice(last + 1) : text.replaceAll(/[.,]/g, '');
  }
  const value = Number(text)*multiplier;
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`Unrecognized positive ${currency} amount`);
  return value;
}
