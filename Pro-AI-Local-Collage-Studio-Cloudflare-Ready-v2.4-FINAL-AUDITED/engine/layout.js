import { getAssetAnalysis } from './intelligence.js';
import { composeObjects, evaluateComposition, compositionExplanation } from './composition.js';

const TYPES=['balanced','grid','editorial','masonry','hero','filmstrip','stack','asymmetric','polaroid','tilt','mosaic','exploded'];
export const LAYOUTS=[
 {id:'balanced',name:'BALANCED',group:'QUICK',desc:'Clean proportional grid'},
 {id:'grid',name:'GRID',group:'QUICK',desc:'Even geometric cells'},
 {id:'editorial',name:'EDITORIAL',group:'QUICK',desc:'Hero image + supporting stack'},
 {id:'masonry',name:'MASONRY',group:'QUICK',desc:'Aspect-aware columns'},
 {id:'hero',name:'HERO',group:'QUICK',desc:'One dominant visual'},
 {id:'filmstrip',name:'FILMSTRIP',group:'QUICK',desc:'Cinematic horizontal sequence'},
 {id:'stack',name:'STACK',group:'QUICK',desc:'Layered focal composition'},
 {id:'asymmetric',name:'ASYMMETRIC',group:'QUICK',desc:'Off-balance editorial frame'},
 {id:'polaroid',name:'POLAROID',group:'CREATIVE',desc:'Tactile offset cards'},
 {id:'tilt',name:'TILT',group:'CREATIVE',desc:'Rotated gallery tiles'},
 {id:'mosaic',name:'MOSAIC',group:'CREATIVE',desc:'Varied tile rhythm'},
 {id:'exploded',name:'EXPLODED',group:'CREATIVE',desc:'Spaced modular arrangement'},
];
export const INTENTS=[
 {id:'product',label:'PRODUCT SHOWCASE'}, {id:'mood',label:'MOOD BOARD'}, {id:'social',label:'SOCIAL POST'}, {id:'album',label:'PHOTO ALBUM'}, {id:'event',label:'EVENT GRAPHIC'}, {id:'wall',label:'WALL ART'}, {id:'marketing',label:'MARKETING COLLAGE'}, {id:'fun',label:'JUST FOR FUN'}
];

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function usable(canvas, margin, gap){return {x:margin,y:margin,w:Math.max(1,canvas.w-margin*2),h:Math.max(1,canvas.h-margin*2),gap};}
function gridRects(n,box,ratioBias=1){
  let best={score:1e9,rows:1,cols:n};
  for(let rows=1;rows<=n;rows++){
    const cols=Math.ceil(n/rows); const cw=(box.w-box.gap*(cols-1))/cols; const ch=(box.h-box.gap*(rows-1))/rows; const ar=cw/ch;
    const score=Math.abs(Math.log(ar*ratioBias)); if(score<best.score)best={score,rows,cols};
  }
  const out=[]; const rh=(box.h-box.gap*(best.rows-1))/best.rows;
  for(let r=0,i=0;r<best.rows;r++)for(let c=0;c<best.cols;c++)if(i<n){const cw=(box.w-box.gap*(best.cols-1))/best.cols;out.push({x:box.x+c*(cw+box.gap),y:box.y+r*(rh+box.gap),w:cw,h:rh,rotation:0});i++;}
  return out;
}
function balanced(n,canvas,margin,gap){const b=usable(canvas,margin,gap); return gridRects(n,b,canvas.w/canvas.h>1.35?.92:1);}
function editorial(n,canvas,margin,gap){if(n<2)return balanced(n,canvas,margin,gap);const b=usable(canvas,margin,gap), leftW=b.w*.58;const arr=[{x:b.x,y:b.y,w:leftW-gap/2,h:b.h,rotation:0}];const rightX=b.x+leftW+gap/2,rightW=b.w-leftW-gap/2;const rest=n-1;const rh=(b.h-gap*(rest-1))/rest;for(let i=0;i<rest;i++)arr.push({x:rightX,y:b.y+i*(rh+gap),w:rightW,h:rh,rotation:0});return arr;}
function hero(n,canvas,margin,gap){if(n<2)return balanced(n,canvas,margin,gap);const b=usable(canvas,margin,gap), heroW=b.w*.66;const arr=[{x:b.x,y:b.y,w:heroW-gap/2,h:b.h,rotation:0}];const x=b.x+heroW+gap/2,w=b.w-heroW-gap/2,rest=n-1,rh=(b.h-gap*(rest-1))/rest;for(let i=0;i<rest;i++)arr.push({x,y:b.y+i*(rh+gap),w,h:rh,rotation:0});return arr;}
function masonry(n,canvas,margin,gap){const b=usable(canvas,margin,gap);const cols=n<3?1:n<=6?2:3;const heights=Array(cols).fill(b.y), widths=(b.w-gap*(cols-1))/cols;const out=[];for(let i=0;i<n;i++){let c=0;for(let j=1;j<cols;j++)if(heights[j]<heights[c])c=j;const assetRatio=canvas._aspects?.[i]||1;const w=widths,h=clamp(w/assetRatio,w*.55,w*1.75);out.push({x:b.x+c*(w+gap),y:heights[c],w,h,rotation:0});heights[c]+=h+gap;}const total=Math.max(...heights)-gap;const scale=Math.min(1,b.h/Math.max(total,1));if(scale<.995)return out.map(o=>({...o,x:b.x+(o.x-b.x)*scale,y:b.y+(o.y-b.y)*scale,w:o.w*scale,h:o.h*scale}));return out;}
function filmstrip(n,canvas,margin,gap){const b=usable(canvas,margin,gap);const h=b.h*.46;const y=b.y+(b.h-h)/2;const w=(b.w-gap*(n-1))/n;return Array.from({length:n},(_,i)=>({x:b.x+i*(w+gap),y,w,h,rotation:0}));}
function stack(n,canvas,margin,gap){const b=usable(canvas,margin,gap),s=Math.min(b.w,b.h)*.64;const cx=b.x+b.w/2,cy=b.y+b.h/2;return Array.from({length:n},(_,i)=>({x:cx-s/2+(i-(n-1)/2)*gap*.8,y:cy-s/2+(i-(n-1)/2)*gap*.55,w:s,h:s*.72,rotation:(i-(n-1)/2)*2.5}));}
function asymmetric(n,canvas,margin,gap){if(n<2)return balanced(n,canvas,margin,gap);const b=usable(canvas,margin,gap), left=b.w*.38, top=b.h*.56;const a=[{x:b.x,y:b.y,w:left,h:b.h,rotation:0},{x:b.x+left+gap,y:b.y,w:b.w-left-gap,h:top,rotation:0}];let rest=n-2;const w=(b.w-left-gap-gap*.5)/2;for(let i=0;i<rest;i++){const row=Math.floor(i/2),col=i%2;const h=(b.h-top-gap-gap*(Math.ceil(rest/2)-1))/Math.max(1,Math.ceil(rest/2));a.push({x:b.x+left+gap+col*(w+gap),y:b.y+top+gap+row*(h+gap),w,h,rotation:0});}return a.slice(0,n);}
function mosaic(n,canvas,margin,gap){const b=usable(canvas,margin,gap);if(n<4)return asymmetric(n,canvas,margin,gap);const rows=n<=6?2:3, cols=3, cellW=(b.w-gap*(cols-1))/cols,cellH=(b.h-gap*(rows-1))/rows;const spans=[];for(let i=0;i<n;i++){const r=Math.floor(i/cols),c=i%cols;spans.push({x:b.x+c*(cellW+gap),y:b.y+r*(cellH+gap),w:cellW,h:cellH,rotation:0});}return spans;}
function rotatedBounds(r){const t=Math.abs((r.rotation||0)*Math.PI/180),c=Math.cos(t),s=Math.sin(t);return{x:r.x+(r.w*c-r.h*s-r.w)/2,y:r.y+(r.w*s+r.h*c-r.h)/2,w:Math.abs(r.w*c)+Math.abs(r.h*s),h:Math.abs(r.w*s)+Math.abs(r.h*c)};}
function clampRotatedRect(r,canvas){const b=rotatedBounds(r);const dx=Math.max(-b.x,Math.min(0,canvas.w-(b.x+b.w)));const dy=Math.max(-b.y,Math.min(0,canvas.h-(b.y+b.h)));return {...r,x:r.x+dx,y:r.y+dy};}
function polaroid(n,canvas,margin,gap){const s=Math.min(canvas.w,canvas.h)*.20;const cx=canvas.w/2,cy=canvas.h/2;const radius=Math.min(canvas.w,canvas.h)*.028;return Array.from({length:n},(_,i)=>{const angle=(i-(n-1)/2)*Math.min(3.2,24/Math.max(1,n));const raw={x:cx-s/2+(i-(n-1)/2)*s*.30,y:cy-s*.42+Math.sin(i*1.7)*radius,w:s,h:s*1.12,rotation:angle};return clampRotatedRect(raw,canvas);});}
function tilt(n,canvas,margin,gap){const a=balanced(n,canvas,margin,gap);return a.map((r,i)=>clampRotatedRect({...r,rotation:(i%2?2.2:-2.2)},canvas));}
function exploded(n,canvas,margin,gap){const a=balanced(n,canvas,margin,gap);return a.map((r,i)=>({...r,x:r.x+(i%2?gap*.45:-gap*.45),y:r.y+(i%3===0?gap*.35:-gap*.2)}));}
function makeRecipe(type,n,canvas,margin,gap){
  const c={...canvas,_aspects:canvas._aspects||[]};
  switch(type){case'grid':return gridRects(n,usable(c,margin,gap),1);case'balanced':return balanced(n,c,margin,gap);case'editorial':return editorial(n,c,margin,gap);case'masonry':return masonry(n,c,margin,gap);case'hero':return hero(n,c,margin,gap);case'filmstrip':return filmstrip(n,c,margin,gap);case'stack':return stack(n,c,margin,gap);case'asymmetric':return asymmetric(n,c,margin,gap);case'polaroid':return polaroid(n,c,margin,gap);case'tilt':return tilt(n,c,margin,gap);case'mosaic':return mosaic(n,c,margin,gap);case'exploded':return exploded(n,c,margin,gap);default:return balanced(n,c,margin,gap);}
}

