import { readFile } from 'node:fs/promises';
import { MARKETS } from '../src/config.mjs';
const p=JSON.parse(await readFile(new URL('../data/prices.json',import.meta.url),'utf8'));
const counts=channel=>new Set(p.observations.filter(r=>r.channel===channel&&r.region!=='global').map(r=>r.region)).size;
console.log(`# Daily collection\n\nConfigured markets: ${MARKETS.length}\n\n| Data | Regions / records |\n|---|---:|\n| iOS named-product listings | ${counts('ios')} regions |\n| Android all-product ranges (not Plus/Pro prices) | ${(p.ranges??[]).length} regions |\n| Official global web baselines | ${p.observations.filter(r=>r.region==='global').length} records |\n| Reviewed regional web quotes | ${counts('web')} regions |\n\nSnapshot: ${p.generatedAt}\n\n`);
const errors=p.markets.filter(m=>m.status==='error');
console.log(`Recorded source errors: ${errors.length}. Prior successful data is preserved with its original date.\n`);
for(const e of errors)console.log(`- ${e.channel}/${e.code}: ${e.error.replace(/[\r\n<>]/g,' ')}`);
