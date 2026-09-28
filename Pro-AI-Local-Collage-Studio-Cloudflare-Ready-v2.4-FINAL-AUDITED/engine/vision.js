const VISION_VERSION = 'mediapipe-1.0.1';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const OBJECT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

let runtimePromise = null;
let runtime = null;

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

function getCategory(det){
  const cat = det?.categories?.[0] || det?.category?.[0] || {};
  return {label:String(cat.categoryName || cat.displayName || cat.label || 'object').toLowerCase(), score:Number(cat.score || 0)};
}

function getBox(det){
  const b=det?.boundingBox || det?.bounding_box || {};
  return {x:Number(b.originX ?? b.origin_x ?? b.x ?? 0),y:Number(b.originY ?? b.origin_y ?? b.y ?? 0),w:Number(b.width ?? b.w ?? 0),h:Number(b.height ?? b.h ?? 0)};
}

function normalizeDetection(det, width, height, kind){
  const box=getBox(det), cat=getCategory(det);
  if(!box.w || !box.h || !width || !height)return null;
  return {
    kind,
    label:cat.label,
    score:clamp(cat.score),
    x:clamp(box.x/width), y:clamp(box.y/height),
    w:clamp(box.w/width), h:clamp(box.h/height)
  };
}

function isPriorityObject(label){
  return /person|face|animal|bird|cat|dog|horse|sheep|cow|elephant|bear|zebra|giraffe|car|motorcycle|bicycle|bus|truck|boat|backpack|handbag|suitcase|bottle|cup|chair|couch|bed|dining table|laptop|cell phone|book|sports ball|food|cake|pizza|sandwich|hot dog|broccoli|banana|apple|orange/.test(label);
}

function combineRegions(regions){
  const strong=regions.filter(r=>r.score>=0.45).sort((a,b)=>{
    const sa=a.score*Math.pow(a.w*a.h,.68)*(a.kind==='face'?1.9:isPriorityObject(a.label)?1.22:1);
    const sb=b.score*Math.pow(b.w*b.h,.68)*(b.kind==='face'?1.9:isPriorityObject(b.label)?1.22:1);
    return sb-sa;
  }).slice(0,6);
  if(!strong.length)return null;
  const total=strong.reduce((s,r)=>s + r.score*Math.pow(Math.max(.0001,r.w*r.h),.55),0) || 1;
  let cx=0,cy=0;
  for(const r of strong){
    const w=r.score*Math.pow(Math.max(.0001,r.w*r.h),.55)*(r.kind==='face'?1.7:isPriorityObject(r.label)?1.15:1);
    cx+=(r.x+r.w/2)*w; cy+=(r.y+r.h/2)*w;
  }
  cx/=total; cy/=total;
  const union=strong.reduce((u,r)=>{
    const x2=r.x+r.w,y2=r.y+r.h;
    if(!u)return {x:r.x,y:r.y,x2,y2};
    return {x:Math.min(u.x,r.x),y:Math.min(u.y,r.y),x2:Math.max(u.x,x2),y2:Math.max(u.y,y2)};
  },null);
  return {
    x:union.x,y:union.y,w:Math.max(.001,union.x2-union.x),h:Math.max(.001,union.y2-union.y),
    centerX:clamp(cx),centerY:clamp(cy),
    label:strong[0].kind==='face'?'FACE':strong[0].label.toUpperCase(),
    confidence:clamp(mean(strong.map(r=>r.score))),
    regions:strong
  };
}

function mean(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0;}

async function loadRuntime(onStatus=()=>{}){
  if(runtime)return runtime;
  if(runtimePromise)return runtimePromise;
  runtimePromise=(async()=>{
    onStatus('LOADING VISION RUNTIME');
    const vision=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/+esm');
    onStatus('LOADING VISION MODELS');
    const fileset=await vision.FilesetResolver.forVisionTasks(WASM_URL);
    let faceDetector=null,objectDetector=null;
    try{
      faceDetector=await vision.FaceDetector.createFromModelPath(fileset,FACE_MODEL_URL);
    }catch(e){console.warn('FACE DETECTOR UNAVAILABLE',e)}
    try{
      objectDetector=await vision.ObjectDetector.createFromModelPath(fileset,OBJECT_MODEL_URL);
    }catch(e){console.warn('OBJECT DETECTOR UNAVAILABLE',e)}
    if(!faceDetector && !objectDetector)throw new Error('VISION_MODELS_UNAVAILABLE');
    runtime={vision,fileset,faceDetector,objectDetector,version:VISION_VERSION};
    onStatus('VISION ENGINE READY');
    return runtime;
  })().catch(e=>{runtimePromise=null;throw e;});
  return runtimePromise;
}

export function visionCapability(){
  return {
    supported: typeof window!=='undefined' && typeof document!=='undefined' && typeof HTMLCanvasElement!=='undefined',
    secureContext: typeof window!=='undefined' ? window.isSecureContext : false,
    webgpu: typeof navigator!=='undefined' && !!navigator.gpu
  };
}

export function visionStatus(){
  return runtime ? 'ready' : runtimePromise ? 'loading' : 'idle';
}

export async function enhanceBitmap(bitmap,{onStatus=()=>{}}={}){
  if(!bitmap)throw new Error('NO_BITMAP');
  const r=await loadRuntime(onStatus);
  const max=640;
  const scale=Math.min(max/bitmap.width,max/bitmap.height,1);
  const w=Math.max(64,Math.round(bitmap.width*scale)),h=Math.max(64,Math.round(bitmap.height*scale));
  const canvas=document.createElement('canvas'); canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:false});
  ctx.drawImage(bitmap,0,0,w,h);
  const regions=[];
  let faceResult=null,objectResult=null;
  if(r.faceDetector)faceResult=r.faceDetector.detect(canvas);
  if(r.objectDetector)objectResult=r.objectDetector.detect(canvas);
  for(const d of faceResult?.detections||[]){const x=normalizeDetection(d,w,h,'face');if(x && x.score>=.4)regions.push(x)}
  for(const d of objectResult?.detections||[]){const x=normalizeDetection(d,w,h,'object');if(x && x.score>=.38)regions.push(x)}
  const subject=combineRegions(regions);
  if(!subject)return {engine:VISION_VERSION,enhanced:false,faces:regions.filter(x=>x.kind==='face'),objects:regions.filter(x=>x.kind==='object'),regions:[],confidence:0,focalX:.5,focalY:.5,subjectBox:null,subjectType:null,detectedAt:Date.now()};
  const visualCenter={x:.5,y:.5};
  const centerBias=.1;
  const focalX=clamp(subject.centerX*(1-centerBias)+visualCenter.x*centerBias);
  const focalY=clamp(subject.centerY*(1-centerBias)+visualCenter.y*centerBias);
  return {
    engine:VISION_VERSION,
    enhanced:true,
    faces:regions.filter(x=>x.kind==='face'),
    objects:regions.filter(x=>x.kind==='object'),
    regions,
    confidence:subject.confidence,
    focalX,focalY,
    subjectBox:{x:subject.x,y:subject.y,w:subject.w,h:subject.h},
    subjectType:subject.label,
    detectedAt:Date.now()
  };
}

export function closeVision(){
  try{runtime?.faceDetector?.close?.();runtime?.objectDetector?.close?.();}catch{}
  runtime=null;runtimePromise=null;
}

export const VISION_PROVIDER_NOTICE='ON-DEVICE VISION: IMAGE INFERENCE RUNS IN THE BROWSER. MEDIA PIPE DOCUMENTATION NOTES THAT THE LIBRARY MAY SEND USAGE/PERFORMANCE METRICS TO GOOGLE.';
