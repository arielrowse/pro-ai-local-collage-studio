import { MAX_CANVAS, MAX_MEGAPIXELS } from '../core/model.js';
import { evaluateComposition } from './composition.js';
import { getAssetAnalysis, subjectVisibility } from './intelligence.js';

export function inspectProject(project, runtimeAssets){
  const issues=[];
  if(project.canvas.w<64||project.canvas.h<64)issues.push({level:'error',key:'canvas',message:'CANVAS IS TOO SMALL.',action:null});
  if(project.canvas.w>MAX_CANVAS||project.canvas.h>MAX_CANVAS)issues.push({level:'error',key:'canvas',message:`CANVAS EXCEEDS ${MAX_CANVAS.toLocaleString()} PX LIMIT.`,action:'canvas'});
  if(project.canvas.w*project.canvas.h>MAX_MEGAPIXELS*1e6)issues.push({level:'warn',key:'mega',message:`EXPORT IS ${((project.canvas.w*project.canvas.h)/1e6).toFixed(1)} MP. LARGE EXPORTS MAY REQUIRE MORE MEMORY.`,action:null});
  const visible=project.objects.filter(o=>!o.hidden);
  if(project.mode!=='mood' && visible.filter(o=>o.type==='image').length===0)issues.push({level:'warn',key:'assets',message:'NO IMAGES ARE CURRENTLY VISIBLE.',action:null});
  for(const o of visible){
    const rot=Math.abs((o.rotation||0)*Math.PI/180), cw=Math.abs(o.w*Math.cos(rot))+Math.abs(o.h*Math.sin(rot)), ch=Math.abs(o.w*Math.sin(rot))+Math.abs(o.h*Math.cos(rot));
    if(o.x<0||o.y<0||o.x+o.w>project.canvas.w||o.y+o.h>project.canvas.h||o.x+o.w<0||o.y+o.h<0) issues.push({level:'warn',key:o.id,message:`${labelObject(o)} EXTENDS OUTSIDE THE CANVAS.`,action:'bounds',objectId:o.id});
    if(o.type==='image'){
      const a=runtimeAssets.get(o.assetId); if(a && a.width*a.height>24e6) issues.push({level:'info',key:o.id+'memory',message:`${a.name.toUpperCase()} IS A LARGE SOURCE. EDITOR MEMORY IS PROTECTED WITH A WORKING DECODE.`,action:null});
      const crop=estimateCrop(o,a);
      const analysis=getAssetAnalysis(runtimeAssets,o);
      const subject=analysis?.vision?.enhanced?subjectVisibility(o,analysis):null;
      if(subject && subject.contained<.68 && (o.fitMode==='smart'||o.fitMode==='free')) issues.push({level:'warn',key:o.id+'subjectCrop',message:`${o.name.toUpperCase()} MAY CROP THE DETECTED ${String(analysis.vision.subjectType||'SUBJECT').toUpperCase()} (${Math.round((1-subject.contained)*100)}% OUTSIDE VIEW).`,action:'fit',objectId:o.id});
      else if(crop>0.22 && (o.fitMode==='smart'||o.fitMode==='free')) issues.push({level:'warn',key:o.id+'crop',message:`${o.name.toUpperCase()} MAY HAVE SIGNIFICANT CROP LOSS (${Math.round(crop*100)}%).`,action:'fit',objectId:o.id});
    }
  }
  if(project.mode!=='mood' && project.objects.filter(o=>o.type==='image'&&!o.hidden).length && project.objects.every(o=>o.type!=='image'||o.hidden))issues.push({level:'warn',key:'hidden',message:'ALL IMAGE ASSETS ARE HIDDEN.',action:null});
  const imageCount=project.objects.filter(o=>o.type==='image').length;
  if(imageCount>=2){
    const comp=evaluateComposition(project.objects,project,runtimeAssets,project.layout.type);
    if(comp.metrics?.intentFit<.55)issues.push({level:'info',key:'intent',message:'CURRENT LAYOUT IS A LOOSE MATCH FOR THE SELECTED COMPOSITION INTENT.',action:null});
    if(comp.metrics?.focal<.60)issues.push({level:'warn',key:'focalQuality',message:'SOME VISUAL FOCAL POINTS MAY LOSE PROMINENCE IN THE CURRENT COMPOSITION.',action:null});
  }
  return {ok:!issues.some(i=>i.level==='error'),issues,count:issues.length};
}
function labelObject(o){return o.type==='image'?`PHOTO ${o.name}`:o.type.toUpperCase()}
export function estimateCrop(o,a){if(!a||o.type!=='image'||o.fitMode==='never')return 0;const ar=a.width/a.height, br=o.w/o.h; if(o.fitMode==='never')return 0; if(o.fitMode==='smart'||o.fitMode==='free'){const cover=ar>br? 'width':'height'; const visibleRatio=cover==='width'?br/ar:ar/br; return Math.max(0,1-visibleRatio);}return 0;}
