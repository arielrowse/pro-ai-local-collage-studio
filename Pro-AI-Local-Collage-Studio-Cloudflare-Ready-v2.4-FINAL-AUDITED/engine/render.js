import { getAssetAnalysis, sourceCropWindow } from './intelligence.js';
import { MAX_MEGAPIXELS } from '../core/model.js';

const checkerLight='#273449',checkerDark='#1d293b';
function roundRect(ctx,x,y,w,h,r){r=Math.max(0,Math.min(r,Math.min(w,h)/2));ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}}
function fillBackground(ctx,project,transparentPreview,transparentExport=false){if(transparentExport)return;if(project.canvas.mapping==='checker'&&transparentPreview){const s=24;ctx.fillStyle=checkerDark;ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.fillStyle=checkerLight;for(let y=0;y<ctx.canvas.height;y+=s)for(let x=0;x<ctx.canvas.width;x+=s)if(((x/s)+(y/s))%2===0)ctx.fillRect(x,y,s,s);return;}if(project.canvas.mapping==='checker'&&!transparentPreview)return;ctx.fillStyle=project.canvas.background||'#fff';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);}
function imageDraw(ctx,o,a,project){if(!a?.bitmap)return;ctx.save();ctx.translate(o.x+o.w/2,o.y+o.h/2);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.translate(-o.w/2,-o.h/2);const radius=Math.min(project.frame.radius,Math.min(o.w,o.h)/2);roundRect(ctx,0,0,o.w,o.h,radius);ctx.clip();const bw=a.bitmap.width,bh=a.bitmap.height,fit=Math.min(o.w/bw,o.h/bh),cover=Math.max(o.w/bw,o.h/bh);let s=o.fitMode==='never'?fit:cover;s*=o.fitMode==='never'?Math.min(1,Math.max(.1,Number(o.scale)||1)):Math.max(.1,Number(o.scale)||1);if(o.fitMode!=='never' && a.analysis){const win=sourceCropWindow(o,a.analysis);if(win){ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(a.bitmap,win.x*bw,win.y*bh,win.w*bw,win.h*bh,0,0,o.w,o.h);ctx.restore();return;}}const dw=bw*s,dh=bh*s;let x=(o.w-dw)/2,y=(o.h-dh)/2;if(o.fitMode!=='never'){const mx=Math.max(0,dw-o.w),my=Math.max(0,dh-o.h);x-=mx*((o.focalX??.5)-.5);y-=my*((o.focalY??.5)-.5);}ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(a.bitmap,x,y,dw,dh);ctx.restore();}
function objectDraw(ctx,o,runtimeAssets,project){if(o.hidden)return;ctx.save();if(o.type==='image'){imageDraw(ctx,o,runtimeAssets.get(o.assetId),project);}else if(o.type==='text'){ctx.translate(o.x,o.y);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.font=`${o.fontWeight||900} ${o.fontSize||46}px Inter,system-ui,sans-serif`;ctx.fillStyle=o.color||'#0f172a';ctx.textAlign=o.align||'left';ctx.textBaseline='middle';ctx.fillText(o.text||'TEXT',0,o.h/2,o.w);}else if(o.type==='swatch'){ctx.translate(o.x,o.y);ctx.rotate((o.rotation||0)*Math.PI/180);roundRect(ctx,0,0,o.w,o.h,o.radius||22);ctx.fillStyle=o.color||'#38bdf8';ctx.fill();}else if(o.type==='divider'){ctx.translate(o.x,o.y);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.fillStyle=o.color||'#38bdf8';ctx.fillRect(0,0,o.w,Math.max(1,o.h));}else if(o.type==='frame'){ctx.translate(o.x,o.y);ctx.rotate((o.rotation||0)*Math.PI/180);roundRect(ctx,0,0,o.w,o.h,o.radius||24);ctx.strokeStyle=o.stroke||'#38bdf8';ctx.lineWidth=o.strokeWidth||8;ctx.stroke();}ctx.restore();}
export function renderProject(ctx,project,runtimeAssets,{preview=true,selection=true,transparentExport=false,guides=[]}={}){ctx.save();ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);fillBackground(ctx,project,preview,transparentExport);const objs=[...project.objects].filter(o=>!o.hidden).sort((a,b)=>(a.z||0)-(b.z||0));for(const o of objs)objectDraw(ctx,o,runtimeAssets,project);if(guides.length)drawGuides(ctx,guides);if(selection&&project.selectedId){const o=project.objects.find(x=>x.id===project.selectedId);if(o&&!o.hidden)drawSelection(ctx,o,runtimeAssets);}ctx.restore();}
function drawSelection(ctx,o,runtimeAssets){ctx.save();const cx=o.x+o.w/2,cy=o.y+o.h/2;ctx.translate(cx,cy);ctx.rotate((o.rotation||0)*Math.PI/180);ctx.translate(-o.w/2,-o.h/2);ctx.strokeStyle='rgba(56,189,248,.98)';ctx.lineWidth=Math.max(3,Math.min(ctx.canvas.width,ctx.canvas.height)*.0016);ctx.setLineDash([12,8]);roundRect(ctx,0,0,o.w,o.h,Math.min(18,Math.min(o.w,o.h)/8));ctx.stroke();ctx.setLineDash([]);const ss=Math.max(10,Math.min(22,Math.min(ctx.canvas.width,ctx.canvas.height)/140));const handles=[[0,0],[o.w,0],[o.w,o.h],[0,o.h]];ctx.fillStyle='#38bdf8';for(const[hx,hy]of handles)ctx.fillRect(hx-ss/2,hy-ss/2,ss,ss);ctx.strokeStyle='#7dd3fc';ctx.beginPath();ctx.moveTo(o.w,0);ctx.lineTo(o.w,-44);ctx.stroke();ctx.beginPath();ctx.arc(o.w,-44,7,0,Math.PI*2);ctx.fill();if(o.type==='image'){const fx=Math.max(0,Math.min(1,o.focalX??.5))*o.w,fy=Math.max(0,Math.min(1,o.focalY??.5))*o.h;ctx.strokeStyle='rgba(248,250,252,.95)';ctx.lineWidth=Math.max(2,ss*.12);ctx.beginPath();ctx.moveTo(fx-12,fy);ctx.lineTo(fx+12,fy);ctx.moveTo(fx,fy-12);ctx.lineTo(fx,fy+12);ctx.stroke();ctx.beginPath();ctx.arc(fx,fy,4,0,Math.PI*2);ctx.stroke();}ctx.restore();}
function drawGuides(ctx,guides){if(!Array.isArray(guides)||!guides.length)return;ctx.save();ctx.strokeStyle='rgba(125,211,252,.88)';ctx.fillStyle='rgba(125,211,252,.96)';ctx.lineWidth=Math.max(2,Math.min(ctx.canvas.width,ctx.canvas.height)*.0007);ctx.setLineDash([10,8]);for(const g of guides){if(g.axis==='x'){ctx.beginPath();ctx.moveTo(g.value,0);ctx.lineTo(g.value,ctx.canvas.height);ctx.stroke();}else{ctx.beginPath();ctx.moveTo(0,g.value);ctx.lineTo(ctx.canvas.width,g.value);ctx.stroke();}}ctx.setLineDash([]);ctx.restore();}
export async function exportSource(blob){
  if(typeof createImageBitmap==='function')return await createImageBitmap(blob,{imageOrientation:'from-image'}).catch(()=>createImageBitmap(blob));
  const url=URL.createObjectURL(blob);
  try{
    const im=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('EXPORT_SOURCE_DECODE_FAILED'));image.src=url;});
    const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;
    const cx=c.getContext('2d');if(!cx)throw new Error('EXPORT_DECODER_UNAVAILABLE');
    cx.drawImage(im,0,0);return c;
  }finally{URL.revokeObjectURL(url);}
}

