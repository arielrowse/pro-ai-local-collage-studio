export const APP_VERSION = 10;
export const MAX_ASSETS = 9;
export const MAX_CANVAS = 8000;
export const MAX_MEGAPIXELS = 40;

export const PRESETS = {
  etsy: { w: 2000, h: 2000, label: 'ETSY COVER • 2000 × 2000' },
  portrait: { w: 1080, h: 1920, label: 'PORTRAIT SOCIAL • 1080 × 1920' },
  wide: { w: 1920, h: 1080, label: 'WIDESCREEN • 1920 × 1080' },
  square: { w: 1080, h: 1080, label: 'SQUARE SOCIAL • 1080 × 1080' },
};

export function uid(prefix='obj') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

export function createImageObject(asset, rect={x:0,y:0,w:500,h:500}, z=0) {
  return {
    id: uid('img'), type:'image', assetId:asset.id, name:asset.name,
    x:rect.x, y:rect.y, w:rect.w, h:rect.h, rotation:rect.rotation || 0,
    scale: rect.scale ?? 1, focalX: rect.focalX ?? .5, focalY: rect.focalY ?? .5, focalAuto: rect.focalAuto ?? true, vision: rect.vision ?? null,
    fitMode: rect.fitMode || 'never', locked:false, hidden:false, z,
  };
}
export function createTextObject(text='TEXT NOTE', rect={x:100,y:100,w:420,h:100}, z=0) {
  return {id:uid('text'),type:'text',text,x:rect.x,y:rect.y,w:rect.w,h:rect.h,rotation:0,locked:false,hidden:false,z,fontSize:46,fontWeight:900,align:'left'};
}
export function createSwatchObject(color='#38bdf8', rect={x:100,y:100,w:180,h:180}, z=0) {
  return {id:uid('swatch'),type:'swatch',color,x:rect.x,y:rect.y,w:rect.w,h:rect.h,rotation:0,locked:false,hidden:false,z,radius:22};
}
export function createDividerObject(rect={x:100,y:100,w:500,h:8}, z=0) {
  return {id:uid('divider'),type:'divider',x:rect.x,y:rect.y,w:rect.w,h:rect.h,rotation:0,locked:false,hidden:false,z,color:'#38bdf8'};
}
export function createFrameObject(rect={x:100,y:100,w:600,h:400}, z=0) {
  return {id:uid('frame'),type:'frame',x:rect.x,y:rect.y,w:rect.w,h:rect.h,rotation:0,locked:false,hidden:false,z,stroke:'#38bdf8',strokeWidth:8,radius:24};
}

export function createProject() {
  return {
    version:APP_VERSION,
    id:uid('project'),
    name:'Untitled Collage',
    mode:'quick',
    intent:'product',
    imageProtection:'never',
    canvas:{preset:'etsy',w:2000,h:2000,mapping:'checker',background:'#ffffff',dpi:300},
    frame:{outerMargin:60,innerGap:24,background:'#ffffff',radius:24},
    layout:{type:'balanced',seed:0},
    intelligence:{visionEnhanced:false,visionProvider:null,lastVisionAt:null},
    objects:[],
    selectedId:null,
    createdAt:Date.now(),
    updatedAt:Date.now()
  };
}

export function cloneProjectForHistory(project) {
  return JSON.parse(JSON.stringify(project, (key,value) => key === 'runtime' ? undefined : value));
}

