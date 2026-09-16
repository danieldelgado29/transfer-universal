const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const APP_PROTOCOL = 3;
const PEER_ID_PREFIX = 'tr-';
const RECONNECT_MS = 12000;
const MAX_RECENTS = 32;
const APP_VERSION = '3.3.0';
const UPDATE_CHECK_MS = 5 * 60 * 1000;
const icons = {Mac:'▱',iPhone:'▯',Android:'♟',Windows:'⊞'};

function escapeHtml(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function randomChars(n=12){const chars='abcdefghjkmnpqrstuvwxyz23456789';const a=new Uint8Array(n);crypto.getRandomValues(a);return [...a].map(v=>chars[v%chars.length]).join('')}
function randomToken(){const a=new Uint8Array(24);crypto.getRandomValues(a);return [...a].map(v=>v.toString(16).padStart(2,'0')).join('')}
function randomPin(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(100000+(a[0]%900000))}
function nowLabel(){return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}

function detectPlatform(){
  const ua=navigator.userAgent||''; const plat=navigator.platform||''; const touch=navigator.maxTouchPoints||0;
  if(/Android/i.test(ua)) return 'android';
  if(/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(plat)&&touch>1)) return 'ios';
  if(/Win/i.test(plat)||/Windows/i.test(ua)) return 'windows';
  if(/Mac/i.test(plat)||/Macintosh/i.test(ua)) return 'mac';
  return matchMedia('(max-width: 760px)').matches ? 'android' : 'windows';
}
function platformLabel(p){return ({ios:'iPhone',android:'Android',mac:'Mac',windows:'Windows'})[p]||p}
function typeFromPlatform(p){return ({ios:'iPhone',android:'Android',mac:'Mac',windows:'Windows'})[p]||'Windows'}
function defaultSelfName(){return platformLabel(detectPlatform())+' TRANSFER'}

function loadJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null') ?? fallback}catch{return fallback}}

let selfDevice = loadJSON('transfer.self', null) || {
  peerId: PEER_ID_PREFIX+randomChars(12),
  name: defaultSelfName(),
  type: typeFromPlatform(detectPlatform()),
  pin: randomPin()
};
selfDevice.type = typeFromPlatform(detectPlatform());
if(!selfDevice.peerId || !selfDevice.peerId.startsWith(PEER_ID_PREFIX)) selfDevice.peerId=PEER_ID_PREFIX+randomChars(12);
if(!selfDevice.pin) selfDevice.pin=randomPin();

let devices = loadJSON('transfer.devices', []);
// Migración V2: elimina dispositivos ficticios que no tenían un Peer ID real.
if(devices.length && devices.every(d=>!d.peerId)) devices=[];
devices = devices.filter(d=>d.peerId && d.peerId!==selfDevice.peerId).map(d=>({...d,online:false,lastSeen:d.lastSeen||null}));

let recents = loadJSON('transfer.recents', []);
let clipboardText = localStorage.getItem('transfer.clipboard') || '';
let deferredPrompt = null;
let peer = null;
let peerReady = false;
let networkError = '';
const connections = new Map(); // peerId -> authenticated DataConnection
const pendingPair = new Map(); // peerId -> DataConnection
const pendingAcks = new Map();

function save(){
  localStorage.setItem('transfer.self',JSON.stringify(selfDevice));
  localStorage.setItem('transfer.devices',JSON.stringify(devices.map(d=>({...d,online:false}))));
  localStorage.setItem('transfer.recents',JSON.stringify(recents));
  if(clipboardText)localStorage.setItem('transfer.clipboard',clipboardText);else localStorage.removeItem('transfer.clipboard');
}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),2400)}
function addRecent(title,meta,icon='≡',id=null){recents.unshift({id:id||crypto.randomUUID?.()||String(Date.now()),title,meta,icon,at:Date.now()});recents=recents.slice(0,MAX_RECENTS);save();renderRecents()}
function setNetworkBadge(state,text){
  ['#desktopNetworkBadge','#mobileNetworkBadge'].forEach(sel=>{const e=$(sel);if(!e)return;e.dataset.state=state;const sp=e.querySelector('span');if(sp)sp.textContent=text});
}
function updateNetworkBadge(){
  if(networkError){setNetworkBadge('error','Sin red P2P');return}
  if(!peerReady){setNetworkBadge('connecting','Conectando…');return}
  const n=devices.filter(d=>d.online).length;
  setNetworkBadge(n?'online':'ready',n?`${n} conectado${n===1?'':'s'}`:'P2P listo');
}
function findDevice(peerId){return devices.find(d=>d.peerId===peerId)}
function upsertDevice(info,token,online=true){
  if(!info?.peerId || info.peerId===selfDevice.peerId)return null;
  let d=findDevice(info.peerId);
  if(!d){d={id:info.peerId,peerId:info.peerId,name:info.name||'Dispositivo',type:info.type||'Windows',token:token||'',online,lastSeen:Date.now()};devices.push(d)}
  else{d.name=info.name||d.name;d.type=info.type||d.type;if(token)d.token=token;d.online=online;d.lastSeen=Date.now()}
  save();renderDevices();return d;
}
function markOnline(peerId,online){const d=findDevice(peerId);if(!d)return;d.online=online;if(online)d.lastSeen=Date.now();save();renderDevices()}

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

