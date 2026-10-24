import {readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import{validateDataset,validateFx,isVerifiedMonthly}from'../src/domain.mjs';
import{canonicalJson}from'../src/web.mjs';
const p=JSON.parse(await readFile(new URL('../data/prices.json',import.meta.url),'utf8'));
const fx=JSON.parse(await readFile(new URL('../data/fx.json',import.meta.url),'utf8'));
validateDataset(p);validateFx(fx);
let docs=0;
for(const[id,d]of Object.entries(p.documents??{})){
  if(d.hashKind!=='canonical_json'||createHash('sha256').update(canonicalJson(d.body)).digest('hex')!==d.sha256)throw new Error(`Source document digest mismatch: ${id}`);
  docs++;
}
const report={schemaVersion:1,dataGeneratedAt:p.generatedAt,status:'passed',officialPriceRecords:p.observations.filter(r=>r.origin!=='reviewed_submission').length,officialMonthlyConfigs:p.observations.filter(r=>r.origin==='official_checkout_config').length,explicitMonthlyWithTaxBasis:p.observations.filter(isVerifiedMonthly).length,iosListingsWithoutPeriod:p.observations.filter(r=>r.channel==='ios'&&r.period==='unknown').length,androidAggregateRanges:(p.ranges??[]).length,androidPlanMonthlyQuotes:p.observations.filter(r=>r.channel==='android'&&r.period==='month').length,sourceDocumentsChecked:docs,checks:['official source URL and country','numeric amount matches stored source text','monthly configuration matches retained official JSON','source JSON canonical SHA-256','source category and tax basis separation','no self-declared verified imports','aggregate ranges excluded from plan rankings'],limits:['Official configuration is not proof of account checkout eligibility.','App Store public listing does not establish period or tax.','Google Play aggregate range does not establish Plus/Pro monthly price.','A retained hash is an integrity check, not a publisher signature.']};
if(process.argv.includes('--write'))await writeFile(new URL('../data/audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
