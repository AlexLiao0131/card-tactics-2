import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {PVP_COMMAND_PROTOCOL} from '../../shared/pvp-command-contract.mjs';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
const dir=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.resolve(dir,'../src/.worker-tactical-test.mjs');
const source=await fs.readFile(path.resolve(dir,'../src/worker.mjs'),'utf8');
await fs.writeFile(runtimePath,source.replace("import { DurableObject } from 'cloudflare:workers';",
  `class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}`));
let entry;try {entry=await import(pathToFileURL(runtimePath));}finally {await fs.rm(runtimePath,{force:true});}
const {PvpRoom,default:worker}=entry;
const NativeResponse=globalThis.Response;
class Socket{
  sent=[];readyState=1;
  send(msg){if(this.readyState===1)this.sent.push(JSON.parse(msg));}
  close(code,reason){this.readyState=3;this.code=code;this.reason=reason;}
  serializeAttachment(x){this.attachment=structuredClone(x);}
  deserializeAttachment(){return this.attachment;}
}
globalThis.WebSocket={OPEN:1};
globalThis.WebSocketPair=class {constructor(){this[0]=new Socket();this[1]=new Socket();}};
globalThis.Response=class Response extends NativeResponse{
  constructor(body,init){if(init?.status===101)return {ok:true,status:101,webSocket:init.webSocket};super(body,init);}
};
globalThis.crypto??=crypto.webcrypto;
class Storage{
  db=new Map();lock=Promise.resolve();
  async get(k){return structuredClone(this.db.get(k));}
  async put(k,v){this.db.set(k,structuredClone(v));}
  async delete(k){this.db.delete(k);}
  async deleteAll(){this.db.clear();}
  async setAlarm(){}
  transaction(callback){const x=this.lock.then(()=>callback(this));this.lock=x.catch(()=>{});return x;}
}
class Context{
  storage=new Storage();sockets=[];
  getWebSockets(){return this.sockets.filter(x=>x.readyState===1);}
  acceptWebSocket(ws){this.sockets.push(ws);}
}
const origin='https://alexliao0131.github.io';
function createService(flag=true){
  const rooms=new Map(),pvpEnv={APP_ORIGIN:origin,PVP_INTERNAL_TACTICAL_TEST:flag?'true':'false'};
  pvpEnv.ROOMS={idFromName:n=>n,get(id){
    if(!rooms.has(id)){const ctx=new Context();rooms.set(id,{ctx,do:new PvpRoom(ctx,pvpEnv)});}
    const r=rooms.get(id);return {fetch:(url,options)=>r.do.fetch(new Request(url,options))};
  }};
  return {rooms,env:pvpEnv};
}
async function post(env,path,data={},token=''){
 const result=await worker.fetch(new Request('https://worker.test'+path,{method:'POST',
 headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
 body:JSON.stringify(data)}),env);
 return {status:result.status,data:await result.json()};
}
async function openSocket(service,code,token){
 const ticket=await post(service.env,`/v1/rooms/${code}/ticket`,{},token);
 const result=await worker.fetch(new Request(`https://worker.test/v1/rooms/${code}/socket?ticket=${ticket.data.ticket}`,{
  headers:{Origin:origin,Upgrade:'websocket'}}),service.env);
 assert.equal(result.status,101);return result.webSocket;
}
async function createReadyRoom(flag=true){
 const service=createService(flag),a=(await post(service.env,'/v1/rooms',{name:'Player A'})).data;
 const b=(await post(service.env,`/v1/rooms/${a.code}/join`,{name:'Player B'})).data;
 const deck=Array(20).fill('imperial_swordsman_card');
 assert.equal((await post(service.env,`/v1/rooms/${a.code}/deck`,{cards:deck},a.token)).status,200);
 assert.equal((await post(service.env,`/v1/rooms/${a.code}/deck`,{cards:deck},b.token)).status,200);
 await openSocket(service,a.code,a.token);await openSocket(service,a.code,b.token);
 const room=service.rooms.get(`ct2:${a.code}`),[wsA,wsB]=room.ctx.getWebSockets();
 await room.do.webSocketMessage(wsA,JSON.stringify({type:'SET_READY',ready:true}));
 await room.do.webSocketMessage(wsB,JSON.stringify({type:'SET_READY',ready:true}));
 return {service,room,ws:[wsA,wsB],players:[a,b]};
}
let serial=0;
async function send(room,socket,action,revision=null,commandId=null){
 const state=await room.ctx.storage.get('authoritative-battle-session');
 const envelope={protocol:PVP_COMMAND_PROTOCOL,baseRevision:revision??state.revision,
 commandId:commandId||`worker-tactical-${String(++serial).padStart(8,'0')}`,action};
 await room.do.webSocketMessage(socket,JSON.stringify({type:'MATCH_COMMAND',envelope}));
 return {messages:socket.sent.slice(-3),state:await room.ctx.storage.get('authoritative-battle-session'),envelope};
}
async function prepare(pair){
 let x=await send(pair.room,pair.ws[0],{type:'KEEP_OPENING_HAND'});
 assert.equal(x.state.state.phase,'OPENING_HAND');
 x=await send(pair.room,pair.ws[1],{type:'KEEP_OPENING_HAND'});
 assert.equal(x.state.state.phase,'BATTLEFIELD_READY');
 return x;
}

test('incremental render frames follow authenticated seat baselines; lost baseline resync is full and read-only',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 const ws0=room.ws[0],ws1=room.ws[1];
 const first=ws0.sent.find(m=>m.type==='PVP_RENDER_SNAPSHOT');
 assert.ok(first,'new connection receives full official Babylon presentation');
 const firstB=ws1.sent.find(m=>m.type==='PVP_RENDER_SNAPSHOT');
 assert.equal(first.seat,0);assert.equal(firstB.seat,1);
 const before=await room.room.ctx.storage.get('authoritative-battle-session');
 await send(room.room,ws0,{type:'BEGIN_BATTLE'});
 const renderMessages=ws0.sent.filter(m=>m.type==='PVP_RENDER_DELTA'||m.type==='PVP_RENDER_SNAPSHOT');
 assert.ok(renderMessages.length>1);
 const newer=renderMessages.at(-1);
 assert.equal(newer.seat,0);
 assert.equal(newer.revision,before.revision+1);
 // The map is unchanged when battle starts. It must not be retransmitted.
 assert.equal(newer.type,'PVP_RENDER_DELTA');
 assert.equal(newer.delta.tiles,undefined);
 assert.equal(newer.delta.mapMeta,undefined);
 const beforeResync=await room.room.ctx.storage.get('authoritative-battle-session');
 const start=ws0.sent.length,opponentCount=ws1.sent.length;
 await room.room.do.webSocketMessage(ws0,JSON.stringify({type:'REQUEST_RENDER_SNAPSHOT'}));
 const recovered=ws0.sent.slice(start).find(m=>m.type==='PVP_RENDER_SNAPSHOT');
 assert.ok(recovered,'resync returns full frame');
 assert.equal(recovered.revision,beforeResync.revision);
 assert.equal(recovered.seat,0);
 assert.deepEqual(await room.room.ctx.storage.get('authoritative-battle-session'),beforeResync,
  'resync must not execute or mutate a game turn');
 assert.equal(ws1.sent.length,opponentCount,'resync does not broadcast to the other seat');
});
