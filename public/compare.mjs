import{MARKETS,PLANS,LIVE_DATA_ORIGIN}from'./lib/config.mjs';
import{selectComparisonRows,selectRows,isVerifiedMonthly,toComparisonCsv}from'./lib/domain.mjs';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:c,maximumFractionDigits:['JPY','KRW','VND','CLP'].includes(c)?0:2}).format(n);
const tax=r=>r.taxStatus==='included'?'含税':r.taxStatus==='excluded'?'未含税':'税费未知';
export function renderComparison({dataset,fx,state}){
  $('.top-section').hidden=true;$('.table-section').hidden=true;$('#baseline-panel').hidden=true;$('#comparison-view').hidden=false;
  const rows=selectComparisonRows(dataset,fx,state);
  const monthly=selectRows(dataset,fx,{...state,channel:'web',mode:'verified'}).filter(r=>r.rankable);
  const web=dataset.observations.filter(r=>r.channel==='web'&&r.region!=='global'),ios=dataset.observations.filter(r=>r.channel==='ios');
  const regions=new Set([...web,...ios].map(r=>r.region));
  for(const[attr,value]of[['data-plan',state.plan],['data-currency',state.target],['data-mode',state.mode]])for(const b of document.querySelectorAll(`[${attr}]`)){const yes=b.getAttribute(attr)===value;b.classList.toggle('selected',yes);b.setAttribute('aria-pressed',String(yes));}
  $('#channel').value='all';$('#area').value=state.area;$('#search').value=state.search;$('#tax').value=state.tax;$('#tax-label').hidden=false;
  $('.stat-label').innerHTML=`网页月度配置价参考 · ${state.tax==='included'?'含税':'未含税'} <span class="mini-icon">↘</span>`;
  $('#stat-low').textContent=monthly[0]?money(monthly[0].converted.amount,state.target):'—';
  $('#stat-low-note').textContent=monthly[0]?`${monthly[0].market.name} · ${PLANS.find(p=>p.id===state.plan).name} · 结账资格待核验`:'当前税费口径下暂无官方月度配置价';
  $('#stat-total').textContent=MARKETS.length;$('#stat-coverage').textContent=regions.size;
  $('#stat-coverage-note').textContent=`网页 ${new Set(web.map(r=>r.region)).size} 地区月费配置 / iOS ${new Set(ios.map(r=>r.region)).size} 地区列价 / 安卓 ${(dataset.ranges??[]).length} 地区范围`;
  $('#stat-fx').textContent=[...new Set(Object.values(fx.rates).map(r=>r.date))].sort().at(-1)||'—';$('#stat-fx-note').textContent='Frankfurter · 每日参考汇率 · 日期过期时不换算';
  $('#verified-count').textContent=web.filter(r=>r.planId===state.plan&&isVerifiedMonthly(r)).length;
  $('#mode-explanation').textContent='同一地区并列三个渠道。网页是官方月度配置价；iOS 公开列价未确认周期；安卓的全部内购范围不是套餐月费。未知字段保持为空，不借用其他渠道价格。';
  $('#comparison-heading').textContent=`${PLANS.find(p=>p.id===state.plan).name} · 网页 / iOS / 安卓`;
  $('#comparison-count').textContent=`${rows.length} 个地区`;
  $('#source-audit-note').innerHTML=`官方源白名单校验 · 金额与原始价格文字核对 · 网页金额绑定保留的官方 JSON · <a href="${LIVE_DATA_ORIGIN}audit.json" target="_blank" rel="noopener">查看审计结果 ↗</a>`;
  const sourceCell=(r,channel,region)=>{
    if(!r)return`<div class="missing-quote">${channel==='web'?'地区月费配置尚未取得':channel==='android'?'未取得官方单品月费':'公开列价尚未取得'}</div><a class="source-link" href="${channel==='android'?`https://play.google.com/store/apps/details?id=com.openai.chatgpt&gl=${region.toUpperCase()}&hl=en`:channel==='web'?`https://chatgpt.com/backend-anon/checkout_pricing_config/configs/${region.toUpperCase()}`:`https://apps.apple.com/${region}/app/chatgpt/id6448311069`}" target="_blank" rel="noopener">官方来源 ↗</a>`;
    const button=text=>`<button class="quote-source-button" data-source-region="${region}" data-source-channel="${channel}">${text} <span>↗</span></button>`;
    if(r.kind==='range')return`<div class="missing-quote">未取得官方单品月费</div><div class="range-context">官方全内购范围<br>${esc(money(r.min,r.currency))} – ${esc(money(r.max,r.currency))}</div>${button('查看范围来源')}<small>不参与 Plus／Pro 月费排名</small>`;
    if(state.mode==='verified'&&(!isVerifiedMonthly(r)||r.taxStatus!==state.tax))return`<div class="missing-quote">不符合所选月度／税费口径</div>${button('查看官方原始列价')}`;
    const converted=r.converted&&!r.converted.stale&&!r.priceStale?money(r.converted.amount,state.target):'换算数据缺失或过期';
    const label=r.period==='month'?`${tax(r)} · 官方月度配置`:'周期未知 · 官方商品列价';
    return`${button(`${esc(r.displayPrice)}${r.period==='month'?'<em>/月</em>':''}`)}<div class="quote-converted">${esc(converted)}</div><div class="quote-basis">${esc(label)}</div><small>${r.observedAt.slice(0,10)}${r.pricingRolloutGate?' · 有生效条件，待账户核验':r.channel==='web'?' · 结账资格待核验':''}</small>`;
  };
  const pages=Math.max(1,Math.ceil(rows.length/20));state.page=Math.min(state.page,pages);
  $('#comparison-rows').innerHTML=rows.slice((state.page-1)*20,state.page*20).map(r=>`<tr><td><strong>${esc(r.market.name)}</strong><small>${r.market.code.toUpperCase()} · ${esc(r.market.nameEn)}</small></td><td>${sourceCell(r.web,'web',r.market.code)}</td><td>${sourceCell(r.ios,'ios',r.market.code)}</td><td>${sourceCell(r.android,'android',r.market.code)}</td></tr>`).join('');
  $('#comparison-pages').innerHTML=`<span>第 ${state.page} / ${pages} 页 · 每页 20 个地区</span><div><button class="button small" id="compare-prev" ${state.page===1?'disabled':''}>← 上一页</button><button class="button small" id="compare-next" ${state.page===pages?'disabled':''}>下一页 →</button></div>`;
  $('#comparison-export').onclick=()=>{const url=URL.createObjectURL(new Blob([toComparisonCsv(rows,state.target)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`gpt-price-radar-three-channels-${state.plan}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('#coverage-summary').textContent=`${regions.size} 个地区有列价或配置 · 安卓单品月费 ${dataset.observations.filter(r=>r.channel==='android'&&r.period==='month').length}`;
  $('#coverage-list').innerHTML=rows.map(r=>`<div class="coverage-item"><span>${esc(r.market.name)}</span><span>网页 ${r.web?'有配置':'待取证'} / iOS ${r.ios?'有列价':'待取证'} / 安卓 ${r.android?.kind==='quote'?'有单品价':r.android?'仅范围':'待取证'}</span></div>`).join('');
}
