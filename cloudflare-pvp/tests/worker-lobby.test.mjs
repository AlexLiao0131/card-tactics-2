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
 assert.equal(wsB.sent.findLast(msg=>msg.room?.bothReady!==undefined).room.bothReady,true);
 assert.equal(wsA.sent.findLast(msg=>msg.room?.bothReady!==undefined).room.bothReady,true);
 const ver=wsB.sent.findLast(msg=>msg.room?.bothReady!==undefined).room.version;
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'GAME_MOVE',to:{x:0,y:0}}));
 assert.equal(wsA.sent.at(-1).error,'TACTICAL_GAME_CORE_NOT_READY');
 assert.equal((await room.ctx.storage.get('room')).version,ver);
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'SET_READY',ready:'true'}));
 // Once both decks are locked and the match starts, SET_READY is no longer a lobby operation.
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
