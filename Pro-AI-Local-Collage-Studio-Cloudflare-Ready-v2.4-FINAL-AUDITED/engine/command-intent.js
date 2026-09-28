import { PRESETS, MAX_CANVAS, MAX_MEGAPIXELS } from '../core/model.js';
import { generateLayout, generateCandidates, LAYOUTS, INTENTS } from './layout.js';

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const LAYOUT_IDS = new Set(LAYOUTS.map(x=>x.id));
const INTENT_IDS = new Set(INTENTS.map(x=>x.id));
const MODES = new Set(['quick','precision','mood']);
const PROTECTION = new Set(['never','smart','free']);
const MAPPINGS = new Set(['checker','white','slate']);

const aliasLayout = [
  ['3x3','grid'],['three by three','grid'],['grid','grid'],['balanced','balanced'],['editorial','editorial'],
  ['masonry','masonry'],['hero','hero'],['filmstrip','filmstrip'],['stack','stack'],['asymmetric','asymmetric'],
  ['polaroid','polaroid'],['tilt','tilt'],['mosaic','mosaic'],['exploded','exploded']
];
const aliasIntent = [
  ['product','product'],['etsy','product'],['mood board','mood'],['moodboard','mood'],['social','social'],
  ['instagram','social'],['album','album'],['event','event'],['wall art','wall'],['marketing','marketing'],['fun','fun']
];
const aliasProtection = [['never crop','never'],['full photo','never'],['keep whole','never'],['keep the whole','never'],['keep my whole','never'],['smart crop','smart'],['smart cropping','smart'],['free crop','free']];

function normalize(s=''){return String(s).toLowerCase().replace(/[“”‘’]/g,'"').replace(/[×✕]/g,'x').replace(/\s+/g,' ').trim();}
function findAlias(q,list){for(const [needle,value] of list)if(q.includes(needle))return value;return null;}
function numberAfter(q,re){const m=q.match(re);return m?Number(m[1]):null;}
function photoIndex(q){const m=q.match(/(?:photo|image|picture|asset)\s*(?:number\s*)?(\d{1,2})\b/i);return m?Number(m[1])-1:null;}
function intentFrom(q){return findAlias(q,aliasIntent);}
function layoutFrom(q){return findAlias(q,aliasLayout);}
function protectionFrom(q){return findAlias(q,aliasProtection);}

