import { createProject, createImageObject, createTextObject, createSwatchObject, createDividerObject, createFrameObject, uid, MAX_ASSETS, MAX_CANVAS, MAX_MEGAPIXELS, sanitizeProject } from '../core/model.js';
import { HistoryManager } from '../core/history.js';
import { saveProjectState, saveProjectAssets, getLatestProject, clearProjects, pruneProjectAssets } from '../core/idb.js';
import { storageHealth, requestPersistentStorage, formatStorageBytes } from '../core/storage.js';
import { saveBlob as saveLocalBlob, openLocalCollage } from '../core/file-access.js';
import { packProject, unpackProject } from '../core/project-file.js';
import { LAYOUTS, INTENTS, generateLayout, generateCandidates, generateCompositionReport, layoutLabel } from '../engine/layout.js';
import { renderProject, exportBlob } from '../engine/render.js';
import { inspectProject } from '../engine/quality.js';
import { localAssistant } from '../engine/assistant.js';
import { analyzeBitmap, focalPointFromAnalysis, analysisLabel, getAssetAnalysis, visionLabel } from '../engine/intelligence.js';
import { enhanceBitmap, visionCapability, visionStatus, VISION_PROVIDER_NOTICE } from '../engine/vision.js';
import { compositionLabel } from '../engine/composition.js';
import { analyzeAuthoring, applyAuthoringFix, authoringLabel } from '../engine/authoring.js';
import { aiModels, aiKeyConfigured, getAIConfig, setAIConfig, clearAIConfig, askAI, askAIPlan, aiUsage, aiEdgeCapability } from '../engine/ai.js';
import { getContext, getNextAction, getContextActions, actionMeta, rankCommands, snapPosition, SHORTCUTS } from '../engine/experience.js';
import { parseStudioCommand, validateCommandPlan, applyCommandPlan } from '../engine/command-intent.js';
import { interpretCopilotRequest, validateCopilotPlan, applyCopilotPlan, describeCopilotPlan, createCopilotDiff, estimateCopilotImpact } from '../engine/copilot.js';
import { loadAdaptiveProfile, startAdaptiveSession, recordAdaptiveEvent, rankAdaptiveActions, rankAdaptiveLayouts, chooseNextAction, adaptiveSummary, setAdaptiveEnabled, resetAdaptiveProfile } from '../engine/adaptive.js';
import { initSupportShare, openDownloadSupportModal, sharePage, SUPPORT_LINK } from './support-share.js';

const app=document.getElementById('app');
const history=new HistoryManager(80);
const runtimeAssets=new Map();
let project=createProject();
let saveTimer=0,toastTimer=0,dragging=null,resizeObserver=null;
let saveRunning=false,saveAgain=false;
const pendingAssetIds=new Set();
let storageSnapshot={supported:false,persistent:false,usage:0,quota:0,ratio:0,label:'LOCAL STORAGE'};
let candidates=[];
const viewState={zoom:1,fit:true,focusMode:false,guides:[],lastAction:null};
let adaptiveProfile=startAdaptiveSession(loadAdaptiveProfile());

const commands=[
 ['Create 3×3 grid','Switch layout to GRID',()=>setLayout('grid'),'grid'],
 ['Switch to Mood Board','Use freeform workspace',()=>setMode('mood'),'mood'],
 ['Switch to Precision Studio','Open detailed controls',()=>setMode('precision'),null],
 ['Set canvas to 1080×1920','Portrait canvas',()=>setCanvasPreset('portrait'),null],
 ['Set gap to 20px','Change inner spacing',()=>setFrameField('innerGap',20),null],
 ['Add Photos','Import local images into the studio',()=>$('#fileInput')?.click(),'addPhotos'],
 ['Compare 4 Layouts','Review intelligent layout candidates',()=>{candidates=rankedCandidates(project);openCompare(candidates)},'compare'],
 ['Creative Copilot','Turn a multi-step creative goal into a safe previewable plan',()=>openCreativeCopilot(),'copilot'],
 ['Smart Command','Describe an edit and preview safe changes before applying',()=>openStudioCommand(),'smartCommand'],
 ['Run Studio Check','Inspect project',()=>runQuality(true),null],
 ['Run Authoring Review','Find one-click composition improvements',()=>openAuthoringReview(),'authorReview'],
 ['Enhance Focal Intelligence','Run on-device face/object vision',()=>runVisionEnhancement(),'enhanceVision'],
 ['Save Project','Write a .LOCALCOLLAGE file',()=>saveProjectFile(),null],
 ['Export Image','Open export lab',()=>openExport(),null],
 ['Share Studio','Share the studio link',()=>sharePage(false),'share'],
 ['Toggle Focus Mode','Maximize the canvas',()=>toggleFocusMode(),'focus'],
 ['Fit Canvas','Fit the canvas to the workspace',()=>setCanvasFit(),'fitCanvas'],
 ['View at 100%','View the canvas at true pixel scale',()=>setZoom(1),'zoom100'],
 ['Configure Optional AI','Connect Gemini or Mistral with your own key',()=>openAISettings(),null],
];

