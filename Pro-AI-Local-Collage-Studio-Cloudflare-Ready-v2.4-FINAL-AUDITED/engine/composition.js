import { getAssetAnalysis, subjectVisibility } from './intelligence.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const sq=(v)=>v*v;
const rectCenter=(r)=>({x:r.x+r.w/2,y:r.y+r.h/2});

function parseHex(hex){
  const m=String(hex||'').match(/^#?([0-9a-f]{6})$/i);
  if(!m)return [128,128,128];
  return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];
}
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d){
    if(max===r)h=((g-b)/d)%6;
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h/=6;if(h<0)h+=1;
  }
  const l=(max+min)/2;
  const s=d?d/(1-Math.abs(2*l-1)):0;
  return {h:h*360,s,l};
}
function colorData(analysis){return rgbToHsl(...parseHex(analysis?.dominantColor));}
function hueDistance(a,b){const d=Math.abs(a-b)%360;return Math.min(d,360-d);}

function salienceOf(analysis){
  if(!analysis)return .5;
  const contrast=clamp((analysis.contrast-.035)/.28);
  const edge=clamp((analysis.edgeDensity-.025)/.23);
  const sat=clamp((analysis.saturation??.25)/.75);
  const density=analysis.visualDensity==='HIGH'?1:analysis.visualDensity==='MEDIUM'?.62:.28;
  const vision=analysis.vision?.enhanced ? clamp((analysis.vision.confidence||0)*.75 + Math.min(1,(analysis.vision.regions?.length||0)/3)*.25) : 0;
  return clamp(contrast*.26+edge*.23+sat*.11+density*.16+vision*.24);
}

function assetProfile(object,runtimeAssets){
  const analysis=getAssetAnalysis(runtimeAssets,object);
  const salience=salienceOf(analysis);
  const color=colorData(analysis);
  const aspect=analysis?.aspect || ((runtimeAssets.get(object.assetId)?.width||1)/(runtimeAssets.get(object.assetId)?.height||1));
  return {object,analysis,salience,color,aspect,orientation:analysis?.orientation||'SQUARE',density:analysis?.visualDensity||'MEDIUM'};
}

function slotImportance(slot,index,total,type,intent){
  const area=slot.w*slot.h;
  const pos=rectCenter(slot);
  const x=pos.x/(slot.canvasW||2000), y=pos.y/(slot.canvasH||2000);
  let importance=area/(slot.canvasArea||1);
  if(['hero','editorial'].includes(type) || ['product','marketing','event'].includes(intent)){
    const thirds=Math.max(.15,1-Math.min(1,Math.hypot(x-.333,y-.333)*1.15));
    importance*=.82+.25*thirds;
  }
  if(type==='masonry')importance*=1.05;
  if(type==='filmstrip')importance*=1+(1-Math.abs(y-.5)*1.4)*.08;
  return importance + index*.00001;
}

function slotRoleFit(profile,slot,type,intent){
  const ratio=slot.w/Math.max(1,slot.h);
  const aspectDelta=Math.abs(Math.log(profile.aspect/ratio));
  const aspectFit=Math.exp(-Math.min(2.5,aspectDelta)*.8);
  let role=.45;
  if(['hero','editorial'].includes(type)) role=.45+profile.salience*.7;
  else if(type==='masonry') role=.55+(profile.orientation!=='SQUARE'?.12:0);
  else if(type==='filmstrip') role=.54+(profile.orientation==='LANDSCAPE'?.2:0);
  else if(['mosaic','asymmetric','stack'].includes(type)) role=.48+(profile.density==='HIGH'?.12:0)+(profile.orientation!=='SQUARE'?.07:0);
  else if(['polaroid','tilt','exploded'].includes(type)) role=.47+(profile.color.s>0.35?.1:0)+(profile.density!=='LOW'?.08:0);
  if(intent==='product' && slot.w*slot.h > (slot.canvasArea||1)*.34) role+=profile.salience*.16;
  if(intent==='mood') role+=profile.color.s*.05;
  if(profile.analysis?.vision?.enhanced){
    const subjectArea=(profile.analysis.vision.subjectBox?.w||0)*(profile.analysis.vision.subjectBox?.h||0);
    const subjectBoost=clamp((subjectArea-.015)/.28);
    if(['hero','editorial'].includes(type)) role+=subjectBoost*.18;
    if(['grid','balanced'].includes(type)) role+=subjectBoost*.05;
  }
  return clamp(role)*(.74+.26*aspectFit);
}

