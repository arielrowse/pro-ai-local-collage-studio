const ANALYSIS_SIZE = 72;

function clamp(v, min=0, max=1){ return Math.max(min, Math.min(max, v)); }
function luminance(r,g,b){ return (0.2126*r + 0.7152*g + 0.0722*b) / 255; }
function rgbToHex(r,g,b){ return '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join(''); }
function saturation(r,g,b){
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  return max === 0 ? 0 : d/max;
}

export function analysisLabel(analysis){
  if(!analysis) return 'ANALYZING';
  const orientation = analysis.orientation || 'SQUARE';
  const density = analysis.visualDensity || 'MEDIUM';
  return `${orientation} • ${density} DETAIL`;
}

export function focalPointFromAnalysis(analysis){
  const vx=analysis?.vision?.focalX;
  const vy=analysis?.vision?.focalY;
  return {
    x: clamp(Number.isFinite(vx) ? vx : Number.isFinite(analysis?.focalX) ? analysis.focalX : .5),
    y: clamp(Number.isFinite(vy) ? vy : Number.isFinite(analysis?.focalY) ? analysis.focalY : .5)
  };
}

export function getVisionRegion(analysis){
  const b=analysis?.vision?.subjectBox;
  if(!b || !Number.isFinite(b.x)||!Number.isFinite(b.y)||!Number.isFinite(b.w)||!Number.isFinite(b.h))return null;
  return {x:clamp(b.x),y:clamp(b.y),w:clamp(b.w),h:clamp(b.h)};
}

export function visionLabel(analysis){
  const v=analysis?.vision;
  if(!v?.enhanced) return 'HEURISTIC FOCAL';
  const type=v.subjectType || 'SUBJECT';
  const count=(v.faces?.length||0)+(v.objects?.length||0);
  return `${type} • ${count} DETECTION${count===1?'':'S'}`;
}

export function sourceCropWindow(o, analysis){
  if(!o || !analysis || o.type!=='image' || o.fitMode==='never') return {x:0,y:0,w:1,h:1,cropped:false};
  const ar=analysis.aspect || 1, br=o.w/Math.max(1,o.h), scale=Math.max(.1,Number(o.scale)||1);
  const baseW=ar>br?br/ar:1, baseH=ar>br?1:ar/br;
  const visibleW=Math.min(1,baseW/scale), visibleH=Math.min(1,baseH/scale);
  let fx=clamp(o.focalX??analysis.focalX??.5), fy=clamp(o.focalY??analysis.focalY??.5);
  const sb=analysis.vision?.subjectBox;
  if(sb && analysis.vision?.enhanced && o.focalAuto!==false){
    // Choose the crop window so the detected subject box stays inside whenever the aspect/scale allows it.
    let x0=(sb.x+sb.w/2)-visibleW/2;
    let y0=(sb.y+sb.h/2)-visibleH/2;
    if(sb.w<=visibleW){if(sb.x<x0)x0=sb.x;if(sb.x+sb.w>x0+visibleW)x0=sb.x+sb.w-visibleW;}
    if(sb.h<=visibleH){if(sb.y<y0)y0=sb.y;if(sb.y+sb.h>y0+visibleH)y0=sb.y+sb.h-visibleH;}
    x0=Math.min(1-visibleW,Math.max(0,x0));
    y0=Math.min(1-visibleH,Math.max(0,y0));
    return {x:x0,y:y0,w:visibleW,h:visibleH,cropped:visibleW<.999||visibleH<.999,subjectAware:true};
  }
  const x0=Math.min(1-visibleW,Math.max(0,fx-visibleW/2));
  const y0=Math.min(1-visibleH,Math.max(0,fy-visibleH/2));
  return {x:x0,y:y0,w:visibleW,h:visibleH,cropped:visibleW<.999||visibleH<.999,subjectAware:false};
}

export function subjectVisibility(o, analysis){
  if(!o || !analysis || o.type!=='image' || o.fitMode==='never') return {crop:0,contained:1,centerInside:1,overall:1,visibleRect:{x:0,y:0,w:1,h:1}};
  const win=sourceCropWindow(o,analysis);
  const crop=Math.max(0,1-win.w*win.h);
  const sb=analysis.vision?.subjectBox;
  if(!sb) return {crop,contained:1,centerInside:1,overall:clamp(1-crop*.42),visibleRect:win};
  const x0=win.x,y0=win.y,x1=x0+win.w,y1=y0+win.h;
  const ix0=Math.max(sb.x,x0),iy0=Math.max(sb.y,y0),ix1=Math.min(sb.x+sb.w,x1),iy1=Math.min(sb.y+sb.h,y1);
  const visibleSubject=Math.max(0,ix1-ix0)*Math.max(0,iy1-iy0);
  const subjectArea=Math.max(.0001,sb.w*sb.h);
  const contained=clamp(visibleSubject/subjectArea);
  const centerInside=((sb.x+sb.w/2)>=x0&&(sb.x+sb.w/2)<=x1&&(sb.y+sb.h/2)>=y0&&(sb.y+sb.h/2)<=y1)?1:0;
  const subjectSafe=.72*contained+.28*centerInside;
  return {crop,contained,centerInside,overall:clamp(1-crop*.42)*.42+subjectSafe*.58,visibleRect:win};
}

/**
 * Browser-local image intelligence pass. It samples a small proxy so analysis remains cheap
 * even for very large source images. No image bytes leave the browser.
 */
export async function analyzeBitmap(bitmap){
  if(!bitmap) return null;
  const scale = Math.min(ANALYSIS_SIZE / bitmap.width, ANALYSIS_SIZE / bitmap.height, 1);
  const w = Math.max(8, Math.round(bitmap.width * scale));
  const h = Math.max(8, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', {willReadFrequently:true, alpha:true});
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(bitmap,0,0,w,h);
  const {data} = ctx.getImageData(0,0,w,h);

  let sumY = 0, sumY2 = 0, alphaSum = 0, opaqueCount = 0;
  let edgeSum = 0, edgeCount = 0;
  let weightedX = 0, weightedY = 0, focusWeight = 0;
  let avgR = 0, avgG = 0, avgB = 0, avgSaturation = 0;
  const buckets = new Map();

  const idxAt = (x,y) => (y*w+x)*4;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=idxAt(x,y);
      const a=data[i+3]/255, r=data[i], g=data[i+1], b=data[i+2];
      const lum=luminance(r,g,b), sat=saturation(r,g,b);
      sumY += lum*a; sumY2 += lum*lum*a; alphaSum += a;
      avgR += r*a; avgG += g*a; avgB += b*a; avgSaturation += sat*a;
      if(a>.96) opaqueCount++;
      const qr=Math.min(5,Math.floor(r/43)), qg=Math.min(5,Math.floor(g/43)), qb=Math.min(5,Math.floor(b/43));
      const key=`${qr},${qg},${qb}`;
      buckets.set(key,(buckets.get(key)||0)+a);

      if(x<w-1 && y<h-1){
        const j=idxAt(x+1,y), k=idxAt(x,y+1);
        const gx=Math.abs(lum-luminance(data[j],data[j+1],data[j+2]));
        const gy=Math.abs(lum-luminance(data[k],data[k+1],data[k+2]));
        const edge=Math.min(1,(gx+gy)*2.5);
        edgeSum += edge; edgeCount++;
        // Visual-energy heuristic: local contrast + saturation, with a gentle center preference.
        const nx=(x/(w-1))-.5, ny=(y/(h-1))-.5;
        const centerBias=1 - Math.min(1, Math.hypot(nx,ny))*0.28;
        const weight=(edge*1.75 + sat*.45)*Math.max(.2,a)*centerBias;
        weightedX += (x/(w-1))*weight;
        weightedY += (y/(h-1))*weight;
        focusWeight += weight;
      }
    }
  }

  const sampleCount = Math.max(1, opaqueCount);
  const meanY = alphaSum ? sumY/alphaSum : 0;
  const variance = Math.max(0, (alphaSum ? sumY2/alphaSum : 0) - meanY*meanY);
  const contrast = Math.sqrt(variance);
  const edgeDensity = edgeCount ? edgeSum/edgeCount : 0;
  const avg = [avgR/sampleCount,avgG/sampleCount,avgB/sampleCount].map(v=>Number.isFinite(v)?v:255);
  const dominantEntry = [...buckets.entries()].sort((a,b)=>b[1]-a[1])[0];
  const dominant = dominantEntry ? dominantEntry[0].split(',').map(v=>(+v)*43+21) : avg;
  const focal = focusWeight ? {x:weightedX/focusWeight,y:weightedY/focusWeight} : {x:.5,y:.5};
  const aspect = bitmap.width / Math.max(1, bitmap.height);
  const orientation = aspect > 1.12 ? 'LANDSCAPE' : aspect < .89 ? 'PORTRAIT' : 'SQUARE';
  const visualDensity = edgeDensity > .19 ? 'HIGH' : edgeDensity > .085 ? 'MEDIUM' : 'LOW';
  const transparency = alphaSum / Math.max(1,w*h);

  return {
    version:2,
    aspect,
    orientation,
    visualDensity,
    focalX:clamp(focal.x),
    focalY:clamp(focal.y),
    luminance:meanY,
    contrast,
    edgeDensity,
    transparency,
    hasTransparency:transparency < .985,
    dominantColor:rgbToHex(dominant[0],dominant[1],dominant[2]),
    averageColor:rgbToHex(avg[0],avg[1],avg[2]),
    saturation:alphaSum ? avgSaturation/alphaSum : 0,
    analyzedAt:Date.now()
  };
}

