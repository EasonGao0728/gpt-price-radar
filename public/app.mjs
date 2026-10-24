import { PLANS, MARKETS } from './lib/config.mjs';
import { selectRows, isVerifiedMonthly, toCsv, validateDataset, validateFx } from './lib/domain.mjs';

const $ = selector => document.querySelector(selector);
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);
const state = {
  plan: PLANS.some(p => p.id === params.get('plan')) ? params.get('plan') : 'plus',
  target: params.get('currency') === 'USD' ? 'USD' : 'CNY',
  mode: params.get('mode') === 'verified' ? 'verified' : 'reference',
  search: params.get('q') || '', tax: params.get('tax') === 'excluded' ? 'excluded' : 'included'
};
let dataset, fx, rows = [];
const money = (amount, currency) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: ['JPY', 'KRW'].includes(currency) ? 0 : 2, maximumFractionDigits: ['JPY', 'KRW'].includes(currency) ? 0 : 2 }).format(amount);
const dateTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未取得';
const planName = () => PLANS.find(p => p.id === state.plan).name;

function notify(message, error = false) {
  $('#feedback').hidden = false;
  $('#feedback').textContent = message;
  $('#feedback').classList.toggle('error', error);
}
function persist() {
  const query = new URLSearchParams({ plan: state.plan, currency: state.target, mode: state.mode });
  if (state.search) query.set('q', state.search);
  if (state.mode === 'verified') query.set('tax', state.tax);
  history.replaceState(null, '', `${location.pathname}?${query}`);
}
function pressed(attribute, value) {
  for (const button of document.querySelectorAll(`[${attribute}]`)) {
    const selected = button.getAttribute(attribute) === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}
function render() {
  rows = selectRows(dataset, fx, state);
  const eligible = rows.filter(r => r.rankable);
  const low = eligible[0];
  const us = selectRows(dataset, fx, { ...state, search: '' }).find(r => r.region === 'us' && r.rankable);
  const successful = new Set(dataset.observations.map(o => o.region)).size;
  const latestPrice = dataset.observations.map(o => o.observedAt).sort().at(-1);
  const dates = [...new Set(Object.values(fx.rates).map(r => r.date))].sort();
  pressed('data-plan', state.plan);
  pressed('data-currency', state.target);
  pressed('data-mode', state.mode);
  $('#search').value = state.search;
  $('#tax').value = state.tax;
  $('#tax-label').hidden = state.mode !== 'verified';
  $('#verified-count').textContent = new Set(dataset.observations.filter(o => o.planId === state.plan && isVerifiedMonthly(o)).map(o => o.region)).size;
  $('.stat-label').innerHTML = `${state.mode === 'reference' ? '当前最低公开列价' : '当前最低已核验月费'} <span class="mini-icon">↘</span>`;
  $('#stat-low').textContent = low ? money(low.converted.amount, state.target) : '—';
  $('#stat-low-note').innerHTML = low ? `<strong>${esc(low.market.name)}</strong> · ${esc(planName())} · ${state.mode === 'reference' ? '周期未确认' : state.tax === 'included' ? '标准月度 · 含税' : '标准月度 · 未含税'}` : state.mode === 'verified' ? '暂无符合当前口径的已核验报价' : '暂无可参与当前排名的数据';
  $('#stat-coverage').textContent = successful;
  const failed = dataset.markets.filter(m => m.status !== 'ok').length;
  $('#stat-coverage-note').textContent = `${dataset.observations.length} 条公开观测${failed ? ` · ${failed} 个地区采集待重试` : ' · 每条保留原始来源'}`;
  $('#stat-fx').textContent = dates.length === 1 ? dates[0] : dates.at(-1) || '—';
  $('#stat-fx-note').textContent = `Frankfurter · 每日更新${dates.length > 1 ? ' · 部分币种日期不同' : ''}`;
  $('#mode-explanation').textContent = state.mode === 'reference'
    ? '当前为公开列价参考。App Store 列表未注明周期与税费，不能直接视作月费；同名其他列价见详情。'
    : `仅比较周期、税费与标准价格均有证据的月度报价，当前税费口径：${state.tax === 'included' ? '已含税' : '未含税'}。`;
  $('#top-title').innerHTML = `${state.mode === 'reference' ? '最低列价' : '最低月费'} TOP 5 <span>${state.mode === 'reference' ? 'REFERENCE' : 'VERIFIED'}</span>`;
  $('#top-note').textContent = `按折合${state.target === 'CNY' ? '人民币' : '美元'}金额升序`;
  $('#top-five').innerHTML = eligible.length ? eligible.slice(0, 5).map((r, i) => `<button class="top-card ${i === 0 ? 'best' : ''}" data-region="${r.region}" aria-label="查看${esc(r.market.name)}报价详情"><div class="card-topline"><span>${r.region.toUpperCase()}</span><span class="top-badge">${i === 0 ? '↘ LOWEST' : `0${i + 1}`}</span></div><div class="top-country">${esc(r.market.name)}</div><div class="top-money">${esc(money(r.converted.amount, state.target))}</div><div class="top-original">${esc(r.displayPrice)} · ${esc(r.currency)}</div><div class="card-line" style="--bar:${Math.round(100 * r.converted.amount / Math.max(...eligible.slice(0, 5).map(x => x.converted.amount)))}%"></div></button>`).join('')
    : '<div class="top-empty">暂无符合当前比较口径的报价。数据不足时，排名保持为空。</div>';
  $('#row-count').textContent = rows.length;
  $('#converted-header').innerHTML = `折合${state.target === 'CNY' ? '人民币' : '美元'} <span aria-hidden="true">↑</span>`;
  $('#table-subtitle').textContent = state.mode === 'reference' ? '每地区取该套餐最低公开列价，不据此判断月度周期。' : `标准月度订阅 · ${state.tax === 'included' ? '已含税' : '未含税'} · 附核验证据`;
  $('#price-rows').innerHTML = rows.map((r, i) => {
    const relative = r.rankable && us ? (r.converted.amount / us.converted.amount - 1) * 100 : null;
    const ratio = relative === null ? '—' : r.region === 'us' ? '基准' : `${relative < 0 ? '−' : '+'}${Math.abs(relative).toFixed(1)}%`;
    const ratioClass = relative === null || r.region === 'us' ? '' : relative < 0 ? 'cheaper' : 'higher';
    const status = r.priceStale ? '价格已过期' : !r.converted ? '缺少汇率' : r.converted.stale ? '汇率已过期' : isVerifiedMonthly(r) ? '月费已核验' : '周期未核验';
    return `<tr class="price-row" data-region="${r.region}"><td><span class="rank ${i === 0 && r.rankable ? 'first' : ''}">${r.rankable ? String(i + 1).padStart(2, '0') : '—'}</span></td><td><div class="country-cell"><span class="region-badge" aria-hidden="true">${r.region.toUpperCase()}</span><div><div class="country-name">${esc(r.market.name)}</div><div class="country-code">${esc(r.market.nameEn)}</div></div></div></td><td><div class="amount">${esc(r.displayPrice)}</div><div class="price-caption">${esc(r.currency)} · ${r.period === 'month' ? '月度' : '周期未确认'}</div></td><td><div class="amount converted">${r.converted ? esc(money(r.converted.amount, state.target)) : '—'}</div><div class="price-caption">${r.rankable ? '参考换算' : '不计入当前排名'}</div></td><td><span class="relative ${ratioClass}">${ratio}</span></td><td><span class="status-badge ${!r.rankable ? 'stale' : isVerifiedMonthly(r) ? 'verified' : ''}">${status}</span><div class="price-caption">${r.taxStatus === 'unknown' ? '税费口径未知' : r.taxStatus === 'included' ? '已含税' : '未含税'}</div></td><td><button class="table-arrow" data-region="${r.region}" aria-label="查看${esc(r.market.name)}报价详情">↗</button></td></tr>`;
  }).join('');
  $('#empty-state').hidden = rows.length > 0;
  if (!rows.length) $('#empty-state').innerHTML = state.search ? '<h3>没有找到匹配地区</h3><p>试试地区名称、英文名或币种代码。</p><button class="button" id="clear-search">清除搜索</button>' : state.mode === 'verified' ? '<h3>已核验月费榜，等待第一条证据。</h3><p>目前采集的是公开列价，尚缺订阅周期与税费证据。审核完成后，合格的月度报价会在这里出现。</p><button class="button" id="show-reference">查看公开列价参考</button><a class="button" href="./CONTRIBUTING.md" target="_blank" rel="noopener">了解如何贡献 ↗</a>' : '<h3>暂无可用报价</h3><p>当前套餐在公开商店中没有可识别的列价。可查看原始数据了解采集状态。</p>';
  $('#table-status').textContent = `${eligible.length} 个地区参与当前${state.mode === 'reference' ? '列价参考' : '月费'}排名${rows.length > eligible.length ? ` · ${rows.length - eligible.length} 个地区数据过期或缺失` : ''}`;
  $('#updated-at').textContent = `最新价格观测：${dateTime(latestPrice)}（北京时间）`;
  $('#export').disabled = rows.length === 0;
  persist();
}

function detail(region) {
  const r = rows.find(row => row.region === region);
  if (!r) return;
  const observations = dataset.observations.filter(x => x.region === region && x.planId === state.plan);
  const marketStatus = dataset.markets.find(m => m.code === region);
  const evidence = r.periodEvidence ? `<a href="${esc(r.periodEvidence.url)}" target="_blank" rel="noopener">${esc(r.periodEvidence.note)} ↗</a>` : '来源列表未注明，等待核验';
  $('#detail-content').innerHTML = `<h2 id="detail-heading">${esc(r.market.name)} <span style="color:#9ca6ac;font-size:17px">${r.region.toUpperCase()}</span></h2><div class="detail-plan">ChatGPT ${esc(planName())} · iOS / App Store</div><div class="detail-grid"><div><dt>最低公开列价</dt><dd>${esc(r.displayPrice)} <small>${r.currency}</small></dd></div><div><dt>折合${state.target === 'CNY' ? '人民币' : '美元'}</dt><dd>${r.converted ? esc(money(r.converted.amount, state.target)) : '暂无汇率'}</dd></div></div><dl class="detail-list"><div><dt>原始商品名</dt><dd>${esc(r.sourceName)}</dd></div><div><dt>订阅周期</dt><dd>${r.period === 'unknown' ? '未知' : r.period === 'month' ? '月度' : '年度'} · ${evidence}</dd></div><div><dt>税费口径</dt><dd>${r.taxStatus === 'unknown' ? '未知；列价不可视为最终含税成本' : r.taxStatus === 'included' ? '已含税' : '未含税'}${r.taxEvidence ? ` · <a href="${esc(r.taxEvidence.url)}" target="_blank" rel="noopener">${esc(r.taxEvidence.note)} ↗</a>` : ''}</dd></div><div><dt>观测时间</dt><dd>${esc(dateTime(r.observedAt))}（北京时间）${r.priceStale ? ' · 已过期，退出当前排名' : ''}</dd></div><div><dt>来源页面</dt><dd><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">查看 ${esc(r.market.name)} App Store 原始页面 ↗</a></dd></div><div><dt>汇率与日期</dt><dd>${r.converted ? `1 ${r.currency} ≈ ${r.converted.rate.toFixed(6)} ${state.target}<br>${r.converted.dates.length ? esc(r.converted.dates.join(' / ')) : '同币种，无需换算'}${r.converted.stale ? ' · 汇率过期' : ''}` : '缺少所需币种的汇率'}<br>Frankfurter · 每日参考汇率</dd></div><div><dt>最近采集</dt><dd>${marketStatus?.status === 'ok' ? '成功' : '失败，保留上次价格'} · ${esc(dateTime(marketStatus?.attemptedAt))}${marketStatus?.error ? ` · ${esc(marketStatus.error)}` : ''}</dd></div><div><dt>来源指纹</dt><dd class="hash">SHA-256<br>${esc(r.sourceSha256)}</dd></div></dl><div class="detail-other"><strong>同名商品的全部公开列价</strong><br>${observations.map(x => `${esc(x.displayPrice)} ${x.currency}（${x.period === 'unknown' ? '周期未知' : esc(x.period)}）`).join(' / ')}<br>保留原始列表，不按价格高低猜测月付或年付。</div><p class="detail-notes">参考榜只取本地区最低公开列价。实际可购套餐、周期、税费和付款条件，请以商店订阅确认页面为准。</p>`;
  $('#detail-dialog').showModal();
}

document.addEventListener('click', event => {
  const target = event.target.closest('button,[data-region]');
  if (!target) return;
  if (target.hasAttribute('data-method')) $('#method-dialog').showModal();
  if (target.classList.contains('close-dialog')) target.closest('dialog').close();
  if (target.hasAttribute('data-region')) detail(target.dataset.region);
  if (!dataset) return;
  if (target.dataset.plan) { state.plan = target.dataset.plan; render(); }
  if (target.dataset.currency) { state.target = target.dataset.currency; render(); }
  if (target.dataset.mode) { state.mode = target.dataset.mode; render(); }
  if (target.id === 'clear-search') { state.search = ''; render(); $('#search').focus(); }
  if (target.id === 'show-reference') { state.mode = 'reference'; render(); }
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
});
$('#search').addEventListener('input', event => { state.search = event.target.value; render(); });
$('#tax').addEventListener('change', event => { state.tax = event.target.value; render(); });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); }
});
$('#export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([toCsv(rows, state.target)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `gpt-price-radar-${state.plan}-${state.mode}-${state.target}.csv`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#refresh').addEventListener('click', async () => {
  if (!fx) return;
  const button = $('#refresh'); button.disabled = true;
  button.querySelector('span').classList.add('refresh-spinning');
  try {
    const response = await fetch(fx.sourceUrl, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const next = { ...fx, fetchedAt: new Date().toISOString(), rates: Object.fromEntries(data.map(r => [r.quote, { rate: r.rate, date: r.date }])) };
    validateFx(next);
    fx = next;
    try { localStorage.setItem('gpt-price-radar-fx-v1', JSON.stringify(fx)); } catch { /* Storage is optional. */ }
    render();
    notify('已取得最新可用的每日参考汇率。周末、节假日或数据源未更新时，汇率日期可能保持不变。');
  } catch { notify('汇率更新暂时失败，继续使用当前快照；价格观测时间与汇率日期保持原样。', true); }
  finally { button.disabled = false; button.querySelector('span').classList.remove('refresh-spinning'); }
});

async function load() {
  try {
    const responses = await Promise.all(['prices', 'fx'].map(name => fetch(`./data/${name}.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) })));
    if (responses.some(r => !r.ok)) throw new Error('Dataset request failed');
    [dataset, fx] = await Promise.all(responses.map(r => r.json()));
    validateDataset(dataset); validateFx(fx);
    try {
      const cached = JSON.parse(localStorage.getItem('gpt-price-radar-fx-v1'));
      if (cached && cached.sourceUrl === fx.sourceUrl && Date.parse(cached.fetchedAt) > Date.parse(fx.fetchedAt)) { validateFx(cached); fx = cached; }
    } catch { /* Invalid or unavailable cache cannot replace the shipped snapshot. */ }
    render();
    $('#loading').hidden = true; $('#app').hidden = false;
    if (rows.some(r => !r.rankable)) notify('部分数据过期或缺少汇率，已退出当前排名。详情中仍可查看最后一次观测。', true);
  } catch {
    $('#loading').hidden = true;
    notify('价格数据读取失败。请刷新页面，或通过左侧“开放价格数据”查看原始 JSON。', true);
    $('#refresh').disabled = true;
  }
}
await load();