function slotThirdsBonus(slot,canvas,type){
  const c=rectCenter(slot), x=c.x/canvas.w, y=c.y/canvas.h;
  if(!['hero','editorial','marketing','event'].includes(type))return 0;
  const pts=[[.333,.333],[.667,.333],[.333,.667],[.667,.667]];
  const d=Math.min(...pts.map(p=>Math.hypot(x-p[0],y-p[1])));
  return clamp(1-d/0.7)*.12;
}

function proximity(a,b,canvas){
  const ca=rectCenter(a),cb=rectCenter(b),d=Math.hypot(ca.x-cb.x,ca.y-cb.y),diag=Math.hypot(canvas.w,canvas.h);
  return clamp(1-d/(diag*.6));
}
function orientationDiversity(a,b){
  if(a.orientation===b.orientation)return .15;
  if(a.orientation==='SQUARE'||b.orientation==='SQUARE')return .72;
  return .98;
}
function pairColorScore(a,b,intent){
  const d=hueDistance(a.color.h,b.color.h);
  const analogous=Math.exp(-sq(d)/sq(78));
  const complementary=Math.exp(-sq(Math.abs(d-180))/sq(70));
  if(intent==='product'||intent==='event'||intent==='marketing')return clamp(.72*analogous+.28*(1-Math.abs(a.color.l-b.color.l)));
  if(intent==='mood'||intent==='fun')return clamp(.55*analogous+.45*complementary);
  return clamp(.65*analogous+.35*(1-Math.abs(a.color.l-b.color.l)));
}
function intentFitScore(type,intent){
  const fit={
    product:{hero:.98,editorial:.95,balanced:.82,grid:.72,masonry:.64,filmstrip:.55,stack:.48,asymmetric:.70,mosaic:.58,polaroid:.40,tilt:.44,exploded:.42},
    mood:{mosaic:.98,asymmetric:.94,stack:.90,polaroid:.86,tilt:.82,exploded:.80,masonry:.66,editorial:.56,hero:.52,balanced:.48,grid:.45,filmstrip:.50},
    social:{hero:.94,balanced:.86,grid:.81,tilt:.76,editorial:.74,mosaic:.72,asymmetric:.69,masonry:.62,filmstrip:.56,stack:.58,polaroid:.63,exploded:.50},
    album:{grid:.95,masonry:.92,filmstrip:.88,balanced:.86,editorial:.62,hero:.55,stack:.50,asymmetric:.58,mosaic:.64,polaroid:.54,tilt:.56,exploded:.46},
    event:{editorial:.94,hero:.86,asymmetric:.83,balanced:.76,grid:.63,mosaic:.61,masonry:.57,filmstrip:.55,stack:.53,polaroid:.48,tilt:.52,exploded:.44},
    wall:{masonry:.93,grid:.88,filmstrip:.82,exploded:.78,balanced:.76,hero:.60,editorial:.57,mosaic:.64,asymmetric:.62,stack:.65,polaroid:.50,tilt:.56},
    marketing:{hero:.95,editorial:.93,mosaic:.78,balanced:.75,asymmetric:.74,grid:.62,masonry:.58,filmstrip:.52,stack:.56,polaroid:.44,tilt:.50,exploded:.48},
    fun:{tilt:.96,polaroid:.94,exploded:.90,stack:.88,mosaic:.84,asymmetric:.76,filmstrip:.62,masonry:.58,balanced:.53,grid:.51,hero:.49,editorial:.46}
  };
  return fit[intent]?.[type]??.55;
}