export function parseStudioCommand(input, project){
  const q=normalize(input);
  const actions=[]; const notes=[]; let confidence=0;
  if(!q)return {understood:false,confidence:0,actions:[],notes:[],summary:'ENTER AN EDITING REQUEST.'};

  const modeMatch=q.match(/\b(quick studio|precision studio|precision|mood board|mood)\b/);
  if(modeMatch){const raw=modeMatch[1];const mode=raw.includes('mood')?'mood':raw.includes('precision')?'precision':'quick';actions.push({op:'setMode',mode});confidence+=.22;}

  const intent=intentFrom(q);
  if(intent){actions.push({op:'setIntent',intent});confidence+=.2;}

  const layout=layoutFrom(q);
  if(layout){actions.push({op:'setLayout',layout});confidence+=.24;}

  const px3=q.match(/\b(1080\s*x\s*1920|1920\s*x\s*1080|2000\s*x\s*2000|1080\s*x\s*1080)\b/);
  if(px3){
    const dims=px3[1].replace(/\s/g,'').split('x').map(Number);
    actions.push({op:'setCanvas',w:dims[0],h:dims[1]});confidence+=.2;
  } else if(q.includes('etsy cover')||q.includes('etsy')){actions.push({op:'setCanvasPreset',preset:'etsy'});confidence+=.18;}
  else if(q.includes('portrait')||q.includes('tiktok')||q.includes('story')){actions.push({op:'setCanvasPreset',preset:'portrait'});confidence+=.16;}
  else if(q.includes('widescreen')||q.includes('16:9')||q.includes('flatlay')){actions.push({op:'setCanvasPreset',preset:'wide'});confidence+=.16;}
  else if(q.includes('square canvas')||q.includes('square social')){actions.push({op:'setCanvasPreset',preset:'square'});confidence+=.14;}

  const gap=numberAfter(q,/(?:inner\s*)?gap\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/) ?? numberAfter(q,/(\d{1,3})\s*(?:px|pixels)?\s*(?:inner\s*)?gap\b/);
  if(gap!=null){actions.push({op:'setFrame',innerGap:clamp(gap,0,80)});confidence+=.15;}
  const margin=numberAfter(q,/(?:outer\s*)?margins?\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/) ?? numberAfter(q,/(\d{1,3})\s*(?:px|pixels)?\s*(?:outer\s*)?margins?\b/);
  if(margin!=null){actions.push({op:'setFrame',outerMargin:clamp(margin,0,300)});confidence+=.15;}
  const radius=numberAfter(q,/(?:corner\s*)?(?:radius|rounding)\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/) ?? numberAfter(q,/(\d{1,3})\s*(?:px|pixels)?\s*(?:corner\s*)?(?:radius|rounding)\b/);
  if(radius!=null){actions.push({op:'setFrame',radius:clamp(radius,0,120)});confidence+=.12;}

  if(/equal\s+(?:margins?|spacing)|even\s+(?:margins?|spacing)|consistent\s+(?:margins?|spacing)/.test(q)){
    actions.push({op:'setFrame',outerMargin:project?.frame?.outerMargin??60,innerGap:project?.frame?.innerGap??24});
    actions.push({op:'equalizeStructuredSpacing'});confidence+=.15;
  }
  if(/(?:white|clean studio)\s+background/.test(q)){actions.push({op:'setBackground',mapping:'white'});confidence+=.12;}
  if(/(?:slate|deep slate)\s+background/.test(q)){actions.push({op:'setBackground',mapping:'slate'});confidence+=.12;}
  if(/transparent\s+background|checkerboard/.test(q)){actions.push({op:'setBackground',mapping:'checker'});confidence+=.12;}

  const protection=protectionFrom(q);
  if(protection){actions.push({op:'setProtection',mode:protection});confidence+=.18;}

  if(/\bcenter\s+(?:everything|all|the photos|the images|the collage)\b/.test(q)){
    actions.push({op:'centerAll'});confidence+=.18;
  } else if(/\bcenter\s+(?:this|the selected|selected)\b/.test(q)){actions.push({op:'centerSelected'});confidence+=.16;}

  if(/\b(?:space|distribute)\s+(?:them|these|the photos|the images)\s+evenly\b/.test(q)||/\bdistribute\s+(?:horizontally|vertically|x|y)\b/.test(q)){
    let axis=/vertically|\by\b/.test(q)?'y':'x';actions.push({op:'distribute',axis});confidence+=.16;
  }
  if(/\balign\s+(?:them|these|the photos|the images)\s+(left|center|right|top|middle|bottom)\b/.test(q)){
    const a=q.match(/\balign\s+(?:them|these|the photos|the images)\s+(left|center|right|top|middle|bottom)\b/)?.[1];
    if(a){actions.push({op:'alignAll',axis:a});confidence+=.15;}
  }

  const hero=photoIndex(q);
  if(hero!=null && /\b(?:hero|lead|main)\b/.test(q)) {actions.push({op:'makeHero',imageIndex:hero});confidence+=.18;notes.push(`PHOTO ${hero+1} WILL BECOME THE HERO.`);}
  if(/\b(?:apply|use)\s+(?:the\s+)?(?:best|strongest)\s+layout\b/.test(q)||/\bsmart\s+(?:arrange|compose)\b/.test(q)){actions.push({op:'applyBestLayout'});confidence+=.2;}
  if(/\b(?:clean\s+fashion\s+editorial|fashion\s+editorial)\b/.test(q)){
    actions.push({op:'setLayout',layout:'editorial'},{op:'setBackground',mapping:'white'},{op:'setFrame',innerGap:24,radius:0});
    confidence+=.28;notes.push('FASHION EDITORIAL MODE WILL USE A CLEAN HERO + SUPPORTING STACK.');
  }
  if(/\b(?:minimal|clean)\b/.test(q) && /\b(?:editorial|product|marketing)\b/.test(q) && !layout){
    actions.push({op:'setLayout',layout:'editorial'},{op:'setBackground',mapping:'white'},{op:'setFrame',radius:0});confidence+=.18;
  }

  const countMatch=q.match(/\b(2|3|4|5|6|7|8|9)[ -]?photo(?:s)?\b/);
  if(countMatch && q.includes('collage') && !layoutFrom(q)){const n=Number(countMatch[1]);if(n===4||n===9){actions.push({op:'setLayout',layout:'grid'});confidence+=.16;}}

  const explicitActionWords=/\b(make|set|switch|change|use|apply|move|center|align|distribute|crop|keep|protect|rotate|scale|zoom|create|build|turn)\b/.test(q);
  confidence += explicitActionWords ? .06 : 0;
  const dedup=[];const seen=new Set();for(const a of actions){const key=JSON.stringify(a);if(!seen.has(key)){seen.add(key);dedup.push(a);}}
  const useful=dedup.filter(a=>a.op);
  const understood=useful.length>0 && confidence>=.34;
  let summary=understood ? describePlan(useful) : 'I COULD NOT SAFELY TURN THAT INTO EDITING ACTIONS YET.';
  if(!understood) notes.push('TRY: “MAKE A CLEAN 4-PHOTO ETSY PRODUCT COLLAGE WITH EQUAL MARGINS.”');
  return {understood,confidence:clamp(confidence,0,1),actions:useful,notes,summary};
}

