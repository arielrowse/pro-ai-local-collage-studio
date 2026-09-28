const SUPPORT_URL = 'https://ko-fi.com/arielrowse';
const SHARE_TEXT = 'Free Local Collage Maker & Mood Board Studio — smart composition, no watermark, local-first.';
let wired = false;
let activeCleanup = null;

function shareUrl(){
  try { const u = new URL(window.location.href); u.hash = ''; return u.href; }
  catch { return window.location.href; }
}
function esc(value=''){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function coffeeIcon(){
  return `<svg class="coffee-line-icon" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
    <defs><filter id="coffeeGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g fill="none" stroke="#7dd3fc" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#coffeeGlow)">
      <path d="M23 36h39v21c0 10-7 17-19 17S23 67 23 57Z"/>
      <path d="M62 42h8c8 0 12 5 12 11s-4 11-12 11h-8"/>
      <path d="M28 78h40"/>
      <path d="M34 25c-4-6 6-8 2-15"/>
      <path d="M49 25c-4-6 6-8 2-15"/>
      <path d="M55 34c-1-4 3-5 1-9"/>
    </g>
    <circle cx="74" cy="56" r="2.2" fill="#38bdf8" filter="url(#coffeeGlow)"/>
  </svg>`;
}
function getRoot(){
  let root=document.getElementById('supportShareRoot');
  if(!root){root=document.createElement('div');root.id='supportShareRoot';document.body.appendChild(root);}
  return root;
}
function notify(root,message,kind=''){
  const el=root.querySelector('[data-share-status]');
  if(el){el.textContent=message;el.className=`support-share-status ${kind}`.trim();}
}
function cleanup(){
  if(typeof activeCleanup==='function')activeCleanup();
  activeCleanup=null;
  const root=document.getElementById('supportShareRoot');if(root)root.innerHTML='';
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function copyText(value){
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value);return true;}
  const ta=document.createElement('textarea');ta.value=value;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();let ok=false;try{ok=document.execCommand('copy');}catch{}ta.remove();return ok;
}
function socialLinks(url){
  const text=encodeURIComponent(SHARE_TEXT);
  const u=encodeURIComponent(url);
  return {
    WhatsApp:`https://wa.me/?text=${text}%20${u}`,
    LinkedIn:`https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    Facebook:`https://www.facebook.com/sharer/sharer.php?u=${u}`,
    Telegram:`https://t.me/share/url?url=${u}&text=${text}`
  };
}
function openShareFallback(){
  const root=getRoot();
  const url=shareUrl();
  const links=socialLinks(url);
  root.innerHTML=`<div class="support-overlay" data-share-overlay>
    <section class="support-modal share-only" role="dialog" aria-modal="true" aria-labelledby="shareTitle">
      <div class="support-modal-head"><div><div class="support-eyebrow">SHARE STUDIO</div><h2 id="shareTitle">SHARE THIS FREE TOOL</h2></div><button class="support-close" data-close-share type="button" aria-label="Close share dialog">×</button></div>
      <p class="support-copy">SHARE THE STUDIO WITH CREATORS WHO MIGHT FIND IT USEFUL.</p>
      <div class="share-link-row"><input class="support-share-input" data-share-input readonly value="${esc(url)}" aria-label="Page share link"><button class="share-copy-btn" data-copy-share type="button">COPY LINK</button></div>
      <div class="share-social-grid">${Object.entries(links).map(([name,href])=>`<a class="share-social-btn" href="${href}" target="_blank" rel="noopener noreferrer" data-share-social>${name}</a>`).join('')}</div>
      <button class="primary share-device-btn" data-device-share type="button">SHARE USING THIS DEVICE</button>
      <div class="support-share-status" data-share-status>SHARE LINK READY.</div>
    </section></div>`;
  const close=()=>{root.innerHTML='';document.removeEventListener('keydown',onKey);};
  const onKey=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',onKey);
  root.querySelector('[data-close-share]').onclick=close;
  root.querySelector('[data-share-overlay]').onclick=e=>{if(e.target===e.currentTarget)close();};
  root.querySelector('[data-copy-share]').onclick=async()=>{const ok=await copyText(url);notify(root,ok?'LINK COPIED TO CLIPBOARD':'COPY IS NOT AVAILABLE IN THIS BROWSER',ok?'success':'error');};
  root.querySelector('[data-device-share]').onclick=async()=>{const result=await nativeShare();const ok=result==='shared';notify(root,ok?'SHARING READY':result==='cancelled'?'SHARING CANCELED':'DEVICE SHARING IS NOT AVAILABLE — USE COPY OR A SOCIAL OPTION',ok?'success':result==='cancelled'?'':'error');};
}
async function nativeShare(){
  const url=shareUrl();
  if(!navigator.share)return 'unsupported';
  try{await navigator.share({title:'Pro AI Local Collage Studio',text:SHARE_TEXT,url});return 'shared';}
  catch(e){return e?.name==='AbortError'?'cancelled':'failed';}
}
export async function sharePage(){
  const result=await nativeShare();
  if(result==='shared'||result==='cancelled')return result==='shared';
  openShareFallback();
  return false;
}
export function openDownloadSupportModal(blob,filename,format='PNG'){
  cleanup();
  const root=getRoot();
  root.innerHTML=`<div class="support-overlay" data-share-overlay>
    <section class="support-modal download-support" role="dialog" aria-modal="true" aria-labelledby="downloadSupportTitle">
      <div class="support-modal-head"><div><div class="support-eyebrow">${esc(String(format).toUpperCase())} EXPORT READY</div><h2 id="downloadSupportTitle">YOUR DOWNLOAD IS READY</h2></div><button class="support-close" data-close-share type="button" aria-label="Close download dialog">×</button></div>
      <div class="support-hero"><div class="coffee-art">${coffeeIcon()}</div><div><div class="support-mini-title">A LITTLE COFFEE KEEPS THE STUDIO GOING</div><p class="support-copy">ENJOYING THE EXPERIENCE? SUPPORTING THE PROJECT HELPS ME KEEP THIS SITE FREE FOR EVERYONE. DONATION IS COMPLETELY OPTIONAL — YOUR DOWNLOAD IS ALWAYS FREE.</p></div></div>
      <div class="support-download-grid">
        <button class="primary support-main-action" data-download-now type="button">DOWNLOAD NOW</button>
        <button class="support-btn" data-support-download type="button"><span>☕</span> SUPPORT ME</button>
      </div>
      <div class="support-subcopy">SUPPORT CAN BE $1 OR ANY AMOUNT YOU CHOOSE. <a href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer">OPEN KO-FI</a></div>
      <div class="support-divider"><span>SHARE LINK</span></div>
      <div class="share-link-row"><input class="support-share-input" data-share-input readonly value="${esc(shareUrl())}" aria-label="Page share link"><button class="share-copy-btn" data-copy-share type="button">COPY LINK</button></div>
      <div class="share-social-grid">${Object.entries(socialLinks(shareUrl())).map(([name,href])=>`<a class="share-social-btn" href="${href}" target="_blank" rel="noopener noreferrer" data-share-social>${name}</a>`).join('')}</div>
      <button class="secondary share-device-btn" data-device-share type="button">SHARE USING THIS DEVICE</button>
      <div class="support-share-status" data-share-status>YOUR FILE HAS NOT STARTED DOWNLOADING YET.</div>
    </section></div>`;
  const close=()=>cleanup();
  const onKey=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',onKey);
  activeCleanup=()=>document.removeEventListener('keydown',onKey);
  root.querySelector('[data-close-share]').onclick=close;
  root.querySelector('[data-share-overlay]').onclick=e=>{if(e.target===e.currentTarget)close();};
  root.querySelector('[data-download-now]').onclick=()=>{downloadBlob(blob,filename);notify(root,'DOWNLOAD STARTED • THANK YOU FOR USING THE STUDIO','success');setTimeout(close,850);};
  root.querySelector('[data-support-download]').onclick=()=>{window.open(SUPPORT_URL,'_blank','noopener,noreferrer');downloadBlob(blob,filename);notify(root,'KO-FI OPENED • DOWNLOAD STARTED • THANK YOU','success');setTimeout(close,1000);};
  root.querySelector('[data-copy-share]').onclick=async()=>{const ok=await copyText(shareUrl());notify(root,ok?'LINK COPIED TO CLIPBOARD':'COPY IS NOT AVAILABLE IN THIS BROWSER',ok?'success':'error');};
  root.querySelector('[data-device-share]').onclick=async()=>{const result=await nativeShare();const ok=result==='shared';notify(root,ok?'SHARING READY':result==='cancelled'?'SHARING CANCELED':'DEVICE SHARING IS NOT AVAILABLE — USE COPY OR A SOCIAL OPTION',ok?'success':result==='cancelled'?'':'error');};
}
export function initSupportShare(){
  if(wired)return;wired=true;
  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('#shareBtn');
    if(btn){e.preventDefault();void sharePage(false);}
  });
}
export const SUPPORT_LINK=SUPPORT_URL;
export const SHARE_MESSAGE=SHARE_TEXT;