function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtBytes(n){if(!Number.isFinite(n))return '—';const u=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<3){v/=1024;i++;}return `${v.toFixed(i?1:0)} ${u[i]}`;}
function $(sel){return document.querySelector(sel)}
function $$(sel){return [...document.querySelectorAll(sel)]}
function toast(msg,type='',ms=2600){clearTimeout(toastTimer);const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`.trim();toastTimer=setTimeout(()=>el.classList.remove('show'),ms)}
function selected(){return project.objects.find(o=>o.id===project.selectedId)||null}
function adaptEvent(type,key){adaptiveProfile=recordAdaptiveEvent(adaptiveProfile,type,key);return adaptiveProfile;}
function rankedCandidates(p=project){return rankAdaptiveLayouts(generateCandidates(p,runtimeAssets),adaptiveProfile,c=>c.type,c=>Number(c.score||0));}
function imageObjects(){return project.objects.filter(o=>o.type==='image')}
function beginMutation(){return JSON.parse(JSON.stringify(project))}
function commit(before,msg=''){project.updatedAt=Date.now();history.commit(before,project);queueSave();renderAll();if(msg)toast(msg,'success');}
function queueSave(){clearTimeout(saveTimer);$('#saveState')?.replaceChildren(textNode('LOCAL • UNSAVED'));saveTimer=setTimeout(saveLocally,650)}
function textNode(t){return document.createTextNode(t)}
async function refreshStorageSnapshot(){storageSnapshot=await storageHealth();updateStorageUI();return storageSnapshot}
function updateStorageUI(){const label=storageSnapshot.quota?`LOCAL STORAGE • ${formatStorageBytes(storageSnapshot.usage)} / ${formatStorageBytes(storageSnapshot.quota)} • ${storageSnapshot.persistent?'PROTECTED':'BEST EFFORT'}`:'LOCAL STORAGE • STATUS UNAVAILABLE';['#storageHealth','#storageHealthModal'].forEach(sel=>{const el=$(sel);if(el)el.textContent=label;});}
async function saveLocally(){
  if(saveRunning){saveAgain=true;return;}
  saveRunning=true;
  try{
    project.updatedAt=Date.now();
    const refs=[...new Set(project.objects.map(o=>o.assetId).filter(Boolean))];
    const dirty=[...pendingAssetIds].map(id=>runtimeAssets.get(id)).filter(Boolean).filter(a=>refs.includes(a.id));
    if(dirty.length)await saveProjectAssets(project.id,dirty.map(a=>({id:a.id,name:a.name,type:a.type,blob:a.blob,bytes:a.bytes})));
    await saveProjectState({id:project.id,name:project.name,updatedAt:Date.now(),project:structuredClone(project),assetRefs:refs});
    await pruneProjectAssets(project.id,refs);
    dirty.forEach(a=>{a.persisted=true;pendingAssetIds.delete(a.id)});
    const snap=await refreshStorageSnapshot();
    const state=$('#saveState');
    if(state)state.textContent=`LOCAL • AUTOSAVED${snap.quota?' • '+snap.label:''}`;
  }catch(e){
    const state=$('#saveState');if(state)state.textContent='LOCAL • SAVE BLOCKED';
    console.warn('LOCAL AUTOSAVE FAILED',e);
  }finally{
    saveRunning=false;
    if(saveAgain){saveAgain=false;queueSave();}
  }
}


function aiContext(){
  const report=generateCompositionReport(project,runtimeAssets);
  const quality=inspectProject(project,runtimeAssets);
  const selectedId=project.selectedId;
  const imgs=imageObjects();
  return {
    mode:project.mode,
    intent:project.intent,
    imageProtection:project.imageProtection,
    canvas:{w:project.canvas.w,h:project.canvas.h,dpi:project.canvas.dpi},
    frame:{outerMargin:project.frame.outerMargin,innerGap:project.frame.innerGap,radius:project.frame.radius},
    layout:project.layout.type,
    objectCount:project.objects.length,
    selected:selectedId?(()=>{const o=project.objects.find(x=>x.id===selectedId);return o?{type:o.type,x:o.x,y:o.y,w:o.w,h:o.h,rotation:o.rotation||0,scale:o.scale||1,fitMode:o.fitMode||null,focalX:o.focalX??.5,focalY:o.focalY??.5,vision:o.vision?{enhanced:!!o.vision.enhanced,confidence:o.vision.confidence||0,subjectType:o.vision.subjectType||null}:null}:null})():null,
    objects:project.objects.slice(0,12).map((o,i)=>({type:o.type,index:i+1,x:Math.round(o.x||0),y:Math.round(o.y||0),w:Math.round(o.w||0),h:Math.round(o.h||0),rotation:Math.round(o.rotation||0),scale:Number((o.scale||1).toFixed(2)),fitMode:o.fitMode||null,focalX:Number((o.focalX??.5).toFixed(2)),focalY:Number((o.focalY??.5).toFixed(2)),hidden:!!o.hidden,locked:!!o.locked})),
    images:imgs.map((o,i)=>{const a=getAssetAnalysis(runtimeAssets,o);return {index:i+1,aspect:a?Number(a.aspect.toFixed(2)):null,contrast:a?Number(a.contrast.toFixed(2)):null,density:a?Number(a.density.toFixed(2)):null,dominantColor:a?.dominantColor||null,vision:o.vision?.enhanced?{confidence:Number((o.vision.confidence||0).toFixed(2)),subjectType:o.vision.subjectType||null}:null}}),
    quality:quality.issues.slice(0,8).map(x=>x.message),
    composition:{intentFit:report.metrics?.intentFit||0,hierarchy:report.metrics?.hierarchy||0,rhythm:report.metrics?.rhythm||0,spacing:report.metrics?.spacing||0,focalSafety:report.metrics?.focal||0},
    authoring:(analyzeAuthoring(project,runtimeAssets).suggestions||[]).map(x=>({id:x.id,title:x.title,message:x.message,delta:Number((x.delta||0).toFixed(3))})),
  };
}
function aiConfiguredLabel(){const c=getAIConfig();return c.configured?`${c.provider.toUpperCase()} • ${c.model}`:'NOT CONNECTED';}

function ensureIntelligenceState(){project.intelligence ||= {visionEnhanced:false,visionProvider:null,lastVisionAt:null};}
function visionCount(){return imageObjects().filter(o=>o.vision?.enhanced).length;}
function visionSummary(){const count=visionCount(), total=imageObjects().length; if(visionStatus()==='loading') return 'LOADING VISION'; if(count===0) return total?'READY TO ENHANCE':'ADD PHOTOS'; return `ENHANCED ${count}/${total}`;}
async function runVisionEnhancement(targetIds=null){
  const all=imageObjects();
  if(!all.length){toast('ADD PHOTOS BEFORE ENHANCING VISION','error');return;}
  const cap=visionCapability();
  if(!cap.supported){toast('ON-DEVICE VISION IS NOT SUPPORTED HERE','error');return;}
  ensureIntelligenceState();
  if(visionStatus()==='loading'){toast('VISION ENGINE IS ALREADY LOADING');return;}
  const before=beginMutation();
  const analysisBefore=new Map();
  imageObjects().forEach(o=>{const rt=runtimeAssets.get(o.assetId);analysisBefore.set(o.assetId,rt?.analysis?structuredClone(rt.analysis):null);});
  const wanted=targetIds ? new Set(targetIds) : null;
  const imgs=(wanted ? all.filter(o=>wanted.has(o.id)) : all).filter(o=>!o.locked);
  if(!imgs.length){toast('NO UNLOCKED IMAGES AVAILABLE FOR VISION','error');return;}
  try{
    toast('LOADING ON-DEVICE VISION RUNTIME','');
    let done=0;
    for(const o of imgs){
      const rt=runtimeAssets.get(o.assetId);
      if(!rt?.bitmap)continue;
      const result=await enhanceBitmap(rt.bitmap,{onStatus:status=>{if(status.includes('READY'))toast(`VISION READY • ANALYZING ${o.name.toUpperCase()}`,'');}});
      const merged={...(rt.analysis||{}),vision:result};
      rt.analysis=merged;
      o.vision=result;
      if(result.enhanced && o.focalAuto!==false){o.focalX=result.focalX;o.focalY=result.focalY;o.focalAuto=true;}
      done++;
      if(done<imgs.length)await new Promise(requestAnimationFrame);
    }
    project.intelligence.visionEnhanced=visionCount()>0;
    project.intelligence.visionProvider='MediaPipe Tasks Vision 1.0.1';
    project.intelligence.lastVisionAt=Date.now();
    history.commit(before,project);
    queueSave();
    renderAll();
    toast(`${visionCount()} IMAGE${visionCount()===1?'':'S'} VISION-ENHANCED`,'success');
  }catch(e){
    project=JSON.parse(JSON.stringify(before));
    runtimeAssets.forEach((rt,id)=>{if(analysisBefore.has(id))rt.analysis=analysisBefore.get(id)||undefined;});
    console.error('VISION ENHANCEMENT FAILED',e);
    toast('VISION ENGINE COULD NOT LOAD — NO PARTIAL CHANGES WERE KEPT','error',4200);
    renderAll();
  }
}

function renderApp(){
app.innerHTML=`
<div class="app">
 <header class="topbar">
  <div class="brand"><div class="brand-mark">✦</div><div><div class="brand-name">PRO AI LOCAL COLLAGE</div><div class="brand-sub">SMART COMPOSITION • PRIVATE BROWSER STUDIO</div></div></div>
  <nav class="mode-tabs" aria-label="Studio modes">
   <button class="mode-tab ${project.mode==='quick'?'active':''}" data-mode="quick">QUICK STUDIO</button>
   <button class="mode-tab ${project.mode==='precision'?'active':''}" data-mode="precision">PRECISION</button>
   <button class="mode-tab ${project.mode==='mood'?'active':''}" data-mode="mood">MOOD BOARD</button>
  </nav>
  <div class="top-actions">
   <button class="top-btn" id="undoBtn">UNDO</button><button class="top-btn" id="redoBtn">REDO</button>
   <button class="top-btn labelled" id="shuffleBtn">SHUFFLE</button><button class="top-btn labelled" id="compareBtn">COMPARE</button><button class="top-btn labelled copilot-btn" id="copilotBtn">✦ COPILOT</button><button class="top-btn labelled" id="smartCommandBtn">SMART COMMAND</button>
   <button class="top-btn labelled" id="projectBtn">PROJECT</button><button class="top-btn labelled" id="helpBtn">HELP</button><button class="top-btn labelled persistent share-btn" id="shareBtn" type="button" aria-label="Share this studio">SHARE</button><button class="top-btn" id="focusBtn" title="F">FOCUS</button><button class="top-btn primary labelled" id="exportBtn">EXPORT</button>
  </div>
 </header>
 <main class="layout-shell">
  <aside class="panel" id="leftPanel"></aside>
  <section class="workspace">
   <div class="workspace-head"><div class="workspace-title">CANVAS WORKSPACE</div><div class="workspace-meta"><span id="canvasLabel"></span><span>•</span><span class="accent" id="workspaceStatus"></span></div></div>
   <div class="experience-bar"><button class="next-action next-action-button" id="nextActionButton" type="button"><span class="experience-kicker">NEXT BEST MOVE</span><div><b id="nextActionTitle">START WITH PHOTOS</b><span id="nextActionMessage">DROP YOUR IMAGES OR ADD THEM FROM YOUR DEVICE.</span></div></button><div class="view-tools"><button class="tiny" id="zoomOutBtn">−</button><button class="tiny" id="fitCanvasBtn">FIT</button><button class="tiny" id="zoom100Btn">100%</button><button class="tiny" id="zoomInBtn">+</button><span class="view-readout" id="zoomReadout">100%</span></div></div>
   <div class="canvas-viewport" id="canvasViewport">
    <div class="canvas-wrap" id="canvasWrap"><canvas id="studioCanvas" aria-label="Editable collage canvas"></canvas></div>
    <div class="context-toolbar" id="contextToolbar"></div>
    <div class="canvas-empty ${imageObjects().length?'hidden':''}" id="canvasEmpty"><div class="drop-zone" id="dropZone" tabindex="0" role="button"><div><div class="drop-icon">↳</div><div class="drop-title">DRAG & DROP MULTIPLE PHOTOS HERE OR CLICK TO BROWSE</div><div class="drop-sub">2–9 IMAGES • LOCAL PROCESSING • NO UPLOAD REQUIRED</div></div></div></div>
   </div>
   <div class="mapping"><b>MAPPING:</b><button class="map-btn ${project.canvas.mapping==='checker'?'active':''}" data-map="checker">TRANSPARENT CHECKERBOARD</button><button class="map-btn ${project.canvas.mapping==='white'?'active':''}" data-map="white">CLEAN STUDIO WHITE</button><button class="map-btn ${project.canvas.mapping==='slate'?'active':''}" data-map="slate">DEEP SLATE SUITE BLEND</button></div>
   <div class="mobile-toolbar"><button class="top-btn" id="mobileAdd">ADD PHOTOS</button><button class="top-btn" id="mobileLayout">LAYOUTS</button><button class="top-btn" id="mobileAdjust">ADJUST</button><button class="top-btn" id="mobileLayers">LAYERS</button></div>
  </section>
  <aside class="inspector"><div class="inspector-scroll" id="inspector"></div></aside>
 </main>
 <div class="bottom panel"><div class="local-status"><span class="status-dot"></span><span id="saveState">LOCAL • READY</span></div><button class="local-status local-status-button" id="storageBtn" type="button" title="Local storage health"><span id="storageHealth">LOCAL STORAGE • CHECKING</span></button><button class="local-status local-status-button adaptive-status" id="adaptiveBtn" type="button" title="Local adaptive studio settings"><span id="adaptiveStatus">ADAPTIVE • ON</span></button><div class="local-status">NO ACCOUNT • NO WATERMARK • SOURCE FILES STAY ON DEVICE</div><div class="local-status"><span class="kbd">/</span> COMMANDS</div><div class="local-status"><span class="kbd">F</span> FOCUS</div></div>
 <footer class="footer-note"><span>FREE LOCAL COLLAGE MAKER • MOOD BOARD STUDIO • PRECISION CANVAS</span><span class="footer-sep">•</span><a class="footer-support" href="${SUPPORT_LINK}" target="_blank" rel="noopener noreferrer" aria-label="Buy me Coffee on Ko-fi"><svg viewBox="0 0 96 96" aria-hidden="true" focusable="false"><path d="M23 36h39v21c0 10-7 17-19 17S23 67 23 57Z"/><path d="M62 42h8c8 0 12 5 12 11s-4 11-12 11h-8"/><path d="M28 78h40"/><path d="M34 25c-4-6 6-8 2-15"/><path d="M49 25c-4-6 6-8 2-15"/></svg><span>Buy Me Coffee</span></a></footer>
</div><div class="toast" id="toast"></div>
<input class="sr-only" id="fileInput" type="file" accept="image/*" multiple>
<input class="sr-only" id="projectInput" type="file" accept=".localcollage,application/x-localcollage">
<div id="modalRoot"></div>`;
attachBaseEvents();resizeObserver?.disconnect();if(window.ResizeObserver){resizeObserver=new ResizeObserver(()=>sizePreview());resizeObserver.observe($('#canvasViewport'));}else{window.addEventListener('resize',sizePreview,{passive:true});}sizePreview();}

function compositionCard(){
  const report=generateCompositionReport(project,runtimeAssets);
  if(!imageObjects().length)return `<div class="section"><div class="label"><span>COMPOSITION INTELLIGENCE</span><span class="mini">WAITING</span></div><div class="hint"><b>ADD PHOTOS.</b> THE ENGINE WILL MAP VISUAL WEIGHT, PAIRING, RHYTHM, HIERARCHY AND NEGATIVE SPACE LOCALLY.</div></div>`;
  const m=report.metrics||{};
  const metric=(label,value)=>`<div class="comp-metric"><span>${label}</span><b>${Math.round((value||0)*100)}%</b><i><em style="width:${Math.round((value||0)*100)}%"></em></i></div>`;
  return `<div class="section composition-panel"><div class="label"><span>COMPOSITION INTELLIGENCE</span><span class="readout">${compositionLabel(report)}</span></div><div class="composition-grid">${metric('HIERARCHY',m.hierarchy)}${metric('RHYTHM',m.rhythm)}${metric('SPACING',m.spacing)}${metric('FOCAL SAFETY',m.focal)}</div><div class="composition-insights">${(report.insights||[]).slice(0,3).map(x=>`<span>✓ ${esc(x)}</span>`).join('')}</div></div>`;
}
function authoringCard(){
  if(!imageObjects().length)return '';
  const report=analyzeAuthoring(project,runtimeAssets);
  const items=report.suggestions||[];
  return `<div class="section authoring-panel"><div class="label"><span>AUTHORING INTELLIGENCE</span><span class="readout">${authoringLabel(report)}</span></div>${items.length?`<div class="authoring-list">${items.map(s=>`<div class="authoring-item"><div class="authoring-item-main"><div class="authoring-kind">${esc(s.kind||'SMART FIX')}</div><b>${esc(s.title)}</b><span>${esc(s.message)}</span></div><button class="tiny author-fix" data-author-fix="${esc(s.id)}">${esc(s.confirmLabel||'FIX')}</button></div>`).join('')}</div><button class="tiny authoring-review-btn" style="margin-top:7px;width:100%">REVIEW ALL SMART FIXES</button>`:`<div class="authoring-good">✓ NO HIGH-VALUE FIXES NEEDED RIGHT NOW. THE COMPOSITION IS IN GOOD SHAPE.</div>`}</div>`;
}

function capabilityNotice(){const cap=visionCapability();if(!cap.supported)return 'BROWSER VISION API UNAVAILABLE';if(visionCount())return 'IMAGE INFERENCE RUNS ON THIS DEVICE • MODEL PROVIDER: MEDIAPIPE';return 'FIRST USE DOWNLOADS THE LOCAL VISION RUNTIME + MODELS • '+(cap.webgpu?'GPU AVAILABLE':'CPU FALLBACK');}

function renderLeft(){
const mode=project.mode;
let html='';
if(mode==='quick'){
html=`<div class="panel-head"><div class="panel-title">LAYOUT LAB</div><div class="mini">QUICK</div></div>
<div class="section"><div class="label"><span>WHAT ARE YOU MAKING?</span></div><div class="chips">${INTENTS.map(i=>`<button class="select-chip ${project.intent===i.id?'active':''}" data-intent="${i.id}">${i.label}</button>`).join('')}</div></div>
<div class="section"><div class="label"><span>SMART LAYOUTS</span><span class="readout">${imageObjects().length} ASSETS</span></div><div class="intel-strip">LOCAL INTELLIGENCE • ASPECT • FOCAL POINT • CONTRAST • DENSITY • COLOR • RELATIONSHIPS</div><div class="section intelligence-card vision-panel"><div class="section-head"><div class="section-title">FOCAL INTELLIGENCE</div><div class="mini">${visionSummary()}</div></div><div class="hint"><b>VISION BOOST:</b> OPTIONAL FACE + OBJECT DETECTION HELPS PROTECT SUBJECTS WHEN CROPPING OR CHANGING LAYOUTS.</div><button class="primary" id="visionBtn" ${imageObjects().length?'':'disabled'} style="margin-top:7px">${visionCount()?'REFRESH ON-DEVICE VISION':'ENHANCE FOCAL INTELLIGENCE'}</button><div class="vision-note">${capabilityNotice()} <button class="inline-link" id="visionPrivacy" type="button">PRIVACY NOTE</button></div></div>${compositionCard()}${authoringCard()}<div class="layout-grid">${rankAdaptiveLayouts(LAYOUTS,adaptiveProfile,l=>l.id,l=>project.layout.type===l.id?0.06:0).map(l=>`<button class="layout-card ${project.layout.type===l.id?'active':''}" data-layout="${l.id}"><b>${l.name}</b><small>${l.desc}</small></button>`).join('')}</div></div>
<div class="section"><div class="two"><button class="secondary" id="addBtn">ADD PHOTOS</button><button class="ghost" id="newBtn">NEW PROJECT</button></div></div>
<div class="section"><button class="primary" id="compareLeft">COMPARE 4 LAYOUTS</button></div>
<div class="hint"><b>SMART SHUFFLE</b> creates new candidates without overwriting your current work. Choose one only when you're ready.</div>`;
}else if(mode==='precision'){
html=`<div class="panel-head"><div class="panel-title">PRECISION STUDIO</div><div class="mini">CONTROL</div></div>
<div class="section"><div class="label"><span>CANVAS</span><span class="readout">${project.canvas.w} × ${project.canvas.h}</span></div><select class="select" id="presetSelect"><option value="etsy">ETSY COVER • 2000 × 2000</option><option value="portrait">PORTRAIT SOCIAL • 1080 × 1920</option><option value="wide">WIDESCREEN • 1920 × 1080</option><option value="square">SQUARE SOCIAL • 1080 × 1080</option><option value="custom">CUSTOM</option></select><div class="two" style="margin-top:7px"><input class="field" id="cw" type="number" min="64" max="${MAX_CANVAS}" value="${project.canvas.w}" aria-label="Canvas width"><input class="field" id="ch" type="number" min="64" max="${MAX_CANVAS}" value="${project.canvas.h}" aria-label="Canvas height"></div><button class="tiny" id="applyCanvas" style="margin-top:7px;width:100%">APPLY CANVAS</button></div>
<div class="section"><div class="label"><span>FRAME</span></div><div class="two"><div class="tool"><div class="tool-label">OUTER MARGIN</div><input id="marginRange" type="range" min="0" max="240" value="${project.frame.outerMargin}"><div class="tool-value" id="marginValue">${project.frame.outerMargin} PX</div></div><div class="tool"><div class="tool-label">INNER GAP</div><input id="gapRange" type="range" min="0" max="160" value="${project.frame.innerGap}"><div class="tool-value" id="gapValue">${project.frame.innerGap} PX</div></div></div><div class="tool" style="margin-top:7px"><div class="tool-label">CORNER RADIUS</div><input id="radiusRange" type="range" min="0" max="160" value="${project.frame.radius}"><div class="tool-value" id="radiusValue">${project.frame.radius} PX</div></div></div>
<div class="section"><div class="label"><span>IMAGE PROTECTION</span></div><div class="seg-row">${[['never','NEVER CROP'],['smart','SMART CROP'],['free','FREE CROP']].map(([v,t])=>`<button class="seg-btn ${project.imageProtection===v?'active':''}" data-protection="${v}">${t}</button>`).join('')}</div></div>
<div class="section"><div class="label"><span>SELECTED OBJECT</span></div><div class="two"><button class="secondary" id="centerBtn">CENTER</button><button class="secondary" id="resetBtn">RESET</button></div><div class="three" style="margin-top:7px"><button class="tiny" id="leftBtn">← 1 PX</button><button class="tiny" id="upBtn">↑ 1 PX</button><button class="tiny" id="rightBtn">→ 1 PX</button></div><button class="tiny" id="downBtn" style="margin-top:7px;width:100%">↓ 1 PX</button></div>
<div class="section"><div class="label"><span>ADD OBJECT</span></div><div class="two"><button class="secondary" id="addText">TEXT NOTE</button><button class="secondary" id="addSwatch">COLOR SWATCH</button></div><div class="two" style="margin-top:7px"><button class="secondary" id="addDivider">DIVIDER</button><button class="secondary" id="addFrame">FRAME</button></div></div>`;
}else{
html=`<div class="panel-head"><div class="panel-title">MOOD BOARD STUDIO</div><div class="mini">FREEFORM</div></div>
<div class="section"><div class="label"><span>FREEFORM TOOLS</span></div><div class="two"><button class="secondary" id="moodAdd">ADD PHOTOS</button><button class="ghost" id="moodArrange">SMART ARRANGE</button></div></div>
<div class="section"><div class="label"><span>ALIGNMENT</span></div><div class="three"><button class="tiny" data-align="left">LEFT</button><button class="tiny" data-align="center">CENTER</button><button class="tiny" data-align="right">RIGHT</button></div><div class="three" style="margin-top:7px"><button class="tiny" data-align="top">TOP</button><button class="tiny" data-align="middle">MIDDLE</button><button class="tiny" data-align="bottom">BOTTOM</button></div><div class="two" style="margin-top:7px"><button class="tiny" data-distribute="x">DISTRIBUTE X</button><button class="tiny" data-distribute="y">DISTRIBUTE Y</button></div></div>
<div class="section"><div class="label"><span>ADD BOARD ELEMENT</span></div><div class="two"><button class="secondary" id="moodText">TEXT NOTE</button><button class="secondary" id="moodSwatch">COLOR SWATCH</button></div></div>
<div class="hint"><b>FREEFORM:</b> drag, resize and rotate objects directly on the canvas. Use the Asset Stack on the right to reorder, hide or lock them.</div>`;
}
$('#leftPanel').innerHTML=html;
attachLeftEvents();}