function describePlan(actions){
  const parts=[];
  for(const a of actions){
    if(a.op==='setIntent')parts.push(`${INTENTS.find(x=>x.id===a.intent)?.label||a.intent}`);
    else if(a.op==='setLayout')parts.push(`${LAYOUTS.find(x=>x.id===a.layout)?.name||a.layout.toUpperCase()} LAYOUT`);
    else if(a.op==='setCanvasPreset')parts.push(`${PRESETS[a.preset]?.label||a.preset}`);
    else if(a.op==='setCanvas')parts.push(`CANVAS ${a.w}×${a.h}`);
    else if(a.op==='setFrame'){
      if(a.innerGap!=null)parts.push(`GAP ${a.innerGap}px`);if(a.outerMargin!=null)parts.push(`MARGIN ${a.outerMargin}px`);if(a.radius!=null)parts.push(`RADIUS ${a.radius}px`);
    } else if(a.op==='setBackground')parts.push(`${a.mapping.toUpperCase()} BACKGROUND`);
    else if(a.op==='setProtection')parts.push(`${a.mode.toUpperCase()} CROP`);
    else if(a.op==='makeHero')parts.push(`PHOTO ${a.imageIndex+1} AS HERO`);
    else if(a.op==='applyBestLayout')parts.push('BEST SMART LAYOUT');
    else if(a.op==='centerAll')parts.push('CENTER ALL');
    else if(a.op==='distribute')parts.push(`DISTRIBUTE ${a.axis.toUpperCase()}`);
    else if(a.op==='alignAll')parts.push(`ALIGN ${a.axis.toUpperCase()}`);
    else if(a.op==='equalizeStructuredSpacing')parts.push('EQUALIZE SPACING');
  }
  return parts.slice(0,8).join(' • ');
}

