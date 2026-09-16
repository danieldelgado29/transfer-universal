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
  {title:'proyecto.zip',meta:'12,4 MB · Enviado a MacBook iSupport · Hace 18 minutos',icon:'▧'},
  {title:'Texto pegado',meta:'En iPhone Daniel · Hace 1 hora',icon:'≡'},
  {title:'foto-show.jpg',meta:'2,1 MB · Recibido en Android Daniel · Hace 2 horas',icon:'▣'}
];
let deferredPrompt = null;
let clipboardText = localStorage.getItem('transfer.clipboard') || '';

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function save(){localStorage.setItem('transfer.devices',JSON.stringify(devices));localStorage.setItem('transfer.recents',JSON.stringify(recents));if(clipboardText)localStorage.setItem('transfer.clipboard',clipboardText)}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2100)}

function detectPlatform(){
  const ua=navigator.userAgent||''; const plat=navigator.platform||''; const touch=navigator.maxTouchPoints||0;
  if(/Android/i.test(ua)) return 'android';
  if(/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(plat)&&touch>1)) return 'ios';
  if(/Win/i.test(plat)||/Windows/i.test(ua)) return 'windows';
  if(/Mac/i.test(plat)||/Macintosh/i.test(ua)) return 'mac';
  return matchMedia('(max-width: 760px)').matches ? 'android' : 'windows';
}
function platformLabel(p){return ({ios:'iPhone',android:'Android',mac:'Mac',windows:'Windows'})[p]||p}
function applyPlatform(choice){
  localStorage.setItem('transfer.platform',choice);
  const actual=choice==='auto'?detectPlatform():choice;
  document.body.dataset.platform=actual;
  $$('input[name="platform"]').forEach(r=>r.checked=r.value===choice);
  const note=$('#platformNote'); if(note) note.textContent=`Vista activa: ${platformLabel(actual)}${choice==='auto'?' · detectada automáticamente':' · forzada para prueba'}`;
}

const mediaDark=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(choice){
  localStorage.setItem('transfer.theme',choice);
  const resolved=choice==='auto'?(mediaDark.matches?'dark':'light'):choice;
  document.documentElement.dataset.theme=resolved;
  $$('input[name="theme"]').forEach(r=>r.checked=r.value===choice);
  const labels={auto:'Automático',light:'Claro',dark:'Oscuro'}; const el=$('#windowsThemeValue'); if(el)el.textContent=labels[choice];
}
mediaDark.addEventListener?.('change',()=>{if((localStorage.getItem('transfer.theme')||'auto')==='auto')applyTheme('auto')});

applyPlatform(localStorage.getItem('transfer.platform')||'auto');
applyTheme(localStorage.getItem('transfer.theme')||'auto');

function deviceRows(compact=false){
  return devices.map(d=>`<div class="device-row"><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Disponible':'Desconectado'}</div></div><span class="ellipsis">•••</span></div>`).join('');
}
function recentRows(){
  if(!recents.length)return `<div class="recent-row"><div class="recent-main"><strong>Sin actividad reciente</strong><small>Lo que prepares para enviar aparecerá aquí.</small></div></div>`;
  return recents.slice(0,8).map(r=>`<div class="recent-row"><div class="recent-icon">${r.icon||'▧'}</div><div class="recent-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.meta)}</small></div><span class="ellipsis">•••</span></div>`).join('');
}
function render(){
  const rows=deviceRows(); ['#mobileDeviceList','#desktopDeviceList'].forEach(sel=>{const e=$(sel);if(e)e.innerHTML=rows});
  const rr=recentRows(); ['#mobileRecentList','#desktopRecentList'].forEach(sel=>{const e=$(sel);if(e)e.innerHTML=rr});
  const online=devices.filter(d=>d.online).length; if($('#onlineCount'))$('#onlineCount').textContent=online;
  $('#sendDeviceList').innerHTML=devices.map(d=>`<label class="select-device"><input type="checkbox" value="${d.id}" ${d.online?'':'disabled'}><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Disponible':'Desconectado'}</div></div></label>`).join('');
  updateClipboardUI();
}
function updateClipboardUI(){
  const preview=clipboardText||'Toca “Pegar” para leer tu portapapeles.';
  if($('#clipboardPreview'))$('#clipboardPreview').textContent=preview;
  if($('#desktopClipboardPreview'))$('#desktopClipboardPreview').textContent=preview;
  if(clipboardText){$('#clipboardTitle').textContent='Texto copiado listo para pegar';$('#clipboardMeta').textContent='Disponible en este dispositivo';}
}