function renderInspector(){
const comp=generateCompositionReport(project,runtimeAssets);
const imgs=project.objects.filter(o=>o.type==='image').sort((a,b)=>(a.z||0)-(b.z||0));
const sel=selected();const q=inspectProject(project,runtimeAssets);
let html=`<div class="panel-head"><div class="panel-title">ASSET STACK</div><div class="mini">${project.objects.length} OBJECTS</div></div>`;
if(!project.objects.length) html+=`<div class="section"><div class="hint"><b>NO OBJECTS YET.</b> DROP PHOTOS OR ADD A BOARD ELEMENT.</div></div>`;
else html+=`<div class="asset-stack">${[...project.objects].sort((a,b)=>(b.z||0)-(a.z||0)).map((o,i)=>{const a=o.type==='image'?runtimeAssets.get(o.assetId):null;return `<button class="asset-row ${sel?.id===o.id?'active':''}" data-select="${o.id}"><span>${a?.thumbUrl?`<img class="thumb" alt="" src="${a.thumbUrl}">`:`<span class="thumb" style="display:grid;place-items:center">${o.type==='text'?'T':o.type==='swatch'?'●':o.type==='divider'?'—':'□'}</span>`}</span><span><span class="asset-name">${esc(o.name||o.text||o.type)}</span><span class="asset-meta">${o.type.toUpperCase()} • ${Math.round(o.w)}×${Math.round(o.h)}${o.locked?' • LOCKED':''}</span></span><span class="asset-no">${o.hidden?'×':String(i+1).padStart(2,'0')}</span></button>`}).join('')}</div>`;
if(sel) html+=selectedInspector(sel);
if(imageObjects().length) html+=`<div class="section composition-summary"><div class="panel-head"><div class="panel-title">COMPOSITION INTELLIGENCE</div><div class="mini">${compositionLabel(comp)}</div></div><div class="composition-insights">${(comp.insights||[]).slice(0,4).map(x=>`<span>✓ ${esc(x)}</span>`).join('')}</div></div>`;
if(imageObjects().length) html+=authoringInspectorCard();
html+=`<div class="section"><div class="panel-head"><div class="panel-title">STUDIO CHECK</div><div class="mini ${q.ok?'':'danger'}">${q.issues.length?q.issues.length+' WARNING'+(q.issues.length>1?'S':''):'READY'}</div></div><div class="stat-grid"><div class="stat"><div class="stat-k">VISIBLE OBJECTS</div><div class="stat-v">${project.objects.filter(o=>!o.hidden).length}</div></div><div class="stat"><div class="stat-k">CANVAS</div><div class="stat-v">${project.canvas.w}×${project.canvas.h}</div></div></div><div class="warning-list">${q.issues.slice(0,5).map(i=>`<div class="warning ${i.level}">${esc(i.message)}${i.action==='fit'?`<button class="tiny" data-quality-fit="${i.objectId}" style="margin-top:6px">FIT PHOTO</button>`:''}</div>`).join('')}</div>${q.issues.length?`<button class="tiny" id="qualityAll" style="margin-top:7px;width:100%">RUN FULL CHECK</button>`:''}</div>`;
$('#inspector').innerHTML=html;attachInspectorEvents();}
function authoringInspectorCard(){
 const report=analyzeAuthoring(project,runtimeAssets);
 const items=report.suggestions||[];
 return `<div class="section authoring-panel"><div class="panel-head"><div class="panel-title">SMART FIXES</div><div class="mini">${authoringLabel(report)}</div></div>${items.length?`<div class="authoring-list">${items.map(s=>`<div class="authoring-item"><div class="authoring-item-main"><div class="authoring-kind">${esc(s.kind||'SMART FIX')}</div><b>${esc(s.title)}</b><span>${esc(s.message)}</span>${s.delta>0.004?`<small>EST. +${Math.round(s.delta*100)} POINTS</small>`:''}</div><button class="tiny author-fix" data-author-fix="${esc(s.id)}">${esc(s.confirmLabel||'FIX')}</button></div>`).join('')}</div>`:`<div class="authoring-good">✓ NO HIGH-VALUE FIXES NEEDED.</div>`}<button class="tiny authoring-review-btn" style="margin-top:7px;width:100%">REVIEW ALL SMART FIXES</button></div>`;
}

function openAuthoringReview(){
 const report=analyzeAuthoring(project,runtimeAssets,{detailed:true});
 openModal('AUTHORING INTELLIGENCE', `<div class="stat-grid"><div class="stat"><div class="stat-k">COMPOSITION FIT</div><div class="stat-v">${Math.round(report.score*100)}%</div></div><div class="stat"><div class="stat-k">SMART FIXES</div><div class="stat-v">${report.suggestions.length}</div></div></div>${report.suggestions.length?`<div class="authoring-modal-list">${report.suggestions.map(s=>`<div class="authoring-modal-item"><div><div class="authoring-kind">${esc(s.kind||'SMART FIX')}</div><b>${esc(s.title)}</b><p>${esc(s.message)}</p>${s.delta>0.004?`<small>ESTIMATED COMPOSITION IMPROVEMENT: +${Math.round(s.delta*100)} POINTS</small>`:''}</div><button class="primary" data-author-fix="${esc(s.id)}">${esc(s.confirmLabel||'FIX')}</button></div>`).join('')}</div>`:`<div class="authoring-good" style="margin-top:10px">✓ THE CURRENT COMPOSITION DOES NOT NEED A HIGH-VALUE AUTOMATIC FIX.</div>`}`);
 $$('#modalRoot [data-author-fix]').forEach(b=>b.onclick=()=>{closeModal();applyAuthoringMutation(b.dataset.authorFix)});
}
function applyAuthoringMutation(id){
 const before=beginMutation(); const r=applyAuthoringFix(project,runtimeAssets,id); if(r.changed){adaptEvent('fix',id);commit(before,r.message)}else renderAll();
}

function selectedInspector(o){
if(o.type==='image') return `<div class="section"><div class="section-head"><div class="section-title">SELECTED PHOTO</div><div class="mini">${esc(o.name).slice(0,24)}</div></div><div class="two" style="margin-top:8px"><div class="tool"><div class="tool-label">X</div><input class="field" data-num="x" value="${Math.round(o.x)}"></div><div class="tool"><div class="tool-label">Y</div><input class="field" data-num="y" value="${Math.round(o.y)}"></div></div><div class="two" style="margin-top:7px"><div class="tool"><div class="tool-label">WIDTH</div><input class="field" data-num="w" value="${Math.round(o.w)}"></div><div class="tool"><div class="tool-label">HEIGHT</div><input class="field" data-num="h" value="${Math.round(o.h)}"></div></div><div class="two" style="margin-top:7px"><div class="tool"><div class="tool-label">ROTATION</div><input class="field" data-num="rotation" value="${Math.round(o.rotation||0)}"></div><div class="tool"><div class="tool-label">SCALE</div><input class="field" data-num="scale" step="0.01" value="${Number(o.scale||1).toFixed(2)}"></div></div><div class="section"><div class="label"><span>FOCAL POINT X</span><span class="readout">${Math.round((o.focalX??.5)*100)}%</span></div><input type="range" min="0" max="1" step=".01" data-focal="x" value="${o.focalX??.5}"><div class="label" style="margin-top:8px"><span>FOCAL POINT Y</span><span class="readout">${Math.round((o.focalY??.5)*100)}%</span></div><input type="range" min="0" max="1" step=".01" data-focal="y" value="${o.focalY??.5}"></div><div class="section intelligence-card"><div class="section-head"><div class="section-title">VISUAL INTELLIGENCE</div><div class="mini">LOCAL</div></div>${(()=>{const a=getAssetAnalysis(runtimeAssets,o);return a?`<div class="intel-grid"><div><span>TYPE</span><b>${analysisLabel(a)}</b></div><div><span>SOURCE</span><b>${runtimeAssets.get(o.assetId)?.width||'—'}×${runtimeAssets.get(o.assetId)?.height||'—'}</b></div><div><span>ASPECT</span><b>${a.aspect.toFixed(2)}</b></div><div><span>CONTRAST</span><b>${Math.round(a.contrast*100)}%</b></div><div><span>TRANSPARENCY</span><b>${a.hasTransparency?'YES':'NO'}</b></div></div><div class="intel-color"><span>DOMINANT COLOR</span><i style="background:${a.dominantColor}"></i><code>${a.dominantColor.toUpperCase()}</code></div><div class="intel-focus">AUTO FOCAL POINT • ${Math.round((a.focalX||.5)*100)}% X / ${Math.round((a.focalY||.5)*100)}% Y</div>${a.vision?.enhanced?`<div class="vision-evidence"><div><span>VISION EVIDENCE</span><b>${esc(visionLabel(a))}</b></div><div><span>CONFIDENCE</span><b>${Math.round((a.vision.confidence||0)*100)}%</b></div><div><span>SUBJECT REGION</span><b>${a.vision.subjectBox?`${Math.round(a.vision.subjectBox.w*100)}% × ${Math.round(a.vision.subjectBox.h*100)}%`:'—'}</b></div></div>`:''}<button class="tiny" id="autoFocusBtn" style="margin-top:7px;width:100%">USE ${a.vision?.enhanced?'VISION':'AUTO'} FOCAL POINT</button>${a.vision?.enhanced?'':`<button class="tiny" id="visionSelectedBtn" style="margin-top:6px;width:100%">ENHANCE THIS PHOTO</button>`}`:`<div class="hint">LOCAL ANALYSIS UNAVAILABLE FOR THIS IMAGE.</div>`})()}</div><div class="object-actions"><button class="tiny" data-fit="never">NEVER CROP</button><button class="tiny" data-fit="smart">SMART CROP</button><button class="tiny" data-fit="free">FREE CROP</button></div><div class="object-actions" style="margin-top:7px"><button class="tiny" id="duplicateObj">DUPLICATE</button><button class="tiny" id="frontObj">BRING FRONT</button><button class="tiny" id="backObj">SEND BACK</button><button class="tiny" id="hideObj">${o.hidden?'SHOW':'HIDE'}</button><button class="tiny" id="lockObj">${o.locked?'UNLOCK':'LOCK'}</button><button class="tiny danger" id="deleteObj">DELETE</button></div></div>`;
return `<div class="section"><div class="section-head"><div class="section-title">SELECTED ${o.type.toUpperCase()}</div><div class="mini">${esc(o.name||o.type)}</div></div><div class="two" style="margin-top:8px"><div class="tool"><div class="tool-label">X</div><input class="field" data-num="x" value="${Math.round(o.x)}"></div><div class="tool"><div class="tool-label">Y</div><input class="field" data-num="y" value="${Math.round(o.y)}"></div></div><div class="two" style="margin-top:7px"><div class="tool"><div class="tool-label">WIDTH</div><input class="field" data-num="w" value="${Math.round(o.w)}"></div><div class="tool"><div class="tool-label">HEIGHT</div><input class="field" data-num="h" value="${Math.round(o.h)}"></div></div><div class="object-actions" style="margin-top:8px"><button class="tiny" id="duplicateObj">DUPLICATE</button><button class="tiny" id="frontObj">BRING FRONT</button><button class="tiny" id="backObj">SEND BACK</button><button class="tiny" id="hideObj">${o.hidden?'SHOW':'HIDE'}</button><button class="tiny" id="lockObj">${o.locked?'UNLOCK':'LOCK'}</button><button class="tiny danger" id="deleteObj">DELETE</button></div></div>`;}

