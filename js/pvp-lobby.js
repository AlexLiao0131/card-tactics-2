import { PVP_API_BASE } from './pvp-config.js';
// Use the SAME official card definitions and deck rules as single player.
import { CardDatabase } from './card-database.js';
import { DeckEngine } from './deck-engine.js';

const $ = id => document.getElementById(id);
const storageKey = 'ct2:pvp-lobby-session:v1';
const connect = $('connect');
const status = $('lobbyStatus');
const ready = $('readyToggle');
const submitDeckButton = $('submitDeck');
const openingPanel = $('openingPanel');
const openingHand = $('openingHand');
const openingHint = $('openingHint');
const keepOpening = $('keepOpening');
const mulliganOpening = $('mulliganOpening');
const createButton = $('createRoom');
const joinButton = $('joinRoom');
const exitButton = $('exitRoom');
const copyButton = $('copyInvite');
const retryButton = $('retryRoom');
const roomView = $('roomView');
const setupView = $('setupView');
const codeView = $('roomCode');
const cards = [$('seatA'), $('seatB')];
const endpoint = String(PVP_API_BASE||'').replace(/\/$/, '');
let socket = null;
let session = null;
let reconnects = 0;
let reconnectTimer = null;
let roomState = null;
let matchState = null;
let commandInFlight = false;
let everJoined = false;

