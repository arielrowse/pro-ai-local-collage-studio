import { PRESETS, MAX_CANVAS, MAX_MEGAPIXELS, createTextObject, createSwatchObject, createDividerObject, createFrameObject, uid } from '../core/model.js';
import { applyCommandPlan } from './command-intent.js';
import { applyAuthoringFix } from './authoring.js';
import { LAYOUTS, generateCandidates } from './layout.js';
import { analyzeAuthoring } from './authoring.js';
import { getAssetAnalysis } from './intelligence.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const norm=(s='')=>String(s).toLowerCase().replace(/[“”‘’]/g,'"').replace(/[×✕]/g,'x').replace(/\s+/g,' ').trim();
const layoutIds=new Set(LAYOUTS.map(x=>x.id));
const presetBySize=new Map(Object.entries(PRESETS).map(([k,v])=>[`${v.w}x${v.h}`,k]));
const intentAliases=[['product showcase','product'],['product collage','product'],['etsy','product'],['social post','social'],['instagram','social'],['mood board','mood'],['album','album'],['event','event'],['wall art','wall'],['marketing','marketing'],['just for fun','fun']];
const layoutAliases=[['editorial','editorial'],['balanced','balanced'],['grid','grid'],['masonry','masonry'],['hero','hero'],['filmstrip','filmstrip'],['stack','stack'],['asymmetric','asymmetric'],['polaroid','polaroid'],['tilt','tilt'],['mosaic','mosaic'],['exploded','exploded']];

function findAlias(q, list){for(const [needle,val] of list)if(q.includes(needle))return val;return null;}
function photoIndex(q){const m=q.match(/(?:photo|image|picture|asset)\s*(?:number\s*)?(\d{1,2})\b/i);return m?Number(m[1])-1:null;}
function num(q,re){const m=q.match(re);return m?Number(m[1]):null;}
function action(op,payload={}){return {op,...payload};}