export function sanitizeProject(project) {
  const src = project && typeof project === 'object' ? project : {};
  const base = createProject();
  const p = cloneProjectForHistory(src);
  const mode = ['quick','precision','mood'].includes(p.mode) ? p.mode : base.mode;
  const intentIds = ['product','mood','social','album','event','wall','marketing','fun'];
  const protectionIds = ['never','smart','free'];
  const mappingIds = ['checker','white','slate'];
  p.version = APP_VERSION;
  p.id = typeof p.id === 'string' && p.id.length < 100 ? p.id : base.id;
  p.name = typeof p.name === 'string' && p.name.trim() ? p.name.slice(0,120) : base.name;
  p.mode = mode;
  p.intent = intentIds.includes(p.intent) ? p.intent : base.intent;
  p.imageProtection = protectionIds.includes(p.imageProtection) ? p.imageProtection : base.imageProtection;
  p.canvas = {...base.canvas, ...(p.canvas && typeof p.canvas === 'object' ? p.canvas : {})};
  p.canvas.preset = ['etsy','portrait','wide','square','custom'].includes(p.canvas.preset) ? p.canvas.preset : base.canvas.preset;
  p.canvas.w = Math.round(Math.max(64, Math.min(MAX_CANVAS, Number(p.canvas.w)||base.canvas.w)));
  p.canvas.h = Math.round(Math.max(64, Math.min(MAX_CANVAS, Number(p.canvas.h)||base.canvas.h)));
  if(p.canvas.w*p.canvas.h > MAX_MEGAPIXELS*1e6){const scale=Math.sqrt((MAX_MEGAPIXELS*1e6)/(p.canvas.w*p.canvas.h));p.canvas.w=Math.max(64,Math.floor(p.canvas.w*scale));p.canvas.h=Math.max(64,Math.floor(p.canvas.h*scale));}
  p.canvas.mapping = mappingIds.includes(p.canvas.mapping) ? p.canvas.mapping : base.canvas.mapping;
  p.canvas.dpi = Math.round(Math.max(72,Math.min(1200,Number(p.canvas.dpi)||300)));
  p.frame = {...base.frame, ...(p.frame && typeof p.frame === 'object' ? p.frame : {})};
  const frameNumber=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
  p.frame.outerMargin = frameNumber(p.frame.outerMargin,base.frame.outerMargin,0,240);
  p.frame.innerGap = frameNumber(p.frame.innerGap,base.frame.innerGap,0,160);
  p.frame.radius = frameNumber(p.frame.radius,base.frame.radius,0,160);
  p.objects = Array.isArray(p.objects) ? p.objects.slice(0,80).filter(o=>o && typeof o === 'object' && ['image','text','swatch','divider','frame'].includes(o.type)).map((o,i)=>{
    const q={...o}; q.id=typeof q.id==='string'&&q.id.length<120?q.id:uid('obj'); q.x=Number.isFinite(+q.x)?+q.x:0; q.y=Number.isFinite(+q.y)?+q.y:0; q.w=Math.max(1,Math.min(MAX_CANVAS,Number(q.w)||100)); q.h=Math.max(1,Math.min(MAX_CANVAS,Number(q.h)||100)); q.rotation=Number.isFinite(+q.rotation)?+q.rotation:0; q.z=Number.isFinite(+q.z)?+q.z:i; q.locked=!!q.locked; q.hidden=!!q.hidden; if(q.type==='image'){q.assetId=typeof q.assetId==='string'&&q.assetId.length<120?q.assetId:null;q.fitMode=protectionIds.includes(q.fitMode)?q.fitMode:p.imageProtection;q.scale=Math.max(.1,Math.min(5,Number(q.scale)||1));q.focalX=Math.max(0,Math.min(1,Number(q.focalX)));q.focalY=Math.max(0,Math.min(1,Number(q.focalY)));q.focalX=Number.isFinite(q.focalX)?q.focalX:.5;q.focalY=Number.isFinite(q.focalY)?q.focalY:.5;} if(q.type==='text')q.text=typeof q.text==='string'?q.text.slice(0,120):'TEXT NOTE'; return q;}) : [];
  const ids=new Set(); p.objects=p.objects.filter(o=>{if(ids.has(o.id))return false;ids.add(o.id);return true;});
  const assetIds=new Set(p.objects.filter(o=>o.type==='image'&&o.assetId).map(o=>o.assetId));
  p.objects=p.objects.filter(o=>o.type!=='image'||assetIds.has(o.assetId));
  p.selectedId = p.objects.some(o=>o.id===p.selectedId) ? p.selectedId : null;
  p.intelligence = p.intelligence && typeof p.intelligence==='object' ? p.intelligence : {...base.intelligence};
  p.layout = p.layout && typeof p.layout==='object' ? p.layout : {...base.layout};
  p.layout.type = ['balanced','grid','editorial','masonry','hero','filmstrip','stack','asymmetric','polaroid','tilt','mosaic','exploded'].includes(p.layout.type) ? p.layout.type : base.layout.type;
  p.updatedAt = Date.now();
  delete p.runtime;
  return p;
}
