const CACHE='transfer-pwa-v3-8-2-qr-handshake';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./version.json','./icons/icon-192.png','./icons/icon-512.png','./vendor/qrcode.min.js','./vendor/html5-qrcode.min.js'];

async function putFresh(cache,url){
  try{
    const response=await fetch(new Request(url,{cache:'reload'}));
    if(response && response.ok)await cache.put(url,response.clone());
  }catch{}
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all(ASSETS.map(url=>putFresh(cache,url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();

    // Mantiene actualización automática entre versiones: aunque la versión vieja todavía
    // al activarse este worker navegamos las ventanas de TRANSFER
    // una sola vez para que carguen el shell nuevo. No borra datos locales.
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    await Promise.all(windows.map(client=>{
      try{return client.navigate(client.url)}catch{return null}
    }));
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

function isFreshShellRequest(request,url){
  if(request.mode==='navigate')return true;
  return /\.(?:html|js|css|webmanifest|json)$/i.test(url.pathname);
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;

  if(isFreshShellRequest(request,url)){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request,{cache:'no-store'});
        if(response && response.ok){
          const cache=await caches.open(CACHE);
          cache.put(request,response.clone());
        }
        return response;
      }catch{
        return (await caches.match(request)) || (request.mode==='navigate' ? await caches.match('./index.html') : Response.error());
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    if(cached)return cached;
    try{
      const response=await fetch(request);
      if(response && response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone())}
      return response;
    }catch{return Response.error()}
  })());
});
