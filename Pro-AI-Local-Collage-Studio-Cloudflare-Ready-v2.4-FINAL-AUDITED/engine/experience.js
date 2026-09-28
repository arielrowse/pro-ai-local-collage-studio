const IMAGE_MODES = new Set(['quick','precision','mood']);
const ACTIONS = {
  copilot: {label:'CREATIVE COPILOT',desc:'Turn a multi-step creative goal into a safe previewable plan'},
  smartCommand: {label:'SMART COMMAND',desc:'Describe a change and preview it before applying'},
  addPhotos: {label:'ADD PHOTOS',desc:'Import local images into the studio'},
  compare: {label:'COMPARE 4 LAYOUTS',desc:'Review intelligent layout candidates'},
  authorReview: {label:'REVIEW SMART FIXES',desc:'Inspect high-value composition improvements'},
  enhanceVision: {label:'ENHANCE FOCAL INTELLIGENCE',desc:'Improve subject-aware cropping locally'},
  fit: {label:'FIT PHOTO',desc:'Show the full selected photo'},
  smartCrop: {label:'SMART CROP',desc:'Protect the strongest visual content while filling the frame'},
  center: {label:'CENTER OBJECT',desc:'Center the selected object on the canvas'},
  duplicate: {label:'DUPLICATE',desc:'Create a reversible copy of the selected object'},
  front: {label:'BRING FRONT',desc:'Move the selected object above the others'},
  back: {label:'SEND BACK',desc:'Move the selected object behind the others'},
  hide: {label:'HIDE OBJECT',desc:'Temporarily remove the selected object from view'},
  lock: {label:'LOCK OBJECT',desc:'Protect the selected object from accidental edits'},
  delete: {label:'DELETE OBJECT',desc:'Remove the selected object'},
  focus: {label:'FOCUS MODE',desc:'Maximize the canvas and reduce interface chrome'},
  fitCanvas: {label:'FIT CANVAS',desc:'Fit the entire project into the workspace'},
  zoom100: {label:'100% VIEW',desc:'View the canvas at true pixel scale'},
};

export const SHORTCUTS = [
  ['CMD/CTRL + Z','UNDO'],
  ['CMD/CTRL + SHIFT + Z','REDO'],
  ['CMD/CTRL + S','SAVE PROJECT'],
  ['CMD/CTRL + K','SMART COMMAND'],
  ['/','COMMAND CENTER'],
  ['F','FOCUS MODE'],
  ['0','FIT CANVAS'],
  ['1','100% VIEW'],
  ['+ / −','ZOOM'],
  ['DELETE','DELETE SELECTED'],
  ['ARROWS','NUDGE 1 PX'],
  ['SHIFT + ARROWS','NUDGE 10 PX'],
  ['ESC','CLOSE / EXIT FOCUS'],
];

export function getContext(project, runtimeAssets) {
  const objects = Array.isArray(project?.objects) ? project.objects : [];
  const images = objects.filter(o => o.type === 'image');
  const selected = objects.find(o => o.id === project?.selectedId) || null;
  const visible = objects.filter(o => !o.hidden);
  const warnings = [];
  const out = (o) => o && (o.x < 0 || o.y < 0 || o.x + o.w > project.canvas.w || o.y + o.h > project.canvas.h);
  if (visible.some(out)) warnings.push('BOUNDS');
  const unlocked = objects.some(o => !o.locked && !o.hidden);
  return {
    mode: IMAGE_MODES.has(project?.mode) ? project.mode : 'quick',
    images,
    selected,
    hasImages: images.length > 0,
    objectCount: objects.length,
    visibleCount: visible.length,
    unlocked,
    warningCount: warnings.length,
    selectedType: selected?.type || null,
    selectedLocked: !!selected?.locked,
    selectedVision: !!selected?.vision?.enhanced,
    selectedFitMode: selected?.fitMode || null,
    intent: project?.intent || 'product',
    warnings,
    assetCount: runtimeAssets?.size || 0,
  };
}

export function getNextAction(project, runtimeAssets) {
  const c = getContext(project, runtimeAssets);
  if (!c.hasImages) return {id:'addPhotos', title:'START WITH PHOTOS', message:'DROP YOUR IMAGES OR ADD THEM FROM YOUR DEVICE.'};
  if (c.warningCount) return {id:'authorReview', title:'CHECK THE COMPOSITION', message:'ONE OR MORE OBJECTS NEED ATTENTION BEFORE EXPORT.'};
  if (c.mode === 'quick') return {id:'compare', title:'COMPARE LAYOUTS', message:'FOUR INTELLIGENT ARRANGEMENTS ARE READY TO REVIEW.'};
  if (c.selectedType === 'image' && c.selectedFitMode === 'never' && !c.selectedVision && c.images.length > 0) {
    return {id:'enhanceVision', title:'BOOST SUBJECT AWARENESS', message:'OPTIONAL ON-DEVICE VISION CAN PROTECT SUBJECTS MORE PRECISELY.'};
  }
  if (c.selected) return {id:'authorReview', title:'REFINE THE COMPOSITION', message:'LET THE STUDIO CHECK FOR HIGH-VALUE, REVERSIBLE IMPROVEMENTS.'};
  return {id:'addPhotos', title:'ADD ANOTHER ASSET', message:'BRING IN ANOTHER LOCAL IMAGE OR BOARD ELEMENT.'};
}

