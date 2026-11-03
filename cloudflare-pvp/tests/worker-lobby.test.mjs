import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const sourcePath=path.resolve(here,'../src/worker.mjs');
const targetPath=path.resolve(here,'../src/.worker-test-runtime.mjs');
const src=await fs.readFile(sourcePath,'utf-8');
await fs.writeFile(targetPath,src.replace("import { DurableObject } from 'cloudflare:workers';",`class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}`));
let mod;
try {mod=await import(pathToFileURL(targetPath));} finally {await fs.unlink(targetPath).catch(()=>{});}
const {PvpRoom,default:worker}=mod;
const NativeResponse=globalThis.Response;
class Socket {
  constructor(){this.readyState=1;this.sent=[];this.attachment=null;}
  close(code,reason){this.readyState=3;this.code=code;this.reason=reason;}
  send(data){if(this.readyState===1)this.sent.push(JSON.parse(data));}
  serializeAttachment(a){this.attachment=structuredClone(a);}
  deserializeAttachment(){return this.attachment;}
}
globalThis.WebSocketPair=class WebSocketPair {constructor(){this[0]=new Socket;this[1]=new Socket;}};
globalThis.WebSocket={OPEN:1};
globalThis.Response=class Response extends NativeResponse {
  constructor(body,init){
    if(init?.status===101){return {status:101,ok:true,webSocket:init.webSocket};}
    super(body,init);
  }
};
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;

class Store {
  data=new Map();alarmAt=0;lock=Promise.resolve();
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){this.data.set(k,structuredClone(v));}
  async delete(k){this.data.delete(k);}
  async deleteAll(){this.data.clear();}
  transaction(fn){
    const operation=this.lock.then(()=>fn(this));
    this.lock=operation.catch(()=>{});
    return operation;
  }
  async setAlarm(t){this.alarmAt=t;}
}
class Ctx {
  constructor(){this.storage=new Store();this.sockets=[];}
  getWebSockets(){return this.sockets.filter(s=>s.readyState===1);}
  acceptWebSocket(ws){this.sockets.push(ws);}
}
function service(){
 const rooms=new Map();
 const ns={idFromName:x=>x,get(key){if(!rooms.has(key)) {const ctx=new Ctx();rooms.set(key,{ctx,do:new PvpRoom(ctx,{})});}const entry=rooms.get(key);return {fetch:(url,options)=>entry.do.fetch(new Request(url,options))};}};
 return {env:{APP_ORIGIN:'https://alexliao0131.github.io',ROOMS:ns},rooms};
}
const origin='https://alexliao0131.github.io';
async function post(env,url,obj={},token='',site=origin){return worker.fetch(new Request('https://worker.example'+url,{method:'POST',headers:{Origin:site,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(obj)}),env)};
async function socket(env,code,ticket){return worker.fetch(new Request(`https://worker.example/v1/rooms/${code}/socket?ticket=${ticket}`,{headers:{Origin:origin,Upgrade:'websocket'}}),env)};

test('HTTP room lifecycle, credentials, tickets and WS readiness',async()=>{
 const {env,rooms}=service();
 const created=await post(env,'/v1/rooms',{name:' Host '});
 assert.equal(created.status,201);
 assert.equal(created.headers.get('Access-Control-Allow-Origin'),origin);
 const host=await created.json();
 assert.match(host.code,/^[A-HJ-NP-Z2-9]{8}$/);
 assert.match(host.token,/^[0-9a-f]{64}$/);
 const room=rooms.get(`ct2:${host.code}`);
 assert.ok(room.ctx.storage.alarmAt>0);
 const a=await post(env,`/v1/rooms/${host.code}/session`,{},host.token);
 assert.equal((await a.json()).seat,0);
 const noAuth=await post(env,`/v1/rooms/${host.code}/session`,{},'f'.repeat(64));
 assert.equal(noAuth.status,401);
 assert.equal(noAuth.headers.get('Access-Control-Allow-Origin'),origin);
 const joined=await post(env,`/v1/rooms/${host.code}/join`,{name:'Guest'});
 assert.equal(joined.status,200);
 const guest=await joined.json();
 const third=await post(env,`/v1/rooms/${host.code}/join`,{name:'Third'});
 assert.equal(third.status,409);
 const ticketA=await (await post(env,`/v1/rooms/${host.code}/ticket`,{},host.token)).json();
 const wsa=await socket(env,host.code,ticketA.ticket);
 assert.equal(wsa.status,101);
 const wsA=room.ctx.getWebSockets()[0];
 assert.equal(wsA.sent[0].type,'WELCOME');
 const replay=await socket(env,host.code,ticketA.ticket);
 assert.equal(replay.status,401);
 const ticketB=await (await post(env,`/v1/rooms/${host.code}/ticket`,{},guest.token)).json();
 assert.equal((await socket(env,host.code,ticketB.ticket)).status,101);
 const wsB=room.ctx.getWebSockets()[1];
 assert.equal(wsA.sent.at(-1).room.seats[1].online,true);
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'SET_READY',ready:true}));
 assert.equal(wsA.sent.at(-1).error,'DECK_REQUIRED');
 const deckA=['livia_card',...Array(19).fill('imperial_swordsman_card')];
 const deckB=['ophi_card',...Array(19).fill('imperial_archer_card')];
 assert.equal((await post(env,`/v1/rooms/${host.code}/deck`,{cards:deckA},host.token)).status,200);
 assert.equal((await post(env,`/v1/rooms/${host.code}/deck`,{cards:deckB},guest.token)).status,200);
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'SET_READY',ready:true}));
 await room.do.webSocketMessage(wsB,JSON.stringify({type:'SET_READY',ready:true}));
 assert.equal(wsB.sent.findLast(x=>x.type==='ROOM_STATE').room.bothReady,true);
 assert.equal(wsA.sent.findLast(x=>x.type==='ROOM_STATE').room.phase,'OPENING_HAND');
 assert.equal(wsA.sent.at(-1).match.view.own.hand.length,5);
 const ver=wsB.sent.findLast(x=>x.type==='ROOM_STATE').room.version;
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'GAME_MOVE',to:{x:0,y:0}}));
 assert.equal(wsA.sent.at(-1).error,'TACTICAL_GAME_CORE_NOT_READY');
 assert.equal((await room.ctx.storage.get('room')).version,ver);
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'SET_READY',ready:'true'}));
 assert.equal(wsA.sent.at(-1).error,'BAD_SEAT');
 // Hibernated DO reconstructs with same persistent storage and socket attachments.
 room.do = new PvpRoom(room.ctx,{});
 const recovered = await post(env,`/v1/rooms/${host.code}/session`,{},host.token);
 assert.equal((await recovered.json()).room.bothReady,true);
 // Duplicate session kicks old socket and keeps seat authoritative.
 const again=await (await post(env,`/v1/rooms/${host.code}/ticket`,{},host.token)).json();
 assert.equal((await socket(env,host.code,again.ticket)).status,101);
 assert.equal(wsA.code,4001);
 assert.equal(room.ctx.getWebSockets().length,2);
});

