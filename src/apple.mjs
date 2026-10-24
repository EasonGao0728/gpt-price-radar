import { PLANS } from './config.mjs';

function decode(value) {
  return value.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll('&amp;', '&').replaceAll('&nbsp;', ' ').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

export function parseAmount(text, market) {
  let value = decode(text).normalize('NFKC').replace(/[^\d.,]/g, '');
  if (['de', 'tr', 'br'].includes(market.code)) value = value.replaceAll('.', '').replace(',', '.');
  else value = value.replaceAll(',', '');
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) throw new Error(`Could not parse ${market.currency} amount: ${text}`);
  return number;
}

export function parseApple(html, market) {
  // Prefer Apple's serialized information shelf; fall back to visible name/price pairs.
  let sourcePairs = [];
  const script = html.match(/<script\b[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/);
  if (script) {
    try {
      const payload = JSON.parse(script[1]);
      for (const entry of payload.data ?? []) {
        const information = entry.data?.shelfMapping?.information;
        const visit = node => {
          if (!node || typeof node !== 'object') return;
          if (typeof node.leadingText === 'string' && typeof node.trailingText === 'string') sourcePairs.push([node.leadingText, node.trailingText]);
          for (const child of Object.values(node)) if (child && typeof child === 'object') Array.isArray(child) ? child.forEach(visit) : visit(child);
        };
        visit(information);
      }
    } catch { /* Visible-pair parser below remains available if the serialized format changes. */ }
  }
  if (!sourcePairs.some(([name]) => PLANS.some(p => p.sourceName === decode(name).trim()))) {
    sourcePairs = [...html.matchAll(/<div\b[^>]*class="[^"]*\btext-pair\b[^"]*"[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<span[^>]*>([^<]+)<\/span>/g)].map(([, name, price]) => [name, price]);
  }
  const found = [];
  const seen = new Set();
  for (const [rawName, rawPrice] of sourcePairs) {
    const sourceName = decode(rawName).trim();
    const plan = PLANS.find(p => p.sourceName === sourceName);
    if (!plan) continue;
    const amount = parseAmount(rawPrice, market);
    const key = `${plan.id}:${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ planId: plan.id, sourceName, amount, displayPrice: decode(rawPrice).trim() });
  }
  if (!found.some(x => x.planId === 'plus')) throw new Error('No ChatGPT Plus IAP found; source format may have changed');
  return found;
}