export function validateCommandPlan(plan,project){
  if(!plan || !Array.isArray(plan.actions) || plan.actions.length>12)return {ok:false,error:'INVALID_PLAN'};
  const safe=[];const warnings=[];const imageCount=project.objects.filter(o=>o.type==='image').length;
  for(const a of plan.actions){
    if(!a||typeof a.op!=='string')continue;
    if(a.op==='setMode'&&MODES.has(a.mode))safe.push({op:a.op,mode:a.mode});
    else if(a.op==='setIntent'&&INTENT_IDS.has(a.intent))safe.push({op:a.op,intent:a.intent});
    else if(a.op==='setLayout'&&LAYOUT_IDS.has(a.layout))safe.push({op:a.op,layout:a.layout});
    else if(a.op==='setCanvasPreset'&&PRESETS[a.preset])safe.push({op:a.op,preset:a.preset});
    else if(a.op==='setCanvas'&&Number.isFinite(+a.w)&&Number.isFinite(+a.h)&&+a.w>=64&&+a.h>=64&&+a.w<=MAX_CANVAS&&+a.h<=MAX_CANVAS&&(+a.w)*(+a.h)<=MAX_MEGAPIXELS*1e6)safe.push({op:a.op,w:Math.round(a.w),h:Math.round(a.h)});
    else if(a.op==='setFrame'){const f={op:a.op};if(a.innerGap!=null)f.innerGap=clamp(+a.innerGap,0,80);if(a.outerMargin!=null)f.outerMargin=clamp(+a.outerMargin,0,300);if(a.radius!=null)f.radius=clamp(+a.radius,0,120);if(Object.keys(f).length>1)safe.push(f);}
    else if(a.op==='setBackground'&&MAPPINGS.has(a.mapping))safe.push({op:a.op,mapping:a.mapping});
    else if(a.op==='setProtection'&&PROTECTION.has(a.mode))safe.push({op:a.op,mode:a.mode});
    else if(a.op==='centerAll')safe.push({op:a.op});
    else if(a.op==='centerSelected')safe.push({op:a.op});
    else if(a.op==='distribute'&&(a.axis==='x'||a.axis==='y'))safe.push({op:a.op,axis:a.axis});
    else if(a.op==='alignAll'&&['left','center','right','top','middle','bottom'].includes(a.axis))safe.push({op:a.op,axis:a.axis});
    else if(a.op==='equalizeStructuredSpacing')safe.push({op:a.op});
    else if(a.op==='makeHero'&&Number.isInteger(a.imageIndex)&&a.imageIndex>=0&&a.imageIndex<imageCount)safe.push({op:a.op,imageIndex:a.imageIndex});
    else if(a.op==='applyBestLayout')safe.push({op:a.op});
    else warnings.push(`IGNORED UNSAFE ACTION: ${a.op}`);
  }
  return {ok:safe.length>0,safe,warnings};
}

function imageObjects(project){return project.objects.filter(o=>o.type==='image'&&!o.hidden);}
function editableImageObjects(project){return imageObjects(project).filter(o=>!o.locked);}
function setImageLayout(project,runtimeAssets,type){const imgs=imageObjects(project);if(imgs.length<1)return false;const arranged=generateLayout(type,project,runtimeAssets,imgs.map(o=>o.id));const map=new Map(arranged.map(o=>[o.id,o]));for(const o of project.objects){const n=map.get(o.id);if(!n||o.locked)continue;Object.assign(o,{x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??1});}project.layout.type=type;return true;}
function centerAll(project){const imgs=editableImageObjects(project);if(!imgs.length)return false;const minX=Math.min(...imgs.map(o=>o.x)),maxX=Math.max(...imgs.map(o=>o.x+o.w),0),minY=Math.min(...imgs.map(o=>o.y)),maxY=Math.max(...imgs.map(o=>o.y+o.h),0);const dx=project.canvas.w/2-(minX+maxX)/2,dy=project.canvas.h/2-(minY+maxY)/2;for(const o of imgs){o.x+=dx;o.y+=dy;}return true;}
function clampToCanvas(project){for(const o of project.objects.filter(o=>!o.hidden&&!o.locked)){o.x=clamp(o.x,Math.min(0,project.canvas.w-o.w),Math.max(0,project.canvas.w-o.w));o.y=clamp(o.y,Math.min(0,project.canvas.h-o.h),Math.max(0,project.canvas.h-o.h));}}
function distribute(project,axis){const imgs=editableImageObjects(project);if(imgs.length<3)return false;const key=axis==='x'?'x':'y',size=axis==='x'?'w':'h';const sorted=[...imgs].sort((a,b)=>a[key]-b[key]);const first=sorted[0],last=sorted[sorted.length-1],start=first[key],end=last[key]+last[size];const total=sorted.reduce((s,o)=>s+o[size],0);const gap=(end-start-total)/Math.max(1,sorted.length-1);if(!Number.isFinite(gap)||gap<0)return false;let cursor=start;for(const o of sorted){o[key]=cursor;cursor+=o[size]+gap;}return true;}
function alignAll(project,axis){const imgs=editableImageObjects(project);if(imgs.length<2)return false;const c=project.canvas;for(const o of imgs){if(axis==='left')o.x=0;else if(axis==='center')o.x=(c.w-o.w)/2;else if(axis==='right')o.x=c.w-o.w;else if(axis==='top')o.y=0;else if(axis==='middle')o.y=(c.h-o.h)/2;else if(axis==='bottom')o.y=c.h-o.h;}return true;}
function makeHero(project,runtimeAssets,imageIndex){const all=imageObjects(project),target=all[imageIndex];if(!target||target.locked)return false;const imgs=editableImageObjects(project);const ordered=[target,...imgs.filter(o=>o!==target)];const arranged=generateLayout('hero',project,runtimeAssets,ordered.map(o=>o.id));const map=new Map(arranged.map(o=>[o.id,o]));for(const o of project.objects){const n=map.get(o.id);if(n&&!o.locked){Object.assign(o,{x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??o.scale??1});o.compositionRole=o.id===target.id?'HERO':'SUPPORT';}}project.layout.type='hero';return true;}
function equalizeSpacing(project){const imgs=imageObjects(project);if(imgs.length<2)return false;return distribute(project,project.canvas.w>=project.canvas.h?'x':'y');}