function pairRhythmScore(a,b,intent,type){
  const densityDelta=a.density===b.density?0:.75;
  const orient=orientationDiversity(a,b);
  const color=pairColorScore(a,b,intent);
  const lum=1-Math.min(1,Math.abs((a.analysis?.luminance??.5)-(b.analysis?.luminance??.5))*1.7);
  const detail=clamp(.35*densityDelta+.35*orient+.2*color+.1*lum);
  if(['grid','balanced'].includes(type))return clamp(.35*color+.28*lum+.22*orient+.15*(1-Math.abs(a.salience-b.salience)));
  if(type==='filmstrip')return clamp(.38*orient+.28*color+.20*densityDelta+.14*lum);
  return clamp(.38*detail+.32*color+.18*orient+.12*lum);
}

function neighborPairs(slots,canvas){
  const pairs=[];
  for(let i=0;i<slots.length;i++){
    const ranks=[];
    for(let j=0;j<slots.length;j++)if(i!==j)ranks.push([proximity(slots[i],slots[j],canvas),j]);
    ranks.sort((a,b)=>b[0]-a[0]);
    for(const [p,j] of ranks.slice(0,2)) if(p>.22 && i<j)pairs.push([i,j,p]);
  }
  return pairs;
}

function spacingScore(objects,canvas){
  const xs=[],ys=[];
  for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
    const a=objects[i],b=objects[j];
    const xOverlap=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));
    const yOverlap=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    if(yOverlap>Math.min(a.h,b.h)*.45){
      const g=Math.max(0,Math.max(a.x-b.x-b.w,b.x-a.x-a.w));xs.push(g/canvas.w);
    }
    if(xOverlap>Math.min(a.w,b.w)*.45){
      const g=Math.max(0,Math.max(a.y-b.y-b.h,b.y-a.y-a.h));ys.push(g/canvas.h);
    }
  }
  const groups=[...xs,...ys];
  if(groups.length<2)return .72;
  const m=mean(groups),variance=mean(groups.map(g=>sq(g-m)));
  return clamp(1-Math.sqrt(variance)*5.2);
}

function alignmentScore(objects,canvas){
  if(objects.length<2)return .6;
  const tol=Math.max(canvas.w,canvas.h)*.008;
  let matches=0,total=0;
  for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
    const a=objects[i],b=objects[j];
    total+=2;
    if(Math.abs(a.x-b.x)<tol||Math.abs(a.x+a.w-b.x-b.w)<tol||Math.abs(a.x+a.w/2-b.x-b.w/2)<tol)matches++;
    if(Math.abs(a.y-b.y)<tol||Math.abs(a.y+a.h-b.y-b.h)<tol||Math.abs(a.y+a.h/2-b.y-b.h/2)<tol)matches++;
  }
  return clamp(matches/Math.max(1,total));
}

function overlapQuality(objects,type){
  let overlapArea=0,pairs=0;
  for(let i=0;i<objects.length;i++)for(let j=i+1;j<objects.length;j++){
    const a=objects[i],b=objects[j];
    const area=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    overlapArea+=area;pairs++;
  }
  if(!pairs)return type==='stack'||type==='polaroid'?.55:1;
  const ratio=overlapArea/(objects.reduce((s,o)=>s+o.w*o.h,0)||1);
  const desired=['stack','polaroid'].includes(type)?.18:['exploded','mosaic','asymmetric','tilt'].includes(type)?.035:0;
  return clamp(1-Math.abs(ratio-desired)*7);
}