test('room isolation, origin restriction, 404 and expiry',async()=>{
 const {env,rooms}=service();
 const denied=await post(env,'/v1/rooms',{name:'x'},'','https://evil.example');
 assert.equal(denied.status,403);
 const wrong=await post(env,'/v1/rooms/ABCDEFGH/join',{name:'A'});
 assert.equal(wrong.status,404);
 const first=await(await post(env,'/v1/rooms',{name:'A'})).json();
 const second=await(await post(env,'/v1/rooms',{name:'B'})).json();
 assert.notEqual(first.code,second.code);
 const room=rooms.get(`ct2:${first.code}`);
 const state=await room.ctx.storage.get('room');
 state.expiresAt=0;await room.ctx.storage.put('room',state);
 const gone=await post(env,`/v1/rooms/${first.code}/session`,{},first.token);
 assert.equal(gone.status,410);
 assert.equal(room.ctx.storage.data.size,0);
 const alive=await post(env,`/v1/rooms/${second.code}/session`,{},second.token);
 assert.equal(alive.status,200);
});

test('racing joins never overwrite the one available second seat',async()=>{
 const {env}=service();
 const host=await(await post(env,'/v1/rooms',{name:'Host'})).json();
 const attempts=await Promise.all(Array.from({length:8},(_,i)=>post(env,`/v1/rooms/${host.code}/join`,{name:`Guest${i}`})));
 assert.equal(attempts.filter(x=>x.status===200).length,1);
 assert.equal(attempts.filter(x=>x.status===409).length,7);
 const state=await(await post(env,`/v1/rooms/${host.code}/session`,{},host.token)).json();
 assert.equal(state.room.seats.filter(Boolean).length,2);
});