export function applyCommandPlan(project,runtimeAssets,plan){
  const v=validateCommandPlan(plan,project);if(!v.ok)return {changed:false,warnings:v.warnings,error:v.error||'INVALID_PLAN'};
  let changed=false;
  for(const a of v.safe){
    if(a.op==='setMode'){project.mode=a.mode;changed=true;}
    else if(a.op==='setIntent'){project.intent=a.intent;changed=true;}
    else if(a.op==='setLayout'){changed=setImageLayout(project,runtimeAssets,a.layout)||changed;}
    else if(a.op==='setCanvasPreset'){const p=PRESETS[a.preset];if(p){project.canvas.preset=a.preset;project.canvas.w=p.w;project.canvas.h=p.h;if(imageObjects(project).length)setImageLayout(project,runtimeAssets,project.layout.type);changed=true;}}
    else if(a.op==='setCanvas'){project.canvas.preset='custom';project.canvas.w=a.w;project.canvas.h=a.h;if(imageObjects(project).length)setImageLayout(project,runtimeAssets,project.layout.type);changed=true;}
    else if(a.op==='setFrame'){for(const k of ['innerGap','outerMargin','radius'])if(a[k]!=null){project.frame[k]=a[k];changed=true;}if((a.innerGap!=null||a.outerMargin!=null)&&imageObjects(project).length)setImageLayout(project,runtimeAssets,project.layout.type);}
    else if(a.op==='setBackground'){project.canvas.mapping=a.mapping;changed=true;}
    else if(a.op==='setProtection'){project.imageProtection=a.mode;imageObjects(project).filter(o=>!o.locked).forEach(o=>{o.fitMode=a.mode;if(a.mode==='never')o.scale=1;});changed=true;}
    else if(a.op==='centerAll')changed=centerAll(project)||changed;
    else if(a.op==='centerSelected'){const o=project.objects.find(o=>o.id===project.selectedId);if(o&&!o.locked){o.x=(project.canvas.w-o.w)/2;o.y=(project.canvas.h-o.h)/2;changed=true;}}
    else if(a.op==='distribute')changed=distribute(project,a.axis)||changed;
    else if(a.op==='alignAll')changed=alignAll(project,a.axis)||changed;
    else if(a.op==='equalizeStructuredSpacing')changed=equalizeSpacing(project)||changed;
    else if(a.op==='makeHero')changed=makeHero(project,runtimeAssets,a.imageIndex)||changed;
    else if(a.op==='applyBestLayout'){const best=generateCandidates(project,runtimeAssets)[0];if(best){const map=new Map(best.objects.map(o=>[o.id,o]));for(const o of project.objects){const n=map.get(o.id);if(n&&!o.locked)Object.assign(o,{x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??o.scale??1,compositionRole:n.compositionRole||o.compositionRole});}project.layout.type=best.type;changed=true;}}
  }
  clampToCanvas(project);project.updatedAt=Date.now();
  return {changed,warnings:v.warnings,applied:v.safe.length,summary:plan.summary||'STUDIO COMMAND APPLIED'};
}

export const STUDIO_COMMAND_SCHEMA={
  type:'object',
  properties:{
    summary:{type:'string'},
    actions:{type:'array',maxItems:12,items:{type:'object',properties:{op:{type:'string'},mode:{type:'string'},intent:{type:'string'},layout:{type:'string'},preset:{type:'string'},w:{type:'integer'},h:{type:'integer'},innerGap:{type:'number'},outerMargin:{type:'number'},radius:{type:'number'},mapping:{type:'string'},imageIndex:{type:'integer'},axis:{type:'string'}},required:['op']}}
  },required:['summary','actions']
};
