import { evaluateComposition } from './composition.js';
import { generateCandidates, generateLayout } from './layout.js';
import { getAssetAnalysis, subjectVisibility } from './intelligence.js';
import { inspectProject } from './quality.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const sq=(v)=>v*v;

function cloneProject(project){return JSON.parse(JSON.stringify(project));}
function images(project){return project.objects.filter(o=>o.type==='image'&&!o.hidden);}
function rectArea(o){return Math.max(0,o.w)*Math.max(0,o.h);}
function boundsOf(objects){
  if(!objects.length)return null;
  const x1=Math.min(...objects.map(o=>o.x)), y1=Math.min(...objects.map(o=>o.y));
  const x2=Math.max(...objects.map(o=>o.x+o.w)), y2=Math.max(...objects.map(o=>o.y+o.h));
  return {x:x1,y:y1,w:x2-x1,h:y2-y1};
}
function groupCenter(objects){
  const b=boundsOf(objects); return b?{x:b.x+b.w/2,y:b.y+b.h/2}:null;
}
function translateVisibleImages(project,dx,dy){
  for(const o of images(project)){if(!o.locked){o.x+=dx;o.y+=dy;}}
}
function clampObjectsToCanvas(project){
  for(const o of project.objects.filter(o=>!o.hidden&&!o.locked)){
    o.x=clamp(o.x,Math.min(0,project.canvas.w-o.w),Math.max(0,project.canvas.w-o.w));
    o.y=clamp(o.y,Math.min(0,project.canvas.h-o.h),Math.max(0,project.canvas.h-o.h));
  }
}
function replaceImageGeometry(project, arranged, type){
  const map=new Map(arranged.map(o=>[o.id,o]));
  project.objects=project.objects.map(o=>{
    const n=map.get(o.id);
    if(!n||o.locked)return o;
    return {...o,x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??o.scale??1,compositionRole:n.compositionRole||o.compositionRole};
  });
  project.layout.type=type;
}
function rebuildLayout(project,runtimeAssets,type=project.layout.type){
  const ids=images(project).map(o=>o.id);
  if(ids.length<2)return false;
  const arranged=generateLayout(type,project,runtimeAssets,ids);
  replaceImageGeometry(project,arranged,type);
  return true;
}
function strongest(project,runtimeAssets){
  let best=null;
  for(const o of images(project)){
    if(o.locked)continue;
    const a=getAssetAnalysis(runtimeAssets,o); if(!a)continue;
    const sal=.28+clamp((a.contrast-.035)/.28)*.24+clamp((a.edgeDensity-.025)/.23)*.19+clamp((a.saturation??.25)/.75)*.1+(a.visualDensity==='HIGH'?.15:a.visualDensity==='MEDIUM'?.08:.03)+(a.vision?.enhanced?clamp((a.vision.confidence||0)*.24):0);
    if(!best||sal>best.score)best={object:o,analysis:a,score:sal};
  }
  return best;
}
function heroMismatch(project,runtimeAssets,report){
  if(!images(project).length)return false;
  const strong=strongest(project,runtimeAssets); if(!strong)return false;
  const large=[...images(project)].sort((a,b)=>rectArea(b)-rectArea(a))[0];
  return ['hero','editorial'].includes(project.layout.type)||['product','marketing','event'].includes(project.intent) ? strong.object.id!==large.id : report.metrics.hierarchy<.68;
}
function fixHero(project,runtimeAssets){
  const strong=strongest(project,runtimeAssets); if(!strong)return false;
  const imgs=images(project); const large=[...imgs].sort((a,b)=>rectArea(b)-rectArea(a))[0];
  if(!large||large.locked||strong.object.locked||strong.object.id===large.id)return false;
  const keys=['x','y','w','h','rotation'];
  const temp={};for(const k of keys)temp[k]=large[k];
  for(const k of keys)large[k]=strong.object[k];
  for(const k of keys)strong.object[k]=temp[k];
  large.compositionRole='HERO'; strong.object.compositionRole='SUPPORT';
  return true;
}
function fixFocal(project,runtimeAssets){
  let changed=false;
  for(const o of images(project)){
    if(o.locked)continue;
    const a=getAssetAnalysis(runtimeAssets,o); if(!a)continue;
    if(a.vision?.enhanced){o.focalX=a.vision.focalX??a.focalX??.5;o.focalY=a.vision.focalY??a.focalY??.5;o.focalAuto=true;}
    if(o.fitMode==='smart'||o.fitMode==='free')o.scale=1;
    const subject=a.vision?.enhanced?subjectVisibility(o,a):null;
    if(subject&&subject.contained<.75)o.fitMode='smart';
    changed=true;
  }
  return changed;
}
function fixCenter(project){
  const objs=images(project); const c=groupCenter(objs); if(!c)return false;
  const dx=project.canvas.w/2-c.x,dy=project.canvas.h/2-c.y;
  if(Math.hypot(dx,dy)<2)return false; translateVisibleImages(project,dx,dy);clampObjectsToCanvas(project);return true;
}
function fixAlignment(project){
  const objs=images(project).filter(o=>!o.locked);if(objs.length<2)return false;
  const centersX=objs.map(o=>o.x+o.w/2),centersY=objs.map(o=>o.y+o.h/2);
  const mx=mean(centersX),my=mean(centersY);
  const vx=mean(centersX.map(v=>sq(v-mx))),vy=mean(centersY.map(v=>sq(v-my)));
  if(vx<vy){for(const o of objs)o.x=mx-o.w/2;}else{for(const o of objs)o.y=my-o.h/2;}
  clampObjectsToCanvas(project);return true;
}
function fixCoverage(project,runtimeAssets){
  if(images(project).length<2)return false;
  const before=project.objects.map(o=>({...o}));
  if(rebuildLayout(project,runtimeAssets,project.layout.type))return true;
  project.objects=before;return false;
}