export function generateLayout(type, project, runtimeAssets, objectIds){
  const ids=objectIds||project.objects.filter(o=>o.type==='image').map(o=>o.id);
  const imgs=ids.map(id=>project.objects.find(o=>o.id===id)).filter(Boolean);
  const aspects=imgs.map(o=>{const a=runtimeAssets.get(o.assetId);return a?.width/a?.height||1});
  const canvas={...project.canvas,_aspects:aspects};
  const margin=project.frame.outerMargin;
  const gap=project.frame.innerGap;
  const rects=makeRecipe(type,imgs.length,canvas,margin,gap);
  return composeObjects(imgs,rects,project,runtimeAssets,type);
}

function clampScore(v){return Math.max(0,Math.min(1,v));}

export function generateCompositionReport(project,runtimeAssets,type=project.layout.type){
  const objects=project.objects.filter(o=>o.type==='image');
  return evaluateComposition(objects,project,runtimeAssets,type);
}

export function generateCandidates(project,runtimeAssets){
  const intents={product:['editorial','hero','balanced','grid'],mood:['mosaic','asymmetric','stack','polaroid'],social:['hero','balanced','grid','tilt'],album:['masonry','grid','filmstrip','balanced'],event:['editorial','asymmetric','hero','balanced'],wall:['masonry','grid','filmstrip','exploded'],marketing:['hero','editorial','mosaic','balanced'],fun:['tilt','polaroid','exploded','stack']};
  const preferred=intents[project.intent]||['balanced','grid','editorial','masonry'];
  const pool=[...new Set([...preferred,...TYPES])];
  return pool.map(type=>{
    const objects=generateLayout(type,project,runtimeAssets);
    const p={...project,layout:{...project.layout,type}};
    const report=evaluateComposition(objects,p,runtimeAssets,type);
    return {type,objects,score:clampScore(report.score),reason:compositionExplanation(report,p,type),report};
  }).sort((a,b)=>b.score-a.score).slice(0,4).map((c,i)=>({...c,label:LAYOUTS.find(x=>x.id===c.type)?.name||c.type,rank:i+1}));
}

export function layoutLabel(type){return LAYOUTS.find(x=>x.id===type)?.name||type.toUpperCase();}
export function layoutTypesForGroup(group){return LAYOUTS.filter(x=>x.group===group);}
