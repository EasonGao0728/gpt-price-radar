import { PLANS, MARKETS, CHANNELS, LIVE_DATA_ORIGIN } from './lib/config.mjs';
import { selectRows, isVerifiedMonthly, toCsv, validateDataset, validateFx, convert } from './lib/domain.mjs';
const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params = new URLSearchParams(location.search);
const state = {
  plan: PLANS.some(p=>p.id===params.get('plan'))?params.get('plan'):'plus',
  target: params.get('currency')==='USD'?'USD':'CNY', mode:params.get('mode')==='verified'?'verified':'reference',
  channel: CHANNELS.some(c=>c.id===params.get('channel'))?params.get('channel'):'ios',
  area:['asia','europe','americas','middle-east','africa','oceania'].includes(params.get('area'))?params.get('area'):'',
  search:params.get('q')||'', tax:params.get('tax')==='excluded'?'excluded':'included', page:1
};
let dataset,fx,rows=[],usingLive=false;
const pageSize=20;
const money=(value,currency)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency,minimumFractionDigits:['JPY','KRW','VND','CLP'].includes(currency)?0:2,maximumFractionDigits:['JPY','KRW','VND','CLP'].includes(currency)?0:2}).format(value);
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未取得';
const planName=()=>PLANS.find(p=>p.id===state.plan).name;
const channelName=()=>CHANNELS.find(c=>c.id===state.channel).name;
const statusLabel=s=>({ok:'公开数据已采集',reviewed_quote:'已有审核报价',no_public_range:'页面未公开内购范围',needs_checkout:'地区结账价格待核验',unavailable:'公开页面不可用',error:'采集失败，保留旧数据'})[s]||'尚未采集';
function notify(message,error=false){$('#feedback').hidden=false;$('#feedback').textContent=message;$('#feedback').classList.toggle('error',error);}
function pressed(attr,value){for(const b of document.querySelectorAll(`[${attr}]`)){const yes=b.getAttribute(attr)===value;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));}}
function persist(){const q=new URLSearchParams({channel:state.channel,plan:state.plan,currency:state.target,mode:state.mode});if(state.search)q.set('q',state.search);if(state.area)q.set('area',state.area);if(state.mode==='verified')q.set('tax',state.tax);history.replaceState(null,'',`${location.pathname}?${q}`);}
function baselineRows(){return dataset.observations.filter(r=>r.channel==='web'&&r.region==='global');}
function regionalQuotes(){return dataset.observations.filter(r=>r.channel===state.channel&&r.region!=='global');}
function rowStatus(r){if(r.priceStale)return'价格已过期';if(r.kind==='range')return'全部内购范围';if(r.region==='global')return'官方美元月费基线';if(!r.converted)return'缺少汇率';if(r.converted.stale)return'汇率已过期';return isVerifiedMonthly(r)?'月费已核验':r.period==='month'?'月度已注明':'周期未核验';}
function render(){
  rows=selectRows(dataset,fx,state);
  const ranked=rows.filter(r=>r.rankable),low=ranked[0],us=selectRows(dataset,fx,{...state,area:'',search:''}).find(r=>r.region==='us'&&r.rankable);
  const exact=regionalQuotes(),channelRanges=(dataset.ranges??[]).filter(r=>r.channel===state.channel);
  const coverage=new Set([...exact,...channelRanges].map(r=>r.region)).size;
  const statuses=dataset.markets.filter(m=>(m.channel??'ios')===state.channel&&m.code!=='global');
  const dates=[...new Set(Object.values(fx.rates).map(r=>r.date))].sort();
  pressed('data-plan',state.plan);pressed('data-currency',state.target);pressed('data-mode',state.mode);
  $('#channel').value=state.channel;$('#area').value=state.area;$('#search').value=state.search;$('#tax').value=state.tax;$('#tax-label').hidden=state.mode!=='verified';
  $('#stat-total').textContent=MARKETS.length;
  $('#verified-count').textContent=new Set(exact.filter(r=>r.planId===state.plan&&isVerifiedMonthly(r)).map(r=>r.region)).size;
  $('.stat-label').innerHTML=`${state.mode==='verified'?'最低已核验月费':'最低地区套餐列价'} <span class="mini-icon">↘</span>`;
  $('#stat-low').textContent=low?money(low.converted.amount,state.target):'—';
  $('#stat-low-note').innerHTML=low?`<strong>${esc(low.market.name)}</strong> · ${esc(planName())} · ${low.period==='month'?'月度已注明':'周期未确认'}`:state.channel==='android'?'全内购范围不能用于套餐最低价排名':state.channel==='web'?'GLOBAL 基线不参与地区排名':'暂无符合当前口径的报价';
  $('#stat-coverage').textContent=coverage;
  $('#stat-coverage-note').textContent=state.channel==='ios'?`${exact.length} 条商品列价 · ${MARKETS.length} 个配置地区`:state.channel==='android'?`${channelRanges.length} 个地区有全内购范围 · ${exact.length} 条套餐报价`:`${baselineRows().length} 条官方基线 · ${exact.length} 条地区报价`;
  $('#stat-fx').textContent=dates.at(-1)||'—';$('#stat-fx-note').textContent=`Frankfurter · 每日更新${dates.length>1?' · 币种日期见详情':''}`;
  $('#mode-explanation').textContent=state.mode==='verified'?`仅比较有周期、标准价和税费证据的月费；口径：${state.tax==='included'?'已含税':'未含税'}。`:state.channel==='ios'?'App Store 公开列价参考：周期与税费未确认；按同名最低列价展示，其他列价见详情。':state.channel==='android'?'Google Play 公开范围涵盖全部内购商品，不是 Plus／Pro 单品月费，不参与套餐 Top 5。':'网页官方 USD 月费基线单独展示；地区结账价需要另行核验，不用统一美元价格填充各地区。';
  $('#baseline-panel').hidden=state.channel!=='web';
  if(state.channel==='web')$('#baseline-panel').innerHTML=`<div class="section-title"><h2>官方网页美元月费基线 <span>GLOBAL · 非地区报价</span></h2><a href="https://learn.chatgpt.com/docs/pricing" target="_blank" rel="noopener">官方来源 ↗</a></div><div class="baseline-grid">${baselineRows().map(r=>`<button class="baseline-card ${r.planId===state.plan?'selected':''}" data-plan="${r.planId}"><span>${esc(PLANS.find(p=>p.id===r.planId)?.name)}</span><strong>${esc(money(r.amount,'USD'))}<small>/月</small></strong><span>${esc(money(convert(r.amount,'USD',state.target,fx)?.amount??r.amount,state.target))} · 税费未知</span></button>`).join('')||'<p>官方基线尚未采集成功。</p>'}</div>`;
  $('#top-title').innerHTML=`${state.mode==='verified'?'最低月费':'最低地区列价'} TOP 5 <span>${state.mode==='verified'?'VERIFIED':'REFERENCE'}</span>`;
  $('#top-note').textContent=`${channelName()} · 折合 ${state.target}`;
  $('#top-five').innerHTML=ranked.length?ranked.slice(0,5).map((r,i)=>`<button class="top-card ${i===0?'best':''}" data-region="${r.region}" aria-label="查看${esc(r.market.name)}报价"><div class="card-topline"><span>${r.region.toUpperCase()}</span><span class="top-badge">${i===0?'↘ LOWEST':String(i+1).padStart(2,'0')}</span></div><div class="top-country">${esc(r.market.name)}</div><div class="top-money">${esc(money(r.converted.amount,state.target))}</div><div class="top-original">${esc(r.displayPrice)} · ${r.currency}</div><div class="card-line" style="--bar:${Math.round(100*r.converted.amount/Math.max(...ranked.slice(0,5).map(x=>x.converted.amount)))}%"></div></button>`).join(''):`<div class="top-empty">${state.channel==='android'?'全内购范围不对应单一套餐，暂不生成套餐排名。':state.channel==='web'?'官方美元基线不代表地区结账价，暂不生成地区排名。':'暂无符合当前比较口径的报价。'}</div>`;
  $('#table-title').innerHTML=`${state.channel==='android'?'Android 内购范围与套餐报价':state.channel==='web'?'官方基线与地区报价':'地区价格一览'} <span id="row-count">${rows.length}</span>`;
  $('#table-subtitle').textContent=state.channel==='android'?'范围包含所有内购商品，当前 Plus／Pro 筛选不改变范围含义。':state.channel==='web'?'GLOBAL 为官方美元参考，不代表某一国家的实际结账报价。':state.mode==='verified'?'仅纳入相同税费口径的标准月度订阅。':'每地区取该套餐最低公开列价，不据此判断月度周期。';
  $('#converted-header').innerHTML=`折合${state.target==='CNY'?'人民币':'美元'} <span aria-hidden="true">↑</span>`;
  const pages=Math.max(1,Math.ceil(rows.length/pageSize));state.page=Math.min(state.page,pages);
  $('#price-rows').innerHTML=rows.slice((state.page-1)*pageSize,state.page*pageSize).map(r=>{
    const rank=ranked.indexOf(r),relative=r.rankable&&us?(r.converted.amount/us.converted.amount-1)*100:null;
    const ratio=relative===null?'—':r.region==='us'?'基准':`${relative<0?'−':'+'}${Math.abs(relative).toFixed(1)}%`;
    const ratioClass=relative===null||r.region==='us'?'':relative<0?'cheaper':'higher';
    const local=r.kind==='range'?`${money(r.min,r.currency)} – ${money(r.max,r.currency)}`:r.displayPrice;
    const converted=r.kind==='range'?(r.convertedMin&&r.convertedMax?`${money(r.convertedMin.amount,state.target)} – ${money(r.convertedMax.amount,state.target)}`:'暂无汇率'):r.converted?money(r.converted.amount,state.target):'暂无汇率';
    return `<tr class="price-row" data-region="${r.region}"><td><span class="rank ${rank===0?'first':''}">${rank>=0?String(rank+1).padStart(2,'0'):'—'}</span></td><td><div class="country-cell"><span class="region-badge">${r.region==='global'?'◎':r.region.toUpperCase()}</span><div><div class="country-name">${esc(r.market.name)}</div><div class="country-code">${esc(r.market.nameEn)}</div></div></div></td><td><div class="amount">${esc(local)}</div><div class="price-caption">${r.currency} · ${r.kind==='range'?'全部内购商品':r.period==='month'?'月度':'周期未确认'}</div></td><td><div class="amount converted">${esc(converted)}</div><div class="price-caption">${r.rankable?'参考换算':r.kind==='range'?'范围换算 · 不作套餐排名':r.region==='global'?'全球基线 · 不作地区排名':'未计入当前排名'}</div></td><td><span class="relative ${ratioClass}">${ratio}</span></td><td><span class="status-badge ${r.priceStale?'stale':isVerifiedMonthly(r)?'verified':''}">${rowStatus(r)}</span><div class="price-caption">${r.taxStatus==='unknown'?'税费口径未知':r.taxStatus==='included'?'已含税':'未含税'}</div></td><td><button class="table-arrow" data-region="${r.region}" aria-label="查看${esc(r.market.name)}来源详情">↗</button></td></tr>`;
  }).join('');
  $('#pagination').hidden=pages<=1;$('#pagination').innerHTML=`<span>第 ${state.page} / ${pages} 页 · 每页 ${pageSize} 个地区</span><div><button class="button small" id="prev-page" ${state.page===1?'disabled':''}>← 上一页</button><button class="button small" id="next-page" ${state.page===pages?'disabled':''}>下一页 →</button></div>`;
  $('#empty-state').hidden=rows.length>0;
  if(!rows.length)$('#empty-state').innerHTML=state.search||state.area?'<h3>没有匹配的可用数据</h3><p>试试其他地区、币种，或清除筛选。</p><button class="button" id="clear-search">清除筛选</button>':`<h3>${state.mode==='verified'?'已核验月费，等待报价证据。':'暂无可公开读取的套餐报价。'}</h3><p>可查看下方覆盖状态。带地区、周期和税费证据的报价经审核后可导入。</p><a class="button" href="https://github.com/EasonGao0728/gpt-price-radar/issues/new/choose" target="_blank" rel="noopener">提交报价证据 ↗</a>${state.mode==='verified'?'<button class="button" id="show-reference">查看公开参考数据</button>':''}`;
  $('#table-status').textContent=`${ranked.length} 个地区参与排名 · ${usingLive?'GitHub 每日数据':'本地构建快照'}`;
  const latest=[...exact,...channelRanges,...(state.channel==='web'?baselineRows():[])].map(r=>r.observedAt).sort().at(-1);
  $('#updated-at').textContent=`最近观测：${time(latest)}（北京时间）`;$('#export').disabled=!rows.length;
  const errors=statuses.filter(s=>s.status==='error').length;$('#coverage-summary').textContent=`${coverage} 有数据 / ${MARKETS.length} 配置地区 · ${errors} 采集失败`;
  $('#coverage-list').innerHTML=MARKETS.filter(m=>(!state.area||m.area===state.area)&&(!state.search||`${m.name} ${m.nameEn} ${m.code}`.toLowerCase().includes(state.search.toLowerCase()))).map(m=>{const s=statuses.find(s=>s.code===m.code);return `<div class="coverage-item"><span>${esc(m.name)} <small>${m.code.toUpperCase()}</small></span><span class="${s?.status==='ok'?'covered':''}">${esc(statusLabel(s?.status))}</span>${s?.sourceUrl?`<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener" aria-label="查看${esc(m.name)}公开来源">↗</a>`:''}</div>`;}).join('');persist();
}
function detail(region){
  const r=rows.find(r=>r.region===region);if(!r)return;
  const others=dataset.observations.filter(x=>x.channel===state.channel&&x.region===region&&x.planId===state.plan);
  const sourceStatus=dataset.markets.find(m=>(m.channel??'ios')===state.channel&&m.code===region);
  const isRange=r.kind==='range',isGlobal=region==='global';
  const local=isRange?`${money(r.min,r.currency)} – ${money(r.max,r.currency)}`:r.displayPrice;
  const value=isRange?(r.convertedMin&&r.convertedMax?`${money(r.convertedMin.amount,state.target)} – ${money(r.convertedMax.amount,state.target)}`:'缺少汇率'):r.converted?money(r.converted.amount,state.target):'缺少汇率';
  $('#detail-content').innerHTML=`<h2 id="detail-heading">${esc(r.market.name)}</h2><div class="detail-plan">${isRange?'全部内购商品范围':`ChatGPT ${esc(planName())}`} · ${channelName()}</div><div class="detail-grid"><div><dt>${isRange?'全部内购原价范围':'公开列价'}</dt><dd>${esc(local)} <small>${r.currency}</small></dd></div><div><dt>折合 ${state.target}</dt><dd>${esc(value)}</dd></div></div><dl class="detail-list"><div><dt>数据范围</dt><dd>${isRange?'Google Play 主应用的全部内购商品，不对应 Plus／Pro 单品':isGlobal?'官方全球美元基线，不代表任何地区结账价':esc(r.sourceName)}</dd></div><div><dt>订阅周期</dt><dd>${r.period==='month'?'月度（有明确来源）':'未知，未按金额推断'}${r.periodEvidence?` · <a href="${esc(r.periodEvidence.url)}" target="_blank" rel="noopener">${esc(r.periodEvidence.note)} ↗</a>`:''}</dd></div><div><dt>税费状态</dt><dd>${r.taxStatus==='unknown'?'未知，不能据此视为最终含税成本':r.taxStatus==='included'?'已含税':'未含税'}</dd></div><div><dt>观测时间</dt><dd>${time(r.observedAt)}（北京时间）${r.priceStale?' · 数据已过期':''}</dd></div><div><dt>原始来源</dt><dd><a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">查看原始官方或已审核来源 ↗</a></dd></div><div><dt>币种依据</dt><dd>${r.currencyEvidence?`${r.currencyEvidence.value} · ${r.currencyEvidence.inferredForIap?'从同页商店币种推定，并检查价格符号':'原始列价的明确ISO代码'}<br>${esc(r.currencyEvidence.path)}`:isGlobal?'官方明确美元价格':'历史记录；币种见原始来源'}${r.currency!==r.market.currency&&!isGlobal?'<br>商店结算币种与本地法币不同，换算使用商店币种。':''}</dd></div><div><dt>汇率日期</dt><dd>${esc((r.converted?.dates??r.convertedMin?.dates??[]).join(' / ')||'同币种，无需换算')}<br>Frankfurter · 每日参考汇率</dd></div><div><dt>最近采集</dt><dd>${esc(statusLabel(sourceStatus?.status))} · ${time(sourceStatus?.attemptedAt)}${sourceStatus?.error?`<br>${esc(sourceStatus.error)}`:''}</dd></div><div><dt>来源指纹</dt><dd class="hash">SHA-256<br>${esc(r.sourceSha256)}</dd></div></dl><div class="detail-other">${isRange?`原始范围：${esc(r.rawRange)}<br>范围两端不用于 Plus／Pro 月费排名。`:isGlobal?'GLOBAL 基线明确按月计费，但不是地区价格，也未确认税费。':`同名商品全部列价：${others.map(x=>esc(x.displayPrice)).join(' / ')}<br>保留全部原始列价，不按高低猜测月付或年付。`}</div>`;$('#detail-dialog').showModal();
}
document.addEventListener('click',e=>{const b=e.target.closest('button,[data-region]');if(!b)return;if(b.hasAttribute('data-method'))$('#method-dialog').showModal();if(b.classList.contains('close-dialog'))b.closest('dialog').close();if(!dataset)return;if(b.dataset.region)detail(b.dataset.region);if(b.dataset.plan){state.plan=b.dataset.plan;state.page=1;render();}if(b.dataset.currency){state.target=b.dataset.currency;render();}if(b.dataset.mode){state.mode=b.dataset.mode;state.page=1;render();}if(b.id==='clear-search'){state.search='';state.area='';state.page=1;render();}if(b.id==='show-reference'){state.mode='reference';render();}if(b.id==='prev-page'){state.page--;render();$('#table-title').scrollIntoView({block:'start'});}if(b.id==='next-page'){state.page++;render();$('#table-title').scrollIntoView({block:'start'});}});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
for(const[id,key]of[['channel','channel'],['area','area'],['tax','tax']])$('#'+id).addEventListener('change',e=>{state[key]=e.target.value;state.page=1;render();});
$('#search').addEventListener('input',e=>{state.search=e.target.value;state.page=1;render();});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('#search').focus();}});
$('#export').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([toCsv(rows,state.target)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`gpt-price-radar-${state.channel}-${state.plan}-${state.target}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
async function fetchJson(url,timeout=10000){const r=await fetch(url,{cache:'no-cache',signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
$('#refresh').addEventListener('click',async()=>{if(!fx)return;const b=$('#refresh');b.disabled=true;b.querySelector('span').classList.add('refresh-spinning');try{const fxUrl=new URL(fx.sourceUrl);fxUrl.searchParams.set('date',new Date().toISOString().slice(0,10));const data=await fetchJson(fxUrl.href,15000);const next={...fx,sourceUrl:fxUrl.href,fetchedAt:new Date().toISOString(),rates:Object.fromEntries(data.map(r=>[r.quote,{rate:r.rate,date:r.date,providers:r.providers??[]}]))};validateFx(next);fx=next;render();notify('已取得最新可用的每日参考汇率。非交易日汇率日期可能保持不变。');}catch{notify('汇率更新失败，继续使用当前快照和原始日期。',true);}finally{b.disabled=false;b.querySelector('span').classList.remove('refresh-spinning');}});
async function load(){try{const remote=!location.hostname.endsWith('github.io')&&!['127.0.0.1','localhost'].includes(location.hostname);if(remote)try{const data=await Promise.all(['prices','fx'].map(n=>fetchJson(`${LIVE_DATA_ORIGIN}${n}.json`)));validateDataset(data[0]);validateFx(data[1]);[dataset,fx]=data;usingLive=true;}catch{/* The shipping snapshot is the fallback when the public data feed cannot be reached. */}if(!dataset){[dataset,fx]=await Promise.all(['prices','fx'].map(n=>fetchJson(`./data/${n}.json`)));validateDataset(dataset);validateFx(fx);usingLive=location.hostname.endsWith('github.io');}render();$('#loading').hidden=true;$('#app').hidden=false;if(rows.some(r=>r.priceStale||r.converted?.stale))notify('部分价格或汇率已过期，已退出当前排名；原始日期和采集状态保留。',true);}catch{$('#loading').hidden=true;notify('读取数据失败，请刷新或查看开放 JSON 数据。',true);$('#refresh').disabled=true;}}
await load();
