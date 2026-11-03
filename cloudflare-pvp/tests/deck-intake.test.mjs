import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {DeckEngine} from '../../js/deck-engine.js';
import {CardDatabase} from '../../js/card-database.js';
import {validateOfficialDeck} from '../src/canonical-deck-rules.mjs';
import {markDeckSubmitted,roomView} from '../src/room-model.mjs';

const validDeck=['livia_card',...Array(19).fill('imperial_swordsman_card')];
const alternateDeck=['ophi_card',...Array(19).fill('imperial_archer_card')];

test('same 20-card rule as existing js/deck-engine.js; no shadow copy',()=>{
  assert.equal(DeckEngine.BATTLE_DECK_SIZE,20);
  assert.deepEqual(validateOfficialDeck(validDeck),{valid:true,cards:DeckEngine.validate(validDeck).deck});
  assert.deepEqual(validateOfficialDeck(alternateDeck),{valid:true,cards:alternateDeck});
  assert.equal(validateOfficialDeck(validDeck.slice(1)).valid,false);
  assert.equal(validateOfficialDeck([...validDeck.slice(0,19),'livia_card']).valid,false);
  assert.equal(validateOfficialDeck([...validDeck.slice(0,19),'ophi_eagle_card']).valid,false);
  assert.equal(validateOfficialDeck([...validDeck.slice(0,19),'flood_card']).valid,false);
  assert.equal(validateOfficialDeck([...validDeck.slice(0,19),'__proto__']).valid,false);
  assert.equal(validateOfficialDeck([...validDeck.slice(0,19),{id:'livia_card'}]).valid,false);
  assert.equal(validateOfficialDeck(['constructor',...Array(19).fill('imperial_swordsman_card')]).valid,false);
  assert.equal(CardDatabase.get('livia_card').unitType,'HERO');
});

test('lobby room projection never exposes private cards',()=>{
  const room={code:'ABCDEFGH',version:1,phase:'LOBBY',seats:[{name:'A',ready:true,tokenHash:'private',deckSubmitted:false},{name:'B',ready:true,tokenHash:'private2',deckSubmitted:false}]};
  markDeckSubmitted(room,0);
  assert.equal(room.version,2);
  assert.deepEqual(room.seats.map(s=>s.ready),[false,false]);
  assert.equal(roomView(room,[0]).seats[0].deckSubmitted,true);
  assert.equal(JSON.stringify(roomView(room,[0])).includes('private'),false);
  assert.throws(()=>markDeckSubmitted(room,2),/BAD_SEAT/);
});

// Mirrors the existing Worker-lobby test harness; only Cloudflare-only base class
// and WS handling are substituted. All authoritative room logic is real.
const here=path.dirname(fileURLToPath(import.meta.url));
const sourcePath=path.resolve(here,'../src/worker.mjs');
const targetPath=path.resolve(here,'../src/.deck-worker-test-runtime.mjs');
const source=await fs.readFile(sourcePath,'utf8');
await fs.writeFile(targetPath,source.replace("import { DurableObject } from 'cloudflare:workers';",`class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}`));
let mod;
try {mod=await import(pathToFileURL(targetPath));}
finally {await fs.unlink(targetPath).catch(()=>{});}
const {default:worker,PvpRoom}=mod;
const nativeResponse=globalThis.Response;
class Socket {
  constructor(){this.readyState=1;this.sent=[];this.attachment=null;}
  close(code,reason){this.readyState=3;this.code=code;this.reason=reason;}
  send(data){if(this.readyState===1)this.sent.push(JSON.parse(data));}
  serializeAttachment(x){this.attachment=structuredClone(x);}
  deserializeAttachment(){return this.attachment;}
}
globalThis.WebSocketPair=class WebSocketPair {constructor(){this[0]=new Socket;this[1]=new Socket;}};
globalThis.WebSocket={OPEN:1};
globalThis.Response=class Response extends nativeResponse {constructor(body,init){if(init?.status===101)return{status:101,ok:true,webSocket:init.webSocket};super(body,init);}};
if(!globalThis.crypto)globalThis.crypto=crypto.webcrypto;
class Storage {
  data=new Map();lock=Promise.resolve();alarmAt=0;
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){this.data.set(k,structuredClone(v));}
  async delete(k){this.data.delete(k);}
  async deleteAll(){this.data.clear();}
  transaction(f){const p=this.lock.then(()=>f(this));this.lock=p.catch(()=>{});return p;}
  async setAlarm(time){this.alarmAt=time;}
}
class Ctx {
  constructor(){this.storage=new Storage();this.sockets=[];}
  getWebSockets(){return this.sockets.filter(s=>s.readyState===1);}
  acceptWebSocket(s){this.sockets.push(s);}
}
function service(){
  const rooms=new Map();
  const ROOMS={idFromName:code=>code,get(key){
    if(!rooms.has(key)){const ctx=new Ctx();rooms.set(key,{ctx,do:new PvpRoom(ctx,{})});}
    const entry=rooms.get(key);return{fetch:(url,options)=>entry.do.fetch(new Request(url,options))};
  }};
  return{rooms,env:{APP_ORIGIN:'https://alexliao0131.github.io',ROOMS}};
}
const origin='https://alexliao0131.github.io';
const post=(env,path,payload={},secret='',host=origin)=>worker.fetch(new Request('https://worker.test'+path,{
  method:'POST',headers:{Origin:host,'Content-Type':'application/json',...(secret?{Authorization:`Bearer ${secret}`}:{})},body:JSON.stringify(payload)
}),env);

