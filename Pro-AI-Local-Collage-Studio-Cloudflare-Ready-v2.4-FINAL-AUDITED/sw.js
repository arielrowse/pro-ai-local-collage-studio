const CACHE = 'local-collage-v2-4';
const CORE = [
  './','./index.html','./404.html','./styles/app.css','./styles/marketing.css','./ui/app.js','./ui/support-share.js',
  './core/model.js','./core/history.js','./core/idb.js','./core/project-file.js','./core/storage.js','./core/file-access.js',
  './engine/layout.js','./engine/composition.js','./engine/intelligence.js','./engine/vision.js','./engine/render.js','./engine/quality.js','./engine/assistant.js','./engine/authoring.js','./engine/experience.js','./engine/command-intent.js','./engine/adaptive.js','./engine/copilot.js','./engine/ai.js',
  './help/','./privacy/','./photo-collage-maker/','./mood-board-maker/','./collage-maker-no-upload/','./etsy-collage-maker/','./product-collage-maker/',
  './manifest.webmanifest','./icon.svg','./favicon.ico','./assets/favicon-48.png','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/og-card.png'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  // Keep dynamic edge routes out of the client cache. They need fresh responses.
  if(url.pathname==='/robots.txt' || url.pathname==='/sitemap.xml' || url.pathname.startsWith('/api/'))return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok) caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  }).catch(()=>cached)));
});