function edgeBalance(objects,canvas){
  if(!objects.length)return 0;
  let left=0,right=0,top=0,bottom=0;
  for(const o of objects){const area=o.w*o.h, c=rectCenter(o);if(c.x<canvas.w/2)left+=area;else right+=area;if(c.y<canvas.h/2)top+=area;else bottom+=area;}
  const horiz=1-Math.abs(left-right)/Math.max(1,left+right), vert=1-Math.abs(top-bottom)/Math.max(1,top+bottom);
  return clamp((horiz+vert)/2);
}

function focalSafety(objects,runtimeAssets){
  const vals=[];
  for(const o of objects.filter(o=>o.type==='image')){
    const a=getAssetAnalysis(runtimeAssets,o);
    if(!a)continue;
    vals.push(subjectVisibility(o,a).overall);
  }
  return mean(vals)||1;
}

function hierarchyScore(objects,profiles,type,intent){
  const areaSorted=[...objects].sort((a,b)=>b.w*b.h-a.w*a.h);
  const salSorted=[...profiles].sort((a,b)=>b.salience-a.salience);
  if(!areaSorted.length)return .5;
  const topArea=areaSorted[0], topProfile=profiles.find(p=>p.object.id===topArea.id);
  if(['hero','editorial'].includes(type)||['product','marketing','event'].includes(intent)){
    if(!topProfile)return .5;
    const salRank=salSorted.findIndex(p=>p.object.id===topProfile.object.id);
    const rankScore=salSorted.length<=1?1:1-salRank/(salSorted.length-1);
    return clamp(.45+rankScore*.55);
  }
  const areaShare=(topArea.w*topArea.h)/(objects.reduce((s,o)=>s+o.w*o.h,0)||1);
  return clamp(.65-Math.abs(areaShare-.28)*.8);
}

function visualCenterScore(objects,profiles,canvas,type){
  let sx=0,sy=0,w=0;
  objects.forEach(o=>{
    const p=profiles.find(p=>p.object.id===o.id);const weight=(o.w*o.h)*(p?.salience??.5);
    const c=rectCenter(o);sx+=c.x*weight;sy+=c.y*weight;w+=weight;
  });
  if(!w)return .5;
  let tx=.5,ty=.5;
  if(['hero','editorial','marketing','event'].includes(type)){tx=.46;ty=.47;}
  const dx=(sx/w)/canvas.w-tx,dy=(sy/w)/canvas.h-ty;
  return clamp(1-Math.hypot(dx,dy)*1.8);
}

function assignmentFitness(profile,slot,assigned,slotProfiles,project,type){
  const slotArea=slot.w*slot.h/(slot.canvasArea||1);
  let fit=slotRoleFit(profile,slot,type,project.intent)+slotThirdsBonus(slot,project.canvas,type);
  if(type==='hero'||type==='editorial'||(project.intent==='product'&&slotArea>.34))fit+=profile.salience*.45;
  if(type==='filmstrip' && profile.orientation==='LANDSCAPE')fit+=.18;
  if(['masonry','mosaic'].includes(type) && profile.orientation!=='SQUARE')fit+=.08;
  for(const pair of slotProfiles){
    const p=pair.profile;
    fit += pairRhythmScore(profile,p,project.intent,type)*pair.weight*.34;
  }
  return fit;
}

function totalAssignmentFitness(objects,slots,profiles,project,type){
  const pairs=neighborPairs(slots,project.canvas);
  const byId=new Map(objects.map((o,i)=>[o.id,{o,p:profiles.find(x=>x.object.id===o.id),slot:slots[i]}]));
  let s=0;
  for(const v of byId.values())s+=slotRoleFit(v.p,v.slot,type,project.intent)+slotThirdsBonus(v.slot,project.canvas,type);
  for(const [i,j,p] of pairs){
    const a=byId.get(objects[i].id),b=byId.get(objects[j].id); if(a&&b)s+=pairRhythmScore(a.p,b.p,project.intent,type)*p*.48;
  }
  return s;
}