// NOTE: Network tests exercise the exact same Worker and Durable Object code as
// production; without a canonical tactical GameCore GAME_MOVE stays denied.
test('two authenticated seats submit independent private decks and reconnect',async()=>{
  const {rooms,env}=service();
  const created=await post(env,'/v1/rooms',{name:'A'});assert.equal(created.status,201);
  const a=await created.json();
  const b=await (await post(env,`/v1/rooms/${a.code}/join`,{name:'B'})).json();
  const room=rooms.get(`ct2:${a.code}`);
  const invalid=await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck.slice(1)},a.token);
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).error,'INVALID_DECK');
  assert.equal(await room.ctx.storage.get('deck:0'),undefined);
  const noAuth=await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},'0'.repeat(64));
  assert.equal(noAuth.status,401);
  const response=await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},a.token);
  assert.equal(response.status,200);
  const viewA=await (await post(env,`/v1/rooms/${a.code}/session`,{},a.token)).json();
  assert.equal(viewA.room.seats[0].deckSubmitted,true);
  assert.equal(viewA.room.seats[1].deckSubmitted,false);
  assert.ok(!JSON.stringify(viewA).includes('livia_card'));
  assert.ok(!JSON.stringify(viewA).includes('imperial_swordsman_card'));
  assert.ok(!JSON.stringify(viewA).includes('tokenHash'));
  assert.deepEqual(await room.ctx.storage.get('deck:0'),validDeck);
  const another=await post(env,`/v1/rooms/${a.code}/deck`,{cards:alternateDeck},b.token);
  assert.equal(another.status,200);
  assert.deepEqual(await room.ctx.storage.get('deck:1'),alternateDeck);
  assert.deepEqual((await (await post(env,`/v1/rooms/${a.code}/session`,{},b.token)).json()).room.seats.map(x=>x.deckSubmitted),[true,true]);
  const version=(await room.ctx.storage.get('room')).version;
  const repeated=await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},a.token);
  assert.equal(repeated.status,200);
  assert.equal((await room.ctx.storage.get('room')).version,version);
  room.do=new PvpRoom(room.ctx,{});
  const restored=await (await post(env,`/v1/rooms/${a.code}/session`,{},b.token)).json();
  assert.equal(restored.room.seats[0].deckSubmitted,true);
  assert.equal(restored.room.seats[1].deckSubmitted,true);
});

test('changing submitted deck clears prior ready state, but duplicate submit does not',async()=>{
  const {rooms,env}=service();
  const a=await (await post(env,'/v1/rooms',{name:'A'})).json();
  const b=await (await post(env,`/v1/rooms/${a.code}/join`,{name:'B'})).json();
  const room=rooms.get(`ct2:${a.code}`);
  await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},a.token);
  await post(env,`/v1/rooms/${a.code}/deck`,{cards:alternateDeck},b.token);
  let stored=await room.ctx.storage.get('room');
  stored.seats[0].ready=true;stored.seats[1].ready=true;
  await room.ctx.storage.put('room',stored);
  await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},a.token);
  assert.deepEqual((await room.ctx.storage.get('room')).seats.map(s=>s.ready),[true,true]);
  await post(env,`/v1/rooms/${a.code}/deck`,{cards:alternateDeck},a.token);
  assert.deepEqual((await room.ctx.storage.get('room')).seats.map(s=>s.ready),[false,false]);
  assert.deepEqual(await room.ctx.storage.get('deck:0'),alternateDeck);
});

test('cross-origin decks are denied; gameplay actions remain disabled',async()=>{
  const {rooms,env}=service();
  const a=await (await post(env,'/v1/rooms',{name:'A'})).json();
  assert.equal((await post(env,`/v1/rooms/${a.code}/deck`,{cards:validDeck},a.token,'https://evil.example')).status,403);
  const room=rooms.get(`ct2:${a.code}`);
  assert.equal(await room.ctx.storage.get('deck:0'),undefined);
  const replySocket=new Socket();replySocket.serializeAttachment({seat:0});
  await room.do.webSocketMessage(replySocket,JSON.stringify({type:'GAME_MOVE',unitId:'p0',x:1,y:1}));
  assert.equal(replySocket.sent.at(-1).error,'TACTICAL_GAME_CORE_NOT_READY');
});