function attachBaseEvents(){
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
$('#undoBtn').onclick=()=>{adaptEvent('action','undo');undo()};$('#redoBtn').onclick=()=>{adaptEvent('action','redo');redo()};$('#storageBtn').onclick=openStorageStatus;$('#shuffleBtn').onclick=()=>{candidates=rankedCandidates(project);openCompare(candidates)};$('#compareBtn').onclick=()=>{candidates=rankedCandidates(project);openCompare(candidates)};$('#copilotBtn').onclick=()=>{adaptEvent('action','creativeCopilot');openCreativeCopilot()};$('#smartCommandBtn').onclick=()=>{adaptEvent('action','smartCommand');openStudioCommand()};$('#projectBtn').onclick=()=>openProjectMenu();$('#helpBtn').onclick=openHelp;$('#adaptiveBtn').onclick=openAdaptiveSettings;$('#exportBtn').onclick=()=>{adaptEvent('action','export');openExport()};$('#focusBtn').onclick=()=>{adaptEvent('action','focus');toggleFocusMode()};
$('#zoomOutBtn').onclick=()=>setZoom(viewState.zoom-.15);$('#zoomInBtn').onclick=()=>setZoom(viewState.zoom+.15);$('#fitCanvasBtn').onclick=setCanvasFit;$('#zoom100Btn').onclick=()=>setZoom(1);
$$('[data-map]').forEach(b=>b.onclick=()=>{if(project.canvas.mapping===b.dataset.map)return;const before=beginMutation();project.canvas.mapping=b.dataset.map;commit(before,'BACKGROUND MAPPING UPDATED')});
const dz=$('#dropZone'),fi=$('#fileInput');$('#mobileAdd').onclick=()=>fi.click();dz?.addEventListener('click',()=>fi.click());dz?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fi.click()}});fi.addEventListener('change',e=>loadFiles(e.target.files));
['dragenter','dragover'].forEach(t=>dz?.addEventListener(t,e=>{e.preventDefault();dz.classList.add('drag')}));['dragleave','drop'].forEach(t=>dz?.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('drag')}));dz?.addEventListener('drop',async e=>{const files=Array.from(e.dataTransfer.files||[]);await loadFiles(files)});
$('#mobileLayout').onclick=()=>setMode('quick');$('#mobileAdjust').onclick=()=>setMode('precision');$('#mobileLayers').onclick=()=>$('#inspector')?.scrollIntoView({behavior:'smooth'});
renderAll();}
function attachLeftEvents(){
$$('[data-intent]').forEach(b=>b.onclick=()=>{const before=beginMutation();project.intent=b.dataset.intent;adaptEvent('intent',b.dataset.intent);queueSave();renderAll();history.commit(before,project)});
$$('[data-layout]').forEach(b=>b.onclick=()=>setLayout(b.dataset.layout));
$('#addBtn')?.addEventListener('click',()=>$('#fileInput').click());$('#moodAdd')?.addEventListener('click',()=>$('#fileInput').click());
$('#newBtn')?.addEventListener('click',newProject);$('#compareLeft')?.addEventListener('click',()=>{candidates=rankedCandidates(project);openCompare(candidates)});
$('#visionBtn')?.addEventListener('click',runVisionEnhancement);
$('#visionPrivacy')?.addEventListener('click',()=>openModal('ON-DEVICE VISION PRIVACY',`<div class="hint"><b>IMAGE INFERENCE STAYS ON THIS DEVICE.</b> THE OPTIONAL VISION RUNTIME IS LOADED FROM PUBLIC CDNS. ITS PROVIDER DOCUMENTATION STATES THAT INPUT DATA IS NOT SENT TO GOOGLE FOR INFERENCE, BUT MEDIA PIPE MAY SEND PERFORMANCE / USAGE METRICS TO GOOGLE.</div><div class="section"><div class="label">CURRENT ENGINE</div><div class="stat-grid"><div class="stat"><div class="stat-k">RUNTIME</div><div class="stat-v">MEDIAPIPE TASKS VISION</div></div><div class="stat"><div class="stat-k">INFERENCE</div><div class="stat-v">ON DEVICE</div></div></div></div>`));
$('#moodArrange')?.addEventListener('click',smartArrangeMood);$('#moodText')?.addEventListener('click',()=>addObject(createTextObject('MOOD NOTE',{x:project.canvas.w*.18,y:project.canvas.h*.12,w:project.canvas.w*.36,h:90},nextZ())));$('#moodSwatch')?.addEventListener('click',()=>addObject(createSwatchObject('#38bdf8',{x:project.canvas.w*.62,y:project.canvas.h*.15,w:150,h:150},nextZ())));
$('#addText')?.addEventListener('click',()=>addObject(createTextObject('TEXT NOTE',{x:120,y:120,w:560,h:90},nextZ())));$('#addSwatch')?.addEventListener('click',()=>addObject(createSwatchObject('#38bdf8',{x:120,y:260,w:180,h:180},nextZ())));$('#addDivider')?.addEventListener('click',()=>addObject(createDividerObject({x:120,y:480,w:600,h:8},nextZ())));$('#addFrame')?.addEventListener('click',()=>addObject(createFrameObject({x:120,y:560,w:720,h:420},nextZ())));
$('#presetSelect')?.addEventListener('change',e=>{if(e.target.value!=='custom')setCanvasPreset(e.target.value);});$('#applyCanvas')?.addEventListener('click',applyCustomCanvas);
bindFrameRange('marginRange','outerMargin','OUTER MARGIN UPDATED');bindFrameRange('gapRange','innerGap','INNER GAP UPDATED');bindFrameRange('radiusRange','radius','CORNER RADIUS UPDATED');
$$('[data-protection]').forEach(b=>b.onclick=()=>{if(project.imageProtection===b.dataset.protection)return;const before=beginMutation();project.imageProtection=b.dataset.protection;project.objects.filter(o=>o.type==='image'&&!o.locked).forEach(o=>{o.fitMode=b.dataset.protection;if(b.dataset.protection==='never')o.scale=1});commit(before,'IMAGE PROTECTION UPDATED')});
$('#centerBtn')?.addEventListener('click',()=>centerSelected());$('#resetBtn')?.addEventListener('click',()=>resetSelected());[['leftBtn',-1,0,1],['upBtn',0,-1,1],['rightBtn',1,0,1],['downBtn',0,1,1]].forEach(([id,x,y,amt])=>$('#'+id)?.addEventListener('click',()=>nudge(x*amt,y*amt)));
$$('[data-align]').forEach(b=>b.onclick=()=>alignSelected(b.dataset.align));$$('[data-distribute]').forEach(b=>b.onclick=()=>distribute(b.dataset.distribute));$$('[data-author-fix]').forEach(b=>b.onclick=()=>applyAuthoringMutation(b.dataset.authorFix));$$('.authoring-review-btn').forEach(b=>b.onclick=openAuthoringReview);}
function attachInspectorEvents(){
$$('[data-select]').forEach(b=>b.onclick=()=>selectObject(b.dataset.select));$$('[data-quality-fit]').forEach(b=>b.onclick=()=>{selectObject(b.dataset.qualityFit);fitSelected()});$('#qualityAll')?.addEventListener('click',()=>runQuality(true));$$('[data-author-fix]').forEach(b=>b.onclick=()=>applyAuthoringMutation(b.dataset.authorFix));$$('.authoring-review-btn').forEach(b=>b.onclick=openAuthoringReview);
$$('[data-num]').forEach(inp=>inp.addEventListener('change',()=>{const o=selected();if(!o||o.locked)return;const before=beginMutation();let v=Number(inp.value);if(inp.dataset.num==='scale')v=Math.max(.1,Math.min(5,v));if(inp.dataset.num==='scale'&&o.type==='image'&&((o.fitMode||project.imageProtection)==='never'||project.imageProtection==='never'))v=Math.min(1,v);if(['w','h'].includes(inp.dataset.num))v=Math.max(20,Math.min(MAX_CANVAS,v));o[inp.dataset.num]=v;commit(before,'OBJECT UPDATED')}));
$$('[data-focal]').forEach(inp=>inp.addEventListener('change',()=>{const o=selected();if(!o||o.locked)return;const before=beginMutation();o[inp.dataset.focal==='x'?'focalX':'focalY']=+inp.value;o.focalAuto=false;commit(before,'FOCAL POINT UPDATED');}));
$$('[data-fit]').forEach(b=>b.onclick=()=>{const o=selected();if(!o||o.type!=='image'||o.locked)return;const before=beginMutation();o.fitMode=b.dataset.fit;if(o.fitMode==='never')o.scale=1;commit(before,'IMAGE PROTECTION UPDATED')});
$('#visionSelectedBtn')?.addEventListener('click',()=>{const o=selected();if(o)runVisionEnhancement([o.id])});$('#duplicateObj')?.addEventListener('click',duplicateSelected);$('#frontObj')?.addEventListener('click',()=>changeZ(1));$('#backObj')?.addEventListener('click',()=>changeZ(-1));$('#hideObj')?.addEventListener('click',toggleHidden);$('#lockObj')?.addEventListener('click',toggleLock);$('#deleteObj')?.addEventListener('click',deleteSelected);$('#autoFocusBtn')?.addEventListener('click',()=>{const o=selected(),a=getAssetAnalysis(runtimeAssets,o);if(!o||!a||o.locked)return;const before=beginMutation();const f=focalPointFromAnalysis(a);o.focalX=f.x;o.focalY=f.y;o.focalAuto=true;commit(before,'AUTO FOCAL POINT APPLIED')});}