export function composeObjects(objects,rects,project,runtimeAssets,type){
  const profiles=objects.map(o=>assetProfile(o,runtimeAssets));
  const slots=rects.map((r,i)=>({...r,index:i,canvasW:project.canvas.w,canvasH:project.canvas.h,canvasArea:project.canvas.w*project.canvas.h}));
  if(objects.length<=1)return objects.map((o,i)=>({...o,...slots[i],scale:1,compositionRole:'HERO'}));

  const slotOrder=[...slots].sort((a,b)=>slotImportance(b,a.index,slots.length,type,project.intent)-slotImportance(a,a.index,slots.length,type,project.intent));
  const unassigned=new Set(profiles.map(p=>p.object.id));
  const assigned=[];
  const hierarchical=['hero','editorial'].includes(type)||['product','marketing','event'].includes(project.intent);
  for(let slotIndex=0;slotIndex<slotOrder.length;slotIndex++){
    const slot=slotOrder[slotIndex];
    let best=null;
    // Anchor the strongest visual to the most important slot for hierarchy-driven compositions.
    if(slotIndex===0 && hierarchical){
      best=profiles.filter(p=>unassigned.has(p.object.id)).sort((a,b)=>b.salience-a.salience)[0];
      if(best)best={p:best,score:best.salience+1};
    }
    if(!best)for(const p of profiles){
      if(!unassigned.has(p.object.id))continue;
      const local=assigned.filter(x=>x.profile).map(x=>({profile:x.profile,weight:proximity(slot,x.slot,project.canvas)}));
      const score=assignmentFitness(p,slot,assigned,local,project,type);
      if(!best||score>best.score)best={p,score};
    }
    if(!best)continue;
    unassigned.delete(best.p.object.id);
    assigned.push({slot,profile:best.p,score:best.score});
  }

  // Small local-search pass: swapping two assets is cheap at our max 9 images and can repair bad rhythm.
  let improved=true,passes=0;
  while(improved&&passes<3){
    improved=false;passes++;
    const base=totalAssignmentFitness(assigned.map(x=>x.profile.object),assigned.map(x=>x.slot),assigned.map(x=>x.profile),project,type);
    for(let i=0;i<assigned.length;i++)for(let j=i+1;j<assigned.length;j++){
      if(hierarchical && (i===0 || j===0)) continue;
      [assigned[i].profile,assigned[j].profile]=[assigned[j].profile,assigned[i].profile];
      const next=totalAssignmentFitness(assigned.map(x=>x.profile.object),assigned.map(x=>x.slot),assigned.map(x=>x.profile),project,type);
      if(next>base+0.002){improved=true;} else {[assigned[i].profile,assigned[j].profile]=[assigned[j].profile,assigned[i].profile];}
    }
  }

  const largestSlot=slotOrder[0];
  const salSorted=[...profiles].sort((a,b)=>b.salience-a.salience);
  const heroId=salSorted[0]?.object.id;
  return assigned.sort((a,b)=>a.slot.index-b.slot.index).map((item,i)=>{
    const role=item.profile.object.id===heroId?'HERO':i===0?'PRIMARY':'SUPPORT';
    const target=item.slot;
    return {...item.profile.object,...target,scale:1,focalX:item.profile.object.focalX??item.profile.analysis?.focalX??.5,focalY:item.profile.object.focalY??item.profile.analysis?.focalY??.5,compositionRole:role};
  });
}