export function getAssetAnalysis(runtimeAssets, object){
  if(!object)return null;
  const base=runtimeAssets.get(object.assetId)?.analysis || null;
  if(!base)return null;
  return object.vision ? {...base,vision:object.vision} : base;
}

function aspectMismatch(assetRatio, boxRatio){
  if(!assetRatio || !boxRatio) return .5;
  return clamp(Math.abs(Math.log(assetRatio/boxRatio)) / 1.7);
}

export function candidateExplanation(type, project, objects, runtimeAssets){
  const imgs=objects.filter(o=>o.type==='image');
  const analyses=imgs.map(o=>getAssetAnalysis(runtimeAssets,o)).filter(Boolean);
  const portrait=analyses.filter(a=>a.orientation==='PORTRAIT').length;
  const landscape=analyses.filter(a=>a.orientation==='LANDSCAPE').length;
  const transparent=analyses.filter(a=>a.hasTransparency).length;
  const highDetail=analyses.filter(a=>a.visualDensity==='HIGH').length;
  const reasons=[];
  if(type==='hero'||type==='editorial') reasons.push('creates clear visual hierarchy');
  if(type==='masonry' && (portrait||landscape)) reasons.push('uses varied image proportions');
  if(type==='balanced'||type==='grid') reasons.push('keeps spacing and alignment consistent');
  if(type==='mosaic'||type==='asymmetric') reasons.push('adds controlled visual variation');
  if(type==='polaroid'||type==='tilt') reasons.push('adds intentional directional movement');
  if(type==='stack'||type==='exploded') reasons.push('creates depth and overlap');
  if(project.intent==='product' && (type==='hero'||type==='editorial')) reasons.push('fits product-focused hierarchy');
  if(project.intent==='mood' && (type==='mosaic'||type==='asymmetric'||type==='stack')) reasons.push('fits mood-board freedom');
  if(highDetail>=Math.max(1,Math.ceil(imgs.length/2))) reasons.push('respects high-detail imagery');
  if(transparent) reasons.push('works well with transparent assets');
  if(portrait>landscape && type==='filmstrip') reasons.push('gives portrait-heavy sets room to breathe');
  return reasons.slice(0,3).join(' • ') || 'composition generated from current image set';
}