export async function exportBlob(project,runtimeAssets,format='png',quality=.92){
  const w=Number(project.canvas.w)||0,h=Number(project.canvas.h)||0;
  if(w<1||h<1)throw new Error('EXPORT_CANVAS_INVALID');
  if(w*h>MAX_MEGAPIXELS*1e6)throw new Error('EXPORT_CANVAS_TOO_LARGE');
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d',{alpha:true});if(!x)throw new Error('EXPORT_CONTEXT_UNAVAILABLE');
  const exportAssets=new Map(runtimeAssets); const temporary=[];
  const used=[...new Set(project.objects.filter(o=>o.type==='image').map(o=>o.assetId).filter(Boolean))];
  try{
    for(const id of used){
      const a=runtimeAssets.get(id); if(!a)continue;
      const sameSize=a.bitmap && a.bitmap.width===a.width && a.bitmap.height===a.height;
      if(sameSize)continue;
      if(!a.blob)throw new Error('EXPORT_SOURCE_MISSING');
      const bitmap=await exportSource(a.blob);
      exportAssets.set(id,{...a,bitmap});temporary.push(bitmap);
    }
    const exportProject={...project,canvas:{...project.canvas}};
    renderProject(x,exportProject,exportAssets,{preview:false,selection:false,transparentExport:!!project.canvas.__transparentExport});
    const type=format==='jpg'||format==='jpeg'?'image/jpeg':format==='webp'?'image/webp':'image/png';
    return await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('EXPORT_FAILED')),type,quality));
  }finally{for(const b of temporary)b.close?.();}
}