function syncModeTabs(){const current=project.mode;$$('[data-mode]').forEach(b=>{const active=b.dataset.mode===current;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});}
function syncMappingButtons(){const current=project.canvas.mapping;$$('[data-map]').forEach(b=>{const active=b.dataset.map===current;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');});}
function syncPresetSelect(){const select=$('#presetSelect');if(select)select.value=['etsy','portrait','wide','square','custom'].includes(project.canvas.preset)?project.canvas.preset:'custom';}
function renderAll(){renderLeft();renderInspector();renderCanvas();sizePreview();syncMeta();syncModeTabs();syncMappingButtons();syncPresetSelect();renderExperienceChrome();}
function renderCanvas(){const c=$('#studioCanvas');if(!c)return;c.width=project.canvas.w;c.height=project.canvas.h;renderProject(c.getContext('2d',{alpha:true}),project,runtimeAssets,{preview:true,selection:true,guides:viewState.guides});}
function renderInspectorOnly(){renderInspector();renderExperienceChrome();}
function sizePreview(){const c=$('#studioCanvas'),vp=$('#canvasViewport'),wrap=$('#canvasWrap');if(!c||!vp)return;const maxW=Math.max(100,vp.clientWidth-32),maxH=Math.max(100,vp.clientHeight-32);const ratio=project.canvas.w/project.canvas.h;let w=maxW,h=w/ratio;if(h>maxH){h=maxH;w=h*ratio}if(viewState.fit){wrap.style.width=`${Math.max(1,w)}px`;wrap.style.height=`${Math.max(1,h)}px`;c.style.maxWidth='100%';c.style.maxHeight='100%';}else{w=project.canvas.w*viewState.zoom;h=project.canvas.h*viewState.zoom;wrap.style.width=`${Math.max(1,w)}px`;wrap.style.height=`${Math.max(1,h)}px`;c.style.maxWidth='none';c.style.maxHeight='none';}c.style.width='100%';c.style.height='100%';}
function setZoom(z){viewState.fit=false;viewState.zoom=Math.max(.25,Math.min(3,Number(z)||1));if(Math.abs(viewState.zoom-1)<.001)viewState.zoom=1;sizePreview();renderExperienceChrome();}
function setCanvasFit(){viewState.fit=true;viewState.zoom=1;sizePreview();renderExperienceChrome();}
function toggleFocusMode(){viewState.focusMode=!viewState.focusMode;document.querySelector('.app')?.classList.toggle('focus-mode',viewState.focusMode);if(viewState.focusMode)toast('FOCUS MODE • PRESS F OR ESC TO EXIT','success');else toast('FULL STUDIO CONTROLS RESTORED');}
function experienceAction(id){viewState.lastAction=id;adaptEvent('action',id);switch(id){case'smartCommand':openStudioCommand();break;case'addPhotos':$('#fileInput')?.click();break;case'compare':candidates=rankedCandidates(project);openCompare(candidates);break;case'authorReview':openAuthoringReview();break;case'enhanceVision':runVisionEnhancement(project.selectedId?[project.selectedId]:null);break;case'fit':fitSelected();break;case'smartCrop':{const o=selected();if(!o||o.type!=='image'||o.locked)break;const before=beginMutation();o.fitMode='smart';commit(before,'SMART CROP ENABLED');break;}case'center':centerSelected();break;case'duplicate':duplicateSelected();break;case'front':changeZ(1);break;case'back':changeZ(-1);break;case'hide':toggleHidden();break;case'lock':toggleLock();break;case'delete':deleteSelected();break;case'focus':toggleFocusMode();break;case'fitCanvas':setCanvasFit();break;case'zoom100':setZoom(1);break;}}
function renderExperienceChrome(){
  let next=getNextAction(project,runtimeAssets);
  const context=getContext(project,runtimeAssets);
  if(next.id==='enhanceVision'&&!visionCapability().supported) next={id:'authorReview',title:'REFINE THE COMPOSITION',message:'LOCAL VISION IS UNAVAILABLE HERE; THE STUDIO CAN STILL REVIEW THE LAYOUT.'};
  const ctxActions=getContextActions(project,runtimeAssets).filter(id=>id!=='enhanceVision'||visionCapability().supported);
  const allowedNext=new Set(['smartCommand','compare','authorReview','enhanceVision','fit','smartCrop','center']);
  const adaptiveCandidates=ctxActions.filter(id=>allowedNext.has(id)).map((id,i)=>({id,priority:(id===next.id?1:0)+Math.max(0,(ctxActions.length-i)/100),title:actionMeta(id).label,message:actionMeta(id).desc}));
  if(context.hasImages&&!context.warningCount&&adaptiveCandidates.length){
    const chosen=chooseNextAction(next,adaptiveCandidates,adaptiveProfile);
    if(chosen&&ctxActions.includes(chosen.id)) next={id:chosen.id,title:chosen.title,message:chosen.message};
  }
  const meta=actionMeta(next.id);
  const t=$('#nextActionTitle'),m=$('#nextActionMessage'),r=$('#zoomReadout'),nb=$('#nextActionButton');
  if(t)t.textContent=next.title||meta.label;
  if(m)m.textContent=next.message||meta.desc;
  if(r)r.textContent=viewState.fit?'FIT':`${Math.round(viewState.zoom*100)}%`;
  if(nb){nb.setAttribute('aria-label',next.title||meta.label);nb.onclick=()=>experienceAction(next.id);}
  const tb=$('#contextToolbar');
  if(tb){
    let actions=ctxActions;
    actions=rankAdaptiveActions(actions,adaptiveProfile,id=>id,(id,i)=>id===next.id?.05:0);
    tb.innerHTML=actions.slice(0,6).map(id=>{const a=actionMeta(id);let label=a.label;if(id==='hide'&&selected()?.hidden)label='SHOW OBJECT';if(id==='lock'&&selected()?.locked)label='UNLOCK OBJECT';return `<button class="tiny context-action ${id===next.id?'recommended':''}" data-experience-action="${id}">${label}</button>`}).join('');
    $$('[data-experience-action]').forEach(b=>b.onclick=()=>experienceAction(b.dataset.experienceAction));
  }
  const as=$('#adaptiveStatus');if(as)as.textContent=`ADAPTIVE • ${adaptiveProfile.enabled?'ON':'OFF'}`;
  const fb=$('#focusBtn');if(fb){fb.textContent=viewState.focusMode?'EXIT FOCUS':'FOCUS';fb.setAttribute('aria-pressed',String(viewState.focusMode));}
  document.querySelector('.app')?.classList.toggle('focus-mode',viewState.focusMode);
}

function syncMeta(){const cl=$('#canvasLabel');if(cl)cl.textContent=`${project.canvas.w} × ${project.canvas.h} PX`;const st=$('#workspaceStatus');if(st)st.textContent=imageObjects().length?`${layoutLabel(project.layout.type)} • ${project.mode.toUpperCase()}`:'AWAITING ASSETS';const empty=$('#canvasEmpty');empty?.classList.toggle('hidden',imageObjects().length>0||project.objects.some(o=>o.type!=='image'));}
function setMode(mode){const before=beginMutation();project.mode=mode;if(mode==='mood'&&project.layout.type==='balanced')project.layout.type='mosaic';adaptEvent('mode',mode);history.commit(before,project);queueSave();renderAll();}
function smartArrangeMood(){if(!imageObjects().length){toast('ADD PHOTOS BEFORE SMART ARRANGE','error');return}const before=beginMutation();adaptEvent('action','smartArrangeMood');const candidates=rankAdaptiveLayouts(generateCandidates({...project,intent:'mood'},runtimeAssets),adaptiveProfile,c=>c.type,c=>Number(c.score||0));const best=candidates[0];if(!best){toast('NO MOOD BOARD ARRANGEMENT AVAILABLE','error');return}const map=new Map(best.objects.map(o=>[o.id,o]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??o.scale??1}:o});project.layout.type=best.type;project.mode='mood';history.commit(before,project);queueSave();renderAll();toast(`${layoutLabel(best.type)} SMART ARRANGEMENT APPLIED`,'success')}

function setLayout(type){if(!imageObjects().length){toast('ADD PHOTOS BEFORE CHOOSING A LAYOUT','error');return}const before=beginMutation();const imgs=imageObjects();const arranged=generateLayout(type,project,runtimeAssets,imgs.map(o=>o.id));const map=new Map(arranged.map(o=>[o.id,o]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,x:n.x,y:n.y,w:n.w,h:n.h,rotation:n.rotation||0,scale:n.scale??o.scale??1}:o});project.layout.type=type;project.updatedAt=Date.now();adaptEvent('layout',type);history.commit(before,project);queueSave();renderAll();toast(`${layoutLabel(type)} APPLIED`,'success')}
function setCanvasPreset(id){const presets={etsy:[2000,2000],portrait:[1080,1920],wide:[1920,1080],square:[1080,1080]};const p=presets[id];if(!p)return;const before=beginMutation();project.canvas.preset=id;project.canvas.w=p[0];project.canvas.h=p[1];const currentType=project.layout.type;const imgs=imageObjects();if(imgs.length){const arranged=generateLayout(currentType,project,runtimeAssets,imgs.map(x=>x.id));const map=new Map(arranged.map(x=>[x.id,x]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});}history.commit(before,project);queueSave();renderAll();}
function applyCustomCanvas(){const w=Number($('#cw')?.value),h=Number($('#ch')?.value);if(!w||!h||w<64||h<64||w>MAX_CANVAS||h>MAX_CANVAS){toast(`CANVAS MUST BE BETWEEN 64 AND ${MAX_CANVAS} PX`,'error');return}if(w*h>MAX_MEGAPIXELS*1e6){toast(`CANVAS EXCEEDS THE SAFE ${MAX_MEGAPIXELS} MP BROWSER EXPORT BOUNDARY`,'error',3800);return}const before=beginMutation();project.canvas.preset='custom';project.canvas.w=w;project.canvas.h=h;if(imageObjects().length){const arranged=generateLayout(project.layout.type,project,runtimeAssets,imageObjects().map(x=>x.id));const map=new Map(arranged.map(x=>[x.id,x]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});}commit(before,'CUSTOM CANVAS APPLIED');}
function bindFrameRange(id,key,message){const input=$('#'+id);if(!input)return;let before=null;const start=()=>{if(!before)before=beginMutation()};const preview=()=>{project.frame[key]=+input.value;if(['outerMargin','innerGap'].includes(key)&&imageObjects().length){const ids=imageObjects().map(x=>x.id);const arranged=generateLayout(project.layout.type,project,runtimeAssets,ids);const map=new Map(arranged.map(o=>[o.id,o]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});}const value=$('#'+(key==='outerMargin'?'marginValue':key==='innerGap'?'gapValue':'radiusValue'));if(value)value.textContent=input.value+' PX';renderCanvas();syncMeta()};input.addEventListener('pointerdown',start);input.addEventListener('focus',start);input.addEventListener('keydown',e=>{if(e.key.startsWith('Arrow')||e.key==='Home'||e.key==='End')start();});input.addEventListener('input',preview);input.addEventListener('change',()=>{if(before)commit(before,message);before=null;});}

function setFrameField(key,value,render=true){const before=beginMutation();project.frame[key]=value;if(key==='innerGap'&&imageObjects().length){const arranged=generateLayout(project.layout.type,project,runtimeAssets,imageObjects().map(x=>x.id));const map=new Map(arranged.map(x=>[x.id,x]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});}history.commit(before,project);queueSave();if(render)renderAll();else{renderCanvas();syncMeta();}}
function nextZ(){return Math.max(-1,...project.objects.map(o=>o.z||0))+1}
function selectObject(id){project.selectedId=id;renderAll()}
function centerSelected(){const o=selected();if(!o||o.locked)return;const before=beginMutation();o.x=(project.canvas.w-o.w)/2;o.y=(project.canvas.h-o.h)/2;commit(before,'OBJECT CENTERED')}
function resetSelected(){const o=selected();if(!o||o.locked)return;const before=beginMutation();o.rotation=0;o.scale=1;if(o.type==='image'){const a=getAssetAnalysis(runtimeAssets,o);const f=focalPointFromAnalysis(a);o.focalX=f.x;o.focalY=f.y;o.focalAuto=true;o.fitMode='never';}commit(before,'OBJECT RESET')}
function nudge(dx,dy){const o=selected();if(!o||o.locked)return;const before=beginMutation();o.x+=dx;o.y+=dy;commit(before,`${dx||dy>0?'NUDGE':''}`.trim()||'NUDGED')}
function fitSelected(){const o=selected();if(!o||o.type!=='image'||o.locked)return;const before=beginMutation();o.fitMode='never';const a=getAssetAnalysis(runtimeAssets,o);const f=focalPointFromAnalysis(a);o.focalX=f.x;o.focalY=f.y;o.focalAuto=true;o.scale=1;commit(before,'FULL PHOTO VISIBLE')}
function duplicateSelected(){const o=selected();if(!o)return;const before=beginMutation();const c=JSON.parse(JSON.stringify(o));c.id=uid(o.type);c.name=(o.name||o.type)+' COPY';c.x+=24;c.y+=24;c.z=nextZ();project.objects.push(c);project.selectedId=c.id;commit(before,'OBJECT DUPLICATED')}
function changeZ(dir){const o=selected();if(!o||o.locked){if(o?.locked)toast('OBJECT IS LOCKED');return;}const before=beginMutation();const zs=project.objects.map(x=>x.z||0);o.z=dir>0?Math.max(...zs,0)+1:Math.min(...zs,0)-1;commit(before,dir>0?'BROUGHT TO FRONT':'SENT BACK')}
function toggleHidden(){const o=selected();if(!o)return;const before=beginMutation();o.hidden=!o.hidden;commit(before,o.hidden?'OBJECT HIDDEN':'OBJECT SHOWN')}
function toggleLock(){const o=selected();if(!o)return;const before=beginMutation();o.locked=!o.locked;commit(before,o.locked?'OBJECT LOCKED':'OBJECT UNLOCKED')}
function deleteSelected(){const o=selected();if(!o)return;if(o.locked){toast('OBJECT IS LOCKED');return;}const before=beginMutation();project.objects=project.objects.filter(x=>x.id!==o.id);project.selectedId=null;commit(before,'OBJECT DELETED')}
function alignSelected(which){const o=selected();if(!o||o.locked)return;const before=beginMutation();if(which==='left')o.x=0;if(which==='right')o.x=project.canvas.w-o.w;if(which==='center')o.x=(project.canvas.w-o.w)/2;if(which==='top')o.y=0;if(which==='bottom')o.y=project.canvas.h-o.h;if(which==='middle')o.y=(project.canvas.h-o.h)/2;commit(before,'OBJECT ALIGNED')}
function distribute(axis){const objs=project.objects.filter(o=>!o.hidden&&!o.locked&&o.type==='image').sort((a,b)=>(axis==='x'?a.x:a.y)-(axis==='x'?b.x:b.y));if(objs.length<3){toast('NEED AT LEAST 3 UNLOCKED IMAGES','error');return}const before=beginMutation();const key=axis==='x'?'x':'y',size=axis==='x'?'w':'h';const start=objs[0][key],end=objs.at(-1)[key]+objs.at(-1)[size],total=objs.reduce((s,o)=>s+o[size],0),gap=(end-start-total)/(objs.length-1);if(!Number.isFinite(gap)||gap<0){toast('NOT ENOUGH SPACE FOR EVEN DISTRIBUTION','error');return}let pos=start;for(const o of objs){o[key]=pos;pos+=o[size]+gap;}commit(before,`DISTRIBUTED ${axis.toUpperCase()}`)}

async function loadFiles(files){const incoming=Array.from(files||[]).filter(f=>f?.type?.startsWith('image/'));const picker=$('#fileInput');if(picker)picker.value='';if(!incoming.length){toast('NO SUPPORTED IMAGE FILES FOUND','error');return}const remaining=MAX_ASSETS-imageObjects().length;if(remaining<=0){toast(`MAXIMUM ${MAX_ASSETS} PHOTOS LOADED`,'error');return}const selectedFiles=incoming.slice(0,remaining);if(incoming.length>remaining)toast(`ONLY ${remaining} MORE IMAGE${remaining===1?'':'S'} CAN BE ADDED`,'');const before=beginMutation();let loaded=0;for(const file of selectedFiles){try{const runtime=await decodeAsset(file);runtime.persisted=false;pendingAssetIds.add(runtime.id);runtimeAssets.set(runtime.id,runtime);const rect={x:0,y:0,w:300,h:300};const o=createImageObject(runtime,rect,loaded);o.fitMode=project.imageProtection;if(runtime.analysis){const f=focalPointFromAnalysis(runtime.analysis);o.focalX=f.x;o.focalY=f.y;o.focalAuto=true;}project.objects.push(o);loaded++;}catch(e){console.warn(e);toast(`COULD NOT LOAD ${file.name.toUpperCase()}`,'error')}}if(loaded){project.selectedId=project.objects.find(o=>o.type==='image')?.id||null;project.layout.type=project.mode==='mood'?'mosaic':'balanced';const imgs=imageObjects();const arranged=generateLayout(project.layout.type,project,runtimeAssets,imgs.map(o=>o.id));const map=new Map(arranged.map(o=>[o.id,o]));project.objects=project.objects.map(o=>map.get(o.id)||o);history.commit(before,project);queueSave();renderAll();toast(`${loaded} IMAGE${loaded>1?'S':''} ADDED LOCALLY`,'success');}}
async function decodeAsset(file){
  if(!file?.size)throw new Error('EMPTY_IMAGE_FILE');
  const meta=await readImageSize(file);
  if(!meta.width||!meta.height)throw new Error('INVALID_IMAGE_DIMENSIONS');
  const workingPixels=8000000;
  let bitmap;
  try{if('createImageBitmap' in window){const px=meta.width*meta.height; if(px>workingPixels){const ratio=Math.sqrt(workingPixels/px),rw=Math.max(1,Math.round(meta.width*ratio)),rh=Math.max(1,Math.round(meta.height*ratio)); try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image',resizeWidth:rw,resizeHeight:rh,resizeQuality:'high'});}catch{bitmap=await createImageBitmap(file,{imageOrientation:'from-image',resizeWidth:rw,resizeHeight:rh});}} else bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}).catch(()=>createImageBitmap(file));}}catch{}
  if(!bitmap){const url=URL.createObjectURL(file);bitmap=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{try{const px=meta.width*meta.height;const ratio=px>workingPixels?Math.sqrt(workingPixels/px):1;const rw=Math.max(1,Math.round(meta.width*ratio)),rh=Math.max(1,Math.round(meta.height*ratio));const c=document.createElement('canvas');c.width=rw;c.height=rh;const cctx=c.getContext('2d');cctx.drawImage(im,0,0,rw,rh);if('createImageBitmap' in window)createImageBitmap(c).then(resolve,reject);else resolve(c);}catch(err){reject(err)}};im.onerror=()=>reject(new Error('IMAGE_DECODE_FAILED'));im.src=url;});URL.revokeObjectURL(url)}const id=uid('asset');const thumbUrl=await thumbnail(bitmap);let analysis=null;try{analysis=await analyzeBitmap(bitmap)}catch(e){console.warn('LOCAL IMAGE ANALYSIS SKIPPED',e)}return{id,name:file.name,type:file.type,blob:file,width:meta.width,height:meta.height,bytes:file.size,workingWidth:bitmap.width,workingHeight:bitmap.height,bitmap,thumbUrl,analysis,persisted:false};}
async function readImageSize(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const im=new Image();im.onload=()=>{const out={width:im.naturalWidth,height:im.naturalHeight};URL.revokeObjectURL(url);im.src='';resolve(out)};im.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('IMAGE_DECODE_FAILED'))};im.src=url;});}
async function thumbnail(bitmap){const max=160,s=Math.min(max/bitmap.width,max/bitmap.height,1),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*s));c.height=Math.max(1,Math.round(bitmap.height*s));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));return URL.createObjectURL(b)}

function fitPreviewPointer(e){const c=$('#studioCanvas'),r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)}}
function hitTest(x,y){const objs=[...project.objects].filter(o=>!o.hidden).sort((a,b)=>(b.z||0)-(a.z||0));for(const o of objs){if(pointInObject(x,y,o))return o}return null}
function pointInObject(x,y,o){const cx=o.x+o.w/2,cy=o.y+o.h/2,rad=-(o.rotation||0)*Math.PI/180,dx=x-cx,dy=y-cy,rx=dx*Math.cos(rad)-dy*Math.sin(rad),ry=dx*Math.sin(rad)+dy*Math.cos(rad);return rx>=-o.w/2&&rx<=o.w/2&&ry>=-o.h/2&&ry<=o.h/2}
function localPoint(x,y,o){const cx=o.x+o.w/2,cy=o.y+o.h/2,rad=-(o.rotation||0)*Math.PI/180,dx=x-cx,dy=y-cy;return{x:dx*Math.cos(rad)-dy*Math.sin(rad)+o.w/2,y:dx*Math.sin(rad)+dy*Math.cos(rad)+o.h/2};}
function handleAt(x,y,o){const p=localPoint(x,y,o),s=Math.max(26,Math.min(44,Math.min(project.canvas.w,project.canvas.h)/35));if(Math.hypot(p.x-o.w,p.y)<s)return 'rotate';if(Math.hypot(p.x-o.w,p.y-o.h)<s)return 'resize';return null;}
function attachCanvasHandlers(){const c=$('#studioCanvas');if(!c||c.dataset.bound==='1')return;c.dataset.bound='1';c.addEventListener('pointerdown',e=>{const p=fitPreviewPointer(e);const sel=selected();let mode=sel&&!sel.locked?handleAt(p.x,p.y,sel):null;const o=mode?sel:hitTest(p.x,p.y);if(!o)return;if(o.locked){project.selectedId=o.id;renderAll();return}project.selectedId=o.id;const before=beginMutation();dragging={id:o.id,mode:mode||'move',before,startX:p.x,startY:p.y,ox:o.x,oy:o.y,ow:o.w,oh:o.h,or:o.rotation||0};c.setPointerCapture?.(e.pointerId);renderAll()});c.addEventListener('pointermove',e=>{if(!dragging)return;const o=project.objects.find(x=>x.id===dragging.id);if(!o||o.locked)return;const p=fitPreviewPointer(e),dx=p.x-dragging.startX,dy=p.y-dragging.startY;if(dragging.mode==='move'){const snapped=snapPosition(project,o,dragging.ox+dx,dragging.oy+dy,e.shiftKey?24:12);o.x=snapped.x;o.y=snapped.y;viewState.guides=snapped.guides;}else if(dragging.mode==='resize'){const lp=localPoint(p.x,p.y,o);o.w=Math.max(20,lp.x);o.h=Math.max(20,lp.y);viewState.guides=[];}else{const cx=dragging.ox+dragging.ow/2,cy=dragging.oy+dragging.oh/2;const a=Math.atan2(p.y-cy,p.x-cx);const base=Math.atan2(-dragging.oh/2,dragging.ow/2);o.rotation=(a-base)*180/Math.PI;viewState.guides=[];}queueSave();renderCanvas();renderInspectorOnly()});const end=()=>{if(!dragging)return;const d=dragging,o=project.objects.find(x=>x.id===d.id);dragging=null;viewState.guides=[];if(o){history.commit(d.before,project);queueSave();renderAll()}};c.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();setZoom(viewState.zoom+(e.deltaY<0?.12:-.12))},{passive:false});c.addEventListener('dblclick',e=>{const p=fitPreviewPointer(e),o=hitTest(p.x,p.y);if(!o)return;selectObject(o.id);if(o.type==='text')editTextObject(o);});c.addEventListener('pointerup',end);c.addEventListener('pointercancel',end)}

