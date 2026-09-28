export async function storageHealth(){
  try{
    const storage=navigator.storage;
    if(!storage?.estimate)return {supported:false,persistent:false,usage:0,quota:0,ratio:0,label:'STORAGE API UNAVAILABLE'};
    const [estimate,persisted]=await Promise.all([
      storage.estimate().catch(()=>({usage:0,quota:0})),
      storage.persisted?storage.persisted().catch(()=>false):Promise.resolve(false)
    ]);
    const usage=Number(estimate.usage)||0, quota=Number(estimate.quota)||0;
    const ratio=quota?Math.max(0,Math.min(1,usage/quota)):0;
    return {supported:true,persistent:!!persisted,usage,quota,ratio,label:quota?`${Math.round(ratio*100)}% USED`:'LOCAL STORAGE'};
  }catch{return {supported:false,persistent:false,usage:0,quota:0,ratio:0,label:'STORAGE STATUS UNAVAILABLE'}}
}

export async function requestPersistentStorage(){
  try{
    if(!navigator.storage?.persist)return false;
    return !!(await navigator.storage.persist());
  }catch{return false}
}

export function formatStorageBytes(n){
  if(!Number.isFinite(n))return '—';
  const u=['B','KB','MB','GB','TB'];let i=0,v=n;
  while(v>=1024&&i<u.length-1){v/=1024;i++;}
  return `${v.toFixed(i?1:0)} ${u[i]}`;
}
