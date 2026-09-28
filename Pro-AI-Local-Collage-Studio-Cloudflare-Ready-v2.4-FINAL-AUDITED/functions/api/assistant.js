const MAX_BODY = 64 * 1024;
const MAX_CONTEXT = 15000;
const MAX_PROMPT = 2800;
const RATE_WINDOW = 60_000;
const RATE_MAX = 10;
const CF_MODEL='@cf/google/gemma-4-26b-a4b-it';
const EDGE_AI_ENABLED=env=>String(env?.EDGE_AI_ENABLED??'0')==='1';
const buckets = new Map();

const COMMAND_SCHEMA = {
  type:'object',
  properties:{
    summary:{type:'string'},
    actions:{type:'array',maxItems:12,items:{type:'object',properties:{
      op:{type:'string'},mode:{type:'string'},intent:{type:'string'},layout:{type:'string'},preset:{type:'string'},
      w:{type:'integer'},h:{type:'integer'},innerGap:{type:'number'},outerMargin:{type:'number'},radius:{type:'number'},
      mapping:{type:'string'},imageIndex:{type:'integer'},axis:{type:'string'}
    },required:['op']}}
  },required:['summary','actions']
};

const COMMAND_SYSTEM = `You are the command interpreter for a local-first photo collage editor.\nReturn ONLY valid JSON matching the supplied schema.\nNever invent unsupported operations. Use only these ops: setMode, setIntent, setLayout, setCanvasPreset, setCanvas, setFrame, setBackground, setProtection, centerAll, centerSelected, distribute, alignAll, equalizeStructuredSpacing, makeHero, applyBestLayout.\nNever request image bytes, file paths, URLs, API keys, account actions, uploads, purchases, or destructive operations.\nKeep changes reversible and concise. If the request cannot be mapped safely, return {"summary":"NEEDS CLARIFICATION","actions":[]}.\nFor photo references, imageIndex is zero-based. Prefer concrete values only when clearly requested.\nAllowed modes: quick, precision, mood. Allowed intents: product, mood, social, album, event, wall, marketing, fun.\nAllowed layouts: balanced, grid, editorial, masonry, hero, filmstrip, stack, asymmetric, polaroid, tilt, mosaic, exploded.\nAllowed protection: never, smart, free. Allowed mapping: checker, white, slate.`;