function undo(){const p=history.undo(project);if(!p){toast('NOTHING TO UNDO');return}project=p;queueSave();renderAll();toast('UNDO COMPLETE')}
function redo(){const p=history.redo(project);if(!p){toast('NOTHING TO REDO');return}project=p;queueSave();renderAll();toast('REDO COMPLETE')}

async function saveProjectFile(){try{const refs=new Set(project.objects.map(o=>o.assetId).filter(Boolean));const assets=[...runtimeAssets.values()].filter(a=>refs.has(a.id));const blob=await packProject(project,assets);const result=await saveLocalBlob(blob,`${safeName(project.name)}.localcollage`);if(result==='aborted')return;toast(result==='picker'?'LOCAL PROJECT SAVED TO DEVICE':'LOCAL PROJECT FILE DOWNLOADED','success');}catch(e){console.error(e);toast((e?.message==='EXPORT_CANVAS_TOO_LARGE'||e?.message==='LOCALCOLLAGE_FILE_TOO_LARGE')?'PROJECT IS TOO LARGE TO PACKAGE SAFELY':'PROJECT SAVE FAILED','error')}}
async function openProjectPicker(){const result=await openLocalCollage();if(result.status==='file'){await openProjectFile(result.file);return;}if(result.status==='fallback')$('#projectInput')?.click();}
async function openProjectFile(file){
  let nextAssets=new Map();
  try{
    const unpack=await unpackProject(file);if(!unpack?.project)throw new Error('INVALID_LOCALCOLLAGE_PROJECT');
    const nextProject=sanitizeProject(unpack.project);
    for(const a of unpack.assets){
      const rt=await decodeAsset(a.blob);rt.id=a.id;rt.name=a.name;rt.persisted=false;
      const obj=nextProject.objects.find(o=>o.assetId===a.id);
      if(obj?.vision)rt.analysis={...(rt.analysis||{}),vision:obj.vision};
      nextAssets.set(a.id,rt);
    }
    nextProject.objects=nextProject.objects.filter(o=>o.type!=='image'||nextAssets.has(o.assetId));
    runtimeAssets.forEach(a=>{a.bitmap?.close?.();if(a.thumbUrl)URL.revokeObjectURL(a.thumbUrl)});runtimeAssets.clear();
    for(const [id,rt] of nextAssets)runtimeAssets.set(id,rt);
    pendingAssetIds.clear();nextAssets.forEach((_,id)=>pendingAssetIds.add(id));
    project=nextProject;ensureIntelligenceState();history.seed(project);queueSave();renderAll();toast('PROJECT RESTORED','success');
  }catch(e){
    nextAssets.forEach(a=>{a.bitmap?.close?.();if(a.thumbUrl)URL.revokeObjectURL(a.thumbUrl)});
    console.error(e);toast(e.message==='LOCALCOLLAGE_FILE_TOO_LARGE'?'PROJECT FILE IS TOO LARGE FOR THIS BROWSER':e.message==='TOO_MANY_ASSETS'?'PROJECT CONTAINS TOO MANY ASSETS':'INVALID LOCALCOLLAGE PROJECT','error')
  }
}

function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
function safeName(s){return String(s||'collage').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'collage'}

async function openStorageStatus(){const s=await refreshStorageSnapshot();openModal('LOCAL STORAGE HEALTH',`<div class="stat-grid"><div class="stat"><div class="stat-k">USAGE</div><div class="stat-v">${esc(formatStorageBytes(s.usage))}</div></div><div class="stat"><div class="stat-k">QUOTA</div><div class="stat-v">${esc(formatStorageBytes(s.quota))}</div></div><div class="stat"><div class="stat-k">STATUS</div><div class="stat-v">${s.persistent?'PROTECTED':'BEST EFFORT'}</div></div><div class="stat"><div class="stat-k">DATABASE</div><div class="stat-v">INDEXEDDB</div></div></div><div class="section"><div class="hint"><b>LOCAL ONLY:</b> AUTOSAVED PROJECTS AND SOURCE BLOBS ARE KEPT IN THIS BROWSER. THE BROWSER MAY EVICT BEST-EFFORT STORAGE UNDER STORAGE PRESSURE; PERSISTENT STORAGE CAN REDUCE THAT RISK WHEN GRANTED.</div><button class="primary" id="protectStorageNow">PROTECT LOCAL STORAGE</button></div>`);$('#protectStorageNow').onclick=async()=>{const ok=await requestPersistentStorage();await refreshStorageSnapshot();closeModal();toast(ok?'LOCAL STORAGE PROTECTION ENABLED':'BROWSER DID NOT GRANT PERSISTENT STORAGE',ok?'success':'error',3300)}}

function openProjectMenu(){refreshStorageSnapshot().then(()=>{});openModal('PROJECTS',`<div class="modal-grid"><button class="primary" id="saveProj">SAVE PROJECT</button><button class="secondary" id="openProj">OPEN PROJECT</button><button class="secondary" id="newProj">NEW PROJECT</button><button class="danger" id="clearLocal">CLEAR LOCAL PROJECTS</button></div><div class="section" style="margin-top:10px"><div class="label"><span>LOCAL STORAGE</span><span class="readout" id="storageHealthModal">${esc(storageSnapshot.label||'CHECKING')}</span></div><div class="hint"><b>LOCAL AUTOSAVE:</b> PROJECT DATA + IMAGE BLOBS STAY IN THIS BROWSER. STORAGE IS BEST-EFFORT BY DEFAULT; YOU CAN ASK THE BROWSER TO PROTECT IT WHEN SUPPORTED.</div><button class="secondary" id="protectStorage" style="margin-top:7px;width:100%">PROTECT LOCAL PROJECT STORAGE</button></div><div class="hint" style="margin-top:10px"><b>FILE SAVE:</b> SUPPORTED BROWSERS CAN SAVE DIRECTLY TO A LOCAL FILE; OTHER BROWSERS USE A DOWNLOAD FALLBACK.</div><div class="section" style="margin-top:10px"><div class="label"><span>ADAPTIVE STUDIO</span><span class="readout">${adaptiveProfile.enabled?'ON':'OFF'}</span></div><div class="hint"><b>LOCAL ONLY.</b> THE STUDIO USES SMALL AGGREGATE COUNTS OF ACTIONS YOU CHOOSE TO PRIORITIZE FAMILIAR TOOLS. NO PROMPTS, FILENAMES, IMAGES OR BROWSING DATA ARE SAVED.</div><button class="secondary" id="adaptiveSettings" style="margin-top:7px;width:100%">MANAGE ADAPTIVE STUDIO</button></div>`);$('#saveProj').onclick=()=>{closeModal();saveProjectFile()};$('#openProj').onclick=async()=>{closeModal();await openProjectPicker()};$('#newProj').onclick=()=>{closeModal();newProject()};$('#clearLocal').onclick=async()=>{if(confirm('Clear locally saved projects on this device?')){await clearProjects();toast('LOCAL PROJECT STORAGE CLEARED','success');await refreshStorageSnapshot()}};$('#protectStorage').onclick=async()=>{const ok=await requestPersistentStorage();await refreshStorageSnapshot();toast(ok?'LOCAL STORAGE PROTECTION ENABLED':'BROWSER DID NOT GRANT PERSISTENT STORAGE',''+(ok?'success':'error'),3300)};$('#adaptiveSettings').onclick=()=>openAdaptiveSettings();}
function openAdaptiveSettings(){const s=adaptiveSummary(adaptiveProfile);openModal('ADAPTIVE STUDIO',`<div class="stat-grid"><div class="stat"><div class="stat-k">STATUS</div><div class="stat-v">${s.enabled?'ON':'OFF'}</div></div><div class="stat"><div class="stat-k">LOCAL EVENTS</div><div class="stat-v">${s.events}</div></div></div><div class="section"><div class="label">${s.topLayout?`MOST USED LAYOUT • ${esc(s.topLayout.key.toUpperCase())}`:'NOT ENOUGH HISTORY YET'}</div><div class="hint">THE STUDIO ONLY REMEMBERS SMALL AGGREGATE COUNTS ON THIS DEVICE. IT DOES NOT STORE YOUR QUESTIONS, IMAGE CONTENT, FILE NAMES OR REMOTE ANALYTICS.</div></div><div class="two"><button class="secondary" id="adaptiveToggle">${s.enabled?'TURN OFF LEARNING':'TURN ON LEARNING'}</button><button class="danger" id="adaptiveReset">RESET LOCAL ADAPTATION</button></div><div class="section"><button class="primary" id="adaptiveDone">DONE</button></div>`);$('#adaptiveToggle').onclick=()=>{adaptiveProfile=setAdaptiveEnabled(adaptiveProfile,!adaptiveProfile.enabled);closeModal();renderAll();toast(adaptiveProfile.enabled?'ADAPTIVE STUDIO ENABLED':'ADAPTIVE STUDIO DISABLED','success')};$('#adaptiveReset').onclick=()=>{if(!confirm('Reset only the local adaptive preferences on this device?'))return;const wasEnabled=adaptiveProfile.enabled;adaptiveProfile=resetAdaptiveProfile();adaptiveProfile=setAdaptiveEnabled(adaptiveProfile,wasEnabled);closeModal();renderAll();toast('LOCAL ADAPTATION RESET','success')};$('#adaptiveDone').onclick=closeModal}

function newProject(){if(!confirm('Start a new project? Current work remains in local autosave until you clear it.'))return;runtimeAssets.forEach(a=>{a.bitmap?.close?.();if(a.thumbUrl)URL.revokeObjectURL(a.thumbUrl)});runtimeAssets.clear();project=createProject();history.seed(project);queueSave();renderAll();toast('NEW PROJECT READY','success')}

function openCompare(list){const root=$('#modalRoot');root.innerHTML=`<div class="modal-backdrop" id="mb"><section class="modal"><div class="modal-head"><div><div class="modal-title">COMPARE LAYOUTS</div><div class="brand-sub">YOUR CURRENT PROJECT STAYS UNCHANGED UNTIL YOU CHOOSE</div></div><button class="icon-btn" id="closeM">×</button></div><div class="modal-grid" id="candidateGrid">${list.map((c,i)=>`<article class="candidate"><canvas id="cand${i}" width="500" height="360"></canvas><div class="candidate-title">LAYOUT ${i+1} • ${c.label}</div><div class="candidate-desc">${esc(c.reason||'COMPOSITION GENERATED FROM CURRENT IMAGE SET')} • ${(c.score*100).toFixed(0)}% COMPOSITION FIT</div><div class="candidate-metrics">${['hierarchy','rhythm','spacing','focal'].map(k=>`<span>${k.toUpperCase()} ${Math.round((c.report?.metrics?.[k]||0)*100)}%</span>`).join('')}</div><button class="primary" data-use-candidate="${i}">USE THIS LAYOUT</button></article>`).join('')}</div></section></div>`;$('#closeM').onclick=closeModal;list.forEach((c,i)=>{const cv=$(`#cand${i}`);const map=new Map(c.objects.map(o=>[o.id,o]));const previewObjects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});const p={...project,objects:previewObjects,selectedId:null,canvas:{...project.canvas,mapping:'checker'}};renderProject(cv.getContext('2d'),p,runtimeAssets,{preview:true,selection:false})});$$('[data-use-candidate]').forEach(b=>b.onclick=()=>{const c=list[+b.dataset.useCandidate];const before=beginMutation();const map=new Map(c.objects.map(o=>[o.id,o]));project.objects=project.objects.map(o=>{const n=map.get(o.id);return n&&!o.locked?{...o,...n}:o});project.layout.type=c.type;adaptEvent('layout',c.type);adaptEvent('action','compare');closeModal();commit(before,`${layoutLabel(c.type)} SELECTED`)})}
function openExport(){openModal('EXPORT LAB',`<div class="two"><div><div class="label">FORMAT</div><select class="select" id="exportFormat"><option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WEBP</option></select></div><div><div class="label">QUALITY</div><input id="exportQuality" type="range" min="50" max="100" value="92"><div class="tool-value" id="exportQualityV">92%</div></div></div><div class="section"><div class="label">BACKGROUND</div><div class="chips"><button class="select-chip active" data-export-bg="current">CURRENT</button><button class="select-chip" data-export-bg="white">WHITE</button><button class="select-chip" data-export-bg="slate">SLATE</button><button class="select-chip" data-export-bg="transparent">TRANSPARENT</button></div></div><div class="section"><div class="stat-grid"><div class="stat"><div class="stat-k">SIZE</div><div class="stat-v">${project.canvas.w}×${project.canvas.h}</div></div><div class="stat"><div class="stat-k">DPI METADATA</div><div class="stat-v">${project.canvas.dpi}</div></div></div></div><div class="section"><button class="primary" id="doExport">EXPORT IMAGE</button><button class="secondary" id="copyExport" style="width:100%;margin-top:7px">COPY TO CLIPBOARD</button><div class="hint">PNG is lossless and supports transparency. DPI is metadata; pixel dimensions determine image detail.</div></div>`);const q=$('#exportQuality');q.oninput=()=>$('#exportQualityV').textContent=q.value+'%';let bg='current';$$('[data-export-bg]').forEach(b=>b.onclick=()=>{$$('[data-export-bg]').forEach(x=>x.classList.remove('active'));b.classList.add('active');bg=b.dataset.exportBg});$('#doExport').onclick=async()=>{const format=$('#exportFormat').value;try{if(format==='jpeg'&&bg==='transparent'){bg='white';$$('[data-export-bg]').forEach(x=>x.classList.toggle('active',x.dataset.exportBg==='white'));}const wantsTransparent=format!=='jpeg' && (bg==='transparent'||(bg==='current'&&project.canvas.mapping==='checker'));const effectiveBg=wantsTransparent?'transparent':bg==='current'?(project.canvas.mapping==='white'?'white':project.canvas.mapping==='slate'?'slate':'white'):bg;const ep={...project,canvas:{...project.canvas,mapping:effectiveBg==='transparent'?'checker':effectiveBg==='white'?'white':'slate',background:effectiveBg==='white'?'#fff':effectiveBg==='slate'?'#1e293b':project.canvas.background,__transparentExport:wantsTransparent&&format!=='jpeg'}};const blob=await exportBlob(ep,runtimeAssets,format,+q.value/100);openDownloadSupportModal(blob,`${safeName(project.name)}.${format==='jpeg'?'jpg':format}`,format);adaptEvent('export',format);toast(`${format.toUpperCase()} EXPORT READY`,'success');}catch(e){console.error(e);toast('EXPORT FAILED — TRY A SMALLER CANVAS','error')}};$('#copyExport').onclick=async()=>{try{const transparentCurrent=project.canvas.mapping==='checker';const ep={...project,canvas:{...project.canvas,__transparentExport:transparentCurrent,mapping:transparentCurrent?'checker':project.canvas.mapping}};const blob=await exportBlob(ep,runtimeAssets,'png',1);if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error('CLIPBOARD_UNSUPPORTED');await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('PNG COPIED TO CLIPBOARD','success')}catch(e){toast('CLIPBOARD IMAGE COPY IS NOT AVAILABLE HERE','error')}}}

