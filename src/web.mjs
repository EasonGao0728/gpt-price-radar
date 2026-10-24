export const OFFICIAL_PRICE_URL = 'https://learn.chatgpt.com/docs/pricing';
export const WEB_CURRENCY_HELP = 'https://help.openai.com/en/articles/10421635-multicurrency-billing';
export const CHECKOUT_CONFIG_ORIGIN='https://chatgpt.com/backend-anon/checkout_pricing_config/configs/';
export const WEB_PLAN_KEYS={plus:'plus','pro-100':'prolite','pro-200':'pro','pro-500':'promax'};
export const checkoutConfigUrl=country=>CHECKOUT_CONFIG_ORIGIN+country.toUpperCase();
export function canonicalJson(value){return JSON.stringify(sort(value));function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}}
export function parseCheckoutConfig(body,region){
  if(body.country_code?.toLowerCase()!==region.toLowerCase())throw new Error('Official config country mismatch');
  const config=body.currency_config;
  if(!config||!/^[A-Z]{3}$/.test(config.symbol_code))throw new Error('Missing official config currency');
  const records=[];
  for(const[planId,key]of Object.entries(WEB_PLAN_KEYS)){
    const monthly=config[key]?.month;
    if(!monthly)continue;
    if(typeof monthly.amount!=='number'||!Number.isFinite(monthly.amount)||monthly.amount<=0)throw new Error(`Invalid monthly amount: ${planId}`);
    const taxStatus=monthly.tax==='inclusive'?'included':monthly.tax==='exclusive'?'excluded':'unknown';
    records.push({planId,amount:monthly.amount,currency:config.symbol_code,period:'month',taxStatus,offerType:'standard',sourcePath:`currency_config.${key}.month`,taxType:config.tax_type??null,taxPercent:config.tax_percent??null,pricingRolloutGate:body.pricing_rollout_gate??config.pricing_rollout_gate??null,checkoutEligibility:'not_verified'});
  }
  if(!records.some(r=>r.planId==='plus'))throw new Error('No explicit Plus month config');
  return records;
}
export function validateConfigProof(record,documents){
  const doc=documents?.[record.sourceDocumentId];
  if(!doc||doc.kind!=='official_checkout_config'||doc.sourceUrl!==checkoutConfigUrl(record.region)||doc.observedAt!==record.observedAt||doc.sha256!==record.sourceSha256||!['canonical_json','response_text'].includes(doc.hashKind))throw new Error(`Missing official source document: ${record.id}`);
  const expected=parseCheckoutConfig(doc.body,record.region).find(r=>r.planId===record.planId);
  if(!expected||['amount','currency','period','taxStatus','offerType','sourcePath','checkoutEligibility','taxType','taxPercent','pricingRolloutGate'].some(key=>JSON.stringify(record[key])!==JSON.stringify(expected[key])))throw new Error(`Quote disagrees with official source: ${record.id}`);
  if(record.periodEvidence?.url!==doc.sourceUrl||record.taxEvidence?.url!==doc.sourceUrl)throw new Error(`Evidence URL differs from official configuration: ${record.id}`);
  if(record.sourceUrl!==doc.sourceUrl)throw new Error(`Source URL mismatch: ${record.id}`);
  return true;
}
export function makeCheckoutRecords(body,region,docId,doc){
  return parseCheckoutConfig(body,region).map(p=>({id:`web-${region}-${p.planId}`,region,channel:'web',scope:'official_configuration',...p,sourceName:p.planId==='plus'?'ChatGPT Plus':`ChatGPT Pro ${p.planId.slice(4)}`,displayPrice:new Intl.NumberFormat('en',{style:'currency',currency:p.currency}).format(p.amount),verification:'official_config',sourceUrl:doc.sourceUrl,observedAt:doc.observedAt,sourceSha256:doc.sha256,sourceHashKind:doc.hashKind,sourceDocumentId:docId,origin:'official_checkout_config',periodEvidence:{url:doc.sourceUrl,note:`官方配置 ${p.sourcePath}，明确月度标准金额。`},taxEvidence:{url:doc.sourceUrl,note:`${p.sourcePath}.tax=${p.taxStatus==='included'?'inclusive':p.taxStatus==='excluded'?'exclusive':'unknown'}`},currencyEvidence:{value:p.currency,scope:'official_config',path:'currency_config.symbol_code',inferredForIap:false}}));
}
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
