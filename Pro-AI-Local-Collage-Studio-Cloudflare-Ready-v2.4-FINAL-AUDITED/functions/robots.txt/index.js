export function onRequestGet({request}){
  const origin=new URL(request.url).origin;
  const body=[
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /functions/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    ''
  ].join('\n');
  return new Response(body,{status:200,headers:{'content-type':'text/plain; charset=UTF-8','cache-control':'public, max-age=3600','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'strict-origin-when-cross-origin'}});
}
