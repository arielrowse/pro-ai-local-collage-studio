import { STUDIO_COMMAND_SCHEMA, validateCommandPlan } from './command-intent.js';

const CACHE_LIMIT = 36;
const cache = new Map();
let inflight = null;
let capabilityPromise = null;

const MODELS = {
  gemini: [
    { id: 'gemini-3.1-flash-lite', label: 'GEMINI 3.1 FLASH-LITE • EFFICIENT' },
    { id: 'gemini-3.5-flash', label: 'GEMINI 3.5 FLASH • ADVANCED' },
  ],
  mistral: [
    { id: 'mistral-small-latest', label: 'MISTRAL SMALL • EFFICIENT' },
  ],
};

const POLICY = { cooldownMs: 7000, maxPrompt: 2800 };
const usage = { calls: [] };
const keyStore = { provider: null, key: null, model: null };

export function aiModels(provider) { return MODELS[provider] || []; }
export function aiKeyConfigured() { return !!keyStore.key; }
export function getAIConfig() { return { provider: keyStore.provider, model: keyStore.model, configured: !!keyStore.key }; }
export function setAIConfig(provider, key, model='') {
  const p = String(provider||'').toLowerCase();
  if (!MODELS[p]) throw new Error('UNSUPPORTED_PROVIDER');
  const k = String(key||'').trim();
  if (k.length < 12 || /\s/.test(k)) throw new Error('INVALID_API_KEY');
  keyStore.provider = p;
  keyStore.key = k;
  keyStore.model = MODELS[p].some(x=>x.id===model) ? model : MODELS[p][0].id;
}
export function clearAIConfig() { keyStore.provider=null; keyStore.key=null; keyStore.model=null; }

function now(){return Date.now();}
function prune(){const t=now();usage.calls=usage.calls.filter(ts=>t-ts<86400000);}
function recentCalls(windowMs){prune();const t=now();return usage.calls.filter(ts=>t-ts<windowMs).length;}
export function aiUsage(){prune();return {hour:recentCalls(3600000),day:usage.calls.length,nextAllowedIn:usage.calls.length?Math.max(0,POLICY.cooldownMs-(now()-usage.calls[usage.calls.length-1])):0};}
function assertBudget(){const u=aiUsage();if(u.nextAllowedIn>0)throw Object.assign(new Error('AI_COOLDOWN'),{code:'AI_COOLDOWN',remaining:u.nextAllowedIn});}

function stableContext(context){
  const c=JSON.parse(JSON.stringify(context||{}));
  if(Array.isArray(c.objects))c.objects=c.objects.slice(0,12).map(o=>({type:o.type,name:o.name,index:o.index,x:Math.round(o.x||0),y:Math.round(o.y||0),w:Math.round(o.w||0),h:Math.round(o.h||0),rotation:Math.round(o.rotation||0),scale:Number((o.scale||1).toFixed(2)),fitMode:o.fitMode,focalX:Number((o.focalX??.5).toFixed(2)),focalY:Number((o.focalY??.5).toFixed(2)),hidden:!!o.hidden,locked:!!o.locked}));
  if(Array.isArray(c.images))c.images=c.images.slice(0,9).map(i=>({index:i.index,aspect:i.aspect,contrast:i.contrast,density:i.density,dominantColor:i.dominantColor,vision:i.vision||null}));
  return c;
}
function stableCommandContext(context){
  const c=stableContext(context);
  return {mode:c.mode,intent:c.intent,imageProtection:c.imageProtection,canvas:c.canvas,frame:c.frame,layout:c.layout,selected:c.selected,objectCount:c.objectCount,images:c.images,composition:c.composition,quality:c.quality?.slice?.(0,5)||[],authoring:c.authoring?.slice?.(0,5)||[]};
}
async function sha256(text){if(!globalThis.crypto?.subtle)return text.slice(0,1200);const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function cacheSet(key,result){cache.set(key,result);while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);}
function parseJsonLoose(raw){const s=String(raw||'').trim();try{return JSON.parse(s);}catch{}const start=s.indexOf('{'),end=s.lastIndexOf('}');if(start>=0&&end>start){try{return JSON.parse(s.slice(start,end+1));}catch{}}return null;}

