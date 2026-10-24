const countries=['US','IN','JP'];
let usable=0;
for(const country of countries){
  const url=`https://chatgpt.com/backend-anon/checkout_pricing_config/configs/${country}`;
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'GPTPriceRadar/0.3 official public pricing research','Accept':'application/json'}});
    if(!r.ok){console.log(JSON.stringify({country,status:r.status,usable:false}));continue;}
    const body=await r.json();
    console.log(JSON.stringify({country,status:r.status,responseCountry:body.country_code,currency:body.currency_config?.symbol_code,plus:body.currency_config?.plus?.month,usable:Boolean(body.currency_config?.plus?.month)}));
    if(body.currency_config?.plus?.month)usable++;
  }catch(e){console.log(JSON.stringify({country,error:e.message,usable:false}));}
}
console.log(`Official regional pricing source usable: ${usable}/${countries.length}`);
if(!usable)process.exitCode=1;