export function scoreVisualFit(object, asset, targetRect, intent='product', layoutType='balanced'){
  const a=asset?.analysis;
  if(!a) return .5;
  const rectRatio=targetRect.w/Math.max(1,targetRect.h);
  const mismatch=aspectMismatch(a.aspect,rectRatio);
  const cropRisk=object.fitMode==='never' ? mismatch*.08 : mismatch*.55;
  const focalEdge=Math.hypot(a.focalX-.5,a.focalY-.5);
  let role=.5;
  if((layoutType==='hero'||layoutType==='editorial') && object===undefined) role=.5;
  if(layoutType==='hero'||layoutType==='editorial') role = .55 + (a.visualDensity==='HIGH'?.18:0) + (a.contrast>.22?.12:0);
  else if(layoutType==='filmstrip') role = a.orientation==='LANDSCAPE'?.75:.52;
  else if(layoutType==='masonry') role = .62 + (mismatch<.3?.15:0);
  else if(layoutType==='stack'||layoutType==='polaroid') role=.62 + (a.visualDensity!=='LOW'?.08:0);
  if(intent==='product' && (layoutType==='hero'||layoutType==='editorial')) role += .08;
  if(intent==='mood' && ['mosaic','asymmetric','stack'].includes(layoutType)) role += .08;
  return clamp(role - cropRisk - focalEdge*.04);
}
