const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const defaultDevices = [
  {id:'mac',name:'MacBook iSupport',type:'Mac',online:true},
  {id:'iphone',name:'iPhone Daniel',type:'iPhone',online:true},
  {id:'android',name:'Android Daniel',type:'Android',online:true},
  {id:'windows',name:'Windows Taller',type:'Windows',online:false}
];
const icons = {Mac:'▱',iPhone:'▯',Android:'♟',Windows:'⊞'};
let devices = JSON.parse(localStorage.getItem('transfer.devices')||'null') || defaultDevices;
let recents = JSON.parse(localStorage.getItem('transfer.recents')||'null') || [
  {title:'proyecto.zip',meta:'12,4 MB · Hace 18 minutos',icon:'▧'},
  {title:'foto-show.jpg',meta:'2,1 MB · Hace 1 hora',icon:'▣'}
];
let deferredPrompt=null;

function save(){ localStorage.setItem('transfer.devices',JSON.stringify(devices)); localStorage.setItem('transfer.recents',JSON.stringify(recents)); }
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.remove('show'),2200)}
function renderDevices(){
  $('#deviceList').innerHTML=devices.map(d=>`<div class="device-row"><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Disponible':'Desconectado'}</div></div><span class="ellipsis">•••</span></div>`).join('');
  $('#sendDeviceList').innerHTML=devices.map(d=>`<label class="select-device"><input type="checkbox" value="${d.id}" ${d.online?'':'disabled'}><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Disponible':'Desconectado'}</div></div></label>`).join('');
}
function renderRecents(){
  $('#recentList').innerHTML=recents.length?recents.slice(0,6).map(r=>`<div class="recent-row"><div class="recent-icon">${r.icon||'▧'}</div><div class="recent-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.meta)}</small></div><span class="ellipsis">•••</span></div>`).join(''):`<div class="recent-row"><div class="recent-main"><strong>Sin actividad reciente</strong><small>Lo que envíes aparecerá aquí.</small></div></div>`;
}
function escapeHtml(s=''){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

function applyTheme(mode){
  localStorage.setItem('transfer.theme',mode);
  if(mode==='auto'){document.documentElement.removeAttribute('data-theme')}
  else document.documentElement.dataset.theme=mode;
  $$('input[name="theme"]').forEach(r=>r.checked=r.value===mode);
}
applyTheme(localStorage.getItem('transfer.theme')||'auto');

$('#settingsBtn').onclick=()=>$('#settingsDialog').showModal();
$$('input[name="theme"]').forEach(r=>r.onchange=()=>applyTheme(r.value));

$('#sendBtn').onclick=()=>{ $('#sendText').value=$('#clipboardPreview').textContent.includes('Toca “Pegar”')?'':$('#clipboardPreview').textContent; $('#sendDialog').showModal(); };
$$('.segment').forEach(btn=>btn.onclick=()=>{ $$('.segment').forEach(x=>x.classList.toggle('active',x===btn)); const file=btn.dataset.kind==='file'; $('#fileAreaWrap').classList.toggle('hidden',!file); $('#textAreaWrap').classList.toggle('hidden',file); });
$('#selectAll').onchange=e=>$$('#sendDeviceList input:not(:disabled)').forEach(c=>c.checked=e.target.checked);

$('#sendForm').addEventListener('submit',e=>{
  e.preventDefault();
  const selected=$$('#sendDeviceList input:checked').map(c=>devices.find(d=>d.id===c.value)).filter(Boolean);
  if(!selected.length){toast('Selecciona al menos un dispositivo');return}
  const isFile=$('.segment.active').dataset.kind==='file';
  let title,icon;
  if(isFile){const f=$('#fileInput').files[0]; if(!f){toast('Selecciona un archivo');return} title=f.name; icon='▧';}
  else {const txt=$('#sendText').value.trim(); if(!txt){toast('Escribe o pega un texto');return} title=txt.length>34?txt.slice(0,34)+'…':txt; icon='≡';}
  recents.unshift({title,meta:`Enviado a ${selected.map(d=>d.name).join(', ')} · ahora`,icon});
  recents=recents.slice(0,20);save();renderRecents();$('#sendDialog').close();toast('Transferencia preparada ✓');
});

$('#copyBtn').onclick=async()=>{
  const text=$('#clipboardPreview').textContent;
  try{await navigator.clipboard.writeText(text);toast('Copiado al portapapeles')}catch{toast('El navegador no permitió copiar')}
};
$('#pasteBtn').onclick=async()=>{
  try{const text=await navigator.clipboard.readText();if(!text){toast('El portapapeles está vacío');return}$('#clipboardTitle').textContent='Texto copiado listo para pegar';$('#clipboardPreview').textContent=text;$('#clipboardMeta').textContent='Leído desde este dispositivo · ahora';toast('Portapapeles actualizado');}
  catch{toast('Autoriza el acceso al portapapeles o pega manualmente')}
};

$('#clearRecentBtn').onclick=()=>{recents=[];save();renderRecents();toast('Actividad reciente eliminada')};
$('#addDeviceBtn').onclick=()=>{$('#pairCode').textContent=Math.random().toString(36).slice(2,4).toUpperCase()+'-'+Math.floor(10+Math.random()*90)+'-'+Math.random().toString(36).slice(2,4).toUpperCase();$('#deviceDialog').showModal()};
$('#deviceForm').addEventListener('submit',e=>{e.preventDefault();const name=$('#newDeviceName').value.trim();const type=$('#newDeviceType').value;if(!name)return;devices.push({id:crypto.randomUUID?.()||Date.now().toString(),name,type,online:true});save();renderDevices();$('#newDeviceName').value='';$('#deviceDialog').close();toast('Dispositivo vinculado')});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else toast('Usa “Añadir a pantalla de inicio” del navegador')};

$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.tab==='transfer')$('#sendDialog').showModal();if(b.dataset.tab==='profile')$('#settingsDialog').showModal()});

renderDevices();renderRecents();
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
