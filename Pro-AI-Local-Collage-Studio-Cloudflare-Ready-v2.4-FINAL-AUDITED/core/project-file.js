const MAGIC='LOCALCOLLAGE1';
const MAX_PROJECT_FILE_BYTES=512*1024*1024;
const MAX_PROJECT_ASSETS=9;
const enc=new TextEncoder(), dec=new TextDecoder();
const MAGIC_BYTES=enc.encode(MAGIC);

export async function packProject(project, assets){
  const sourceAssets=(assets||[]).filter(a=>a?.id&&a?.blob).slice(0,MAX_PROJECT_ASSETS);
  const bins=[]; let offset=0;
  for(const a of sourceAssets){
    if(!a?.id||!a?.blob)continue;
    const length=a.blob.size||0;
    bins.push({id:a.id,name:a.name||'Image',type:a.blob.type||a.type||'application/octet-stream',offset,length});
    offset+=length;
  }
  const header=enc.encode(JSON.stringify({magic:MAGIC,version:2,project,assets:bins}));
  const prefix=new Uint8Array(MAGIC_BYTES.length+4+header.length);
  prefix.set(MAGIC_BYTES,0);
  new DataView(prefix.buffer).setUint32(MAGIC_BYTES.length,header.length,true);
  prefix.set(header,MAGIC_BYTES.length+4);
  // Blob parts are referenced lazily by the browser instead of copying every source image into one ArrayBuffer.
  const parts=[prefix];
  for(const a of sourceAssets)parts.push(a.blob);
  const out=new Blob(parts,{type:'application/x-localcollage'});
  if(out.size>MAX_PROJECT_FILE_BYTES)throw new Error('LOCALCOLLAGE_FILE_TOO_LARGE');
  return out;
}

async function readHeader(file){
  if(!file || file.size<MAGIC_BYTES.length+4)throw new Error('INVALID_LOCALCOLLAGE_FILE');
  const prefix=new Uint8Array(await file.slice(0,MAGIC_BYTES.length+4).arrayBuffer());
  const magic=dec.decode(prefix.slice(0,MAGIC_BYTES.length));
  if(magic!==MAGIC)throw new Error('NOT_A_LOCALCOLLAGE_FILE');
  const headerLen=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength).getUint32(MAGIC_BYTES.length,true);
  const headerStart=MAGIC_BYTES.length+4,headerEnd=headerStart+headerLen;
  if(headerEnd>file.size||headerLen<2||headerLen>32*1024*1024)throw new Error('INVALID_LOCALCOLLAGE_HEADER');
  const headerText=await file.slice(headerStart,headerEnd).text();
  return {headerStart,headerEnd,data:JSON.parse(headerText)};
}

export async function unpackProject(file){
  if(!file || file.size>MAX_PROJECT_FILE_BYTES)throw new Error('LOCALCOLLAGE_FILE_TOO_LARGE');
  const {headerEnd,data}=await readHeader(file);
  if(data?.magic!==MAGIC||!data?.project||!Array.isArray(data.assets))throw new Error('INVALID_LOCALCOLLAGE_PROJECT');
  if(data.assets.length>MAX_PROJECT_ASSETS)throw new Error('TOO_MANY_ASSETS');
  const ids=new Set(), assets=[];
  for(const meta of data.assets){
    if(!meta?.id || ids.has(meta.id) || String(meta.id).length>120)throw new Error('INVALID_LOCALCOLLAGE_ASSET_ID');
    ids.add(meta.id);
    const offset=Number(meta.offset),length=Number(meta.length);
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||headerEnd+offset+length>file.size)throw new Error('INVALID_LOCALCOLLAGE_ASSET_RANGE');
    const blob=file.slice(headerEnd+offset,headerEnd+offset+length,meta.type||'application/octet-stream');
    assets.push({id:meta.id,name:meta.name||'Image',type:meta.type||blob.type,blob});
  }
  return {project:data.project,assets,formatVersion:Number(data.version)||1};
}