function openSettings(){applyPlatform(localStorage.getItem('transfer.platform')||'auto');applyTheme(localStorage.getItem('transfer.theme')||'auto');$('#settingsDialog').showModal()}
['#mobileSettingsBtn','#desktopSettingsBtn','#themeShortcut','#windowsThemeBtn'].forEach(sel=>{const el=$(sel);if(el)el.onclick=openSettings});
$$('input[name="theme"]').forEach(r=>r.onchange=()=>applyTheme(r.value));
$$('input[name="platform"]').forEach(r=>r.onchange=()=>applyPlatform(r.value));

function openSend(prefillFile=null){
  if(prefillFile){$('.segment[data-kind="file"]').click(); const dt=new DataTransfer();dt.items.add(prefillFile);$('#fileInput').files=dt.files;}
  else{$('#sendText').value=clipboardText;}
  $('#sendDialog').showModal();
}
$$('[data-open-send]').forEach(b=>b.onclick=()=>openSend());
$$('.segment').forEach(btn=>btn.onclick=()=>{$$('.segment').forEach(x=>x.classList.toggle('active',x===btn));const file=btn.dataset.kind==='file';$('#fileAreaWrap').classList.toggle('hidden',!file);$('#textAreaWrap').classList.toggle('hidden',file)});
$('#selectAll').onchange=e=>$$('#sendDeviceList input:not(:disabled)').forEach(c=>c.checked=e.target.checked);

$('#sendForm').addEventListener('submit',e=>{
  e.preventDefault();
  const selected=$$('#sendDeviceList input:checked').map(c=>devices.find(d=>d.id===c.value)).filter(Boolean);
  if(!selected.length){toast('Selecciona al menos un dispositivo');return}
  const isFile=$('.segment.active').dataset.kind==='file'; let title,icon;
  if(isFile){const f=$('#fileInput').files[0];if(!f){toast('Selecciona un archivo');return}title=f.name;icon='▧';}
  else{const txt=$('#sendText').value.trim();if(!txt){toast('Escribe o pega un texto');return}title=txt.length>42?txt.slice(0,42)+'…':txt;icon='≡';}
  recents.unshift({title,meta:`Preparado para ${selected.map(d=>d.name).join(', ')} · ahora`,icon});recents=recents.slice(0,24);save();render();$('#sendDialog').close();toast('Transferencia preparada ✓');
});

const copyBtn=$('#copyBtn'); if(copyBtn)copyBtn.onclick=async()=>{const text=clipboardText||$('#clipboardPreview').textContent;try{await navigator.clipboard.writeText(text);toast('Copiado al portapapeles')}catch{toast('El navegador no permitió copiar')}};
const pasteBtn=$('#pasteBtn'); if(pasteBtn)pasteBtn.onclick=async()=>{try{const text=await navigator.clipboard.readText();if(!text){toast('El portapapeles está vacío');return}clipboardText=text;save();updateClipboardUI();toast('Portapapeles actualizado')}catch{toast('Autoriza el portapapeles o pega manualmente')}};

function clearRecents(){recents=[];save();render();toast('Actividad reciente eliminada')}
['#mobileClearRecentBtn','#desktopClearRecentBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=clearRecents});
function addDevice(){
  $('#pairCode').textContent=Math.random().toString(36).slice(2,4).toUpperCase()+'-'+Math.floor(10+Math.random()*90)+'-'+Math.random().toString(36).slice(2,4).toUpperCase();$('#deviceDialog').showModal();
}
['#mobileAddDeviceBtn','#desktopAddDeviceBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=addDevice});
$('#deviceForm').addEventListener('submit',e=>{e.preventDefault();const name=$('#newDeviceName').value.trim(),type=$('#newDeviceType').value;if(!name)return;devices.push({id:crypto.randomUUID?.()||Date.now().toString(),name,type,online:true});save();render();$('#newDeviceName').value='';$('#deviceDialog').close();toast('Dispositivo vinculado')});

const desktopFileBtn=$('#desktopFileBtn'); if(desktopFileBtn)desktopFileBtn.onclick=()=>$('#desktopFileInput').click();
$('#desktopFileInput').onchange=e=>{const f=e.target.files[0];if(f)openSend(f)};
const dz=$('#dropZone');
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.querySelector('.drop-zone').classList.add('dragover')}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.querySelector('.drop-zone').classList.remove('dragover')}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)openSend(f)});

$$('[data-tab]').forEach(b=>b.onclick=()=>{
  const group=b.closest('nav');if(group)group.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  const tab=b.dataset.tab;if(tab==='transfer')openSend();if(tab==='settings'||tab==='profile')openSettings();if(tab==='devices')toast('Gestión de dispositivos disponible en esta pantalla');if(tab==='clipboard')toast('Historial de portapapeles: siguiente módulo');
});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else toast('Usa “Añadir a pantalla de inicio” del navegador')};

render();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