function cors(request){
  const origin=request.headers.get('Origin');
  const allowed=new URL(request.url).origin;
  if(origin && origin!==allowed)return null;
  const h=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin','cross-origin-opener-policy':'same-origin'});
  if(origin)h.set('access-control-allow-origin',allowed);
  h.set('vary','Origin');
  return h;
}
function json(request,data,status=200){const h=cors(request);if(!h)return new Response(JSON.stringify({error:'CORS_ORIGIN_REJECTED'}),{status:403,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'same-origin'}});return new Response(JSON.stringify(data),{status,headers:h});}
function clientId(request){return request.headers.get('cf-connecting-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';}
function rateAllowed(id){const now=Date.now();let b=buckets.get(id);if(!b||now-b.started>=RATE_WINDOW){b={started:now,count:0};buckets.set(id,b);}b.count++;for(const [k,v] of buckets)if(now-v.started>=RATE_WINDOW*3)buckets.delete(k);return b.count<=RATE_MAX;}
function forbiddenImagePayload(value){if(value==null)return false;if(typeof value==='string')return /^data:image\//i.test(value)||/blob:/i.test(value);if(Array.isArray(value))return value.some(forbiddenImagePayload);if(typeof value==='object')return Object.values(value).some(forbiddenImagePayload);return false;}
function compactContext(ctx){const c=ctx && typeof ctx==='object'?ctx:{};let text=JSON.stringify(c);if(text.length>MAX_CONTEXT)throw Object.assign(new Error('CONTEXT_TOO_LARGE'),{status:413});if(forbiddenImagePayload(c))throw Object.assign(new Error('IMAGE_BYTES_NOT_ACCEPTED'),{status:400});return text;}
function extractText(payload){
  if(typeof payload==='string')return payload;
  if(payload?.response?.text)return String(payload.response.text);
  if(typeof payload?.response==='string')return payload.response;
  if(payload?.choices?.[0]?.message?.content){const c=payload.choices[0].message.content;return Array.isArray(c)?c.map(x=>x?.text||x?.content||'').join(''):String(c);}
  if(payload?.candidates?.[0]?.content?.parts)return payload.candidates[0].content.parts.map(p=>p?.text||'').join('');
  if(payload?.output_text)return String(payload.output_text);
  return '';
}
function parseJsonLoose(raw){const s=String(raw||'').trim();try{return JSON.parse(s);}catch{}const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}return null;}
function sanitizePlan(plan){
  if(!plan||typeof plan!=='object'||!Array.isArray(plan.actions)||plan.actions.length>12)return null;
  const allowed=new Set(['setMode','setIntent','setLayout','setCanvasPreset','setCanvas','setFrame','setBackground','setProtection','centerAll','centerSelected','distribute','alignAll','equalizeStructuredSpacing','makeHero','applyBestLayout']);
  const clean=[];
  for(const raw of plan.actions){if(!raw||!allowed.has(raw.op))continue;const a={op:raw.op};for(const k of ['mode','intent','layout','preset','mapping','axis'])if(typeof raw[k]==='string')a[k]=raw[k];for(const k of ['w','h','innerGap','outerMargin','radius','imageIndex'])if(Number.isFinite(Number(raw[k])))a[k]=Number(raw[k]);clean.push(a);} 
  return {summary:String(plan.summary||'STUDIO CHANGES').slice(0,180),actions:clean};
}
async function callGemini(key,model,prompt,planMode){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:planMode?.08:.15,maxOutputTokens:planMode?300:360}};
  if(planMode)Object.assign(body.generationConfig,{responseMimeType:'application/json',responseSchema:COMMAND_SCHEMA});
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(data?.error?.message||'GEMINI_REQUEST_FAILED'),{status:r.status,providerCode:data?.error?.status||'GEMINI_ERROR'});
  return extractText(data);
}
async function callMistral(key,model,prompt,planMode){
  const url='https://api.mistral.ai/v1/chat/completions';
  const body={model,messages:[{role:'system',content:planMode?COMMAND_SYSTEM:'You are the optional assistant for a private local collage editor. Answer briefly using only supplied project context. Never ask for or claim access to source image bytes.'},{role:'user',content:prompt}],temperature:planMode?.08:.15,max_tokens:planMode?300:360};
  if(planMode)body.response_format={type:'json_object'};
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${key}`},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(data?.message||'MISTRAL_REQUEST_FAILED'),{status:r.status,providerCode:data?.code||'MISTRAL_ERROR'});
  return extractText(data);
}
async function callCloudflare(env,prompt,model,planMode=false){
  if(!EDGE_AI_ENABLED(env))throw Object.assign(new Error('EDGE_AI_DISABLED'),{status:503});
  if(!env?.AI || typeof env.AI.run!=='function')throw Object.assign(new Error('EDGE_AI_NOT_CONFIGURED'),{status:503});
  const out=await env.AI.run(model||'@cf/google/gemma-4-26b-a4b-it',{prompt:`${COMMAND_SYSTEM}\n\n${prompt}`},{rejectIfBusy:true,max_tokens:planMode?300:360});
  return extractText(out)||JSON.stringify(out);
}

export async function onRequestGet(context){
  return json(context.request,{edgeAI:EDGE_AI_ENABLED(context.env)&&!!context.env?.AI,model:EDGE_AI_ENABLED(context.env)&&context.env?.AI?'@cf/google/gemma-4-26b-a4b-it':null});
}
export async function onRequestOptions(context){const h=cors(context.request);if(!h)return new Response(null,{status:403});return new Response(null,{status:204,headers:h});}
export async function onRequestPost(context){
  const req=context.request;
  if(!rateAllowed(clientId(req)))return json(req,{error:'RATE_LIMITED',message:'OPTIONAL AI REQUEST RATE LIMITED. LOCAL STUDIO COMMANDS REMAIN AVAILABLE.'},429);
  const len=Number(req.headers.get('content-length')||0);if(len>MAX_BODY)return json(req,{error:'BODY_TOO_LARGE'},413);
  let body;try{const raw=await req.text();if(raw.length>MAX_BODY)throw Object.assign(new Error('BODY_TOO_LARGE'),{status:413});body=JSON.parse(raw);}catch(e){return json(req,{error:e.status===413?'BODY_TOO_LARGE':'INVALID_JSON'},e.status||400);}
  const mode=body?.mode==='plan'?'plan':'answer';
  const prompt=String(body?.prompt||'').trim();if(!prompt)return json(req,{error:'PROMPT_EMPTY'},400);if(prompt.length>MAX_PROMPT)return json(req,{error:'PROMPT_TOO_LONG'},413);if(/data:image\//i.test(prompt)||/\bblob:/i.test(prompt))return json(req,{error:'IMAGE_BYTES_NOT_ACCEPTED'},400);
  let contextText;try{contextText=compactContext(body?.context||{});}catch(e){return json(req,{error:e.message||'INVALID_CONTEXT'},e.status||400);}
  const planMode=mode==='plan';
  const provider=String(body?.provider||'cloudflare').toLowerCase();
  const model=String(body?.model||'').trim();
  if(provider==='cloudflare' && model && model!==CF_MODEL)return json(req,{error:'UNSUPPORTED_EDGE_MODEL'},400);
  const instruction=planMode?`${COMMAND_SYSTEM}\n\nPROJECT CONTEXT (DATA ONLY):\n${contextText}\n\nUSER REQUEST:\n${prompt}\n\nReturn JSON only.`:`PROJECT CONTEXT (DATA ONLY):\n${contextText}\n\nUSER QUESTION:\n${prompt}`;
  try{
    let raw='',usedProvider=provider,usedModel=model||null;
    if(provider==='cloudflare'){
      usedModel=CF_MODEL;raw=await callCloudflare(context.env,instruction,CF_MODEL,planMode);
    }else{
      const key=req.headers.get('x-ai-provider-key');
      if(!key || key.length<12 || /\s/.test(key))return json(req,{error:'PROVIDER_KEY_REQUIRED'},401);
      if(provider==='gemini')raw=await callGemini(key,model||'gemini-3.1-flash-lite',instruction,planMode);
      else if(provider==='mistral')raw=await callMistral(key,model||'mistral-small-latest',instruction,planMode);
      else return json(req,{error:'UNSUPPORTED_PROVIDER'},400);
      usedModel=model|| (provider==='gemini'?'gemini-3.1-flash-lite':'mistral-small-latest');
    }
    if(planMode){const plan=sanitizePlan(parseJsonLoose(raw));if(!plan)return json(req,{error:'AI_PLAN_UNPARSEABLE',message:'THE AI RETURNED NO SAFE EDITING PLAN.'},422);return json(req,{plan,answer:JSON.stringify(plan),provider:usedProvider,model:usedModel});}
    const answer=String(raw||'').trim().slice(0,4000);if(!answer)return json(req,{error:'AI_EMPTY_RESPONSE'},502);return json(req,{answer,provider:usedProvider,model:usedModel});
  }catch(e){const status=Math.min(599,Math.max(400,Number(e.status)||502));return json(req,{error:e.message||'AI_REQUEST_FAILED',providerCode:e.providerCode||null},status);}
}