export function interpretCopilotRequest(input, project, runtimeAssets){
  const raw=String(input||'').replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
  const q=norm(raw); const actions=[]; const notes=[]; const reasons=[]; let confidence=0;
  if(!q)return {understood:false,confidence:0,actions:[],summary:'ENTER A CREATIVE REQUEST.',notes:[],reasons:[],source:'LOCAL_COPILOT'};

  const intent=findAlias(q,intentAliases);
  if(intent){actions.push(action('setIntent',{intent}));confidence+=.18;reasons.push(`USE ${intent.toUpperCase()} CREATIVE INTENT`);}
  const layout=findAlias(q,layoutAliases);
  if(layout){actions.push(action('setLayout',{layout}));confidence+=.18;reasons.push(`USE ${layout.toUpperCase()} COMPOSITION`);}

  const dims=q.match(/\b(\d{2,5})\s*x\s*(\d{2,5})\b/);
  if(dims){const w=Number(dims[1]),h=Number(dims[2]);if(w<=MAX_CANVAS&&h<=MAX_CANVAS&&w*h<=MAX_MEGAPIXELS*1e6){const preset=presetBySize.get(`${w}x${h}`);actions.push(preset?action('setCanvasPreset',{preset}):action('setCanvas',{w,h}));confidence+=.15;reasons.push(`SET CANVAS TO ${w} × ${h}`);}}
  if(q.includes('etsy')&&!dims){actions.push(action('setCanvasPreset',{preset:'etsy'}));confidence+=.12;reasons.push('USE ETSY SQUARE CANVAS');}
  if((q.includes('tiktok')||q.includes('story')||q.includes('vertical')||q.includes('portrait'))&&!dims){actions.push(action('setCanvasPreset',{preset:'portrait'}));confidence+=.12;reasons.push('USE PORTRAIT CANVAS');}
  if((q.includes('16:9')||q.includes('widescreen')||q.includes('landscape'))&&!dims){actions.push(action('setCanvasPreset',{preset:'wide'}));confidence+=.1;reasons.push('USE WIDESCREEN CANVAS');}

  const gap=num(q,/(?:inner\s*)?gap\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/) ?? num(q,/(\d{1,3})\s*(?:px|pixels)?\s*(?:inner\s*)?gap\b/);
  if(gap!=null){actions.push(action('setFrame',{innerGap:clamp(gap,0,80)}));confidence+=.1;reasons.push(`SET ${clamp(gap,0,80)}PX INNER GAP`);}
  const margin=num(q,/(?:outer\s*)?margins?\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/);
  if(margin!=null){actions.push(action('setFrame',{outerMargin:clamp(margin,0,300)}));confidence+=.1;reasons.push(`SET ${clamp(margin,0,300)}PX OUTER MARGIN`);}
  const radius=num(q,/(?:corner\s*)?(?:radius|rounding)\s*(?:of|to|=)?\s*(\d{1,3})\s*(?:px|pixels)?\b/) ?? num(q,/(\d{1,3})\s*(?:px|pixels)?\s*(?:corner\s*)?(?:radius|rounding)\b/);
  if(radius!=null){actions.push(action('setFrame',{radius:clamp(radius,0,120)}));confidence+=.08;reasons.push(`SET ${clamp(radius,0,120)}PX CORNER RADIUS`);}

  if(/equal\s+(?:margins?|spacing)|even\s+(?:margins?|spacing)|consistent\s+(?:margins?|spacing)|clean\s+spacing/.test(q)){actions.push(action('equalizeStructuredSpacing'));confidence+=.14;reasons.push('NORMALIZE SPACING');}
  if(/align\s+(?:everything|all|the photos|the images)\s+(left|center|right|top|middle|bottom)/.test(q)){const axis=q.match(/align\s+(?:everything|all|the photos|the images)\s+(left|center|right|top|middle|bottom)/)?.[1];actions.push(action('alignAll',{axis}));confidence+=.1;reasons.push(`ALIGN ${axis.toUpperCase()}`);}
  if(/distribute\s+(?:everything|all|the photos|the images)?\s*(horizontally|vertically|x|y)/.test(q)){const axis=/vertically|\by\b/.test(q)?'y':'x';actions.push(action('distribute',{axis}));confidence+=.1;reasons.push(`DISTRIBUTE ${axis.toUpperCase()}`);}
  if(/center\s+(?:everything|all|the photos|the images|the collage)/.test(q)){actions.push(action('centerAll'));confidence+=.08;reasons.push('CENTER COMPOSITION');}

  const idx=photoIndex(q);
  if(idx!=null && /\b(?:hero|lead|main)\b/.test(q)){actions.push(action('makeHero',{imageIndex:idx}));confidence+=.18;reasons.push(`MAKE PHOTO ${idx+1} THE HERO`);}
  if(/\b(?:show|keep|protect)\s+(?:the\s+)?whole\s+(?:photo|image|photos|images)\b|never\s+crop|full\s+photo/.test(q)){actions.push(action('setProtection',{mode:'never'}));confidence+=.14;reasons.push('PROTECT THE FULL PHOTO');}
  if(/\bsmart\s+crop\b|\bfill\s+the\s+frame\b/.test(q)){actions.push(action('setProtection',{mode:'smart'}));confidence+=.1;reasons.push('ENABLE SMART CROP');}

  if(/\b(?:fix|clean up|tidy|polish|refine)\b/.test(q)){
    const report=analyzeAuthoring(project,runtimeAssets);
    const best=(report.suggestions||[]).filter(s=>Number(s.delta||0)>0).sort((a,b)=>Number(b.delta||0)-Number(a.delta||0)).slice(0,4);
    for(const s of best) actions.push(action('applyAuthoringFix',{fixId:s.id}));
    if(best.length){confidence+=Math.min(.28,best.length*.07);reasons.push(`APPLY ${best.length} HIGH-VALUE SMART FIX${best.length===1?'':'ES'}`);}
  }
  if(/\b(?:best|strongest|smart)\s+(?:layout|composition)|make\s+it\s+look\s+good|choose\s+for\s+me/.test(q)){actions.push(action('applyBestLayout'));confidence+=.16;reasons.push('CHOOSE THE STRONGEST LOCAL COMPOSITION');}

  if(/\b(?:clean|minimal|modern)\b/.test(q)){
    if(!layout) actions.push(action('setLayout',{layout:'editorial'}));
    actions.push(action('setBackground',{mapping:'white'}));
    if(gap==null && radius==null) actions.push(action('setFrame',{innerGap:24,radius:0}));
    else if(gap==null) actions.push(action('setFrame',{innerGap:24}));
    else if(radius==null) actions.push(action('setFrame',{radius:0}));
    confidence+=.12;reasons.push('USE A CLEAN MINIMAL VISUAL SYSTEM');
  }
  if(/\b(?:fashion|editorial)\b/.test(q)){
    actions.push(action('setLayout',{layout:'editorial'}),action('setBackground',{mapping:'white'}),action('setFrame',{innerGap:24,radius:0}));
    confidence+=.18;reasons.push('USE EDITORIAL HIERARCHY');
  }
  if(/\b(?:mood board|moodboard)\b/.test(q)){
    actions.push(action('setMode',{mode:'mood'}));
    if(!layout)actions.push(action('setLayout',{layout:'mosaic'}));
    confidence+=.16;reasons.push('OPEN MOOD BOARD WORKFLOW');
  }

  const addText=raw.match(/\b(?:add|create)\s+(?:a\s+)?(?:text|note|title|label)\s*(?:saying|reading|with)?\s*["']([^"']{1,120})["']?/i);
  if(addText){actions.push(action('addText',{text:addText[1].trim()}));confidence+=.14;reasons.push('ADD A TEXT NOTE');}
  const color=q.match(/\b(?:add|create)\s+(?:a\s+)?(?:color|colour)\s+(?:swatch|block)\s+(?:of|#)?\s*(#[0-9a-f]{3,8})\b/i);
  if(color){actions.push(action('addSwatch',{color:color[1].toUpperCase()}));confidence+=.12;reasons.push('ADD A COLOR SWATCH');}
  if(/\b(?:add|create|include|plus|and)\s+(?:a\s+)?divider\b/.test(q)){actions.push(action('addDivider'));confidence+=.1;reasons.push('ADD A DIVIDER');}
  if(/\b(?:add|create|include|plus|and)\s+(?:a\s+)?frame\b/.test(q)){actions.push(action('addFrame'));confidence+=.1;reasons.push('ADD A FRAME');}

  if(/\b(?:product\s+showcase|product\s+collage)\b/.test(q) && !layout){actions.push(action('applyBestLayout'));confidence+=.1;}
  if(q.includes('4-photo')||q.includes('4 photo')){if(!layout){actions.push(action('setLayout',{layout:'balanced'}));confidence+=.08;}}
  if(q.includes('3x3')){actions.push(action('setLayout',{layout:'grid'}));confidence+=.1;}

  const seen=new Set(),dedup=[];for(const a of actions){const k=JSON.stringify(a);if(!seen.has(k)){seen.add(k);dedup.push(a);}}
  const understood=dedup.length>0 && confidence>=.18;
  const summary=understood?(reasons.slice(0,4).join(' • ')||'PREPARE A SMART CREATIVE EDIT'):'I COULD NOT BUILD A HIGH-CONFIDENCE SAFE PLAN FROM THAT REQUEST.';
  return {understood,confidence:Math.min(1,confidence),actions:dedup.slice(0,12),summary,notes, reasons, source:'LOCAL_COPILOT'};
}

export function validateCopilotPlan(plan, project){
  if(!plan||!Array.isArray(plan.actions)||plan.actions.length<1||plan.actions.length>12)return {ok:false,safe:[],warnings:['INVALID CREATIVE PLAN']};
  const safe=[],warnings=[]; const imageCount=project.objects.filter(o=>o.type==='image').length;
  for(const a of plan.actions){
    if(!a||typeof a.op!=='string')continue;
    if(a.op==='setMode'&&['quick','precision','mood'].includes(a.mode))safe.push({op:a.op,mode:a.mode});
    else if(a.op==='setIntent'&&['product','mood','social','album','event','wall','marketing','fun'].includes(a.intent))safe.push({op:a.op,intent:a.intent});
    else if(a.op==='setLayout'&&layoutIds.has(a.layout))safe.push({op:a.op,layout:a.layout});
    else if(a.op==='setCanvasPreset'&&PRESETS[a.preset])safe.push({op:a.op,preset:a.preset});
    else if(a.op==='setCanvas'&&Number.isFinite(+a.w)&&Number.isFinite(+a.h)&&+a.w>=64&&+a.h>=64&&+a.w<=MAX_CANVAS&&+a.h<=MAX_CANVAS&&(+a.w)*(+a.h)<=MAX_MEGAPIXELS*1e6)safe.push({op:a.op,w:Math.round(a.w),h:Math.round(a.h)});
    else if(a.op==='setFrame'){const f={op:a.op};if(a.innerGap!=null)f.innerGap=clamp(+a.innerGap,0,80);if(a.outerMargin!=null)f.outerMargin=clamp(+a.outerMargin,0,300);if(a.radius!=null)f.radius=clamp(+a.radius,0,120);if(Object.keys(f).length>1)safe.push(f);}
    else if(a.op==='setBackground'&&['checker','white','slate'].includes(a.mapping))safe.push({op:a.op,mapping:a.mapping});
    else if(a.op==='setProtection'&&['never','smart','free'].includes(a.mode))safe.push({op:a.op,mode:a.mode});
    else if(['centerAll','equalizeStructuredSpacing','applyBestLayout'].includes(a.op))safe.push({op:a.op});
    else if(a.op==='centerSelected')safe.push({op:a.op});
    else if(a.op==='distribute'&&['x','y'].includes(a.axis))safe.push({op:a.op,axis:a.axis});
    else if(a.op==='alignAll'&&['left','center','right','top','middle','bottom'].includes(a.axis))safe.push({op:a.op,axis:a.axis});
    else if(a.op==='makeHero'&&Number.isInteger(a.imageIndex)&&a.imageIndex>=0&&a.imageIndex<imageCount)safe.push({op:a.op,imageIndex:a.imageIndex});
    else if(a.op==='applyAuthoringFix'&&typeof a.fixId==='string'&&a.fixId.length<80)safe.push({op:a.op,fixId:a.fixId});
    else if(a.op==='addText'&&typeof a.text==='string'&&a.text.trim().length>0&&a.text.length<=120)safe.push({op:a.op,text:a.text.trim()});
    else if(a.op==='addSwatch'&&/^#[0-9A-Fa-f]{3,8}$/.test(String(a.color||'')))safe.push({op:a.op,color:String(a.color).toUpperCase()});
    else if(a.op==='addDivider')safe.push({op:a.op});
    else if(a.op==='addFrame')safe.push({op:a.op});
    else warnings.push(`IGNORED UNSAFE ACTION: ${a.op}`);
  }
  return {ok:safe.length>0,safe,warnings};
}

function labelAction(a){
  const labels={setMode:`SWITCH TO ${String(a.mode).toUpperCase()} STUDIO`,setIntent:`SET ${String(a.intent).toUpperCase()} INTENT`,setLayout:`USE ${String(a.layout).toUpperCase()} LAYOUT`,setCanvasPreset:`USE ${String(a.preset).toUpperCase()} CANVAS`,setCanvas:`SET CANVAS ${a.w} × ${a.h}`,setFrame:'UPDATE FRAME SETTINGS',setBackground:`SET ${String(a.mapping).toUpperCase()} BACKGROUND`,setProtection:`SET IMAGE PROTECTION TO ${String(a.mode).toUpperCase()}`,centerAll:'CENTER THE COMPOSITION',centerSelected:'CENTER SELECTED OBJECT',distribute:`DISTRIBUTE ${String(a.axis).toUpperCase()}`,alignAll:`ALIGN ${String(a.axis).toUpperCase()}`,equalizeStructuredSpacing:'NORMALIZE STRUCTURED SPACING',makeHero:`MAKE PHOTO ${a.imageIndex+1} THE HERO`,applyBestLayout:'CHOOSE STRONGEST LOCAL LAYOUT',applyAuthoringFix:`APPLY SMART FIX: ${a.fixId}`,addText:`ADD TEXT: “${a.text}”`,addSwatch:`ADD COLOR SWATCH ${a.color}`,addDivider:'ADD DIVIDER',addFrame:'ADD FRAME'};
  return labels[a.op]||a.op.toUpperCase();
}
export function describeCopilotPlan(plan){const v=plan?.actions||[];return v.map(labelAction).slice(0,8);}

export function createCopilotDiff(before, after){
  const changes=[];
  const path=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))changes.push({label,before:a,after:b});};
  path(before.mode,after.mode,'MODE'); path(before.intent,after.intent,'INTENT'); path(before.layout?.type,after.layout?.type,'LAYOUT');
  path(before.canvas?.w,after.canvas?.w,'CANVAS WIDTH'); path(before.canvas?.h,after.canvas?.h,'CANVAS HEIGHT');
  path(before.frame?.innerGap,after.frame?.innerGap,'INNER GAP'); path(before.frame?.outerMargin,after.frame?.outerMargin,'OUTER MARGIN'); path(before.frame?.radius,after.frame?.radius,'CORNER RADIUS');
  path(before.imageProtection,after.imageProtection,'IMAGE PROTECTION'); path(before.objects?.length,after.objects?.length,'OBJECT COUNT');
  const bmap=new Map((before.objects||[]).map(o=>[o.id,o])),amap=new Map((after.objects||[]).map(o=>[o.id,o]));
  for(const [id,b] of bmap){const a=amap.get(id);if(!a){changes.push({label:`REMOVE ${b.type.toUpperCase()}`,before:id,after:null});continue;} const moved=['x','y','w','h','rotation','scale'].some(k=>Math.round((b[k]||0)*100)!==Math.round((a[k]||0)*100)); if(moved){changes.push({label:`MOVE / TRANSFORM ${b.name||b.type}`,before:{x:b.x,y:b.y,w:b.w,h:b.h,rotation:b.rotation,scale:b.scale},after:{x:a.x,y:a.y,w:a.w,h:a.h,rotation:a.rotation,scale:a.scale}});}}
  for(const [id,a] of amap)if(!bmap.has(id))changes.push({label:`ADD ${a.type.toUpperCase()}`,before:null,after:id});
  return changes.slice(0,18);
}

