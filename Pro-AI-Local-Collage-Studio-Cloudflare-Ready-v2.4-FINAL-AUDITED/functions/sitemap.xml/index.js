const ROUTES=[
  '/',
  '/photo-collage-maker/',
  '/mood-board-maker/',
  '/collage-maker-no-upload/',
  '/etsy-collage-maker/',
  '/product-collage-maker/',
  '/help/',
  '/privacy/'
];
export function onRequestGet({request}){
  const origin=new URL(request.url).origin;
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n`+
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`+
    ROUTES.map(path=>`<url><loc>${origin}${path}</loc></url>`).join('')+
    `</urlset>`;
  return new Response(xml,{status:200,headers:{'content-type':'application/xml; charset=UTF-8','cache-control':'public, max-age=3600'}});
}