export async function aiEdgeCapability(){
  if(capabilityPromise)return capabilityPromise;
  capabilityPromise=fetch('/api/assistant',{method:'GET',headers:{accept:'application/json'},cache:'no-store'}).then(async r=>{const d=await r.json().catch(()=>({}));return {available:!!d.edgeAI,model:d.model||null};}).catch(()=>({available:false,model:null}));
  return capabilityPromise;
}

export async function askAI(prompt, context, {preferFree=true}={}){
  const compact=stableContext(context);
  const p=String(prompt||'').trim().slice(0,POLICY.maxPrompt);
  if(!p)throw new Error('AI_PROMPT_EMPTY');
  const edge=preferFree?await aiEdgeCapability():{available:false};
  const provider=edge.available?'cloudflare':(keyStore.key?keyStore.provider:null);
  if(!provider)throw new Error('AI_NOT_CONFIGURED');
  const model=provider==='cloudflare'?(edge.model||'@cf/google/gemma-4-26b-a4b-it'):keyStore.model;
  const key=await sha256(`${provider}|${model}|answer|${p}|${JSON.stringify(compact)}`);
  if(cache.has(key))return {...cache.get(key),cached:true};
  if(inflight)throw new Error('AI_BUSY');
  assertBudget();
  inflight=(async()=>{
    const headers={'content-type':'application/json'};
    if(provider!=='cloudflare')headers['x-ai-provider-key']=keyStore.key;
    const response=await fetch('/api/assistant',{method:'POST',headers,body:JSON.stringify({mode:'answer',provider,model,prompt:p,context:compact})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(data.message||'AI_REQUEST_FAILED');e.code=data.error||'AI_REQUEST_FAILED';throw e;}
    usage.calls.push(now());
    const result={answer:String(data.answer||'').trim(),provider:data.provider||provider,model:data.model||model};cacheSet(key,result);return {...result,cached:false};
  })();
  try{return await inflight}finally{inflight=null;}
}

export async function askAIPlan(prompt, context, {preferFree=true}={}){
  const p=String(prompt||'').trim().slice(0,POLICY.maxPrompt);
  if(!p)throw new Error('AI_PROMPT_EMPTY');
  const compact=stableCommandContext(context);
  const key=await sha256(`${preferFree?'auto':'byok'}|${keyStore.provider||''}|${keyStore.model||''}|plan|${p}|${JSON.stringify(compact)}`);
  if(cache.has(key))return {...cache.get(key),cached:true};
  if(inflight)throw new Error('AI_BUSY');
  const edge=preferFree?await aiEdgeCapability():{available:false};
  let provider=edge.available?'cloudflare':(keyStore.key?keyStore.provider:null);
  if(!provider)throw new Error('AI_PLAN_UNAVAILABLE');
  assertBudget();
  inflight=(async()=>{
    const response=await fetch('/api/assistant',{method:'POST',headers:{'content-type':'application/json',...(provider==='cloudflare'?{}:{'x-ai-provider-key':keyStore.key})},body:JSON.stringify({mode:'plan',provider,model:provider==='cloudflare'?(edge.model||'@cf/google/gemma-4-26b-a4b-it'):keyStore.model,prompt:p,context:compact,schema:STUDIO_COMMAND_SCHEMA})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const e=new Error(data.message||'AI_PLAN_FAILED');e.code=data.error||'AI_PLAN_FAILED';throw e;}
    const rawPlan=data.plan||parseJsonLoose(data.answer);
    const checked=validateCommandPlan(rawPlan,context?.__project||{objects:[]});
    if(!checked.ok)throw new Error('AI_PLAN_UNSAFE');
    usage.calls.push(now());
    const result={plan:{...rawPlan,actions:checked.safe},provider:data.provider||provider,model:data.model||null};cacheSet(key,result);return {...result,cached:false};
  })();
  try{return await inflight}finally{inflight=null;}
}
