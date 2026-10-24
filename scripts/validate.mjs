import { readFile } from 'node:fs/promises';
import { validateDataset, validateFx } from '../src/domain.mjs';
const read = file => readFile(new URL(`../data/${file}`, import.meta.url), 'utf8').then(JSON.parse);
const prices = await read('prices.json');
validateDataset(prices);
validateFx(await read('fx.json'));
console.log(`Validated ${prices.observations.length} observations across ${prices.markets.length} markets.`);