function openHelp(){openModal('HELP & STUDIO GUIDE',`<div class="modal-grid"><div class="hint"><b>QUICK:</b> DROP PHOTOS, GENERATE CANDIDATES, COMPARE, THEN CHOOSE.</div><div class="hint"><b>PRECISION:</b> EDIT POSITION, SIZE, ROTATION, FOCAL POINT AND IMAGE PROTECTION.</div><div class="hint"><b>MOOD BOARD:</b> MOVE, OVERLAP, ALIGN AND DISTRIBUTE OBJECTS FREELY.</div><div class="hint"><b>PRIVACY:</b> LOCAL MODE DOES NOT REQUIRE IMAGE UPLOADS TO CREATE OR EXPORT.</div><div class="hint"><b>PROJECTS:</b> AUTOSAVE USES INDEXEDDB. SAVE PROJECT CREATES A .LOCALCOLLAGE FILE.</div><div class="hint"><b>SHORTCUTS:</b> / COMMANDS • F FOCUS • 0 FIT • 1 100% • CMD/CTRL+S SAVE • DELETE REMOVE • ARROWS NUDGE • SHIFT+ARROW 10 PX.</div></div><div class="section"><div class="label"><span>ASK STUDIO</span><span class="readout" id="aiConnLabel">${esc(aiConfiguredLabel())}</span></div><input class="field" id="qaInput" placeholder="ASK ABOUT YOUR CURRENT PROJECT…"><div class="qa-suggestions"><button class="qa" data-q="WHY IS PHOTO 3 CROPPED?">WHY IS PHOTO 3 CROPPED?</button><button class="qa" data-q="HOW DO I MAKE A 3×3 GRID?">HOW DO I MAKE A 3×3 GRID?</button><button class="qa" data-q="HOW DO I KEEP MY WHOLE PHOTO VISIBLE?">KEEP WHOLE PHOTO VISIBLE</button><button class="qa" data-q="WHAT DOES 300 DPI MEAN?">WHAT DOES 300 DPI MEAN?</button></div><div class="answer" id="qaAnswer">LOCAL STUDIO GUIDE READY.</div><div class="two" style="margin-top:7px"><button class="secondary" id="askLocal">LOCAL GUIDE</button><button class="primary" id="askExternal">ASK OPTIONAL AI</button></div><div class="ai-usage" id="aiUsage"></div></div><div class="section"><button class="secondary" id="aiSettings">CONFIGURE OPTIONAL AI</button><button class="secondary" id="helpPage" style="margin-top:7px">OPEN FULL HELP CENTER</button></div>`);const updateUsage=()=>{const u=aiUsage();$('#aiUsage').textContent=`${u.hour} OPTIONAL AI CALL${u.hour===1?'':'S'} THIS HOUR • ${u.day} TODAY • LOCAL GUIDE IS UNLIMITED`;};const askLocal=()=>{$('#qaAnswer').textContent=localAssistant($('#qaInput').value,project,runtimeAssets);updateUsage()};const askExternal=async()=>{const q=$('#qaInput').value.trim();if(!q){$('#qaAnswer').textContent='ENTER A QUESTION FIRST. THE LOCAL GUIDE WILL TRY BEFORE ANY EXTERNAL AI REQUEST.';return}const local=localAssistant(q,project,runtimeAssets);if(!local.startsWith('TRY ASKING:')){$('#qaAnswer').textContent=local;return}const edge=await aiEdgeCapability();if(!edge.available&&!aiKeyConfigured()){openAISettings();return}$('#askExternal').disabled=true;$('#qaAnswer').textContent='ASKING AI • ONLY COMPACT PROJECT METADATA IS SENT…';try{const r=await askAI(q,aiContext(),{preferFree:true});$('#qaAnswer').textContent=`${r.answer}${r.cached?' • CACHED':''}`;updateUsage()}catch(e){if(e.code==='AI_COOLDOWN'){$('#qaAnswer').textContent=`AI REQUEST COOLING DOWN • TRY AGAIN IN ${Math.ceil((e.remaining||7000)/1000)}S. LOCAL GUIDE REMAINS AVAILABLE.`}else{$('#qaAnswer').textContent=e.message||'OPTIONAL AI REQUEST FAILED. LOCAL GUIDE REMAINS AVAILABLE.'}}finally{$('#askExternal').disabled=false;updateUsage()}};$('#qaInput').addEventListener('keydown',e=>{if(e.key==='Enter')askLocal()});$$('[data-q]').forEach(b=>b.onclick=()=>{$('#qaInput').value=b.dataset.q;askLocal()});$('#askLocal').onclick=askLocal;$('#askExternal').onclick=askExternal;$('#aiSettings').onclick=openAISettings;$('#helpPage').onclick=()=>{location.href='./help/'};updateUsage()}

function openAISettings(){const c=getAIConfig();let provider=c.provider||'gemini';const models=()=>aiModels(provider);openModal('OPTIONAL AI ASSISTANT',`<div class="hint"><b>LOCAL-FIRST.</b> THE CORE EDITOR, IMAGE ANALYSIS AND STUDIO GUIDE DO NOT USE AI QUOTA. OPTIONAL AI RUNS ONLY WHEN YOU PRESS ASK AI.</div><div class="section"><div class="label">PROVIDER</div><div class="chips"><button class="select-chip ${provider==='gemini'?'active':''}" id="provGemini">GEMINI</button><button class="select-chip ${provider==='mistral'?'active':''}" id="provMistral">MISTRAL</button></div></div><div class="section"><div class="label">MODEL</div><select class="select" id="aiModel">${models().map(m=>`<option value="${m.id}" ${c.model===m.id?'selected':''}>${m.label}</option>`).join('')}</select></div><div class="section"><div class="label">API KEY</div><input class="field" id="aiKey" type="password" autocomplete="off" spellcheck="false" placeholder="PASTE YOUR PROVIDER KEY"><div class="hint"><b>SESSION ONLY.</b> THE KEY IS KEPT IN MEMORY FOR THIS TAB AND IS NOT SAVED TO INDEXEDDB, THE PROJECT FILE, OR A COOKIE. THE APP SENDS NO SOURCE IMAGE BYTES TO OPTIONAL AI.</div></div><div class="section"><div class="ai-policy-grid"><div><span>CONTEXT</span><b>STRUCTURED TEXT ONLY</b></div><div><span>OUTPUT</span><b>420 TOKENS MAX</b></div><div><span>RETRY</span><b>NONE</b></div><div><span>CACHE</span><b>SESSION MEMORY</b></div></div></div><div class="two" style="margin-top:10px"><button class="secondary" id="forgetAI">FORGET KEY</button><button class="primary" id="saveAI">CONNECT AI</button></div><div class="section"><div class="hint">GEMINI 3.1 FLASH-LITE IS THE DEFAULT EFFICIENT MODEL. MISTRAL SMALL IS THE DEFAULT MISTRAL OPTION. PROVIDER QUOTAS STILL APPLY TO YOUR OWN KEY.</div></div>`);const refresh=()=>{const list=aiModels(provider);$('#aiModel').innerHTML=list.map(m=>`<option value="${m.id}">${m.label}</option>`).join('')};$('#provGemini').onclick=()=>{provider='gemini';$('#provGemini').classList.add('active');$('#provMistral').classList.remove('active');refresh()};$('#provMistral').onclick=()=>{provider='mistral';$('#provMistral').classList.add('active');$('#provGemini').classList.remove('active');refresh()};$('#saveAI').onclick=()=>{try{setAIConfig(provider,$('#aiKey').value,$('#aiModel').value);closeModal();toast(`${provider.toUpperCase()} AI CONNECTED • SESSION ONLY`,'success')}catch(e){toast('VALID API KEY REQUIRED','error')}};$('#forgetAI').onclick=()=>{clearAIConfig();closeModal();toast('OPTIONAL AI KEY FORGOTTEN','success')}}
function openModal(title,body,size='sm'){$('#modalRoot').innerHTML=`<div class="modal-backdrop" id="mb"><section class="modal ${size}"><div class="modal-head"><div class="modal-title">${title}</div><button class="icon-btn" id="closeM">×</button></div>${body}</section></div>`;$('#closeM').onclick=closeModal;$('#mb').addEventListener('click',e=>{if(e.target.id==='mb')closeModal()})}
function closeModal(){$('#modalRoot').innerHTML=''}

function commandActionText(a){
  if(a.op==='setMode')return `SWITCH TO ${String(a.mode).toUpperCase()} STUDIO`;
  if(a.op==='setIntent')return `SET INTENT TO ${String(a.intent).toUpperCase()}`;
  if(a.op==='setLayout')return `USE ${layoutLabel(a.layout)} LAYOUT`;
  if(a.op==='setCanvasPreset')return `SET CANVAS TO ${String(a.preset).toUpperCase()}`;
  if(a.op==='setCanvas')return `SET CANVAS TO ${a.w} × ${a.h} PX`;
  if(a.op==='setFrame'){const p=[];if(a.outerMargin!=null)p.push(`MARGIN ${a.outerMargin}px`);if(a.innerGap!=null)p.push(`GAP ${a.innerGap}px`);if(a.radius!=null)p.push(`RADIUS ${a.radius}px`);return p.join(' • ')||'UPDATE FRAME';}
  if(a.op==='setBackground')return `${String(a.mapping).toUpperCase()} BACKGROUND`;
  if(a.op==='setProtection')return `${String(a.mode).toUpperCase()} CROP`;
  if(a.op==='centerAll')return 'CENTER ALL PHOTOS';
  if(a.op==='centerSelected')return 'CENTER SELECTED OBJECT';
  if(a.op==='distribute')return `DISTRIBUTE ${String(a.axis).toUpperCase()}`;
  if(a.op==='alignAll')return `ALIGN ALL ${String(a.axis).toUpperCase()}`;
  if(a.op==='equalizeStructuredSpacing')return 'EQUALIZE STRUCTURED SPACING';
  if(a.op==='makeHero')return `MAKE PHOTO ${a.imageIndex+1} THE HERO`;
  if(a.op==='applyBestLayout')return 'APPLY STRONGEST SMART LAYOUT';
  return String(a.op).toUpperCase();
}
function openCreativeCopilot(){
  let pending=null; let impact=null;
  const renderPlan=(plan,origin='LOCAL')=>{
    const checked=validateCopilotPlan(plan,project); pending=plan;
    const preview=document.querySelector('#copilotPreview'),status=document.querySelector('#copilotStatus'),apply=document.querySelector('#copilotApply'),source=document.querySelector('#copilotSource'),impactBox=document.querySelector('#copilotImpact');
    if(!preview||!status||!apply)return;
    if(!checked.ok){status.textContent='NO SAFE PLAN YET';status.className='command-status warn';preview.innerHTML='<div class="hint">THE COPILOT COULD NOT BUILD A SAFE MULTI-STEP PLAN. TRY A MORE CONCRETE GOAL, SUCH AS “MAKE A CLEAN PRODUCT COLLAGE WITH EQUAL SPACING.”</div>';apply.disabled=true;impactBox.innerHTML='';return;}
    const working=structuredClone(project);const r=applyCopilotPlan(working,runtimeAssets,{...plan,actions:checked.safe});
    if(!r.changed){status.textContent='NO CHANGES NEEDED';status.className='command-status ready';apply.disabled=true;impactBox.innerHTML='<div class="command-status ready">THIS PROJECT ALREADY MATCHES THE REQUEST CLOSELY.</div>';return;}
    impact=estimateCopilotImpact(plan,project,working);
    status.textContent=`${checked.safe.length} SAFE STEP${checked.safe.length===1?'':'S'} READY`;status.className='command-status ready';
    preview.innerHTML=`<div class="command-summary">${esc(plan.summary||'REVIEW THE CREATIVE PLAN')}</div><div class="command-list">${describeCopilotPlan({actions:checked.safe}).map(x=>`<div class="command-step"><span>✓</span><b>${esc(x)}</b></div>`).join('')}</div>${checked.warnings?.length?`<div class="hint">${esc(checked.warnings.join(' • '))}</div>`:''}`;
    impactBox.innerHTML=`<div class="copilot-impact-grid"><div><span>STEPS</span><b>${impact.changeCount}</b></div><div><span>PROJECT</span><b>UNCHANGED</b></div><div class="wide"><span>PREVIEW</span><b>${Math.round(impact.estimatedImprovement*100)}% ESTIMATED COMPOSITION IMPROVEMENT</b></div></div><div class="hint">NOTHING HAS BEEN CHANGED. APPLY WILL CREATE ONE UNDOABLE TRANSACTION.</div>`;
    apply.disabled=false; source.textContent=origin==='LOCAL'?'LOCAL COPILOT • ZERO AI QUOTA':`AI PLAN • ${plan.provider||'EDGE'} • PREVIEW ONLY`;
  };
  openModal('CREATIVE COPILOT',`<div class="hint"><b>DESCRIBE THE RESULT YOU WANT.</b> THE COPILOT CAN COMBINE LAYOUT, INTENT, CANVAS, SPACING, IMAGE PROTECTION, SMART FIXES AND BOARD ELEMENTS INTO ONE REVIEWABLE PLAN.</div><div class="section"><div class="label"><span>GOAL</span><span class="readout">LOCAL FIRST</span></div><textarea class="field" id="copilotInput" rows="4" style="resize:vertical" placeholder="MAKE THIS A CLEAN PRODUCT COLLAGE, PUT PHOTO 3 AS THE HERO, KEEP WHOLE PHOTOS, AND USE EVEN MARGINS."></textarea></div><div class="section"><div class="command-status" id="copilotStatus">READY FOR A CREATIVE GOAL.</div><div class="command-preview" id="copilotPreview"><div class="hint">TRY: “MAKE THIS A MINIMAL FASHION EDITORIAL.” • “TURN THIS INTO A MOOD BOARD WITH A TITLE.”</div></div><div id="copilotImpact" style="margin-top:8px"></div></div><div class="two" style="margin-top:9px"><button class="secondary" id="copilotAiBtn">TRY AI INTERPRETATION</button><button class="primary" id="copilotPreviewBtn">PREVIEW PLAN</button></div><div class="two" style="margin-top:7px"><button class="secondary" id="copilotCancel">CANCEL</button><button class="primary" id="copilotApply" disabled>APPLY PLAN</button></div><div class="hint" id="copilotSource">LOCAL COPILOT • ZERO AI QUOTA</div>`,'lg');
  const input=$('#copilotInput'),status=$('#copilotStatus'),aiBtn=$('#copilotAiBtn'),previewBtn=$('#copilotPreviewBtn'),applyBtn=$('#copilotApply');
  const doLocal=()=>{const q=input.value.trim();if(!q){status.textContent='ENTER A CREATIVE GOAL.';status.className='command-status warn';return;}renderPlan(interpretCopilotRequest(q,project,runtimeAssets),'LOCAL');};
  const doAI=async()=>{const q=input.value.trim();if(!q)return;aiBtn.disabled=true;status.textContent='BUILDING PLAN • NO CHANGES YET';status.className='command-status';try{const edge=await aiEdgeCapability();if(!edge.available&&!aiKeyConfigured()){throw new Error('NO AI PLAN ROUTE IS CONNECTED');}const r=await askAIPlan(q,{...aiContext(),__project:project},{preferFree:true});renderPlan({...r.plan,provider:r.provider,model:r.model},r.provider==='cloudflare'?'FREE EDGE AI':'OPTIONAL BYOK AI');}catch(e){status.textContent=e.message||'AI PLAN FAILED • LOCAL COPILOT STILL WORKS.';status.className='command-status warn';}finally{aiBtn.disabled=false;}};
  previewBtn.onclick=doLocal;aiBtn.onclick=doAI;$('#copilotCancel').onclick=closeModal;
  applyBtn.onclick=()=>{if(!pending)return;const checked=validateCopilotPlan(pending,project);if(!checked.ok)return;const before=beginMutation();const r=applyCopilotPlan(project,runtimeAssets,{...pending,actions:checked.safe});if(!r.changed){toast('NO SAFE CHANGES WERE NECESSARY');return;}adaptEvent('command','copilot');adaptEvent('action','creativeCopilot');adaptEvent('mode',project.mode);adaptEvent('intent',project.intent);closeModal();commit(before,'CREATIVE COPILOT APPLIED');};
  input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();doLocal();}});input.focus();
}

