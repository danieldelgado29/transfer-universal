const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const APP_PROTOCOL = 3;
const PEER_ID_PREFIX = 'tr-';
const RECONNECT_MS = 12000;
const MAX_RECENTS = 32;
const APP_VERSION = '3.9.1';
const MAC_BRIDGE_URLS = ['https://127.0.0.1:8766','http://127.0.0.1:8765'];
const MAC_BRIDGE_POLL_MS = 700;
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
const inboundPair = new Map(); // peerId -> sesión de vinculación entrante pendiente de confirmación
const pairingSessions = new Map(); // peerId -> sesión saliente con reintentos automáticos
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
function deviceLabel(d){return String(d?.alias||d?.name||'Dispositivo')}
function deviceGlyph(d){
  const hay=String(`${d?.alias||''} ${d?.name||''} ${d?.type||''}`).toLowerCase();
  if(hay.includes('iphone') || d?.type==='iPhone')return '📱';
  if(hay.includes('android') || d?.type==='Android')return '🤖';
  if(hay.includes('imac'))return '🖥️';
  if(hay.includes('macbook') || hay.includes('laptop'))return '💻';
  if(d?.type==='Mac')return '💻';
  if(hay.includes('windows') || d?.type==='Windows')return '🪟';
  return '📲';
}
function clipboardPreviewText(text,max=78){
  const t=String(text||'').trim();
  if(!t)return 'Aún no hay texto sincronizado.';
  return t.length>max?t.slice(0,max)+'…':t;
}
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
mediaDark.addEventListener?.('change',()=>{if((localStorage.getItem('transfer.theme')||'light')==='auto')applyTheme('light')});
applyPlatform(localStorage.getItem('transfer.platform')||'auto');
applyTheme(localStorage.getItem('transfer.theme')==='dark'?'dark':'light');

