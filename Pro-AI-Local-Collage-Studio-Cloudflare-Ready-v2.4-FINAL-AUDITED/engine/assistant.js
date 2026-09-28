export function localAssistant(question, project, assets){
  const q=String(question||'').toLowerCase();
  const selected=project.objects.find(o=>o.id===project.selectedId);
  if(q.includes('crop')||q.includes('cropped')){
    const o=selected?.type==='image'?selected:project.objects.find(x=>x.type==='image');
    if(!o) return 'SELECT A PHOTO FIRST. I CAN THEN EXPLAIN ITS FIT MODE, SCALE AND FOCAL POINT.';
    return `${o.name.toUpperCase()} IS USING ${o.fitMode.toUpperCase()} MODE WITH ${(o.scale*100).toFixed(0)}% SCALE. ${o.fitMode==='never'?'NEVER CROP IS ACTIVE, SO THE FULL PHOTO STAYS VISIBLE.':'TRY NEVER CROP TO SHOW THE WHOLE PHOTO, OR ADJUST FOCAL POINT.'}`;
  }
  if(q.includes('3x3')||q.includes('three by three')) return 'OPEN LAYOUT LAB AND CHOOSE GRID. WITH 9 IMAGES THE SMART LAYOUT ENGINE WILL BUILD A 3×3 COMPOSITION.';
  if(q.includes('etsy')) return 'SET THE CANVAS TO ETSY COVER, THEN USE PRODUCT SHOWCASE INTENT FOR CLEAN MARGINS AND A STRONGER HERO IMAGE.';
  if(q.includes('watermark')) return 'EXPORTS ARE GENERATED LOCALLY FROM THE PROJECT STATE. THIS STUDIO DOES NOT ADD A WATERMARK.';
  if(q.includes('move')||q.includes('position')) return selected?'SELECTED OBJECT: '+(selected.name||selected.type).toUpperCase()+'. DRAG IT ON THE CANVAS OR USE PRECISION NUDGE CONTROLS.':'SELECT AN OBJECT ON THE CANVAS FIRST.';
  if(q.includes('dpi')) return `DPI IS METADATA. THE ACTUAL IMAGE DETAIL COMES FROM PIXEL DIMENSIONS. CURRENT PROJECT DPI METADATA: ${project.canvas.dpi}.`;
  if(q.includes('privacy')||q.includes('upload')) return 'IMAGE FILES ARE PROCESSED IN THIS BROWSER. LOCAL MODE DOES NOT REQUIRE IMAGE UPLOADS.';
  if(q.includes('save')||q.includes('project')) return 'USE SAVE PROJECT TO CREATE A .LOCALCOLLAGE FILE. THE PROJECT CONTAINS THE EDITABLE SCENE PLUS ITS IMAGE FILES.';
  if(q.includes('copilot')||q.includes('make this look')||q.includes('do it for me')) return 'OPEN CREATIVE COPILOT TO DESCRIBE A MULTI-STEP GOAL. THE STUDIO BUILDS A SAFE PLAN, SHOWS THE CHANGES, AND WAITS FOR YOUR APPROVAL.';
  return 'TRY ASKING: “WHY IS PHOTO 3 CROPPED?”, “HOW DO I MAKE A 3×3 GRID?”, “HOW DO I KEEP MY WHOLE PHOTO VISIBLE?”, OR “WHAT DOES 300 DPI MEAN?”';
}