export function evaluateComposition(objects,project,runtimeAssets,type=project.layout.type){
  const imgs=objects.filter(o=>o.type==='image');
  if(!imgs.length)return {score:0,metrics:{},insights:['ADD PHOTOS TO ACTIVATE COMPOSITION INTELLIGENCE.'],roles:[]};
  const profiles=imgs.map(o=>assetProfile(o,runtimeAssets));
  const pairs=neighborPairs(imgs,project.canvas);
  const byObject=new Map(profiles.map(p=>[p.object.id,p]));
  const rhythm=mean(pairs.map(([i,j,p])=>pairRhythmScore(byObject.get(imgs[i].id),byObject.get(imgs[j].id),project.intent,type)*p))||.62;
  const hierarchy=hierarchyScore(imgs,profiles,type,project.intent);
  const spacing=spacingScore(imgs,project.canvas);
  const alignment=alignmentScore(imgs,project.canvas);
  const edge= requireMoodEdgeBalance(type,imgs,project.canvas);
  const focal=focalSafety(imgs,runtimeAssets);
  const overlap=overlapQuality(imgs,type);
  const center=visualCenterScore(imgs,profiles,project.canvas,type);
  const intentFit=intentFitScore(type,project.intent);
  const coverage=clamp(imgs.reduce((s,o)=>s+o.w*o.h,0)/(project.canvas.w*project.canvas.h));
  const coverageScore=clamp(1-Math.abs(coverage-(type==='filmstrip'?.46:type==='stack'?.58:.68))*1.75);
  const score=clamp(
    intentFit*.16 + hierarchy*.15 + rhythm*.16 + spacing*.11 + alignment*.10 + edge*.09 + focal*.12 + overlap*.05 + center*.03 + coverageScore*.03
  );
  const roles=profiles.sort((a,b)=>b.salience-a.salience).map((p,i)=>({name:p.object.name||`PHOTO ${i+1}`,role:i===0?'HERO':i<3?'SUPPORT':'DETAIL',salience:Math.round(p.salience*100)}));
  const insights=[];
  if(intentFit>.88)insights.push('LAYOUT FITS THE SELECTED INTENT'); else if(intentFit<.58)insights.push('LAYOUT FIGHTS THE SELECTED INTENT');
  if(hierarchy>.82)insights.push('STRONG VISUAL HIERARCHY'); else if(hierarchy<.58)insights.push('HERO SUBJECT COULD BE MORE PROMINENT');
  if(rhythm>.80)insights.push('GOOD IMAGE-TO-IMAGE RHYTHM'); else if(rhythm<.56)insights.push('ADJACENT IMAGES FEEL TOO SIMILAR');
  if(spacing>.82)insights.push('SPACING IS CONSISTENT'); else if(spacing<.58)insights.push('GAP RHYTHM NEEDS TUNING');
  if(alignment>.82)insights.push('CLEAN ALIGNMENT AXIS'); else if(alignment<.48)insights.push('ALIGNMENT IS INTENTIONALLY LOOSE');
  if(focal>.88)insights.push('FOCAL POINTS ARE PROTECTED'); else if(focal<.68)insights.push('SOME SUBJECTS MAY LOSE FOCUS');
  const visionCount=profiles.filter(p=>p.analysis?.vision?.enhanced).length;
  if(visionCount) insights.push(`${visionCount} IMAGE${visionCount===1?'':'S'} USING VISION-ENHANCED SUBJECT PROTECTION`);
  if(center>.80)insights.push('VISUAL WEIGHT IS BALANCED');
  if(!insights.length)insights.push('COMPOSITION IS BALANCED FOR THE CURRENT INTENT');
  return {score,metrics:{intentFit,hierarchy,rhythm,spacing,alignment,balance:edge,focal,overlap,coverage:coverageScore,visualCenter:center},insights:insights.slice(0,4),roles};
}

function requireMoodEdgeBalance(type,objects,canvas){
  const base=edgeBalance(objects,canvas);
  if(['stack','polaroid','tilt','exploded'].includes(type))return clamp(base*.82+.18);
  return base;
}

export function compositionExplanation(report,project,type){
  const intent=String(project.intent||'').toUpperCase();
  const parts=[`${intent} INTENT`,...report.insights.slice(0,2)];
  if(report.roles?.[0])parts.push(`${report.roles[0].name.toUpperCase()} LEADS THE COMPOSITION`);
  return parts.join(' • ');
}

export function compositionLabel(report){
  if(!report)return 'ANALYZING';
  return `${Math.round(report.score*100)}% COMPOSITION FIT`;
}
