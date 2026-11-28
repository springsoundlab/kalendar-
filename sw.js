/* Сервис-воркер CRM: программа и модули Firebase хранятся на устройстве, чтобы всё открывалось без интернета.
   Данные клиентов хранит сама CRM (локальная копия) и синхронизирует с Firebase, когда появляется связь. */
const V='ssl-v1',PAGE=V+'-page',MOD=V+'-mod';
const FBP='https://www.gstatic.com/firebasejs/';
const OPT={ignoreVary:true};

self.addEventListener('install',e=>{e.waitUntil(self.skipWaiting())});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys())if(k!==PAGE&&k!==MOD)await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheMod(url,seen){
  if(seen.has(url))return;seen.add(url);
  const c=await caches.open(MOD);
  let r=await c.match(url,OPT);
  if(!r){r=await fetch(url,{mode:'cors'});if(!r.ok)throw new Error(url);await c.put(url,r.clone())}
  const t=await r.clone().text(),re=/(?:from|import)\s*\(?\s*["']([^"']+\.js)["']/g;let m;const subs=[];
  while((m=re.exec(t))){try{subs.push(new URL(m[1],url).href)}catch(x){}}
  for(const u of subs)if(u.startsWith(FBP))await cacheMod(u,seen);
}
async function warm(d){
  const seen=new Set();
  try{
    const c=await caches.open(PAGE);
    if(d.warm&&!(await c.match(d.warm,{ignoreSearch:true,ignoreVary:true}))){const r=await fetch(d.warm,{cache:'no-cache'});if(r.ok)await c.put(d.warm,r)}
  }catch(x){}
  for(const u of d.mods||[]){try{if(u.startsWith(FBP))await cacheMod(u,seen)}catch(x){}}
}
self.addEventListener('message',e=>{if(e.data&&(e.data.warm||e.data.mods))e.waitUntil(warm(e.data))});

async function fallbackPage(c){
  const sc=self.registration.scope;
  for(const u of [sc,sc+'index.html']){const r=await c.match(u,{ignoreSearch:true,ignoreVary:true});if(r)return r}
  for(const k of await c.keys()){if(/\.html?$|\/$/.test(new URL(k.url).pathname)){const r=await c.match(k,OPT);if(r)return r}}
  return null;
}
/* сначала сеть (чтобы новая версия приходила сразу), при отсутствии связи или долгом ответе — копия на устройстве */
async function netFirst(r){
  const c=await caches.open(PAGE),nav=r.mode==='navigate';
  const net=fetch(r.url,{cache:'no-cache',credentials:'same-origin'});net.catch(()=>{});
  try{
    const res=await Promise.race([net,new Promise((_,j)=>setTimeout(()=>j(new Error('slow')),nav?3000:6000))]);
    if(res&&res.status===200){try{await c.put(r.url,res.clone())}catch(x){}}
    return res;
  }catch(e){
    const hit=(await c.match(r.url,{ignoreSearch:nav,ignoreVary:true}))||(nav?await fallbackPage(c):null);
    if(hit)return hit;
    return net;
  }
}
async function cacheFirst(r){
  const c=await caches.open(MOD),hit=await c.match(r.url,OPT);
  if(hit)return hit;
  const res=await fetch(r);
  if(res&&res.ok){try{await c.put(r.url,res.clone())}catch(x){}}
  return res;
}
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin===self.location.origin){e.respondWith(netFirst(r));return}
  if(u.href.startsWith(FBP)){e.respondWith(cacheFirst(r))}
});