export function getContextActions(project, runtimeAssets) {
  const c = getContext(project, runtimeAssets);
  if (!c.selected) {
    return c.hasImages
      ? ['copilot','smartCommand','compare','authorReview','enhanceVision','focus']
      : ['smartCommand','addPhotos','focus'];
  }
  if (c.selectedLocked) return ['hide','lock'];
  if (c.selectedType === 'image') {
    return ['copilot','fit','smartCrop','center',...(c.selectedVision ? [] : ['enhanceVision']),'duplicate','front','back','hide','lock','delete'];
  }
  return ['center','duplicate','front','back','hide','lock','delete'];
}

export function actionMeta(id) { return ACTIONS[id] || {label:id.toUpperCase(),desc:''}; }

function fuzzyScore(query, value) {
  const q = String(query || '').trim().toLowerCase();
  const v = String(value || '').toLowerCase();
  if (!q) return 0;
  if (v === q) return 100;
  if (v.startsWith(q)) return 75;
  if (v.includes(q)) return 55;
  let qi = 0, hits = 0;
  for (const ch of v) { if (ch === q[qi]) { qi++; hits++; if (qi === q.length) break; } }
  return qi === q.length ? 25 + Math.min(20, hits) : -1;
}

export function rankCommands(commands, query, project, runtimeAssets) {
  const next = getNextAction(project, runtimeAssets);
  const context = new Set(getContextActions(project, runtimeAssets));
  return commands.map((c,index) => {
    const name = c[0], desc = c[1], actionId = c[3] || null;
    const base = Math.max(fuzzyScore(query,name),fuzzyScore(query,desc));
    const score = (base < 0 ? -1 : base) + (actionId === next.id ? 45 : 0) + (actionId && context.has(actionId) ? 12 : 0);
    return {c,index,score,suggested:actionId===next.id};
  }).filter(x => x.score >= 0 || !String(query||'').trim()).sort((a,b)=>b.score-a.score);
}

export function snapPosition(project, object, desiredX, desiredY, threshold=12) {
  if (!object || object.locked) return {x:desiredX,y:desiredY,guides:[]};
  const guides=[];
  let x=desiredX, y=desiredY;
  const cx=desiredX+object.w/2, cy=desiredY+object.h/2;
  const targetsX=[{v:0,g:'left'},{v:project.canvas.w/2-object.w/2,g:'center'},{v:project.canvas.w-object.w,g:'right'}];
  const targetsY=[{v:0,g:'top'},{v:project.canvas.h/2-object.h/2,g:'middle'},{v:project.canvas.h-object.h,g:'bottom'}];
  const nearby=project.objects.filter(o=>o.id!==object.id&&!o.hidden);
  for (const t of targetsX) if (Math.abs(x-t.v)<=threshold) {x=t.v; guides.push({axis:'x',value:t.v,kind:'CANVAS'});break;}
  for (const t of targetsY) if (Math.abs(y-t.v)<=threshold) {y=t.v; guides.push({axis:'y',value:t.v,kind:'CANVAS'});break;}
  const otherX = nearby.flatMap(o=>[
    {v:o.x-object.w,g:'EDGE'}, {v:o.x+o.w,g:'EDGE'}, {v:o.x+(o.w-object.w)/2,g:'CENTER'}, {v:o.x-object.w,g:'GAP'}, {v:o.x+o.w,g:'GAP'}
  ]);
  const otherY = nearby.flatMap(o=>[
    {v:o.y-object.h,g:'EDGE'}, {v:o.y+o.h,g:'EDGE'}, {v:o.y+(o.h-object.h)/2,g:'CENTER'}
  ]);
  for (const t of otherX) if (Math.abs(x-t.v)<=threshold) {x=t.v;guides.push({axis:'x',value:t.v,kind:'OBJECT'});break;}
  for (const t of otherY) if (Math.abs(y-t.v)<=threshold) {y=t.v;guides.push({axis:'y',value:t.v,kind:'OBJECT'});break;}
  return {x,y,guides:guides.slice(0,2)};
}