export function estimateCopilotImpact(plan,before,after){
  const diff=createCopilotDiff(before,after); let score=0;
  if(plan.actions.some(a=>a.op==='setLayout'||a.op==='applyBestLayout'||a.op==='makeHero'))score+=.25;
  if(plan.actions.some(a=>a.op==='equalizeStructuredSpacing'||a.op==='alignAll'||a.op==='distribute'))score+=.2;
  if(plan.actions.some(a=>a.op==='applyAuthoringFix'))score+=.22;
  if(plan.actions.some(a=>a.op==='setProtection'))score+=.08;
  score=Math.min(.95,score+Math.min(.28,diff.length*.022));
  return {changeCount:diff.length,estimatedImprovement:score,diff};
}


const BASE_OPS=new Set(['setMode','setIntent','setLayout','setCanvasPreset','setCanvas','setFrame','setBackground','setProtection','centerAll','centerSelected','distribute','alignAll','equalizeStructuredSpacing','makeHero','applyBestLayout']);
function maxZ(project){return Math.max(-1,...project.objects.map(o=>Number.isFinite(o.z)?o.z:-1));}
function addText(project,text){const w=Math.min(720,Math.max(320,text.length*28)),h=92;const o=createTextObject(text,{x:(project.canvas.w-w)/2,y:project.frame.outerMargin,w,h},maxZ(project)+1);o.fontSize=Math.max(28,Math.min(58,Math.round(58-(text.length-12)*.35)));project.objects.push(o);project.selectedId=o.id;return true;}
function addSwatch(project,color){const o=createSwatchObject(color,{x:project.canvas.w-project.frame.outerMargin-180,y:project.canvas.h-project.frame.outerMargin-180,w:180,h:180},maxZ(project)+1);project.objects.push(o);project.selectedId=o.id;return true;}
function addDivider(project){const w=Math.max(220,Math.min(project.canvas.w-project.frame.outerMargin*2,720));const o=createDividerObject({x:(project.canvas.w-w)/2,y:project.canvas.h/2,w,h:8},maxZ(project)+1);project.objects.push(o);project.selectedId=o.id;return true;}
function addFrame(project){const w=Math.max(260,project.canvas.w-project.frame.outerMargin*2),h=Math.max(220,project.canvas.h-project.frame.outerMargin*2);const o=createFrameObject({x:(project.canvas.w-w)/2,y:(project.canvas.h-h)/2,w,h},maxZ(project)+1);project.objects.push(o);project.selectedId=o.id;return true;}
export function applyCopilotPlan(project,runtimeAssets,plan){
  const checked=validateCopilotPlan(plan,project);
  if(!checked.ok)return {changed:false,warnings:checked.warnings||[],error:'INVALID_PLAN'};
  const base=checked.safe.filter(a=>BASE_OPS.has(a.op));
  const extras=checked.safe.filter(a=>!BASE_OPS.has(a.op));
  let changed=false,warnings=[...(checked.warnings||[])];
  if(base.length){const r=applyCommandPlan(project,runtimeAssets,{...plan,actions:base});changed=r.changed||changed;warnings.push(...(r.warnings||[]));}
  for(const a of extras){
    try{
      if(a.op==='applyAuthoringFix'){const r=applyAuthoringFix(project,runtimeAssets,a.fixId);changed=r.changed||changed;if(!r.changed)warnings.push(r.message||`FIX ${a.fixId} NO LONGER NEEDED`);}
      else if(a.op==='addText')changed=addText(project,a.text)||changed;
      else if(a.op==='addSwatch')changed=addSwatch(project,a.color)||changed;
      else if(a.op==='addDivider')changed=addDivider(project)||changed;
      else if(a.op==='addFrame')changed=addFrame(project)||changed;
    }catch(e){warnings.push(`ACTION FAILED: ${a.op}`)}
  }
  project.updatedAt=Date.now();
  return {changed,warnings,applied:checked.safe.length,summary:plan.summary||'CREATIVE COPILOT APPLIED'};
}
