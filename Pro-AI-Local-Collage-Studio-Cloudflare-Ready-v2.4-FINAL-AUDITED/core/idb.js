const DB_NAME='pro-local-collage';
const DB_VERSION=2;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});
      if(!db.objectStoreNames.contains('assets'))db.createObjectStore('assets',{keyPath:'key'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB unavailable'));
  });
}

function request(req){
  return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed'));});
}

export async function saveProjectState(record){
  const db=await openDB();
  const state={
    id:record.id,
    name:record.name,
    updatedAt:record.updatedAt||Date.now(),
    project:record.project,
    assetRefs:Array.isArray(record.assetRefs)?record.assetRefs:[]
  };
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readwrite');
    tx.objectStore('projects').put(state);
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{const e=tx.error||new Error('IndexedDB project save failed');db.close();reject(e)};
  });
}

export async function saveProjectAssets(projectId, assets){
  if(!assets?.length)return true;
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('assets','readwrite');
    const s=tx.objectStore('assets');
    for(const a of assets){
      if(!a?.id||!a?.blob)continue;
      s.put({key:`${projectId}:${a.id}`,projectId,assetId:a.id,name:a.name||'Image',type:a.type||a.blob.type||'application/octet-stream',blob:a.blob,bytes:a.bytes||a.blob.size||0,savedAt:Date.now()});
    }
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{const e=tx.error||new Error('IndexedDB asset save failed');db.close();reject(e)};
  });
}

export async function saveProject(record){
  const assets=Array.isArray(record.assets)?record.assets:[];
  const assetRefs=assets.map(a=>a?.id).filter(Boolean);
  await saveProjectState({...record,assetRefs});
  if(assets.length)await saveProjectAssets(record.id,assets);
  return true;
}

export async function getProject(id){
  const db=await openDB();
  const rec=await request(db.transaction('projects','readonly').objectStore('projects').get(id));
  if(!rec){db.close();return null;}
  const assets=await readAssetsForProject(db,id,rec.assetRefs);
  db.close();
  return {...rec,assets};
}

function readAssetsForProject(db,projectId,refs=[]){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('assets','readonly');
    const s=tx.objectStore('assets');
    const out=[];
    const r=s.openCursor();
    r.onsuccess=()=>{
      const c=r.result;
      if(!c){resolve(refs?.length?out.filter(a=>refs.includes(a.assetId)):out);return;}
      const v=c.value;
      if(v.projectId===projectId)out.push(v);
      c.continue();
    };
    r.onerror=()=>reject(r.error||new Error('IndexedDB asset read failed'));
  });
}

export async function getLatestProject(){
  const db=await openDB();
  const all=await request(db.transaction('projects','readonly').objectStore('projects').getAll());
  all.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  const rec=all[0]||null;
  if(!rec){db.close();return null;}

  // v1 records stored assets inline. Return them as-is so the app can migrate them on the next save.
  if(Array.isArray(rec.assets)&&rec.assets.length){db.close();return {...rec,assetPersistence:'embedded'};}
  const assets=await readAssetsForProject(db,rec.id,rec.assetRefs||[]);
  db.close();
  return {...rec,assets,assetPersistence:'store'};
}

export async function clearProjects(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['projects','assets'],'readwrite');
    tx.objectStore('projects').clear();
    tx.objectStore('assets').clear();
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{const e=tx.error||new Error('IndexedDB clear failed');db.close();reject(e)};
  });
}

export async function pruneProjectAssets(projectId, keepAssetIds=[]){
  const keep=new Set(keepAssetIds||[]);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('assets','readwrite');
    const s=tx.objectStore('assets');
    const r=s.openCursor();
    r.onsuccess=()=>{
      const c=r.result;
      if(!c)return;
      const v=c.value;
      if(v.projectId===projectId && !keep.has(v.assetId))c.delete();
      c.continue();
    };
    tx.oncomplete=()=>{db.close();resolve(true)};
    tx.onerror=()=>{const e=tx.error||new Error('IndexedDB asset prune failed');db.close();reject(e)};
  });
}