function deviceRows(){
  if(!devices.length)return `<div class="empty-state"><strong>No hay dispositivos vinculados</strong><small>Toca “Agregar” y usa el ID + PIN del otro equipo.</small></div>`;
  return devices.map(d=>`<div class="device-row" data-peer="${escapeHtml(d.peerId)}"><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Conectado':'Desconectado'}${d.lastSeen&&!d.online?` · visto ${new Date(d.lastSeen).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:''}</div></div><button class="ellipsis remove-device" type="button" data-remove-peer="${escapeHtml(d.peerId)}" title="Opciones">•••</button></div>`).join('');
}
function recentRows(){
  if(!recents.length)return `<div class="recent-row"><div class="recent-main"><strong>Sin actividad reciente</strong><small>Los textos enviados y recibidos aparecerán aquí.</small></div></div>`;
  return recents.slice(0,8).map(r=>`<div class="recent-row"><div class="recent-icon">${r.icon||'▧'}</div><div class="recent-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.meta)}</small></div><span class="ellipsis">•••</span></div>`).join('');
}
function renderDevices(){
  const rows=deviceRows(); ['#mobileDeviceList','#desktopDeviceList'].forEach(sel=>{const e=$(sel);if(e)e.innerHTML=rows});
  const online=devices.filter(d=>d.online).length;if($('#onlineCount'))$('#onlineCount').textContent=online;
  const send=$('#sendDeviceList');if(send)send.innerHTML=devices.length?devices.map(d=>`<label class="select-device ${d.online?'':'is-offline'}"><input type="checkbox" value="${escapeHtml(d.peerId)}" ${d.online?'':'disabled'}><div class="device-icon">${icons[d.type]||'▱'}</div><div class="device-main"><strong>${escapeHtml(d.name)}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Conectado':'Desconectado'}</div></div></label>`).join(''):`<div class="empty-state"><strong>Primero vincula otro equipo</strong><small>Ambos dispositivos deben tener TRANSFER abierto durante la primera vinculación.</small></div>`;
  updateNetworkBadge();
}
function renderRecents(){const rr=recentRows();['#mobileRecentList','#desktopRecentList'].forEach(sel=>{const e=$(sel);if(e)e.innerHTML=rr})}
function updateClipboardUI(){
  const preview=clipboardText||'Toca “Pegar” para leer tu portapapeles.';
  if($('#clipboardPreview'))$('#clipboardPreview').textContent=preview;
  if($('#desktopClipboardPreview'))$('#desktopClipboardPreview').textContent=preview;
  if($('#clipboardTitle'))$('#clipboardTitle').textContent=clipboardText?'Texto sincronizado listo para pegar':'Texto listo para compartir';
  if($('#clipboardMeta'))$('#clipboardMeta').textContent=clipboardText?'Guardado en TRANSFER':'Sin texto sincronizado';
}
function render(){renderDevices();renderRecents();updateClipboardUI();renderPairDialog()}

function selfInfo(){return {peerId:selfDevice.peerId,name:selfDevice.name,type:selfDevice.type}}
function renderPairDialog(){
  if($('#selfDeviceName'))$('#selfDeviceName').value=selfDevice.name;
  if($('#selfPeerId'))$('#selfPeerId').textContent=selfDevice.peerId;
  if($('#selfPairPin'))$('#selfPairPin').textContent=selfDevice.pin;
  const dot=$('#peerLiveDot');if(dot)dot.classList.toggle('on',peerReady);
}

function attachConnection(conn,{pairing=false,pin=''}={}){
  if(!conn)return;
  const remoteId=conn.peer;
  conn.on('open',()=>{
    if(pairing){pendingPair.set(remoteId,conn);conn.send({type:'pair-request',protocol:APP_PROTOCOL,pin,device:selfInfo()})}
    else{
      const d=findDevice(remoteId);
      if(!d?.token){conn.close();return}
      conn.send({type:'hello',protocol:APP_PROTOCOL,token:d.token,device:selfInfo()});
    }
  });
  conn.on('data',msg=>handleMessage(conn,msg));
  conn.on('close',()=>{if(connections.get(remoteId)===conn)connections.delete(remoteId);pendingPair.delete(remoteId);markOnline(remoteId,false)});
  conn.on('error',()=>{if(connections.get(remoteId)===conn)connections.delete(remoteId);pendingPair.delete(remoteId);markOnline(remoteId,false)});
}
function authenticate(conn,device){connections.set(conn.peer,conn);upsertDevice(device,null,true);updateNetworkBadge()}
function handleMessage(conn,msg){
  if(!msg || typeof msg!=='object')return;
  const remoteId=conn.peer;
  if(msg.protocol && msg.protocol!==APP_PROTOCOL){conn.send({type:'error',message:'Versión de protocolo incompatible'});return}

  if(msg.type==='pair-request'){
    if(String(msg.pin)!==String(selfDevice.pin)){conn.send({type:'pair-rejected',message:'PIN incorrecto'});setTimeout(()=>conn.close(),250);return}
    const token=randomToken();
    const d=upsertDevice({...msg.device,peerId:remoteId},token,true);
    connections.set(remoteId,conn);
    conn.send({type:'pair-accepted',protocol:APP_PROTOCOL,token,device:selfInfo()});
    selfDevice.pin=randomPin();save();renderPairDialog();renderDevices();
    addRecent('Dispositivo vinculado',`${d?.name||remoteId} · ahora`,'⇄');
    toast(`${d?.name||'Dispositivo'} vinculado ✓`);return;
  }
  if(msg.type==='pair-accepted'){
    const d=upsertDevice({...msg.device,peerId:remoteId},msg.token,true);
    connections.set(remoteId,conn);pendingPair.delete(remoteId);
    if($('#pairStatus'))$('#pairStatus').textContent=`Vinculado con ${d?.name||remoteId} ✓`;
    addRecent('Dispositivo vinculado',`${d?.name||remoteId} · ahora`,'⇄');
    toast('Dispositivo vinculado ✓');setTimeout(()=>$('#deviceDialog')?.close(),700);return;
  }
  if(msg.type==='pair-rejected'){
    pendingPair.delete(remoteId);if($('#pairStatus'))$('#pairStatus').textContent=msg.message||'No se pudo vincular';toast(msg.message||'Vinculación rechazada');return;
  }
  if(msg.type==='hello'){
    const d=findDevice(remoteId);
    if(!d || !d.token || msg.token!==d.token){conn.send({type:'error',message:'Dispositivo no autorizado'});setTimeout(()=>conn.close(),150);return}
    authenticate(conn,{...msg.device,peerId:remoteId});conn.send({type:'hello-accepted',protocol:APP_PROTOCOL,device:selfInfo()});return;
  }
  if(msg.type==='hello-accepted'){
    const d=findDevice(remoteId);if(!d)return;authenticate(conn,{...(msg.device||d),peerId:remoteId});return;
  }
  if(msg.type==='text'){
    const d=findDevice(remoteId);if(!d || connections.get(remoteId)!==conn)return;
    const text=String(msg.text||'');if(!text)return;
    clipboardText=text;save();updateClipboardUI();
    const title=text.length>48?text.slice(0,48)+'…':text;
    addRecent(title,`Recibido de ${d.name} · ${nowLabel()}`,'≡',msg.id);
    conn.send({type:'ack',id:msg.id,protocol:APP_PROTOCOL});
    toast(`Texto recibido de ${d.name}`);return;
  }
  if(msg.type==='ack'){
    const pending=pendingAcks.get(msg.id);if(pending){pending.ok.add(remoteId);if(pending.ok.size>=pending.expected){pendingAcks.delete(msg.id)}}return;
  }
  if(msg.type==='ping'){conn.send({type:'pong',t:msg.t,protocol:APP_PROTOCOL});return}
  if(msg.type==='pong'){markOnline(remoteId,true);return}
}

function connectDevice(d){
  if(!peerReady || !peer || !d?.peerId || d.peerId===selfDevice.peerId)return;
  const current=connections.get(d.peerId);if(current?.open){markOnline(d.peerId,true);return}
  try{const conn=peer.connect(d.peerId,{reliable:true,metadata:{app:'TRANSFER',protocol:APP_PROTOCOL}});attachConnection(conn)}catch{}
}
function reconnectAll(){if(!peerReady)return;devices.forEach(connectDevice)}

function initPeer(){
  updateNetworkBadge();
  if(typeof Peer==='undefined'){networkError='No se pudo cargar PeerJS';updateNetworkBadge();console.error(networkError);return}
  try{
    peer=new Peer(selfDevice.peerId,{debug:0});
    peer.on('open',id=>{peerReady=true;networkError='';selfDevice.peerId=id;save();renderPairDialog();updateNetworkBadge();reconnectAll()});
    peer.on('connection',conn=>attachConnection(conn));
    peer.on('disconnected',()=>{peerReady=false;updateNetworkBadge();try{peer.reconnect()}catch{}});
    peer.on('close',()=>{peerReady=false;updateNetworkBadge()});
    peer.on('error',err=>{
      console.warn('TRANSFER P2P',err);
      if(err?.type==='unavailable-id'){
        selfDevice.peerId=PEER_ID_PREFIX+randomChars(12);save();try{peer.destroy()}catch{};peer=null;setTimeout(initPeer,300);return;
      }
      networkError=err?.type||'error';updateNetworkBadge();
    });
  }catch(err){networkError=String(err);updateNetworkBadge()}
}

function openSettings(){applyPlatform(localStorage.getItem('transfer.platform')||'auto');applyTheme(localStorage.getItem('transfer.theme')||'auto');$('#settingsDialog').showModal()}
['#mobileSettingsBtn','#desktopSettingsBtn','#themeShortcut','#windowsThemeBtn'].forEach(sel=>{const el=$(sel);if(el)el.onclick=openSettings});
$$('input[name="theme"]').forEach(r=>r.onchange=()=>applyTheme(r.value));
$$('input[name="platform"]').forEach(r=>r.onchange=()=>applyPlatform(r.value));

function openSend(prefillFile=null){
  if(prefillFile){$('.segment[data-kind="file"]').click();try{const dt=new DataTransfer();dt.items.add(prefillFile);$('#fileInput').files=dt.files}catch{} }
  else{$('#sendText').value=clipboardText;$('.segment[data-kind="text"]').click()}
  renderDevices();$('#sendDialog').showModal();
}
$$('[data-open-send]').forEach(b=>b.onclick=()=>openSend());
$$('.segment').forEach(btn=>btn.onclick=()=>{$$('.segment').forEach(x=>x.classList.toggle('active',x===btn));const file=btn.dataset.kind==='file';$('#fileAreaWrap').classList.toggle('hidden',!file);$('#textAreaWrap').classList.toggle('hidden',file)});
$('#selectAll').onchange=e=>$$('#sendDeviceList input:not(:disabled)').forEach(c=>c.checked=e.target.checked);

$('#sendForm').addEventListener('submit',e=>{
  e.preventDefault();
  const selectedPeers=$$('#sendDeviceList input:checked').map(c=>c.value);
  if(!selectedPeers.length){toast('Selecciona al menos un dispositivo conectado');return}
  const isFile=$('.segment.active').dataset.kind==='file';
  if(isFile){toast('Archivos P2P llegan en la siguiente etapa');return}
  const text=$('#sendText').value.trim();if(!text){toast('Escribe o pega un texto');return}
  const msgId=crypto.randomUUID?.()||`${Date.now()}-${randomChars(6)}`;
  let sent=0;
  selectedPeers.forEach(peerId=>{const conn=connections.get(peerId);if(conn?.open){conn.send({type:'text',protocol:APP_PROTOCOL,id:msgId,text,sentAt:Date.now(),device:selfInfo()});sent++}});
  if(!sent){toast('Los dispositivos ya no están conectados');renderDevices();return}
  clipboardText=text;save();updateClipboardUI();
  const names=selectedPeers.map(id=>findDevice(id)?.name||id);
  addRecent(text.length>48?text.slice(0,48)+'…':text,`Enviado a ${names.join(', ')} · ${nowLabel()}`,'≡',msgId);
  pendingAcks.set(msgId,{expected:sent,ok:new Set(),at:Date.now()});
  $('#sendDialog').close();toast(`Texto enviado a ${sent} dispositivo${sent===1?'':'s'} ✓`);
});

const copyBtn=$('#copyBtn');if(copyBtn)copyBtn.onclick=async()=>{const text=clipboardText||$('#clipboardPreview')?.textContent||'';if(!text)return toast('No hay texto para copiar');try{await navigator.clipboard.writeText(text);toast('Copiado al portapapeles')}catch{toast('El navegador no permitió copiar')}};
const pasteBtn=$('#pasteBtn');if(pasteBtn)pasteBtn.onclick=async()=>{try{const text=await navigator.clipboard.readText();if(!text){toast('El portapapeles está vacío');return}clipboardText=text;save();updateClipboardUI();toast('Texto cargado en TRANSFER')}catch{toast('Autoriza el portapapeles o pega manualmente')}};

function clearRecents(){recents=[];save();renderRecents();toast('Actividad reciente eliminada')}
['#mobileClearRecentBtn','#desktopClearRecentBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=clearRecents});

function openDeviceDialog(){renderPairDialog();if($('#pairStatus'))$('#pairStatus').textContent=peerReady?'P2P listo para vincular.':'Conectando al servicio P2P…';$('#remotePeerId').value='';$('#remotePairPin').value='';$('#deviceDialog').showModal()}
['#mobileAddDeviceBtn','#desktopAddDeviceBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=openDeviceDialog});
$('#selfDeviceName')?.addEventListener('change',e=>{const v=e.target.value.trim();if(v){selfDevice.name=v;save();reconnectAll();toast('Nombre actualizado')}});
$('#rotatePinBtn')?.addEventListener('click',()=>{selfDevice.pin=randomPin();save();renderPairDialog();toast('PIN renovado')});
async function copyPlain(value,successLabel){
  try{await navigator.clipboard.writeText(String(value));toast(successLabel)}
  catch{toast(`No se pudo copiar automáticamente: ${value}`)}
}
$('#copySelfIdBtn')?.addEventListener('click',()=>copyPlain(selfDevice.peerId,'ID copiado ✓'));
$('#copySelfPinBtn')?.addEventListener('click',()=>copyPlain(selfDevice.pin,'PIN copiado ✓'));

function normalizeRemoteId(raw){
  const text=String(raw||'').trim().toLowerCase();
  const match=text.match(/tr-[a-z0-9-]{6,40}/);
  return match?match[0]:text.replace(/^transfer\s*id\s*:\s*/i,'').trim();
}
$('#remotePeerId')?.addEventListener('input',e=>{
  const cleaned=normalizeRemoteId(e.target.value);
  if(cleaned!==e.target.value && /^tr-[a-z0-9-]{6,40}$/.test(cleaned))e.target.value=cleaned;
});
$('#deviceForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!peerReady){toast('La red P2P todavía no está lista');return}
  const remoteId=normalizeRemoteId($('#remotePeerId').value);$('#remotePeerId').value=remoteId;const pin=$('#remotePairPin').value.trim();
  if(!/^tr-[a-z0-9-]{6,40}$/.test(remoteId)){toast('ID de dispositivo inválido');return}
  if(remoteId===selfDevice.peerId){toast('Ese es este mismo dispositivo');return}
  if(!/^\d{6}$/.test(pin)){toast('El PIN debe tener 6 números');return}
  $('#pairStatus').textContent='Conectando con el otro dispositivo…';
  try{const conn=peer.connect(remoteId,{reliable:true,metadata:{app:'TRANSFER',protocol:APP_PROTOCOL,pairing:true}});attachConnection(conn,{pairing:true,pin});setTimeout(()=>{if(!findDevice(remoteId) && $('#deviceDialog').open)$('#pairStatus').textContent='Aún no responde. Revisa que el otro dispositivo tenga TRANSFER abierto y el PIN sea actual.'},7000)}catch{$('#pairStatus').textContent='No se pudo iniciar la conexión.'}
});

// Cierre robusto de todas las ventanas modales. Los botones X nunca envían formularios.
$$('[data-close-dialog]').forEach(btn=>btn.addEventListener('click',()=>{
  const dialog=btn.closest('dialog');
  if(dialog?.open)dialog.close('cancel');
}));
$$('dialog.sheet').forEach(dialog=>{
  dialog.addEventListener('click',e=>{if(e.target===dialog && dialog.open)dialog.close('cancel')});
});

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-remove-peer]');if(!b)return;
  const peerId=b.dataset.removePeer;const d=findDevice(peerId);if(!d)return;
  if(!confirm(`¿Desvincular ${d.name}?`))return;
  try{connections.get(peerId)?.close()}catch{};connections.delete(peerId);devices=devices.filter(x=>x.peerId!==peerId);save();renderDevices();toast('Dispositivo desvinculado');
});