function setStatus(message, bad = false) {
  status.textContent = message;
  status.dataset.error = bad ? 'true' : 'false';
}
function validCode(s) {
  const result = String(s||'').toUpperCase().replace(/[\s-]/g,'');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(result)?result:null;
}
function safeDisplayName(s) { return String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,24); }
function safeEndpoint() {
  try {
    const url = new URL(endpoint);
    return url.protocol==='https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname==='/' ? url.origin : null;
  } catch { return null; }
}
async function api(path, { name, token, cards } = {}) {
  if (!safeEndpoint()) throw Error('PVP_SERVER_NOT_CONFIGURED');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 12_000);
  try {
    const response = await fetch(`${endpoint}${path}`, {
      method:'POST', headers:{'Content-Type':'application/json',...(token?{'Authorization':`Bearer ${token}`}:{})},
      body:JSON.stringify(cards ? {cards} : name ? {name} : {}),signal:controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP_${response.status}`);
    return data;
  } finally { clearTimeout(timer); }
}
function setSession(value) {
  session=value;
  if (session) sessionStorage.setItem(storageKey,JSON.stringify(session));
  else sessionStorage.removeItem(storageKey);
  setupView.hidden=!!session;
  roomView.hidden=!session;
  submitDeckButton.disabled=!session;
  matchState=null;
  commandInFlight=false;
  openingPanel.hidden=true;
  if (session) codeView.textContent=session.code;
}
function closeSocket() {
  clearTimeout(reconnectTimer);
  if (socket) { socket.onclose=null; socket.onerror=null; socket.onmessage=null; socket.close(1000,'LEAVE'); }
  socket=null;
  ready.disabled=true;
  commandInFlight=false;
}
function displayRoom(data) {
  if (!data || data.code !== session?.code) return;
  roomState=data;
  for (let i=0;i<2;i++) {
    const seat=data.seats[i];
    const name=cards[i].querySelector('[data-name]');
    const meta=cards[i].querySelector('[data-status]');
    name.textContent=seat?.name || '等待玩家加入';
    const isMe=session.seat===i;
    meta.textContent=seat ? `${seat.online?'已連線':'離線'} · ${seat.ready?'已準備':'尚未準備'} · ${seat.deckSubmitted?'牌組已提交':'未提交牌組'}${isMe?' · 你':''}` : '空位';
    cards[i].dataset.ready=seat?.ready?'true':'false';
  }
  const mine=data.seats?.[session.seat];
  ready.textContent=mine?.ready?'取消準備':'我已準備';
  ready.disabled=data.phase!=='LOBBY' || socket?.readyState!==WebSocket.OPEN || mine?.deckSubmitted!==true;
  submitDeckButton.disabled=data.phase!=='LOBBY';
  $('bothReady').textContent=data.phase==='OPENING_HAND'
    ? '已由伺服器建立起手牌。雙方依序確認起手牌；完整 3D 戰棋尚未開放。'
    : data.phase==='WAITING_FOR_TACTICAL_ENGINE'
    ? '雙方起手牌決策已由伺服器儲存。仍須完成正式地圖、部署、戰鬥與環境結算。'
    : data.bothReady
    ? '雙方已準備。正在建立伺服器對局…'
    : data.seats?.some(s=>s && !s.deckSubmitted) ? '等待雙方提交合法的 20 張出擊牌組' : '等待雙方準備';
  $('bothReady').dataset.ready=data.bothReady?'true':'false';
}
function displayMatch(message) {
  if (!session || !message || message.view?.seat!==session.seat) return;
  matchState=message;
  commandInFlight=false;
  const view=message.view;
  openingPanel.hidden=false;
  openingHand.replaceChildren();
  for (const [i,card] of view.own.hand.entries()) {
    const row=document.createElement('label');
    row.className='opening-card';
    const input=document.createElement('input');
    input.type='checkbox';input.value=String(i);
    input.disabled=view.activeSeat!==session.seat || !view.own.openingDecisionAvailable;
    row.append(input,document.createTextNode(`${card.name}｜${card.cost??'?'} 水晶`));
    openingHand.append(row);
  }
  const myTurn=view.phase==='OPENING_HAND' && view.activeSeat===session.seat;
  keepOpening.disabled=!myTurn || socket?.readyState!==WebSocket.OPEN;
  mulliganOpening.disabled=!myTurn || socket?.readyState!==WebSocket.OPEN;
  openingHint.textContent=view.phase==='WAITING_FOR_TACTICAL_ENGINE'
    ? '伺服器已保存雙方起手牌；戰棋核心尚未接入，無法開始部署或移動。'
    : myTurn
    ? `輪到你確認起手牌（版本 ${message.revision}）。可勾選要換掉的牌，或直接保留。`
    : view.myOpeningDone ? '你已確認起手牌，等待另一位玩家。' : '等待另一位玩家確認起手牌。';
}
function sendOpeningCommand(action) {
  if (!session || !matchState || commandInFlight ||
      matchState.view?.activeSeat!==session.seat || socket?.readyState!==WebSocket.OPEN) return;
  const id=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
  commandInFlight=true;
  keepOpening.disabled=true;mulliganOpening.disabled=true;
  socket.send(JSON.stringify({type:'MATCH_COMMAND',envelope:{
    protocol:matchState.protocol,baseRevision:matchState.revision,commandId:id,action
  }}));
}
keepOpening.onclick=()=>sendOpeningCommand({type:'KEEP_OPENING_HAND'});
mulliganOpening.onclick=()=>sendOpeningCommand({type:'MULLIGAN',indices:[...openingHand.querySelectorAll('input:checked')].map(x=>Number(x.value))});

async function socketConnect() {
  if (!session) return;
  closeSocket();
  setStatus('正在重新取得一次性連線票證…');
  try {
    const ticket=await api(`/v1/rooms/${session.code}/ticket`,{token:session.token});
    if (!session) return;
    const url=safeEndpoint().replace(/^https:/,'wss:')+`/v1/rooms/${session.code}/socket?ticket=${ticket.ticket}`;
    const ws = new WebSocket(url);
    socket=ws;
    ws.onopen=()=>{
      reconnects=0;everJoined=true;
      ready.disabled=roomState?.phase!=='LOBBY' || !roomState?.seats?.[session?.seat]?.deckSubmitted;
      setStatus('已連上房間。可提交牌組；雙方準備後由伺服器抽取起手牌。正式戰棋仍未開放。');
    };
    ws.onmessage=event=>{
      let message;
      try { message=JSON.parse(event.data); } catch { return; }
      if (message.type==='ROOM_STATE'||message.type==='WELCOME') displayRoom(message.room);
      if (message.type==='MATCH_STATE') displayMatch(message.match);
      if (message.type==='MATCH_ACK') commandInFlight=false;
      if (message.type==='ERROR') {
        commandInFlight=false;
        setStatus(`伺服器拒絕操作：${message.error}`,true);
        if (matchState) displayMatch(matchState);
      }
    };
    ws.onerror=()=>setStatus('WebSocket 連線發生問題。',true);
    ws.onclose=e=>{
      if (socket!==ws || !session) return;
      ready.disabled=true;
      if (e.code===4002) {setStatus('房間已到期，請重新建立房間。',true);setSession(null);return;}
      if (e.code===4001) {setStatus('此席位已在另一個頁面登入。',true);return;}
      // Reconnect only while the user keeps the lobby open. No server-side heartbeat.
      if (reconnects>=5) {setStatus('自動重連失敗，請按「重新連線」。',true);return;}
      reconnects++;
      setStatus(`連線中斷，正在重試（${reconnects}/5）…`,true);
      reconnectTimer=setTimeout(socketConnect, Math.min(15_000,1000*2**reconnects));
    };
  } catch (err) {
    setStatus(`無法連線：${err.message}`,true);
    ready.disabled=true;
  }
}
async function openSession(value) {
  closeSocket();setSession(value);roomState=null;await socketConnect();
}
createButton.onclick=async()=>{
  const name=safeDisplayName($('playerName').value);
  if (!name) return setStatus('請輸入玩家名稱。',true);
  createButton.disabled=true;
  try {
    setStatus('正在建立房間…');
    const result=await api('/v1/rooms',{name});
    await openSession({code:result.code,token:result.token,seat:result.seat});
  } catch(err) {setStatus(`建立失敗：${err.message}`,true);}
  finally {createButton.disabled=false;}
};
joinButton.onclick=async()=>{
  const name=safeDisplayName($('playerName').value);
  const code=validCode($('joinCode').value);
  if (!name || !code) return setStatus('請輸入玩家名稱與有效的 8 碼房間碼。',true);
  joinButton.disabled=true;
  try {
    setStatus('正在加入房間…');
    const result=await api(`/v1/rooms/${code}/join`,{name});
    await openSession({code:result.code,token:result.token,seat:result.seat});
  } catch(err) {setStatus(`加入失敗：${err.message}`,true);}
  finally {joinButton.disabled=false;}
};
submitDeckButton.onclick=async()=>{
  if (!session || roomState?.phase!=='LOBBY') return;
  // The UI reads the same saved deck and official validator as the main game.
  const deck = DeckEngine.getActive();
  const validation = DeckEngine.validate(deck);
  if (!validation.valid) return setStatus('目前尚未設定合法的 20 張出擊牌組，請先在遊戲的牌組畫面整備。', true);
  const originalSession=session;
  submitDeckButton.disabled=true;
  try {
    setStatus('正在將你的出擊牌組交由 PVP 伺服器驗證…');
    const response=await api(`/v1/rooms/${session.code}/deck`,{token:session.token,cards:validation.deck});
    if (session!==originalSession) return;
    if (response.deckSubmitted) setStatus('牌組已由伺服器驗證並儲存。對手只能看到已提交狀態，看不到牌組內容。');
  } catch(err) {setStatus(`牌組提交失敗：${err.message}`,true);}
  finally {submitDeckButton.disabled=!session;}
};
ready.onclick=()=>{
  if (socket?.readyState!==WebSocket.OPEN || !roomState) return;
  const mySeat=roomState.seats[session.seat];
  socket.send(JSON.stringify({type:'SET_READY',ready:!mySeat?.ready}));
};
retryButton.onclick=()=>{reconnects=0;socketConnect();};
exitButton.onclick=()=>{closeSocket();setSession(null);setStatus('已離開本機房間畫面；你的席位在房間到期前仍保留。');};
copyButton.onclick=async()=>{
  const url=new URL(location.href);
  url.searchParams.set('room',session.code);url.searchParams.delete('token');
  try {await navigator.clipboard.writeText(url.href);setStatus('已複製邀請連結。');}
  catch {setStatus(`邀請連結：${url.href}`);}
};
$('joinCode').value=validCode(new URLSearchParams(location.search).get('room'))||'';
if (!safeEndpoint()) {
  connect.textContent='尚未設定 Cloudflare Worker 網址';
  createButton.disabled=true;joinButton.disabled=true;
  setStatus('請先部署 cloudflare-pvp，並在 js/pvp-config.js 填入實際 Worker HTTPS 網址。',true);
} else {
  connect.textContent=`連線伺服器：${safeEndpoint()}`;
  try {
    const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
    if (saved?.token && validCode(saved.code) && [0,1].includes(saved.seat)) {
      setSession(saved);await socketConnect();
    }
  } catch { sessionStorage.removeItem(storageKey); }
}