function openStudioCommand(){
  let pending=null;
  openModal('SMART COMMAND',`<div class="hint"><b>DESCRIBE WHAT YOU WANT.</b> THE STUDIO TRANSLATES COMMON EDITS LOCALLY FIRST. NOTHING CHANGES UNTIL YOU PRESS APPLY.</div><div class="section"><div class="label"><span>REQUEST</span><span class="readout">LOCAL FIRST</span></div><textarea class="field" id="smartCommandInput" rows="3" style="resize:vertical" placeholder="MAKE A CLEAN 4-PHOTO ETSY PRODUCT COLLAGE WITH EQUAL MARGINS."></textarea></div><div class="section"><div class="command-status" id="smartCommandStatus">READY FOR A REQUEST.</div><div class="command-preview" id="smartCommandPreview"><div class="hint">TRY: “MAKE PHOTO 3 THE HERO.” • “USE A 3×3 GRID.” • “SET WHITE BACKGROUND AND 20PX GAP.”</div></div></div><div class="two" style="margin-top:9px"><button class="secondary" id="smartAiBtn" disabled>LET OPTIONAL AI INTERPRET</button><button class="primary" id="smartPreviewBtn">PREVIEW CHANGES</button></div><div class="two" style="margin-top:7px"><button class="secondary" id="smartCancelBtn">CANCEL</button><button class="primary" id="smartApplyBtn" disabled>APPLY CHANGES</button></div><div class="hint" id="smartCommandSource">LOCAL PARSER • ZERO AI QUOTA</div>`);
  const input=$('#smartCommandInput'),status=$('#smartCommandStatus'),preview=$('#smartCommandPreview'),aiBtn=$('#smartAiBtn'),applyBtn=$('#smartApplyBtn'),source=$('#smartCommandSource');
  function showPlan(plan,origin='LOCAL'){
    pending=plan;
    const checked=validateCommandPlan(plan,project);
    const actions=checked.safe||[];
    status.textContent=checked.ok?`${actions.length} SAFE CHANGE${actions.length===1?'':'S'} READY`:'NO SAFE CHANGES';
    status.className=`command-status ${checked.ok?'ready':'warn'}`;
    preview.innerHTML=checked.ok?`<div class="command-summary">${esc(plan.summary||'REVIEW THESE CHANGES')}</div><div class="command-list">${actions.map(a=>`<div class="command-step"><span>✓</span><b>${esc(commandActionText(a))}</b></div>`).join('')}</div>${checked.warnings?.length?`<div class="hint">${esc(checked.warnings.join(' • '))}</div>`:''}`:`<div class="hint">I COULD NOT TURN THAT REQUEST INTO A SAFE EDIT. TRY MORE CONCRETE WORDING OR USE OPTIONAL AI INTERPRETATION.</div>`;
    applyBtn.disabled=!checked.ok;
    source.textContent=origin==='LOCAL'?'LOCAL PARSER • ZERO AI QUOTA':`OPTIONAL AI • ${plan.provider||'EDGE'} • PREVIEW ONLY`;
  }
  async function localPreview(){
    const q=input.value.trim();if(!q){status.textContent='ENTER A REQUEST FIRST.';status.className='command-status warn';return;}
    const p=parseStudioCommand(q,project);showPlan(p,'LOCAL');
    aiBtn.disabled=p.understood;
    if(!p.understood){const cap=await aiEdgeCapability();aiBtn.textContent=cap.available?'TRY FREE EDGE AI INTERPRETATION':'TRY OPTIONAL AI INTERPRETATION';}
  }
  async function aiPreview(){
    const q=input.value.trim();if(!q)return;
    aiBtn.disabled=true;applyBtn.disabled=true;status.textContent='INTERPRETING REQUEST • NO CHANGES YET';status.className='command-status';
    try{
      const edge=await aiEdgeCapability();
      if(!edge.available&&!aiKeyConfigured()){throw Object.assign(new Error('AI_PLAN_UNAVAILABLE'),{code:'AI_PLAN_UNAVAILABLE'});}
      const r=await askAIPlan(q,{...aiContext(),__project:project},{preferFree:true});
      showPlan({...r.plan,provider:r.provider,model:r.model},r.provider==='cloudflare'?'FREE EDGE AI':'OPTIONAL BYOK AI');
    }catch(e){
      pending=null;applyBtn.disabled=true;
      status.textContent=e.code==='AI_COOLDOWN'?'AI REQUEST COOLING DOWN • LOCAL COMMANDS STILL WORK.':e.code==='AI_PLAN_UNAVAILABLE'?'NO OPTIONAL AI ROUTE IS CONNECTED. USE LOCAL COMMANDS OR CONNECT BYOK AI.':'AI INTERPRETATION FAILED • NOTHING WAS CHANGED.';
      status.className='command-status warn';
      preview.innerHTML='<div class="hint">THE PROJECT IS UNCHANGED. TRY A MORE CONCRETE LOCAL COMMAND OR CONNECT OPTIONAL AI.</div>';
    }finally{aiBtn.disabled=false;}
  }
  $('#smartPreviewBtn').onclick=localPreview;
  $('#smartAiBtn').onclick=aiPreview;
  $('#smartCancelBtn').onclick=closeModal;
  applyBtn.onclick=()=>{
    if(!pending)return;
    const checked=validateCommandPlan(pending,project);if(!checked.ok)return;
    const before=beginMutation();const r=applyCommandPlan(project,runtimeAssets,{...pending,actions:checked.safe});
    if(!r.changed){toast('NO SAFE CHANGES WERE NECESSARY');return;}
    adaptEvent('command',pending.actions?.[0]?.op||'smart-command');adaptEvent('action','smartCommand');closeModal();commit(before,'SMART COMMAND APPLIED');
  };
  input.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();localPreview();}});
  input.focus();
}

function openCommandPalette(){
  const rankPalette=(query)=>rankCommands(commands,query,project,runtimeAssets)
    .map((x,i)=>({...x,score:x.score+(adaptiveProfile.enabled?Math.min(10,Math.sqrt((adaptiveProfile.commands?.[x.c[0]]||0))*2):0)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  const renderResults=(query='',active=0)=>{
    const ranked=rankPalette(query);
    const results=$('#cmdResults');if(!results)return;
    results.innerHTML=ranked.map((x,i)=>`<button class="command ${i===active?'active':''} ${x.suggested?'suggested':''}" data-cmd="${x.index}"><b>${x.c[0]}${x.suggested?' • SUGGESTED':''}</b><small>${x.c[1]}</small></button>`).join('');
    $$('[data-cmd]').forEach(b=>b.onclick=()=>{const cmd=commands[+b.dataset.cmd];adaptEvent('command',cmd[0]);closeModal();cmd[2]()});
  };
  openModal('COMMAND CENTER',`<section class="palette"><div class="hint"><b>NEXT:</b> ${esc(getNextAction(project,runtimeAssets).title)} — ${esc(nextMessage(project,runtimeAssets))}</div><input class="field" id="cmdInput" placeholder="TYPE A COMMAND…" autocomplete="off"><div class="palette-results" id="cmdResults"></div><div class="shortcut-grid">${SHORTCUTS.slice(0,8).map(([k,v])=>`<span><b>${k}</b>${v}</span>`).join('')}</div></section>`);
  const inp=$('#cmdInput');let active=0;
  const refresh=()=>{const ranked=rankPalette(inp.value);active=Math.min(active,Math.max(0,ranked.length-1));renderResults(inp.value,active)};
  inp.addEventListener('input',()=>{active=0;refresh()});
  inp.addEventListener('keydown',e=>{const ranked=rankPalette(inp.value);if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(active+1,Math.max(0,ranked.length-1));renderResults(inp.value,active)}else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,0);renderResults(inp.value,active)}else if(e.key==='Enter'){e.preventDefault();const x=ranked[active];if(x){adaptEvent('command',x.c[0]);closeModal();x.c[2]()}}});
  refresh();inp.focus();
}

function nextMessage(project,runtimeAssets){return getNextAction(project,runtimeAssets).message||actionMeta(getNextAction(project,runtimeAssets).id).desc;}
function editTextObject(o){if(!o||o.type!=='text'||o.locked)return;openModal('EDIT TEXT',`<div class="section"><div class="label">TEXT</div><textarea class="field" id="editTextField" rows=4 style="resize:vertical">${esc(o.text||'')}</textarea></div><div class="two" style="margin-top:9px"><button class="secondary" id="cancelTextEdit">CANCEL</button><button class="primary" id="saveTextEdit">APPLY TEXT</button></div>`);$('#cancelTextEdit').onclick=closeModal;$('#saveTextEdit').onclick=()=>{const before=beginMutation();o.text=$('#editTextField').value||'TEXT';closeModal();commit(before,'TEXT UPDATED')};$('#editTextField').focus();$('#editTextField').select();}

function runQuality(show){const q=inspectProject(project,runtimeAssets);if(show)openModal('STUDIO CHECK',`<div class="stat-grid"><div class="stat"><div class="stat-k">STATUS</div><div class="stat-v">${q.ok?'READY':'BLOCKED'}</div></div><div class="stat"><div class="stat-k">ISSUES</div><div class="stat-v">${q.issues.length}</div></div></div><div class="warning-list" style="margin-top:10px">${(q.issues.length?q.issues:[{level:'info',message:'NO CURRENT COMPOSITION WARNINGS.'}]).map(i=>`<div class="warning ${i.level}">${esc(i.message)}</div>`).join('')}</div>`);return q}

function keyboard(e){const tag=document.activeElement?.tagName;const editing=['INPUT','TEXTAREA','SELECT','BUTTON','A'].includes(tag)||!!document.activeElement?.isContentEditable;const mod=e.metaKey||e.ctrlKey;if(mod&&!editing&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return}if(mod&&!editing&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return}if(mod&&!editing&&e.key.toLowerCase()==='s'){e.preventDefault();saveProjectFile();return}if(e.key==='/'&&!editing){e.preventDefault();openCommandPalette();return}if(e.key==='f'&&!editing){e.preventDefault();toggleFocusMode();return}if(e.key==='0'&&!editing){e.preventDefault();setCanvasFit();return}if(mod&&!editing&&e.key.toLowerCase()==='k'){e.preventDefault();openStudioCommand();return}if(e.key==='1'&&!editing){e.preventDefault();setZoom(1);return}if((e.key==='+'||e.key==='=')&&!editing){e.preventDefault();setZoom(viewState.zoom+.15);return}if(e.key==='-'&&!editing){e.preventDefault();setZoom(viewState.zoom-.15);return}if(e.key==='Escape'){if(viewState.focusMode){toggleFocusMode();return}closeModal();return}if(e.key==='Delete'&&!editing){deleteSelected();return}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!editing){e.preventDefault();const m=e.altKey?0.1:e.shiftKey?10:1;nudge((e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)*m,(e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0)*m)}}

document.addEventListener('keydown',keyboard);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&pendingAssetIds.size){void saveLocally();}});
window.addEventListener('pagehide',()=>{if(pendingAssetIds.size){void saveLocally();}});

initSupportShare();
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{}));

// Project file input
document.addEventListener('change',e=>{if(e.target?.id==='projectInput'&&e.target.files?.[0])openProjectFile(e.target.files[0])});

// Initial bootstrap
renderApp();history.seed(project);attachCanvasHandlers();refreshStorageSnapshot();getLatestProject().then(async record=>{if(!record)return;openModal('RECOVERED PROJECT FOUND',`<div class="hint"><b>AUTOSAVE FOUND.</b> A RECENT LOCAL PROJECT IS AVAILABLE ON THIS DEVICE.</div><div class="two" style="margin-top:10px"><button class="primary" id="restoreRecovered">RESTORE</button><button class="secondary" id="ignoreRecovered">START EMPTY</button></div>`);$('#restoreRecovered').onclick=async()=>{closeModal();try{project=sanitizeProject(record.project);for(const a of (record.assets||[])){const rt=await decodeAsset(a.blob);rt.id=a.id;rt.name=a.name;rt.persisted=record.assetPersistence==='store';if(rt.persisted)pendingAssetIds.delete(a.id);else pendingAssetIds.add(a.id);const obj=project.objects.find(o=>o.assetId===a.id);if(obj?.vision)rt.analysis={...(rt.analysis||{}),vision:obj.vision};runtimeAssets.set(a.id,rt)}project.objects=project.objects.filter(o=>o.type!=='image'||runtimeAssets.has(o.assetId));ensureIntelligenceState();history.seed(project);renderAll();toast('LOCAL PROJECT RECOVERED','success')}catch(e){toast('RECOVERY FAILED','error')}};$('#ignoreRecovered').onclick=closeModal}).catch(()=>{});
