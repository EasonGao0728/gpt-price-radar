export const OFFICIAL_PRICE_URL = 'https://learn.chatgpt.com/docs/pricing';
export const WEB_CURRENCY_HELP = 'https://help.openai.com/en/articles/10421635-multicurrency-billing';
export function parseOfficialWebBaseline(html) {
  const plusBlock = html.match(/<h3\b[^>]*>\s*Plus\s*<\/h3>([\s\S]*?)(?=<h3\b|$)/i)?.[1];
  const plus = plusBlock?.match(/\$(\d+(?:\.\d+)?)<\/span>\s*<span\b[^>]*>\s*\/month/i);
  const proBlock = html.match(/<h3\b[^>]*>\s*Pro\s*<\/h3>([\s\S]*?)(?=<h3\b|$)/i)?.[1];
  const proTiers = proBlock?.match(/Plans at\s+\$(\d+),\s*\$(\d+),\s*or\s*\$(\d+)\s+USD per month/i);
  if (!plus) throw new Error('Official Plus monthly USD card not recognized');
  const rows = [{ planId: 'plus', amount: Number(plus[1]), currency: 'USD', period: 'month' }];
  if (proTiers) for (const amount of proTiers.slice(1).map(Number)) rows.push({ planId: 'pro-' + amount, amount, currency: 'USD', period: 'month' });
  return rows;
}