function deviceRows(mobile=false){
  if(!devices.length)return `<div class="empty-state"><strong>No hay dispositivos vinculados</strong><small>Toca “Agregar” y escanea el QR del otro equipo.</small></div>`;
  return devices.map(d=>{
    const status=d.online?'Conectado':'Desconectado';
    const last=d.lastSeen&&!d.online?` · visto ${new Date(d.lastSeen).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'';
    if(mobile){
      return `<div class="device-row mobile-device-send ${d.online?'':'is-offline'}" data-send-peer="${escapeHtml(d.peerId)}" role="button" tabindex="0"><div class="device-icon real-device-icon">${deviceGlyph(d)}</div><div class="device-main"><strong>${escapeHtml(deviceLabel(d))}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${status}${last}</div></div><div class="device-actions"><button class="device-action rename-device" type="button" data-rename-peer="${escapeHtml(d.peerId)}" title="Renombrar">✎</button><span class="direct-send-arrow">›</span></div></div>`;
    }
    return `<div class="device-row" data-peer="${escapeHtml(d.peerId)}"><div class="device-icon real-device-icon">${deviceGlyph(d)}</div><div class="device-main"><strong>${escapeHtml(deviceLabel(d))}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${status}${last}</div></div><div class="device-actions"><button class="device-action rename-device" type="button" data-rename-peer="${escapeHtml(d.peerId)}" title="Renombrar">✎</button><button class="ellipsis remove-device device-action" type="button" data-remove-peer="${escapeHtml(d.peerId)}" title="Desvincular">•••</button></div></div>`;
  }).join('');
}
function recentRows(){
  if(!recents.length)return `<div class="recent-row"><div class="recent-main"><strong>Sin actividad reciente</strong><small>Los textos enviados y recibidos aparecerán aquí.</small></div></div>`;
  return recents.slice(0,8).map(r=>`<div class="recent-row"><div class="recent-icon">${r.icon||'▧'}</div><div class="recent-main"><strong>${escapeHtml(r.title)}</strong><small>${escapeHtml(r.meta)}</small></div><span class="ellipsis">•••</span></div>`).join('');
}
function renderDevices(){
  const mobile=$('#mobileDeviceList');if(mobile)mobile.innerHTML=deviceRows(true);
  const desktop=$('#desktopDeviceList');if(desktop)desktop.innerHTML=deviceRows(false);
  const online=devices.filter(d=>d.online).length;if($('#onlineCount'))$('#onlineCount').textContent=online;
  const send=$('#sendDeviceList');
  if(send)send.innerHTML=devices.length?devices.map(d=>`<label class="select-device ${d.online?'':'is-offline'}"><input type="checkbox" value="${escapeHtml(d.peerId)}" ${d.online?'':'disabled'}><div class="device-icon real-device-icon">${deviceGlyph(d)}</div><div class="device-main"><strong>${escapeHtml(deviceLabel(d))}</strong><div class="status-line"><span class="dot ${d.online?'':'off'}"></span>${d.online?'Conectado':'Desconectado'}</div></div></label>`).join(''):`<div class="empty-state"><strong>Primero vincula otro equipo</strong><small>Ambos dispositivos deben tener TRANSFER abierto durante la primera vinculación.</small></div>`;
  updateNetworkBadge();
}
let mobileRecentsExpanded=false;
function renderRecents(){
  const rr=recentRows();
  const mobile=$('#mobileRecentList');if(mobile){mobile.innerHTML=rr;mobile.hidden=!mobileRecentsExpanded}
  const desktop=$('#desktopRecentList');if(desktop)desktop.innerHTML=rr;
  const toggle=$('#mobileRecentToggleBtn');if(toggle)toggle.textContent=mobileRecentsExpanded?'⌃':'⌄';
}
function updateClipboardUI(){
  const preview=clipboardPreviewText(clipboardText);
  if($('#clipboardPreview'))$('#clipboardPreview').textContent=preview;
  if($('#desktopClipboardPreview'))$('#desktopClipboardPreview').textContent=clipboardText||'Esperando portapapeles…';
  if($('#clipboardTitle'))$('#clipboardTitle').textContent='Texto sincronizado';
  if($('#clipboardMeta'))$('#clipboardMeta').textContent=clipboardText?'Toca la flecha para ver el texto completo':'Aún no hay texto sincronizado';
  if($('#clipboardViewerText'))$('#clipboardViewerText').textContent=clipboardText||'Aún no hay texto sincronizado.';
}
function render(){renderDevices();renderRecents();updateClipboardUI();renderPairDialog()}

function selfInfo(){return {peerId:selfDevice.peerId,name:selfDevice.name,type:selfDevice.type}}
function pairQrPayload(){
  return `TRANSFER-PAIR|${APP_PROTOCOL}|${selfDevice.peerId}|${selfDevice.pin}`;
}

function parsePairQrPayload(raw){
  const text=String(raw||'').trim();
  const parts=text.split('|');
  if(parts.length!==4 || parts[0]!=='TRANSFER-PAIR')throw new Error('Este QR no pertenece a TRANSFER');
  const protocol=Number(parts[1]);
  const peerId=normalizeRemoteId(parts[2]);
  const pin=String(parts[3]||'').trim();
  if(protocol!==APP_PROTOCOL)throw new Error('Versión de TRANSFER incompatible');
  if(!/^tr-[a-z0-9-]{6,40}$/.test(peerId))throw new Error('QR de dispositivo inválido');
  if(!/^\d{6}$/.test(pin))throw new Error('QR de vinculación inválido');
  return {peerId,pin};
}

function renderPairQr(){
  const box=$('#pairQr');
  if(!box)return;
  box.innerHTML='';
  const hint=$('#pairQrHint');
  if(!peerReady){
    box.innerHTML='<div class="pair-qr-wait">Preparando QR…</div>';
    if(hint)hint.textContent='Conectando TRANSFER…';
    return;
  }
  if(typeof QRCode==='undefined'){
    box.innerHTML='<div class="pair-qr-wait">QR no disponible</div>';
    if(hint)hint.textContent='No se cargó el generador QR.';
    return;
  }
  new QRCode(box,{
    text:pairQrPayload(),
    width:224,
    height:224,
    colorDark:'#000000',
    colorLight:'#ffffff',
    correctLevel:QRCode.CorrectLevel.M
  });
  if(hint)hint.textContent='Escanea este código desde TRANSFER en el otro dispositivo.';
}

function renderPairDialog(){
  if($('#selfDeviceName'))$('#selfDeviceName').value=selfDevice.name;
  if($('#selfPeerId'))$('#selfPeerId').textContent=selfDevice.peerId;
  if($('#selfPairPin'))$('#selfPairPin').textContent=selfDevice.pin;
  const dot=$('#peerLiveDot');if(dot)dot.classList.toggle('on',peerReady);
  renderPairQr();
}

function clearInboundPair(remoteId,conn=null){
  const p=inboundPair.get(remoteId);
  if(!p)return;
  if(conn && p.conn!==conn)return;
  if(p.timer)clearInterval(p.timer);
  if(p.cleanupTimer)clearTimeout(p.cleanupTimer);
  inboundPair.delete(remoteId);
}

function sendInboundPairAccepted(remoteId){
  const p=inboundPair.get(remoteId);
  if(!p || p.completed || !p.conn?.open)return;
  try{
    p.conn.send({type:'pair-accepted',protocol:APP_PROTOCOL,token:p.token,device:selfInfo()});
    p.tries=(p.tries||0)+1;
  }catch{}
  if(p.tries>=30){
    if(p.timer)clearInterval(p.timer);
    p.timer=null;
  }
}

function sendInboundPairComplete(remoteId){
  const p=inboundPair.get(remoteId);
  if(!p || !p.completed || !p.conn?.open)return;
  try{
    p.conn.send({type:'pair-complete',protocol:APP_PROTOCOL,token:p.token,device:selfInfo()});
    p.completeTries=(p.completeTries||0)+1;
  }catch{}
  if(p.completeTries>=30){
    if(p.timer)clearInterval(p.timer);
    p.timer=null;
  }
}

function stageInboundPair(conn,msg){
  const remoteId=conn.peer;
  let p=inboundPair.get(remoteId);

  if(p?.completed){
    p.conn=conn;
    sendInboundPairComplete(remoteId);
    return;
  }

  if(!p){
    p={
      token:randomToken(),
      device:{...(msg.device||{}),peerId:remoteId},
      conn,
      tries:0,
      completeTries:0,
      completed:false,
      timer:null,
      cleanupTimer:null
    };
    inboundPair.set(remoteId,p);
  }else{
    p.device={...(msg.device||p.device||{}),peerId:remoteId};
    p.conn=conn;
    p.tries=0;
    if(p.timer)clearInterval(p.timer);
  }

  sendInboundPairAccepted(remoteId);
  p.timer=setInterval(()=>sendInboundPairAccepted(remoteId),650);
}

function stopPairingSession(remoteId,{keepConn=null,closeExtra=false}={}){
  const session=pairingSessions.get(remoteId);
  if(!session)return;
  session.done=true;
  if(session.retryTimer)clearInterval(session.retryTimer);
  if(session.deadlineTimer)clearTimeout(session.deadlineTimer);
  if(session.confirmTimer)clearInterval(session.confirmTimer);
  for(const t of session.requestTimers.values())clearInterval(t);
  session.requestTimers.clear();

  if(closeExtra){
    for(const c of session.connections){
      if(c===keepConn)continue;
      try{c.close()}catch{}
    }
  }
  pairingSessions.delete(remoteId);
}

function sendPairRequest(session,conn){
  if(!session || session.done || session.accepted || !conn?.open)return;
  try{
    pendingPair.set(session.remoteId,conn);
    conn.send({
      type:'pair-request',
      protocol:APP_PROTOCOL,
      pin:session.pin,
      device:selfInfo()
    });
  }catch{}
}

function launchPairAttempt(session){
  if(!session || session.done || session.accepted || !peerReady || !peer)return;
  if(session.attempts>=8)return;

  session.attempts++;
  if($('#pairStatus')){
    $('#pairStatus').textContent=`Conectando automáticamente… intento ${session.attempts}`;
  }

  try{
    const conn=peer.connect(session.remoteId,{
      reliable:true,
      metadata:{app:'TRANSFER',protocol:APP_PROTOCOL,pairing:true}
    });
    session.connections.add(conn);
    attachConnection(conn,{pairing:true,pin:session.pin});

    const timer=setInterval(()=>sendPairRequest(session,conn),700);
    session.requestTimers.set(conn,timer);

    conn.on('open',()=>sendPairRequest(session,conn));
    conn.on('close',()=>{
      clearInterval(timer);
      session.requestTimers.delete(conn);
      session.connections.delete(conn);
    });
    conn.on('error',()=>{
      clearInterval(timer);
      session.requestTimers.delete(conn);
      session.connections.delete(conn);
    });
  }catch{}
}

function attachConnection(conn,{pairing=false,pin='',incoming=false}={}){
  if(!conn)return;
  const remoteId=conn.peer;
  conn.on('open',()=>{
    if(pairing){
      pendingPair.set(remoteId,conn);
      conn.send({type:'pair-request',protocol:APP_PROTOCOL,pin,device:selfInfo()});
    }else if(!incoming){
      const d=findDevice(remoteId);
      if(!d?.token){conn.close();return}
      conn.send({type:'hello',protocol:APP_PROTOCOL,token:d.token,device:selfInfo()});
    }
    // IMPORTANTE: una conexión entrante desconocida NO se cierra aquí.
    // Debe quedarse abierta para poder recibir pair-request del dispositivo
    // que acaba de escanear el QR. handleMessage validará después el PIN/token.
  });
  conn.on('data',msg=>handleMessage(conn,msg));
  conn.on('close',()=>{
    const wasCurrent=connections.get(remoteId)===conn;
    if(wasCurrent)connections.delete(remoteId);
    if(pendingPair.get(remoteId)===conn)pendingPair.delete(remoteId);
    clearInboundPair(remoteId,conn);
    if(wasCurrent)markOnline(remoteId,false);
  });
  conn.on('error',()=>{
    const wasCurrent=connections.get(remoteId)===conn;
    if(wasCurrent)connections.delete(remoteId);
    if(pendingPair.get(remoteId)===conn)pendingPair.delete(remoteId);
    clearInboundPair(remoteId,conn);
    if(wasCurrent)markOnline(remoteId,false);
  });
}
function authenticate(conn,device){connections.set(conn.peer,conn);upsertDevice(device,null,true);updateNetworkBadge()}
function handleMessage(conn,msg){
  if(!msg || typeof msg!=='object')return;
  const remoteId=conn.peer;
  if(msg.protocol && msg.protocol!==APP_PROTOCOL){conn.send({type:'error',message:'Versión de protocolo incompatible'});return}

  if(msg.type==='pair-request'){
    const staged=inboundPair.get(remoteId);

    if(staged?.completed){
      staged.conn=conn;
      sendInboundPairComplete(remoteId);
      return;
    }

    if(String(msg.pin)!==String(selfDevice.pin)){
      conn.send({type:'pair-rejected',message:'Código temporal incorrecto'});
      setTimeout(()=>conn.close(),250);
      return;
    }

    stageInboundPair(conn,msg);
    return;
  }

  if(msg.type==='pair-accepted'){
    if(!msg.token)return;
    const session=pairingSessions.get(remoteId);
    if(!session)return;

    session.accepted=true;
    session.token=msg.token;
    session.remoteDevice={...(msg.device||{}),peerId:remoteId};
    pendingPair.delete(remoteId);

    for(const t of session.requestTimers.values())clearInterval(t);
    session.requestTimers.clear();
    if(session.retryTimer){clearInterval(session.retryTimer);session.retryTimer=null}

    const confirm=()=>{
      if(session.done)return;
      const c=[...session.connections].find(x=>x?.open) || conn;
      try{
        if(c?.open)c.send({
          type:'pair-confirmed',
          protocol:APP_PROTOCOL,
          token:session.token,
          device:selfInfo()
        });
      }catch{}
    };

    confirm();
    if(!session.confirmTimer)session.confirmTimer=setInterval(confirm,650);

    if($('#pairStatus')){
      $('#pairStatus').textContent=`Confirmando vínculo con ${session.remoteDevice?.name||remoteId}…`;
    }
    return;
  }

  if(msg.type==='pair-confirmed'){
    const p=inboundPair.get(remoteId);
    if(!p || !msg.token || msg.token!==p.token)return;

    p.conn=conn;

    if(!p.completed){
      if(p.timer)clearInterval(p.timer);
      p.timer=null;
      p.completed=true;
      p.completeTries=0;

      const d=upsertDevice({...p.device,peerId:remoteId},p.token,true);
      connections.set(remoteId,conn);

      selfDevice.pin=randomPin();
      save();
      renderPairDialog();
      renderDevices();

      addRecent('Dispositivo vinculado',`${d?.name||remoteId} · ahora`,'⇄');
    }

    sendInboundPairComplete(remoteId);
    if(!p.timer)p.timer=setInterval(()=>sendInboundPairComplete(remoteId),650);

    if($('#pairStatus'))$('#pairStatus').textContent='Confirmando en el otro dispositivo…';
    return;
  }

  if(msg.type==='pair-complete'){
    const session=pairingSessions.get(remoteId);
    let d=findDevice(remoteId);

    if(session){
      if(!session.token || !msg.token || session.token!==msg.token)return;
      d=upsertDevice({...session.remoteDevice,...(msg.device||{}),peerId:remoteId},session.token,true);
      connections.set(remoteId,conn);
      stopPairingSession(remoteId,{keepConn:conn,closeExtra:true});
    }else{
      if(!d || !msg.token || d.token!==msg.token)return;
      connections.set(remoteId,conn);
      markOnline(remoteId,true);
    }

    const ack=()=>{
      try{
        if(conn.open)conn.send({
          type:'pair-complete-ack',
          protocol:APP_PROTOCOL,
          token:msg.token,
          device:selfInfo()
        });
      }catch{}
    };
    ack();
    setTimeout(ack,250);
    setTimeout(ack,700);

    qrPairBusy=false;
    if($('#pairStatus'))$('#pairStatus').textContent=`Vinculado con ${d?.name||remoteId} ✓`;
    toast('Dispositivo vinculado ✓');
    setTimeout(()=>{
      if($('#deviceDialog')?.open)$('#deviceDialog').close('paired');
    },350);
    return;
  }

  if(msg.type==='pair-complete-ack'){
    const p=inboundPair.get(remoteId);
    const d=findDevice(remoteId);
    if(!p || !p.completed || !msg.token || msg.token!==p.token || !d)return;

    if(p.timer)clearInterval(p.timer);
    p.timer=null;
    connections.set(remoteId,conn);
    markOnline(remoteId,true);

    if($('#pairStatus'))$('#pairStatus').textContent=`Vinculado con ${d.name||remoteId} ✓`;
    toast('Dispositivo vinculado ✓');

    if(p.cleanupTimer)clearTimeout(p.cleanupTimer);
    p.cleanupTimer=setTimeout(()=>clearInboundPair(remoteId),1800);

    setTimeout(()=>{
      if($('#deviceDialog')?.open)$('#deviceDialog').close('paired');
    },350);
    return;
  }

  if(msg.type==='pair-rejected'){
    stopPairingSession(remoteId,{closeExtra:true});
    qrPairBusy=false;
    pendingPair.delete(remoteId);
    if($('#pairStatus'))$('#pairStatus').textContent=msg.message||'No se pudo vincular';
    toast(msg.message||'Vinculación rechazada');
    return;
  }
  if(msg.type==='hello'){
    const d=findDevice(remoteId);
    if(!d || !d.token || msg.token!==d.token){conn.send({type:'error',message:'Dispositivo no autorizado'});setTimeout(()=>conn.close(),150);return}
    authenticate(conn,{...msg.device,peerId:remoteId});
    conn.send({type:'hello-accepted',protocol:APP_PROTOCOL,device:selfInfo()});

    if(detectPlatform()==='mac'){
      void pollMacBridge({autoSend:false}).then(latest=>{
        const text=String(latest||clipboardText||'');
        if(!text || !conn.open)return;
        try{
          conn.send({
            type:'text',
            protocol:APP_PROTOCOL,
            id:crypto.randomUUID?.()||`${Date.now()}-${randomChars(6)}`,
            text,
            sentAt:Date.now(),
            device:selfInfo(),
            autoClipboard:true,
            source:'mac-resume-sync'
          });
        }catch{}
      });
    }
    return;
  }
  if(msg.type==='hello-accepted'){
    const d=findDevice(remoteId);if(!d)return;authenticate(conn,{...(msg.device||d),peerId:remoteId});return;
  }
  if(msg.type==='text'){
    const d=findDevice(remoteId);if(!d || connections.get(remoteId)!==conn)return;
    const text=String(msg.text||'');if(!text)return;
    const same=text===clipboardText;

    clipboardText=text;save();updateClipboardUI();
    if(detectPlatform()==='mac')void writeMacBridgeClipboard(text);
    if(detectPlatform()==='android' && androidNativeBridgeAvailable())writeAndroidNativeClipboard(text);

    if(!(msg.source==='mac-resume-sync' && same)){
      const title=text.length>48?text.slice(0,48)+'…':text;
      addRecent(title,`Recibido de ${d.name} · ${nowLabel()}`,'≡',msg.id);
      toast(`Texto recibido de ${d.name}`);
    }

    conn.send({type:'ack',id:msg.id,protocol:APP_PROTOCOL});
    return;
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

let lastAndroidResumeRepair=0;
let androidResumeRetryTimer=null;

function restoreAndroidConnectionsAfterResume(){
  if(detectPlatform()!=='android')return;
  if(document.visibilityState!=='visible')return;

  const now=Date.now();
  if(now-lastAndroidResumeRepair<1200)return;
  lastAndroidResumeRepair=now;

  devices.forEach(d=>{
    const c=connections.get(d.peerId);
    try{c?.close()}catch{}
    connections.delete(d.peerId);
    d.online=false;
  });
  renderDevices();

  try{
    if(peer?.disconnected)peer.reconnect();
  }catch{}

  const retry=()=>{
    if(peerReady)reconnectAll();
    requestAndroidNativeClipboard();
  };

  setTimeout(retry,180);
  setTimeout(retry,650);

  if(androidResumeRetryTimer)clearTimeout(androidResumeRetryTimer);
  androidResumeRetryTimer=setTimeout(retry,1600);
}

function initPeer(){
  updateNetworkBadge();
  if(typeof Peer==='undefined'){networkError='No se pudo cargar PeerJS';updateNetworkBadge();console.error(networkError);return}
  try{
    peer=new Peer(selfDevice.peerId,{debug:0});
    peer.on('open',id=>{peerReady=true;networkError='';selfDevice.peerId=id;save();renderPairDialog();updateNetworkBadge();reconnectAll()});
    peer.on('connection',conn=>attachConnection(conn,{incoming:true}));
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


// V3.5 — puente local de portapapeles para macOS.
// El helper local escucha el portapapeles real del Mac aun cuando TRANSFER no tiene foco.
let macBridgeOnline=false;
let macBridgeTimer=null;
let macBridgeBusy=false;
let lastBridgeSeen='';

function updateMacBridgeBadge(){
  const e=$('#macBridgeBadge');if(!e)return;
  if(detectPlatform()!=='mac'){e.hidden=true;return}
  e.hidden=false;e.dataset.state=macBridgeOnline?'online':'offline';
  e.textContent=macBridgeOnline?'Bridge Mac activo':'Bridge Mac no detectado';
}

async function macBridgeFetch(path,options={}){
  let lastError=null;
  for(const baseUrl of MAC_BRIDGE_URLS){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),1600);
    try{
      const response=await fetch(`${baseUrl}${path}`,{
        cache:'no-store',
        mode:'cors',
        credentials:'omit',
        targetAddressSpace:'loopback',
        ...options,
        signal:ctrl.signal
      });
      clearTimeout(timer);
      return response;
    }catch(err){
      clearTimeout(timer);
      lastError=err;
    }
  }
  throw lastError || new Error('Mac Bridge no disponible');
}

function autoSendClipboardToCrossPlatform(text){
  const targets=devices.filter(d=>d.online && (d.type==='Android'||d.type==='Windows'));
  if(!targets.length || !text)return 0;
  const msgId=crypto.randomUUID?.()||`${Date.now()}-${randomChars(6)}`;
  let sent=0;const names=[];
  targets.forEach(d=>{const conn=connections.get(d.peerId);if(conn?.open){conn.send({type:'text',protocol:APP_PROTOCOL,id:msgId,text,sentAt:Date.now(),device:selfInfo(),autoClipboard:true});sent++;names.push(d.name)}});
  if(sent){
    pendingAcks.set(msgId,{expected:sent,ok:new Set(),at:Date.now()});
    addRecent(text.length>48?text.slice(0,48)+'…':text,`Portapapeles → ${names.join(', ')} · ${nowLabel()}`,'≡',msgId);
  }
  return sent;
}

async function pollMacBridge({autoSend=true}={}){
  if(detectPlatform()!=='mac' || macBridgeBusy)return null;
  macBridgeBusy=true;
  try{
    const response=await macBridgeFetch('/clipboard?_='+Date.now());
    if(!response.ok)throw new Error(String(response.status));
    const data=await response.json();
    macBridgeOnline=true;updateMacBridgeBadge();
    const text=typeof data.text==='string'?data.text:'';
    if(text && text!==lastBridgeSeen){lastBridgeSeen=text}
    if(text && text!==clipboardText){
      clipboardText=text;save();updateClipboardUI();
      if(autoSend)autoSendClipboardToCrossPlatform(text);
    }
    return text;
  }catch{
    if(macBridgeOnline){macBridgeOnline=false;updateMacBridgeBadge()}
    return null;
  }finally{macBridgeBusy=false}
}

async function writeMacBridgeClipboard(text){
  if(detectPlatform()!=='mac' || !text)return false;
  try{
    const response=await macBridgeFetch('/clipboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
    if(!response.ok)throw new Error(String(response.status));
    macBridgeOnline=true;lastBridgeSeen=text;updateMacBridgeBadge();return true;
  }catch{macBridgeOnline=false;updateMacBridgeBadge();return false}
}

async function loadSystemClipboard({announce=true}={}){
  if(detectPlatform()==='android' && androidNativeBridgeAvailable()){
    requestAndroidNativeClipboard();
    if(announce)toast('Portapapeles Android actualizado');
    return clipboardText;
  }
  if(detectPlatform()==='mac'){
    const text=await pollMacBridge({autoSend:false});
    if(text){clipboardText=text;save();updateClipboardUI();if(announce)toast('Portapapeles Mac actualizado');return text}
  }
  try{
    const text=await navigator.clipboard.readText();
    if(!text){if(announce)toast('El portapapeles está vacío');return ''}
    clipboardText=text;save();updateClipboardUI();if(announce)toast('Texto cargado en TRANSFER');return text;
  }catch{if(announce)toast('No se pudo leer el portapapeles');return ''}
}

function startMacBridgeIntegration(){
  updateMacBridgeBadge();
  if(detectPlatform()!=='mac')return;
  pollMacBridge({autoSend:true});
  if(macBridgeTimer)clearInterval(macBridgeTimer);
  macBridgeTimer=setInterval(()=>{if(document.visibilityState==='visible')pollMacBridge({autoSend:true})},MAC_BRIDGE_POLL_MS);
  window.addEventListener('focus',()=>pollMacBridge({autoSend:true}));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollMacBridge({autoSend:true})});
}


// V3.7 - integración con la app Android nativa.
// Recibido por P2P -> portapapeles real Android.
// Copiado en Android -> al volver a TRANSFER se detecta sin tocar Pegar.
let lastAndroidNativeSeen='';
let lastAndroidNativeSent='';

function androidNativeBridgeAvailable(){
  try{
    return detectPlatform()==='android'
      && typeof window.TRANSFERAndroid!=='undefined'
      && typeof window.TRANSFERAndroid.setClipboard==='function';
  }catch{return false}
}

function writeAndroidNativeClipboard(text){
  if(!androidNativeBridgeAvailable() || !text)return false;
  try{
    window.TRANSFERAndroid.setClipboard(String(text));
    return true;
  }catch{return false}
}

function autoSendAndroidClipboard(text){
  text=String(text||'');
  if(!text || text===lastAndroidNativeSent)return 0;
  const targets=devices.filter(d=>d.online && (d.type==='Mac'||d.type==='Windows'));
  if(!targets.length)return 0;
  const msgId=crypto.randomUUID?.()||`${Date.now()}-${randomChars(6)}`;
  let sent=0;const names=[];
  targets.forEach(d=>{
    const conn=connections.get(d.peerId);
    if(conn?.open){
      try{
        conn.send({type:'text',protocol:APP_PROTOCOL,id:msgId,text,sentAt:Date.now(),device:selfInfo(),autoClipboard:true,source:'android-native'});
        sent++;names.push(d.name);
      }catch{}
    }
  });
  if(sent){
    lastAndroidNativeSent=text;
    pendingAcks.set(msgId,{expected:sent,ok:new Set(),at:Date.now()});
    addRecent(text.length>48?text.slice(0,48)+'…':text,`Portapapeles Android -> ${names.join(', ')} · ${nowLabel()}`,'≡',msgId);
  }
  return sent;
}

window.TRANSFERNativeAndroidClipboard=function(text){
  text=String(text||'');
  if(!text)return;
  if(text===lastAndroidNativeSeen)return;
  lastAndroidNativeSeen=text;

  const changed=text!==clipboardText;
  if(changed){
    clipboardText=text;
    save();
    updateClipboardUI();
  }

  const sent=autoSendAndroidClipboard(text);
  if(changed && !sent){
    addRecent(text.length>48?text.slice(0,48)+'…':text,`Portapapeles Android actualizado · ${nowLabel()}`,'≡');
  }
};

function requestAndroidNativeClipboard(){
  if(!androidNativeBridgeAvailable())return false;
  try{
    window.TRANSFERAndroid.requestClipboardSync();
    return true;
  }catch{return false}
}

function startAndroidNativeIntegration(){
  if(detectPlatform()!=='android')return;
  updateClipboardUI();
  if(androidNativeBridgeAvailable())requestAndroidNativeClipboard();

  window.addEventListener('transfer-android-native-ready',()=>{
    updateClipboardUI();
    requestAndroidNativeClipboard();
    toast('Android nativo conectado ✓');
  });
}

function openSettings(){applyTheme(localStorage.getItem('transfer.theme')==='dark'?'dark':'light');$('#settingsDialog').showModal()}
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
  const names=selectedPeers.map(id=>{const d=findDevice(id);return d?deviceLabel(d):id});
  addRecent(text.length>48?text.slice(0,48)+'…':text,`Enviado a ${names.join(', ')} · ${nowLabel()}`,'≡',msgId);
  pendingAcks.set(msgId,{expected:sent,ok:new Set(),at:Date.now()});
  $('#sendDialog').close();toast(`Texto enviado a ${sent} dispositivo${sent===1?'':'s'} ✓`);
});

const copyBtn=$('#copyBtn');if(copyBtn)copyBtn.onclick=async()=>{const text=clipboardText||$('#clipboardPreview')?.textContent||'';if(!text)return toast('No hay texto para copiar');if(detectPlatform()==='android'&&androidNativeBridgeAvailable()){writeAndroidNativeClipboard(text);toast('Listo para pegar en Android');return}try{await navigator.clipboard.writeText(text);toast('Copiado al portapapeles')}catch{toast('El navegador no permitió copiar')}};
const pasteBtn=$('#pasteBtn');if(pasteBtn)pasteBtn.onclick=()=>loadSystemClipboard({announce:true});
const desktopPasteBtn=$('#desktopPasteBtn');if(desktopPasteBtn)desktopPasteBtn.onclick=()=>loadSystemClipboard({announce:true});

function sendCurrentTextDirect(peerId){
  const d=findDevice(peerId);
  if(!d)return;
  if(!d.online){toast(`${deviceLabel(d)} está desconectado`);return}
  const text=String(clipboardText||'').trim();
  if(!text){toast('No hay texto sincronizado para enviar');return}
  const conn=connections.get(peerId);
  if(!conn?.open){toast(`${deviceLabel(d)} no está conectado`);markOnline(peerId,false);return}
  const msgId=crypto.randomUUID?.()||`${Date.now()}-${randomChars(6)}`;
  try{
    conn.send({type:'text',protocol:APP_PROTOCOL,id:msgId,text,sentAt:Date.now(),device:selfInfo()});
    pendingAcks.set(msgId,{expected:1,ok:new Set(),at:Date.now()});
    addRecent(text.length>48?text.slice(0,48)+'…':text,`Enviado a ${deviceLabel(d)} · ${nowLabel()}`,'≡',msgId);
    toast(`Enviado a ${deviceLabel(d)} ✓`);
  }catch{
    toast('No se pudo enviar');
    markOnline(peerId,false);
  }
}

$('#mobileClipboardCard')?.addEventListener('click',e=>{
  if(e.target.closest('#mobileClipboardOpenBtn') || e.target===e.currentTarget || e.target.closest('.hero-copy') || e.target.closest('.hero-icon')){
    if($('#clipboardViewerText'))$('#clipboardViewerText').textContent=clipboardText||'Aún no hay texto sincronizado.';
    $('#clipboardDialog')?.showModal();
  }
});
$('#mobileClipboardCard')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#clipboardDialog')?.showModal()}});
$('#mobileRecentToggleBtn')?.addEventListener('click',()=>{mobileRecentsExpanded=!mobileRecentsExpanded;renderRecents()});

function clearRecents(){recents=[];save();renderRecents();toast('Actividad reciente eliminada')}
['#desktopClearRecentBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=clearRecents});

let qrScanner=null;
let qrScannerRunning=false;
let qrPairBusy=false;

async function stopQrScanner(){
  if(!qrScanner)return;
  try{
    if(qrScannerRunning)await qrScanner.stop();
  }catch{}
  try{await qrScanner.clear()}catch{}
  qrScanner=null;
  qrScannerRunning=false;
  $('#qrScannerPanel')?.classList.add('hidden');
  $('#openScannerBtn')?.classList.remove('hidden');
}

async function pairWithCredentials(remoteId,pin,{fromQr=false}={}){
  if(!peerReady){toast('La red P2P todavía no está lista');return false}
  remoteId=normalizeRemoteId(remoteId);
  pin=String(pin||'').trim();

  if(!/^tr-[a-z0-9-]{6,40}$/.test(remoteId)){toast('Dispositivo inválido');return false}
  if(remoteId===selfDevice.peerId){toast('Ese QR pertenece a este mismo dispositivo');return false}
  if(!/^\d{6}$/.test(pin)){toast('Código de vinculación inválido');return false}

  if($('#remotePeerId'))$('#remotePeerId').value=remoteId;
  if($('#remotePairPin'))$('#remotePairPin').value=pin;
  if($('#pairStatus'))$('#pairStatus').textContent=fromQr?'QR leído. Vinculando automáticamente…':'Conectando automáticamente…';

  stopPairingSession(remoteId,{closeExtra:true});

  const session={
    remoteId,
    pin,
    startedAt:Date.now(),
    attempts:0,
    accepted:false,
    done:false,
    token:'',
    remoteDevice:null,
    connections:new Set(),
    requestTimers:new Map(),
    retryTimer:null,
    deadlineTimer:null,
    confirmTimer:null
  };
  pairingSessions.set(remoteId,session);

  launchPairAttempt(session);

  session.retryTimer=setInterval(()=>{
    if(session.done || session.accepted)return;
    launchPairAttempt(session);
  },2500);

  session.deadlineTimer=setTimeout(()=>{
    if(session.done)return;
    stopPairingSession(remoteId,{closeExtra:true});
    qrPairBusy=false;
    if($('#pairStatus') && $('#deviceDialog')?.open){
      $('#pairStatus').textContent='No se pudo completar. Toca Abrir cámara y vuelve a escanear.';
    }
  },25000);

  return true;
}

async function handleScannedPairQr(decodedText){
  if(qrPairBusy)return;
  qrPairBusy=true;
  try{
    const data=parsePairQrPayload(decodedText);
    await stopQrScanner();
    const started=await pairWithCredentials(data.peerId,data.pin,{fromQr:true});
    if(!started)qrPairBusy=false;
  }catch(err){
    qrPairBusy=false;
    toast(err?.message||'QR no válido');
  }
}

async function startQrScanner(){
  qrPairBusy=false;
  if(typeof Html5Qrcode==='undefined'){
    toast('El lector QR no está disponible');
    return;
  }
  if(!peerReady){
    toast('Espera a que TRANSFER termine de conectar');
    return;
  }
  const panel=$('#qrScannerPanel');
  const button=$('#openScannerBtn');
  panel?.classList.remove('hidden');
  button?.classList.add('hidden');
  if($('#pairStatus'))$('#pairStatus').textContent='Abriendo cámara…';

  try{
    const cameras=await Html5Qrcode.getCameras();
    if(!cameras?.length)throw new Error('No se encontró ninguna cámara');

    const mobile=detectPlatform()==='android'||detectPlatform()==='ios';
    let selected=cameras[0];
    if(mobile){
      selected=cameras.find(c=>/back|rear|environment|trasera|posterior/i.test(c.label)) || cameras[cameras.length-1];
    }

    qrScanner=new Html5Qrcode('qrReader');
    await qrScanner.start(
      selected.id,
      {fps:10,qrbox:{width:250,height:250},aspectRatio:1},
      text=>{void handleScannedPairQr(text)},
      ()=>{}
    );
    qrScannerRunning=true;
    if($('#pairStatus'))$('#pairStatus').textContent='Apunta la cámara al QR del otro dispositivo.';
  }catch(err){
    await stopQrScanner();
    if($('#pairStatus'))$('#pairStatus').textContent='No se pudo abrir la cámara.';
    toast(err?.message||'No se pudo abrir la cámara');
  }
}

function openDeviceDialog(){
  void stopQrScanner();
  renderPairDialog();
  if($('#pairStatus'))$('#pairStatus').textContent=peerReady?'Muestra tu QR o escanea el del otro dispositivo.':'Conectando al servicio P2P…';
  if($('#remotePeerId'))$('#remotePeerId').value='';
  if($('#remotePairPin'))$('#remotePairPin').value='';
  $('#deviceDialog').showModal();
  setTimeout(renderPairQr,60);
}

['#mobileAddDeviceBtn','#desktopAddDeviceBtn'].forEach(sel=>{const e=$(sel);if(e)e.onclick=openDeviceDialog});
$('#selfDeviceName')?.addEventListener('change',e=>{const v=e.target.value.trim();if(v){selfDevice.name=v;save();reconnectAll();renderPairQr();toast('Nombre actualizado')}});
$('#rotatePinBtn')?.addEventListener('click',()=>{selfDevice.pin=randomPin();save();renderPairDialog();toast('Código renovado')});
$('#refreshQrBtn')?.addEventListener('click',()=>{selfDevice.pin=randomPin();save();renderPairDialog();toast('Nuevo QR generado')});
$('#openScannerBtn')?.addEventListener('click',()=>{void startQrScanner()});
$('#closeScannerBtn')?.addEventListener('click',()=>{void stopQrScanner();if($('#pairStatus'))$('#pairStatus').textContent='Escáner cerrado.'});

async function copyPlain(value,successLabel){
  try{await navigator.clipboard.writeText(String(value));toast(successLabel)}
  catch{toast(`No se pudo copiar automáticamente: ${value}`)}
}
$('#copySelfIdBtn')?.addEventListener('click',()=>copyPlain(selfDevice.peerId,'ID copiado ✓'));
$('#copySelfPinBtn')?.addEventListener('click',()=>copyPlain(selfDevice.pin,'Código copiado ✓'));

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
  void pairWithCredentials($('#remotePeerId').value,$('#remotePairPin').value,{fromQr:false});
});
$('#deviceDialog')?.addEventListener('close',()=>{
  void stopQrScanner();
  if($('#deviceDialog')?.returnValue!=='paired'){
    for(const remoteId of [...pairingSessions.keys()])stopPairingSession(remoteId,{closeExtra:true});
    qrPairBusy=false;
  }
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
  const rename=e.target.closest('[data-rename-peer]');
  if(rename){
    e.stopPropagation();
    const d=findDevice(rename.dataset.renamePeer);if(!d)return;
    const value=prompt('Renombrar dispositivo\n\nDeja vacío para volver al nombre original.',deviceLabel(d));
    if(value===null)return;
    const clean=String(value).trim().slice(0,40);
    if(clean){d.alias=clean;toast(`Ahora se llama ${clean}`)}
    else{delete d.alias;toast(`Nombre restaurado: ${d.name||'Dispositivo'}`)}
    save();renderDevices();return;
  }
  const remove=e.target.closest('[data-remove-peer]');
  if(remove){
    e.stopPropagation();
    const peerId=remove.dataset.removePeer;const d=findDevice(peerId);if(!d)return;
    if(!confirm(`¿Desvincular ${deviceLabel(d)}?`))return;
    try{connections.get(peerId)?.close()}catch{};connections.delete(peerId);devices=devices.filter(x=>x.peerId!==peerId);save();renderDevices();toast('Dispositivo desvinculado');
    return;
  }
  const direct=e.target.closest('[data-send-peer]');
  if(direct){sendCurrentTextDirect(direct.dataset.sendPeer);return}
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

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  if(detectPlatform()==='android'){
    restoreAndroidConnectionsAfterResume();
    return;
  }
  if(peer && peer.disconnected){try{peer.reconnect()}catch{}}
  reconnectAll();
});

window.addEventListener('focus',()=>{
  if(detectPlatform()==='android')restoreAndroidConnectionsAfterResume();
});

window.addEventListener('pageshow',()=>{
  if(detectPlatform()==='android')restoreAndroidConnectionsAfterResume();
});

window.addEventListener('online',()=>{
  networkError='';
  if(peer?.disconnected){try{peer.reconnect()}catch{}}
  if(detectPlatform()==='android')restoreAndroidConnectionsAfterResume();
  else reconnectAll();
});
window.addEventListener('offline',()=>{devices.forEach(d=>d.online=false);renderDevices();setNetworkBadge('error','Sin Internet')});
setInterval(()=>{
  if(!peerReady)return;
  devices.forEach(d=>{const c=connections.get(d.peerId);if(c?.open){try{c.send({type:'ping',protocol:APP_PROTOCOL,t:Date.now()})}catch{markOnline(d.peerId,false)}}else connectDevice(d)});
},RECONNECT_MS);

render();
initPeer();
startMacBridgeIntegration();
startAndroidNativeIntegration();

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