function issue(id,kind,title,message,priority,mutator,metadata={}){
  return {id,kind,title,message,priority,mutator,...metadata};
}

export function analyzeAuthoring(project,runtimeAssets,{detailed=false}={}){
  const comp=evaluateComposition(images(project),project,runtimeAssets,project.layout.type);
  const quality=detailed?inspectProject(project,runtimeAssets):{issues:[]};
  const simpleBounds=project.objects.some(o=>!o.hidden&&(o.x<0||o.y<0||o.x+o.w>project.canvas.w||o.y+o.h>project.canvas.h));
  const suggestions=[];
  if(simpleBounds||quality.issues.some(i=>i.action==='bounds'||i.key==='canvas')){
    suggestions.push(issue('bounds','safety','KEEP EVERYTHING ON CANVAS','ONE OR MORE OBJECTS EXTEND BEYOND THE EXPORT BOUNDARY.',100,(p)=>{clampObjectsToCanvas(p);return true;}));
  }
  if(comp.metrics?.focal<.72){
    suggestions.push(issue('focal','crop','PROTECT VISUAL SUBJECTS','A FEW PHOTOS MAY BE LOSING THEIR MOST IMPORTANT CONTENT.',96,(p)=>fixFocal(p,runtimeAssets),{autoSafe:true}));
  }
  if(heroMismatch(project,runtimeAssets,comp)){
    suggestions.push(issue('hero','hierarchy','STRENGTHEN VISUAL HIERARCHY','THE STRONGEST PHOTO IS NOT LEADING THE COMPOSITION.',88,(p)=>fixHero(p,runtimeAssets)));
  }
  if(comp.metrics?.spacing<.72 && project.mode!=='mood'){
    suggestions.push(issue('spacing','rhythm','REBUILD CLEAN SPACING','GAPS ARE UNEVEN FOR THIS STRUCTURED LAYOUT.',82,(p)=>fixCoverage(p,runtimeAssets),{confirmLabel:'REBUILD LAYOUT'}));
  }
  if(comp.metrics?.alignment<.58 && ['grid','balanced','editorial','hero','filmstrip','masonry'].includes(project.layout.type)){
    suggestions.push(issue('alignment','alignment','ALIGN THE COMPOSITION','VISIBLE IMAGE EDGES OR AXES ARE FIGHTING EACH OTHER.',76,(p)=>fixAlignment(p)));
  }
  if(comp.metrics?.balance<.64 || comp.metrics?.visualCenter<.64){
    suggestions.push(issue('balance','balance','RE-CENTER VISUAL WEIGHT','THE CURRENT IMAGE GROUP SITS TOO FAR FROM THE CANVAS CENTER.',72,(p)=>fixCenter(p)));
  }
  if(comp.metrics?.intentFit<.58 && images(project).length>=2){
    const candidates=generateCandidates(project,runtimeAssets);
    const best=candidates[0];
    if(best&&best.type!==project.layout.type){
      suggestions.push(issue('intent','intent','MATCH THE CREATIVE INTENT',`A ${best.label.toUpperCase()} ARRANGEMENT FITS THIS PROJECT BETTER.`,68,(p)=>{replaceImageGeometry(p,best.objects,best.type);return true;},{confirmLabel:`USE ${best.label.toUpperCase()}`,candidate:best.type}));
    }
  }
  const ranked=suggestions.sort((a,b)=>b.priority-a.priority);
  const base=clamp(comp.score);
  if(!detailed) return {score:base,metrics:comp.metrics||{},issues:quality.issues||[],suggestions:ranked.slice(0,3).map(s=>({...s,delta:0})),insights:comp.insights||[]};
  const evaluated=ranked.map(s=>{
    let delta=0;
    try{const test=cloneProject(project);const changed=s.mutator(test);if(changed){const after=evaluateComposition(images(test),test,runtimeAssets,test.layout.type);delta=after.score-base;}}
    catch{delta=0;}
    return {...s,delta};
  }).sort((a,b)=>(b.priority+Math.max(0,b.delta)*30)-(a.priority+Math.max(0,a.delta)*30));
  return {score:base,metrics:comp.metrics||{},issues:quality.issues||[],suggestions:evaluated.slice(0,3),insights:comp.insights||[]};
}

export function applyAuthoringFix(project,runtimeAssets,id){
  const report=analyzeAuthoring(project,runtimeAssets,{detailed:false});
  const suggestion=report.suggestions.find(s=>s.id===id);
  if(!suggestion)return {changed:false,message:'NO LONGER NEEDED'};
  const changed=!!suggestion.mutator(project);
  project.updatedAt=Date.now();
  return {changed,message:changed?`${suggestion.title} APPLIED`:'NO SAFE CHANGE WAS NECESSARY'};
}

export function authoringLabel(report){
  if(!report)return 'ANALYZING';
  if(!report.suggestions.length)return 'COMPOSITION HEALTHY';
  const n=report.suggestions.length;
  return `${n} SMART FIX${n===1?'':'ES'} AVAILABLE`;
}