const desktopFileBtn=$('#desktopFileBtn');if(desktopFileBtn)desktopFileBtn.onclick=()=>$('#desktopFileInput').click();
$('#desktopFileInput').onchange=e=>{const f=e.target.files[0];if(f)openSend(f)};
const dz=$('#dropZone');
['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.querySelector('.drop-zone').classList.add('dragover')}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.querySelector('.drop-zone').classList.remove('dragover')}));
dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)openSend(f)});

$$('[data-tab]').forEach(b=>b.onclick=()=>{
  const group=b.closest('nav');if(group)group.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  const tab=b.dataset.tab;if(tab==='transfer')openSend();if(tab==='settings'||tab==='profile')openSettings();if(tab==='devices')openDeviceDialog();if(tab==='clipboard')toast('El último texto sincronizado está disponible en Inicio');
});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e});
$('#installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else toast('Usa “Añadir a pantalla de inicio” del navegador')};

document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(peer && peer.disconnected){try{peer.reconnect()}catch{}}reconnectAll()}});
window.addEventListener('online',()=>{networkError='';if(peer?.disconnected){try{peer.reconnect()}catch{}}reconnectAll()});
window.addEventListener('offline',()=>{devices.forEach(d=>d.online=false);renderDevices();setNetworkBadge('error','Sin Internet')});
setInterval(()=>{
  if(!peerReady)return;
  devices.forEach(d=>{const c=connections.get(d.peerId);if(c?.open){try{c.send({type:'ping',protocol:APP_PROTOCOL,t:Date.now()})}catch{markOnline(d.peerId,false)}}else connectDevice(d)});
},RECONNECT_MS);

