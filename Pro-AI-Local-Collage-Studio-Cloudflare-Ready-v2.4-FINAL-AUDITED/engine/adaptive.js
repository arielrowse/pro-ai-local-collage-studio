const STORAGE_KEY='pro-ai-local-collage:adaptive:v1';
const VERSION=1;
const EVENT_LIMIT=18;

const fresh=()=>({
  version:VERSION,
  enabled:true,
  sessions:0,
  events:0,
  actions:{},
  modes:{},
  intents:{},
  layouts:{},
  fixes:{},
  exports:{},
  commands:{},
  lastAction:null,
  lastMode:null,
  lastIntent:null
});

function safeInt(v){return Number.isFinite(v)?Math.max(0,Math.min(9999,Math.round(v))):0;}
function capMap(map){
  const entries=Object.entries(map||{}).map(([k,v])=>[k,safeInt(v)]).filter(([,v])=>v>0);
  entries.sort((a,b)=>b[1]-a[1]);
  return Object.fromEntries(entries.slice(0,32));
}
function sanitize(input){
  const p=fresh();
  if(!input||typeof input!=='object')return p;
  p.enabled=input.enabled!==false;
  p.sessions=safeInt(input.sessions); p.events=safeInt(input.events);
  p.actions=capMap(input.actions); p.modes=capMap(input.modes); p.intents=capMap(input.intents);
  p.layouts=capMap(input.layouts); p.fixes=capMap(input.fixes); p.exports=capMap(input.exports); p.commands=capMap(input.commands);
  p.lastAction=typeof input.lastAction==='string'?input.lastAction.slice(0,48):null;
  p.lastMode=typeof input.lastMode==='string'?input.lastMode.slice(0,24):null;
  p.lastIntent=typeof input.lastIntent==='string'?input.lastIntent.slice(0,24):null;
  return p;
}

export function loadAdaptiveProfile(){
  try{return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'));}catch{return fresh();}
}
export function saveAdaptiveProfile(profile){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(sanitize(profile)));return true;}catch{return false;}
}
export function resetAdaptiveProfile(){
  try{localStorage.removeItem(STORAGE_KEY);}catch{}
  return fresh();
}
export function setAdaptiveEnabled(profile,enabled){const p=sanitize(profile);p.enabled=!!enabled;saveAdaptiveProfile(p);return p;}

function touch(map,key){if(!key)return;map[key]=safeInt(map[key])+1;}
function decay(p){
  if(p.events%EVENT_LIMIT!==0)return p;
  for(const mapName of ['actions','modes','intents','layouts','fixes','exports','commands']){
    const map=p[mapName]||{};
    for(const k of Object.keys(map)) map[k]=Math.max(0,Math.floor(map[k]*0.96));
  }
  return p;
}

export function recordAdaptiveEvent(profile,type,key){
  const p=sanitize(profile);
  if(!p.enabled)return p;
  const k=String(key||'').trim().slice(0,64);
  if(!k)return p;
  switch(type){
    case'action': touch(p.actions,k); p.lastAction=k; break;
    case'mode': touch(p.modes,k); p.lastMode=k; break;
    case'intent': touch(p.intents,k); p.lastIntent=k; break;
    case'layout': touch(p.layouts,k); break;
    case'fix': touch(p.fixes,k); break;
    case'export': touch(p.exports,k); break;
    case'command': touch(p.commands,k); break;
    default: return p;
  }
  p.events=safeInt(p.events)+1;
  decay(p);
  saveAdaptiveProfile(p);
  return p;
}

export function startAdaptiveSession(profile){
  const p=sanitize(profile);
  p.sessions=safeInt(p.sessions)+1;
  saveAdaptiveProfile(p);
  return p;
}

function count(profile,bucket,key){return safeInt(profile?.[bucket]?.[key]);}

export function adaptiveBoost(profile,bucket,key,max=0.08){
  const c=count(profile,bucket,key);
  if(!c||!profile?.enabled)return 0;
  const normalized=Math.log1p(c)/Math.log1p(6);
  return Math.min(max,normalized*max);
}

export function rankAdaptiveActions(items,profile,keyFn,baseFn=()=>0){
  const list=[...(items||[])];
  if(!profile?.enabled||list.length<2)return list;
  return list.map((item,index)=>({item,index,score:baseFn(item,index)+adaptiveBoost(profile,'actions',keyFn(item),0.12)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.item);
}

export function rankAdaptiveLayouts(items,profile,keyFn,scoreFn=x=>Number(x?.score||0)){
  const list=[...(items||[])];
  if(!profile?.enabled||list.length<2)return list;
  return list.map((item,index)=>({item,index,score:scoreFn(item)+adaptiveBoost(profile,'layouts',keyFn(item),0.045)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.item);
}

export function chooseNextAction(base,candidates,profile){
  if(!profile?.enabled||!Array.isArray(candidates)||!candidates.length)return base;
  const counts=candidates.map(item=>count(profile,'actions',item.id));
  const maxCount=Math.max(...counts,0);
  const winner=[...candidates].map((item,index)=>{
    const c=count(profile,'actions',item.id);
    const familiarity=maxCount>0?c/maxCount:0;
    return {item,index,score:(item.priority||0)+familiarity*0.65};
  }).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.item;
  return winner||base;
}

export function adaptiveSummary(profile){
  const p=sanitize(profile);
  const top=(map,label)=>Object.entries(map||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]?{label,key:Object.entries(map).sort((a,b)=>b[1]-a[1])[0][0],count:Object.entries(map).sort((a,b)=>b[1]-a[1])[0][1]}:null;
  return {
    enabled:p.enabled,
    sessions:p.sessions,
    events:p.events,
    topAction:top(p.actions,'ACTION'),
    topLayout:top(p.layouts,'LAYOUT'),
    topMode:top(p.modes,'MODE'),
    topIntent:top(p.intents,'INTENT'),
    topFix:top(p.fixes,'FIX'),
    topExport:top(p.exports,'EXPORT'),
  };
}

export function adaptiveExportSnapshot(profile){
  const p=sanitize(profile);
  return {
    version:VERSION,
    enabled:p.enabled,
    sessions:p.sessions,
    events:p.events,
    actions:{...p.actions},modes:{...p.modes},intents:{...p.intents},layouts:{...p.layouts},fixes:{...p.fixes},exports:{...p.exports},commands:{...p.commands},
    lastAction:p.lastAction,lastMode:p.lastMode,lastIntent:p.lastIntent
  };
}