// Real Worker/DO match creation with private per-seat projections and replay.
// Only opening hands are enabled; tactical commands must remain rejected.
test('two-player ready atomically creates private server opening game and survives reconnect',async()=>{
 const {env,rooms}=service();
 const a=await(await post(env,'/v1/rooms',{name:'A'})).json();
 const b=await(await post(env,`/v1/rooms/${a.code}/join`,{name:'B'})).json();
 const room=rooms.get(`ct2:${a.code}`);
 const dA=['livia_card',...Array(19).fill('imperial_swordsman_card')];
 const dB=['ophi_card',...Array(19).fill('imperial_archer_card')];
 assert.equal((await post(env,`/v1/rooms/${a.code}/deck`,{cards:dA},a.token)).status,200);
 assert.equal((await post(env,`/v1/rooms/${a.code}/deck`,{cards:dB},b.token)).status,200);
 const ticket0=await (await post(env,`/v1/rooms/${a.code}/ticket`,{},a.token)).json();
 const ticket1=await (await post(env,`/v1/rooms/${a.code}/ticket`,{},b.token)).json();
 await socket(env,a.code,ticket0.ticket);await socket(env,a.code,ticket1.ticket);
 const [ws0,ws1]=room.ctx.getWebSockets();
 await room.do.webSocketMessage(ws0,JSON.stringify({type:'SET_READY',ready:true}));
 assert.equal(await room.ctx.storage.get('authoritative-battle-session'),undefined);
 await room.do.webSocketMessage(ws1,JSON.stringify({type:'SET_READY',ready:true}));
 let session=await room.ctx.storage.get('authoritative-battle-session');
 assert.equal(session.revision,0);
 assert.equal(session.state.phase,'OPENING_HAND');
 assert.equal((await room.ctx.storage.get('room')).phase,'OPENING_HAND');
 assert.equal(ws0.sent.at(-1).type,'MATCH_STATE');
 assert.equal(ws1.sent.at(-1).type,'MATCH_STATE');
 assert.equal(ws0.sent.at(-1).match.view.own.hand.length,5);
 assert.equal(ws1.sent.at(-1).match.view.own.hand.length,5);
 assert.equal(JSON.stringify(ws0.sent.at(-1)).includes('imperial_archer_card'),false);
 assert.equal(JSON.stringify(ws1.sent.at(-1)).includes('imperial_swordsman_card'),false);
 const projection0=await post(env,`/v1/rooms/${a.code}/opening`,{},a.token);
 assert.equal(projection0.status,200);
 assert.equal((await projection0.json()).match.view.seat,0);
 const projection1=await post(env,`/v1/rooms/${a.code}/opening`,{},b.token);
 assert.equal((await projection1.json()).match.view.seat,1);
 assert.equal((await post(env,`/v1/rooms/${a.code}/opening`,{},'0'.repeat(64))).status,401);
 const command={type:'MATCH_COMMAND',envelope:{protocol:'ct2-command-v1',commandId:'opening00001',baseRevision:0,action:{type:'KEEP_OPENING_HAND'}}};
 await room.do.webSocketMessage(ws1,JSON.stringify(command));
 assert.equal(ws1.sent.at(-1).error,'NOT_YOUR_TURN');
 await room.do.webSocketMessage(ws0,JSON.stringify(command));
 assert.equal(ws0.sent.findLast(x=>x.type==='MATCH_ACK').acceptedRevision,1);
 session=await room.ctx.storage.get('authoritative-battle-session');
 assert.equal(session.revision,1);
 assert.equal(session.state.cards[0].mulliganDone,true);
 await room.do.webSocketMessage(ws0,JSON.stringify(command));
 assert.equal(ws0.sent.at(-1).duplicate,true);
 assert.equal((await room.ctx.storage.get('authoritative-battle-session')).revision,1);
 // Deployment, movement, damage payloads are not accepted without canonical tactical rules.
 await room.do.webSocketMessage(ws0,JSON.stringify({type:'MATCH_COMMAND',envelope:{
  protocol:'ct2-command-v1',commandId:'wrongact0001',baseRevision:1,action:{type:'MOVE',unitId:'p0',x:2,y:3}}}));
 assert.equal(ws0.sent.at(-1).error,'NOT_YOUR_TURN');
 await room.do.webSocketMessage(ws1,JSON.stringify({type:'MATCH_COMMAND',envelope:{
  protocol:'ct2-command-v1',commandId:'opening00002',baseRevision:1,action:{type:'MULLIGAN',indices:[0,1]}}}));
 session=await room.ctx.storage.get('authoritative-battle-session');
 assert.equal(session.revision,2);
 assert.equal(session.state.phase,'WAITING_FOR_TACTICAL_ENGINE');
 assert.equal((await room.ctx.storage.get('room')).phase,'WAITING_FOR_TACTICAL_ENGINE');
 // Lost ACKs remain safe to retry after the opening phase has closed.
 await room.do.webSocketMessage(ws1,JSON.stringify({type:'MATCH_COMMAND',envelope:{
  protocol:'ct2-command-v1',commandId:'opening00002',baseRevision:1,action:{type:'MULLIGAN',indices:[0,1]}}}));
 assert.equal(ws1.sent.at(-1).duplicate,true);
 assert.equal((await room.ctx.storage.get('authoritative-battle-session')).revision,2);
 const denied=await post(env,`/v1/rooms/${a.code}/deck`,{cards:dA},a.token);
 assert.equal(denied.status,409);
 // Hibernation simulates a Worker restart without losing battle state.
 room.do=new PvpRoom(room.ctx,{});
 const recTicket=await (await post(env,`/v1/rooms/${a.code}/ticket`,{},a.token)).json();
 await socket(env,a.code,recTicket.ticket);
 const resumed=room.ctx.getWebSockets().find(s=>s.deserializeAttachment()?.seat===0);
 assert.equal(resumed.sent.findLast(x=>x.type==='MATCH_STATE').match.revision,2);
 assert.equal(resumed.sent.findLast(x=>x.type==='MATCH_STATE').match.view.phase,'WAITING_FOR_TACTICAL_ENGINE');
 assert.equal((await post(env,`/v1/rooms/${a.code}/opening`,{},a.token)).status,200);
});