render();
initPeer();

// V3.2 — actualización automática de la PWA.
// La app se instala una sola vez. Al abrir o volver al primer plano comprueba
// GitHub Pages, activa el Service Worker nuevo y recarga una sola vez.
let swRegistration = null;
let updateCheckBusy = false;
let controllerReloading = false;

async function activateWaitingWorker(reg){
  if(reg?.waiting){
    reg.waiting.postMessage({type:'SKIP_WAITING'});
    return true;
  }
  return false;
}

async function checkForAppUpdate({quiet=true}={}){
  if(!('serviceWorker' in navigator) || updateCheckBusy)return;
  updateCheckBusy=true;
  try{
    const reg=swRegistration || await navigator.serviceWorker.getRegistration('./');
    if(reg){
      swRegistration=reg;
      await reg.update();
      if(await activateWaitingWorker(reg))return;
    }

    // version.json se pide sin caché para detectar una publicación nueva incluso
    // cuando la PWA estaba suspendida durante horas o días.
    const response=await fetch(`./version.json?_=${Date.now()}`,{cache:'no-store',headers:{'cache-control':'no-cache'}});
    if(!response.ok)throw new Error(`version ${response.status}`);
    const remote=await response.json();
    if(remote?.version && remote.version!==APP_VERSION){
      if(!quiet)toast(`Actualizando TRANSFER ${remote.version}…`);
      if(reg){
        await reg.update();
        if(await activateWaitingWorker(reg))return;
      }
      // Si el navegador aún no expone el worker nuevo, una recarga con el SW
      // network-first obliga a solicitar el shell actualizado.
      setTimeout(()=>location.reload(),350);
    }
  }catch(err){
    console.debug('TRANSFER update check',err);
  }finally{updateCheckBusy=false}
}

async function setupServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(controllerReloading)return;
      controllerReloading=true;
      sessionStorage.setItem('transfer.lastAutoUpdate',String(Date.now()));
      location.reload();
    });

    swRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    swRegistration.addEventListener('updatefound',()=>{
      const worker=swRegistration.installing;
      if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed' && navigator.serviceWorker.controller){
          activateWaitingWorker(swRegistration);
        }
      });
    });

    await checkForAppUpdate({quiet:true});
  }catch(err){console.warn('TRANSFER Service Worker',err)}
}

window.addEventListener('load',setupServiceWorker);
window.addEventListener('focus',()=>checkForAppUpdate({quiet:true}));
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')checkForAppUpdate({quiet:true});
});
setInterval(()=>checkForAppUpdate({quiet:true}),UPDATE_CHECK_MS);
