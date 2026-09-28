const ACCEPTS=[{description:'Local Collage Project',accept:{'application/x-localcollage':['.localcollage']}}];

export function canUseFilePickers(){return typeof window.showSaveFilePicker==='function'&&typeof window.showOpenFilePicker==='function';}

export async function saveBlob(blob,name){
  if(typeof window.showSaveFilePicker==='function'){
    try{
      const handle=await window.showSaveFilePicker({suggestedName:name,types:ACCEPTS,excludeAcceptAllOption:false});
      const writable=await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    }catch(e){
      if(e?.name==='AbortError')return 'aborted';
    }
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  return 'download';
}

export async function openLocalCollage(){
  if(typeof window.showOpenFilePicker==='function'){
    try{
      const handles=await window.showOpenFilePicker({multiple:false,types:ACCEPTS,excludeAcceptAllOption:false});
      if(handles?.[0])return {status:'file',file:await handles[0].getFile()};
    }catch(e){
      if(e?.name==='AbortError')return {status:'aborted'};
    }
  }
  return {status:'fallback'};
}
