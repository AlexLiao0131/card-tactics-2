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

test('explicit test mode advances across opening -> start -> deploy -> next seat with real DO storage',async()=>{
 const room=await createReadyRoom(true);
 await prepare(room);
 const begin=await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 assert.equal(begin.state.state.phase,'PLAYER_CARD_PHASE');
 assert.equal(begin.state.state.activeSeat,0);
 const base=begin.state.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 const deployed=await send(room.room,room.ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y});
 assert.equal(deployed.state.state.units.length,1);
 assert.equal(deployed.state.state.units[0].team,'P');
 const duplicate=await send(room.room,room.ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y},
   deployed.envelope.baseRevision,deployed.envelope.commandId);
 assert.equal(duplicate.state.revision,deployed.state.revision);
 assert.equal(duplicate.state.state.units.length,1);
 assert.equal(room.ws[0].sent.at(-1).duplicate,true);
 const ended=await send(room.room,room.ws[0],{type:'END_CARD_PHASE'});
 assert.equal(ended.state.state.phase,'PLAYER_TACTICAL_PHASE');
 const turn=await send(room.room,room.ws[0],{type:'END_TACTICAL_PHASE'});
 assert.equal(turn.state.state.activeSeat,1);
 assert.equal(turn.state.state.phase,'ENEMY_CARD_PHASE');
 const wrong=await send(room.room,room.ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y});
 assert.equal(wrong.state.revision,turn.state.revision);
 assert.equal(room.ws[0].sent.at(-1).error,'NOT_YOUR_TURN');
 const own=await post(room.service.env,`/v1/rooms/${room.players[0].code}/opening`,{},room.players[0].token);
 assert.equal(own.data.match.view.own.hand.length,4);
 assert.equal(own.data.match.view.opponent.handCount,5);
 assert.equal(own.data.match.view.units.length,1);
 assert.ok(room.ws[0].sent.some(m=>m.type==='PVP_RENDER_SNAPSHOT'));
 assert.equal(room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.tacticalEnabled,true);
 assert.equal(room.ws[0].sent.findLast(m=>m.type==='PVP_RENDER_SNAPSHOT').seat,0);
 assert.equal(room.ws[0].sent.findLast(m=>m.type==='PVP_RENDER_SNAPSHOT').matchId,room.players[0].code);
 assert.equal(room.ws[1].sent.findLast(m=>m.type==='PVP_RENDER_SNAPSHOT').seat,1);
});

test('without explicit test flag production Worker still rejects new tactical commands, but supports opening retries',async()=>{
 const room=await createReadyRoom(false);
 const before=await prepare(room);
 const denied=await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 assert.equal(room.ws[0].sent.at(-1).error,'TACTICAL_GAME_CORE_NOT_READY');
 assert.equal(denied.state.revision,before.state.revision);
 assert.ok(!room.ws[0].sent.some(m=>m.type==='PVP_RENDER_SNAPSHOT'));
 assert.equal(room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.tacticalEnabled,false);
});


test('WebSocket round-trip attack -> opponent reaction -> official damage, no duplicate / forged reactions',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 const draft=await room.room.ctx.storage.get('authoritative-battle-session');
 const place0=draft.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 const place1=draft.state.battlefield.deploymentPoints.find(p=>p.owner==='ENEMY').area[0];
 await send(room.room,room.ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:place0.x,y:place0.y});
 await send(room.room,room.ws[0],{type:'END_CARD_PHASE'});
 await send(room.room,room.ws[0],{type:'END_TACTICAL_PHASE'});
 await send(room.room,room.ws[1],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:place1.x,y:place1.y});
 await send(room.room,room.ws[1],{type:'END_CARD_PHASE'});
 const setup=await room.room.ctx.storage.get('authoritative-battle-session');
 const [defender,attacker]=setup.state.units;
 const map=setup.state.battlefield.map;
 const skill=SkillDatabase.get('slash');
 let legal=false;
 for(const tile of map.tiles){
   const next=TacticalEngine.tile(map,tile.x+1,tile.y);
   if(!next||!globalThis.TERRAINS[tile.terrain]?.passable||
      !globalThis.TERRAINS[next.terrain]?.passable)continue;
   defender.x=tile.x;defender.y=tile.y;attacker.x=next.x;attacker.y=next.y;
   if(TacticalEngine.canTarget(map,attacker,defender,skill,setup.state.environmentState)){
     legal=true;break;
   }
 }
 assert.ok(legal,'test fixture arranges official targetable positions');
 attacker.acted=false;attacker.waited=false;attacker.moved=false;
 await room.room.ctx.storage.put('authoritative-battle-session',setup);
 const declare=await send(room.room,room.ws[1],{type:'DECLARE_ATTACK',
   attackerId:attacker.id,targetId:defender.id,skillId:'slash'});
 assert.equal(declare.state.state.phase,'PVP_REACTION_PENDING');
 assert.equal(declare.state.state.activeSeat,0);
 const view0=room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 const view1=room.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 assert.ok(view0.reactionOptions?.defenses?.some(m=>m.id==='sword_parry'));
 assert.equal(view1.reactionOptions,null,'attacker does not receive private defender choices');
 assert.ok(view0.units.find(u=>u.id===defender.id)?.attackSkills?.some(s=>s.id==='slash'));
 assert.ok(view1.units.find(u=>u.id===attacker.id)?.attackSkills?.some(s=>s.id==='slash'));
 assert.equal(view0.units.find(u=>u.id===attacker.id)?.attackSkills,undefined,
   'opponent unit loadout skill list must not leak');
 assert.equal(view1.units.find(u=>u.id===defender.id)?.attackSkills,undefined,
   'opponent unit loadout skill list must not leak');
 const forged=await send(room.room,room.ws[1],{type:'REACT_ATTACK',reaction:'ACCEPT'});
 assert.equal(forged.state.revision,declare.state.revision);
 assert.equal(room.ws[1].sent.at(-1).error,'NOT_YOUR_TURN');
 const react=await send(room.room,room.ws[0],{type:'REACT_ATTACK',reaction:'EVADE'});
 assert.equal(react.state.state.phase,'ENEMY_TACTICAL_PHASE');
 assert.equal(react.state.state.activeSeat,1);
 assert.equal(react.state.state.pendingAttack,null);
 assert.equal(react.state.state.units[1].acted,true);
 assert.equal(room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view.phase,'ENEMY_TACTICAL_PHASE');
 const duplicate=await send(room.room,room.ws[0],{type:'REACT_ATTACK',reaction:'EVADE'},
   react.envelope.baseRevision,react.envelope.commandId);
 assert.equal(duplicate.state.revision,react.state.revision);
 assert.equal(room.ws[0].sent.at(-1).duplicate,true);
});

test('Durable Object weather card command uses official card controller and persists climate once',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 const data=await room.room.ctx.storage.get('authoritative-battle-session');
 data.state.cards[0].zones.hand.push('fog_card');
 data.state.cards[0].crystals=10;
 await room.room.ctx.storage.put('authoritative-battle-session',data);
 const result=await send(room.room,room.ws[0],{type:'PLAY_INSTANT_CARD',cardId:'fog_card'});
 assert.equal(result.state.revision,data.revision+1);
 assert.equal(result.state.state.cards[0].crystals,7);
 assert.equal(result.state.state.cards[0].zones.discard.includes('fog_card'),true);
 assert.equal(result.state.state.environmentState.weather,'FOG');
 const identical=await send(room.room,room.ws[0],{type:'PLAY_INSTANT_CARD',cardId:'fog_card'},
   result.envelope.baseRevision,result.envelope.commandId);
 assert.equal(identical.state.revision,result.state.revision);
 assert.equal(room.ws[0].sent.at(-1).duplicate,true);
 const hacker=await send(room.room,room.ws[1],{type:'PLAY_INSTANT_CARD',cardId:'fog_card'});
 assert.equal(hacker.state.revision,result.state.revision);
 assert.equal(room.ws[1].sent.at(-1).error,'NOT_YOUR_TURN');
});

test('Durable Object effect skill cast accepts same official resources and rejects repeated heal',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 await send(room.room,room.ws[0],{type:'END_CARD_PHASE'});
 const draft=await room.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const points=draft.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 withCanonicalEngines(draft.state,e=>{
   for(const [id,characterId,point] of [
     ['caster','church_saint',points[0]],['friend','church_templar_hero',points[1]]]){
     const unit=e.unitRuntime.create({id,team:'P',characterId,x:point.x,y:point.y,
       map:draft.state.battlefield.map,cores:draft.state.battlefield.cores});
     delete unit._runtimeMap;
     unit.acted=false;unit.waited=false;unit.moved=false;
     if(id==='friend')unit.hp-=50;
     draft.state.units.push(unit);
   }
 });
 await room.room.ctx.storage.put('authoritative-battle-session',draft);
 const cast=await send(room.room,room.ws[0],{type:'CAST_EFFECT_SKILL',unitId:'caster',targetId:'friend',skillId:'saint_hero_heal'});
 assert.equal(cast.state.revision,draft.revision+1);
 const caster=cast.state.state.units.find(u=>u.id==='caster');
 const friend=cast.state.state.units.find(u=>u.id==='friend');
 assert.equal(caster.acted,true);assert.ok(friend.hp>friend.character.combat.hp-50);
 assert.ok(room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view.units.find(u=>u.id==='caster')
    .effectSkills.some(x=>x.id==='saint_hero_heal'));
 const repeated=await send(room.room,room.ws[0],{type:'CAST_EFFECT_SKILL',unitId:'caster',targetId:'friend',skillId:'saint_hero_heal'});
 assert.equal(repeated.state.revision,cast.state.revision);
 assert.equal(room.ws[0].sent.at(-1).error,'CASTER_NOT_AVAILABLE');
});

test('Durable Object steal-hand command preserves opponent privacy and commits only once',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 const before=await room.room.ctx.storage.get('authoritative-battle-session');
 before.state.cards[0].zones.hand.push('steal_hand_card');
 before.state.cards[0].crystals=10;
 await room.room.ctx.storage.put('authoritative-battle-session',before);
 const opponentCount=before.state.cards[1].zones.hand.length;
 const action={type:'PLAY_INSTANT_CARD',cardId:'steal_hand_card'};
 const sent=await send(room.room,room.ws[0],action);
 assert.equal(sent.state.revision,before.revision+1);
 assert.equal(sent.state.state.cards[1].zones.hand.length,opponentCount-1);
 assert.equal(sent.state.state.cards[0].crystals,5);
 assert.ok(sent.state.state.cards[0].zones.discard.includes('steal_hand_card'));
 const last1=room.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 assert.equal(last1.opponent.handCount,sent.state.state.cards[0].zones.hand.length);
 assert.ok(!('hand' in last1.opponent),'opponent may see hand count but not stolen hand contents');
 const duplicate=await send(room.room,room.ws[0],action,sent.envelope.baseRevision,sent.envelope.commandId);
 assert.equal(duplicate.state.revision,sent.state.revision);
 assert.equal(room.ws[0].sent.at(-1).duplicate,true);
});

test('production test flag off still denies effect and instant spell commands through WebSocket',async()=>{
 const room=await createReadyRoom(false);const opened=await prepare(room);
 for(const action of [{type:'PLAY_INSTANT_CARD',cardId:'fog_card'},
   {type:'CAST_EFFECT_SKILL',unitId:'x',targetId:'y',skillId:'saint_hero_heal'}]){
   const denied=await send(room.room,room.ws[0],action);
   assert.equal(denied.state.revision,opened.state.revision);
   assert.equal(room.ws[0].sent.at(-1).error,'TACTICAL_GAME_CORE_NOT_READY');
 }
});

test('Durable Object meteor uses official synchronous impact, charges once, and resists client damage override',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 const base=(await pair.room.ctx.storage.get('authoritative-battle-session')).state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 await send(pair.room,pair.ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y});
 const before=await pair.room.ctx.storage.get('authoritative-battle-session');
 before.state.cards[0].zones.hand.push('starfall_card');
 before.state.cards[0].crystals=10;
 const unitBefore=before.state.units[0].hp;
 await pair.room.ctx.storage.put('authoritative-battle-session',before);
 const cmd={type:'PLAY_TARGET_CARD',cardId:'starfall_card',x:base.x,y:base.y};
 const result=await send(pair.room,pair.ws[0],cmd);
 assert.equal(result.state.revision,before.revision+1);
 assert.equal(result.state.state.cards[0].crystals,0);
 assert.equal(result.state.state.cards[0].zones.discard.includes('starfall_card'),true);
 assert.ok(result.state.state.units[0].hp<unitBefore,'HP damage must be in committed DO state, not later animation');
 const old=await send(pair.room,pair.ws[0],cmd,result.envelope.baseRevision,result.envelope.commandId);
 assert.equal(old.state.revision,result.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).duplicate,true);
 const forged=await send(pair.room,pair.ws[0],{...cmd,damage:999999});
 assert.equal(forged.state.revision,result.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).error,'CLIENT_RESULT_FORBIDDEN');
});

test('Durable Object WebSocket self-enchantment survives serialized restart; private followup and duplicate commit remain correct',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 await send(pair.room,pair.ws[0],{type:'END_CARD_PHASE'});
 const saved=await pair.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const points=saved.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 withCanonicalEngines(saved.state,e=>{
  const pos=points.find(p=>globalThis.TERRAINS[TacticalEngine.tile(saved.state.battlefield.map,p.x,p.y)?.terrain]?.passable);
  const unit=e.unitRuntime.create({id:'owner_livia',team:'P',characterId:'livia',x:pos.x,y:pos.y,
    map:saved.state.battlefield.map,cores:saved.state.battlefield.cores});
  assert.ok(unit);delete unit._runtimeMap;saved.state.units.push(unit);
 });
 await pair.room.ctx.storage.put('authoritative-battle-session',saved);
 // Projections are server-issued. The client is forbidden to invent candidates.
 const {tacticalDebugProjection}=await import('../src/pvp-headless-tactical.mjs');
 const option=tacticalDebugProjection(saved.state,0).units.find(u=>u.id==='owner_livia')
   .enchantmentOptions.find(o=>o.targetId==='owner_livia'&&o.variantId==='ENCHANT_FIRE');
 assert.ok(option,'official controller must issue the available weapon/variant');
 const spell={type:'CAST_ENCHANTMENT',unitId:'owner_livia',targetId:'owner_livia',
   skillId:option.skillId,variantId:option.variantId,weaponSlot:option.weaponSlot};
 const one=await send(pair.room,pair.ws[0],spell);
 assert.equal(one.state.revision,saved.revision+1);
 assert.deepEqual(one.state.state.pendingEnchantmentFollowup,
   {unitId:'owner_livia',weaponSlot:option.weaponSlot});
 assert.ok(one.state.state.units[0].effects.some(e=>e.type==='WEAPON_ENCHANT'&&e.weaponSlot===option.weaponSlot));
 const selfView=pair.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 const otherView=pair.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 assert.equal(selfView.enchantmentFollowup.unitId,'owner_livia');
 assert.equal(otherView.enchantmentFollowup,null);
 assert.equal(otherView.units.find(u=>u.id==='owner_livia')?.enchantmentOptions,undefined);
 const twice=await send(pair.room,pair.ws[0],spell,one.envelope.baseRevision,one.envelope.commandId);
 assert.equal(twice.state.revision,one.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).duplicate,true);
 const forbidden=await send(pair.room,pair.ws[0],{type:'END_TACTICAL_PHASE'});
 assert.equal(forbidden.state.revision,one.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).error,'ENCHANTMENT_FOLLOWUP_REQUIRED');
 // Simulate a process restart by replacing the DO with a new instance holding its persisted storage.
 const context=pair.room.ctx;pair.room.do=new PvpRoom(context,pair.service.env);
 const end=await send(pair.room,pair.ws[0],{type:'END_ENCHANT_FOLLOWUP',unitId:'owner_livia'});
 assert.equal(end.state.revision,one.state.revision+1);
 assert.equal(end.state.state.pendingEnchantmentFollowup,null);
 assert.equal(end.state.state.units[0].acted,true);
 assert.ok(end.state.state.units[0].effects.some(e=>e.type==='WEAPON_ENCHANT'),
   'ending the optional attack keeps enchantment for its next attack');
});

test('Durable Object channel spell ticks at next round; cannot choose client-defined healing amount',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 await send(pair.room,pair.ws[0],{type:'END_CARD_PHASE'});
 const saved=await pair.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const points=saved.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 withCanonicalEngines(saved.state,e=>{
   const loc=points.find(p=>globalThis.TERRAINS[TacticalEngine.tile(saved.state.battlefield.map,p.x,p.y)?.terrain]?.passable);
   const u=e.unitRuntime.create({id:'pvp_ophi',team:'P',characterId:'ophi',x:loc.x,y:loc.y,
      map:saved.state.battlefield.map,cores:saved.state.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;u.hp-=30;saved.state.units.push(u);
 });
 await pair.room.ctx.storage.put('authoritative-battle-session',saved);
 const illegal=await send(pair.room,pair.ws[0],{type:'CAST_EFFECT_SKILL',unitId:'pvp_ophi',
   targetId:'pvp_ophi',skillId:'ophi_healing_song',healing:99999});
 assert.equal(illegal.state.revision,saved.revision);
 assert.equal(pair.ws[0].sent.at(-1).error,'INVALID_EFFECT_SKILL_COMMAND');
 const spell=await send(pair.room,pair.ws[0],{type:'CAST_EFFECT_SKILL',unitId:'pvp_ophi',
   targetId:'pvp_ophi',skillId:'ophi_healing_song'});
 assert.equal(spell.state.revision,saved.revision+1);
 const startHp=spell.state.state.units.find(u=>u.id==='pvp_ophi').hp;
 assert.equal(spell.state.state.units.find(u=>u.id==='pvp_ophi').effects.some(e=>e.type==='HEALING_CHANNEL'),true);
 await send(pair.room,pair.ws[0],{type:'END_TACTICAL_PHASE'});
 await send(pair.room,pair.ws[1],{type:'END_CARD_PHASE'});
 // A random real map/weather may injure a channeling unit during the same
 // round. Compare the canonical turn with an otherwise identical control
 // room minus the healing channel instead of assuming no environmental harm.
 const baseline=structuredClone(await pair.room.ctx.storage.get('authoritative-battle-session'));
 const noChannel=structuredClone(baseline.state);
 const controlSinger=noChannel.units.find(u=>u.id==='pvp_ophi');
 controlSinger.effects=controlSinger.effects.filter(e=>e.type!=='HEALING_CHANNEL');
 const {resolveCanonicalPlayerCommand}=await import('../src/pvp-headless-tactical.mjs');
 resolveCanonicalPlayerCommand(noChannel,{type:'END_TACTICAL_PHASE'},1);
 const controlHp=noChannel.units.find(u=>u.id==='pvp_ophi').hp;
 const advanced=await send(pair.room,pair.ws[1],{type:'END_TACTICAL_PHASE'});
 assert.equal(advanced.state.state.round,2);
 assert.equal(advanced.state.state.units.find(u=>u.id==='pvp_ophi').hp,controlHp+10);
 assert.equal(baseline.state.units.find(u=>u.id==='pvp_ophi').hp,startHp);
 assert.equal(advanced.state.state.units.find(u=>u.id==='pvp_ophi').effects.some(e=>e.type==='HEALING_CHANNEL'),true);
});

test('Durable Object blood-shadow attack and private memory selection survive retry and storage restart',async()=>{
 const room=await createReadyRoom(true);await prepare(room);
 await send(room.room,room.ws[0],{type:'BEGIN_BATTLE'});
 await send(room.room,room.ws[0],{type:'END_CARD_PHASE'});
 const session=await room.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const map=session.state.battlefield.map;
 withCanonicalEngines(session.state,e=>{
  for(const [id,team,characterId] of [['vampire','P','seraphina'],['victim','E','imperial_swordsman']]){
   const u=e.unitRuntime.create({id,team,characterId,x:1,y:1,map,cores:session.state.battlefield.cores});
   assert.ok(u);delete u._runtimeMap;u.moved=false;u.acted=false;u.waited=false;
   session.state.units.push(u);
  }
 });
 const [actor,victim]=session.state.units;
 const controller=globalThis.TacticalActionController.create({actionState:()=>({map,
  units:session.state.units,environmentState:session.state.environmentState})});
 const legal=tile=>globalThis.TERRAINS[tile.terrain]?.passable&&
   !map.objects.some(o=>o.blocksMovement&&o.x===tile.x&&o.y===tile.y);
 let found=false;
 for(const tile of map.tiles){
  if(!legal(tile))continue;
  const back=TacticalEngine.tile(map,tile.x-1,tile.y);
  if(!back||!legal(back))continue;
  victim.x=tile.x;victim.y=tile.y;victim.facing='E';
  for(const pos of map.tiles){
   if(!legal(pos)||pos.x===victim.x&&pos.y===victim.y||
      Math.abs(pos.x-back.x)+Math.abs(pos.y-back.y)>actor.character.combat.move)continue;
   actor.x=pos.x;actor.y=pos.y;
   if(controller.bloodShadowLanding(actor,victim)){
    actor.z=TacticalEngine.elevation(pos);victim.z=TacticalEngine.elevation(tile);
    found=true;break;
   }
  }
  if(found)break;
 }
 assert.ok(found,'official landing has a valid path and visibility');
 await room.room.ctx.storage.put('authoritative-battle-session',session);
 const action={type:'CAST_BLOOD_SHADOW',unitId:'vampire',targetId:'victim',skillId:'seraphina_blood_drain'};
 const cast=await send(room.room,room.ws[0],action);
 assert.equal(cast.state.revision,session.revision+1);
 assert.ok(cast.state.state.pendingBloodMemoryChoice?.skillIds.length>0);
 assert.ok(cast.state.state.units[1].hp<victim.hp);
 const private0=room.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 const private1=room.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 assert.ok(private0.bloodMemoryChoice?.options.length>0);
 assert.equal(private1.bloodMemoryChoice,null);
 assert.equal(private1.units.find(u=>u.id==='vampire')?.bloodShadowOptions,undefined);
 const retry=await send(room.room,room.ws[0],action,cast.envelope.baseRevision,cast.envelope.commandId);
 assert.equal(retry.state.revision,cast.state.revision);
 assert.equal(room.ws[0].sent.at(-1).duplicate,true);
 const denied=await send(room.room,room.ws[1],{type:'CHOOSE_BLOOD_MEMORY',unitId:'vampire',skillId:null});
 assert.equal(denied.state.revision,cast.state.revision);
 assert.equal(room.ws[1].sent.at(-1).error,'NOT_YOUR_TURN');
 // An instance restart may rehydrate from the same DO storage. Pending choice
 // is data, not a browser closure or an ephemeral JS object.
 const {ctx}=room.room;room.room.do=new PvpRoom(ctx,room.service.env);
 const choiceId=private0.bloodMemoryChoice.options[0].id;
 const accepted=await send(room.room,room.ws[0],{type:'CHOOSE_BLOOD_MEMORY',unitId:'vampire',skillId:choiceId});
 assert.equal(accepted.state.revision,cast.state.revision+1);
 assert.equal(accepted.state.state.pendingBloodMemoryChoice,null);
 assert.ok(accepted.state.state.units[0].grantedSkills.some(g=>g.bloodMemory&&g.skillId===choiceId));
 assert.equal(accepted.state.state.units[0].acted,true);
 const another=await send(room.room,room.ws[0],{type:'CHOOSE_BLOOD_MEMORY',unitId:'vampire',skillId:choiceId});
 assert.equal(another.state.revision,accepted.state.revision);
 assert.equal(room.ws[0].sent.at(-1).error,'NO_BLOOD_MEMORY_CHOICE');
});

test('Durable Object blood burst is server calculated, seat-private, idempotent and restart-safe',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 await send(pair.room,pair.ws[0],{type:'END_CARD_PHASE'});
 const initial=await pair.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const map=initial.state.battlefield.map;
 const lookup=new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t]));
 const good=t=>t&&globalThis.TERRAINS[t.terrain]?.passable&&
   !(map.objects||[]).some(o=>o.blocksMovement&&o.x===t.x&&o.y===t.y);
 const tile=map.tiles.find(t=>good(t)&&good(lookup.get(`${t.x+1},${t.y}`)));
 assert.ok(tile);
 withCanonicalEngines(initial.state,e=>{
   for(const item of [
     {id:'vampire',team:'P',characterId:'seraphina',x:tile.x,y:tile.y},
     {id:'bleeding_target',team:'E',characterId:'imperial_swordsman',x:tile.x+1,y:tile.y}
   ]){
     const u=e.unitRuntime.create({...item,map,cores:initial.state.battlefield.cores});
     assert.ok(u);delete u._runtimeMap;u.acted=false;u.waited=false;u.moved=false;
     initial.state.units.push(u);
   }
   e.effect.apply({source:initial.state.units[0],target:initial.state.units[1],
     effect:SkillDatabase.get('seraphina_rending_claw').statusEffects[0]});
 });
 await pair.room.ctx.storage.put('authoritative-battle-session',initial);
 const ours=await post(pair.service.env,`/v1/rooms/${pair.players[0].code}/opening`,{},pair.players[0].token);
 assert.ok(ours.data.match.view.units.find(u=>u.id==='vampire').bloodBurstSkills.some(s=>s.id==='seraphina_blood_burst'));
 const theirs=await post(pair.service.env,`/v1/rooms/${pair.players[0].code}/opening`,{},pair.players[1].token);
 assert.equal(theirs.data.match.view.units.find(u=>u.id==='vampire')?.bloodBurstSkills,undefined);
 const illegal=await send(pair.room,pair.ws[0],{type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:'seraphina_blood_burst',damage:99999});
 assert.equal(pair.ws[0].sent.at(-1).error,'CLIENT_RESULT_FORBIDDEN');
 assert.equal(illegal.state.revision,initial.revision);
 const action={type:'CAST_BLOOD_BURST',unitId:'vampire',skillId:'seraphina_blood_burst'};
 const first=await send(pair.room,pair.ws[0],action);
 assert.equal(first.state.revision,initial.revision+1);
 assert.ok(first.state.state.units[1].hp<initial.state.units[1].hp);
 assert.equal(first.state.state.units[1].effects.some(e=>e.id==='BLEEDING'),true);
 const context=pair.room.ctx;pair.room.do=new PvpRoom(context,pair.service.env);
 const replay=await send(pair.room,pair.ws[0],action,first.envelope.baseRevision,first.envelope.commandId);
 assert.equal(replay.state.revision,first.state.revision);
 assert.deepEqual(replay.state.state.units,first.state.state.units);
 assert.equal(pair.ws[0].sent.at(-1).duplicate,true);
});

test('Durable Object shared smoke field commits once, stays seat-private and survives restart through round expiry',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 await send(pair.room,pair.ws[0],{type:'END_CARD_PHASE'});
 const saved=await pair.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const spots=saved.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 withCanonicalEngines(saved.state,e=>{
   const loc=spots.find(p=>globalThis.TERRAINS[TacticalEngine.tile(saved.state.battlefield.map,p.x,p.y)?.terrain]?.passable);
   const cat=e.unitRuntime.create({id:'pvp_cat_field',team:'P',characterId:'cat_thief_hero',x:loc.x,y:loc.y,
     map:saved.state.battlefield.map,cores:saved.state.battlefield.cores});
   assert.ok(cat);delete cat._runtimeMap;saved.state.units.push(cat);
 });
 await pair.room.ctx.storage.put('authoritative-battle-session',saved);
 const spell={type:'CAST_AREA_FIELD',unitId:'pvp_cat_field',skillId:'cat_smoke_bomb'};
 const cast=await send(pair.room,pair.ws[0],spell);
 assert.equal(cast.state.revision,saved.revision+1);
 const caster=cast.state.state.units.find(u=>u.id==='pvp_cat_field');
 assert.ok(caster.effects.some(e=>e.id==='SMOKE_COVER'));
 assert.equal(cast.state.state.fieldState.smokeFields.length,1);
 const privateOwn=pair.ws[0].sent.findLast(m=>m.type==='MATCH_STATE').match.view.units.find(u=>u.id===caster.id);
 const privateOpponent=pair.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view.units.find(u=>u.id===caster.id);
 assert.ok(privateOwn.areaFieldSkills.some(s=>s.id==='cat_smoke_bomb'));
 assert.equal(privateOpponent?.areaFieldSkills,undefined);
 const ignored=await send(pair.room,pair.ws[0],{...spell,damage:99999});
 assert.equal(ignored.state.revision,cast.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).error,'CLIENT_RESULT_FORBIDDEN');
 const duplicated=await send(pair.room,pair.ws[0],spell,cast.envelope.baseRevision,cast.envelope.commandId);
 assert.equal(duplicated.state.revision,cast.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).duplicate,true);
 pair.room.do=new PvpRoom(pair.room.ctx,pair.service.env);
 const recovered=await pair.room.ctx.storage.get('authoritative-battle-session');
 assert.equal(recovered.state.fieldState.smokeFields.length,1);
 const ended=await send(pair.room,pair.ws[0],{type:'END_TACTICAL_PHASE'});
 assert.equal(ended.state.state.activeSeat,1);
 await send(pair.room,pair.ws[1],{type:'END_CARD_PHASE'});
 const next=await send(pair.room,pair.ws[1],{type:'END_TACTICAL_PHASE'});
 assert.equal(next.state.state.round,2);
 assert.equal(next.state.state.fieldState.smokeFields.length,1);
});

test('Durable Object WebSocket map-target skill delegates to original hydrology engine, hides private choices and deduplicates',async()=>{
 const pair=await createReadyRoom(true);await prepare(pair);
 await send(pair.room,pair.ws[0],{type:'BEGIN_BATTLE'});
 await send(pair.room,pair.ws[0],{type:'END_CARD_PHASE'});
 const saved=await pair.room.ctx.storage.get('authoritative-battle-session');
 const {withCanonicalEngines}=await import('../src/pvp-engine-context.mjs');
 const positions=saved.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area;
 withCanonicalEngines(saved.state,e=>{
  const p=positions.find(p=>globalThis.TERRAINS[TacticalEngine.tile(saved.state.battlefield.map,p.x,p.y)?.terrain]?.passable);
  assert.ok(p);
  const unit=e.unitRuntime.create({id:'pvp_nereia',team:'P',characterId:'nereia',
    x:p.x,y:p.y,map:saved.state.battlefield.map,cores:saved.state.battlefield.cores});
  assert.ok(unit);delete unit._runtimeMap;saved.state.units.push(unit);
 });
 await pair.room.ctx.storage.put('authoritative-battle-session',saved);
 const {tacticalDebugProjection}=await import('../src/pvp-headless-tactical.mjs');
 const own=tacticalDebugProjection(saved.state,0).units.find(u=>u.id==='pvp_nereia');
 assert.ok(own.mapSkills.some(s=>s.id==='nereia_tsunami'));
 assert.ok(tacticalDebugProjection(saved.state,1).units.every(u=>u.mapSkills===undefined));
 const actor=saved.state.units.find(u=>u.id==='pvp_nereia');
 const ctrl=globalThis.TacticalActionController.create({
  actionState:()=>({map:saved.state.battlefield.map,units:saved.state.units,
    environmentState:saved.state.environmentState}),
  unitAt:(x,y)=>saved.state.units.find(u=>u.alive&&u.x===x&&u.y===y)||null
 });
 const tile=ctrl.mapTargetTiles(actor,SkillDatabase.get('nereia_tsunami'))[0];assert.ok(tile);
 const action={type:'CAST_MAP_SKILL',unitId:'pvp_nereia',skillId:'nereia_tsunami',x:tile.x,y:tile.y};
 const first=await send(pair.room,pair.ws[0],action);
 assert.equal(first.state.revision,saved.revision+1);
 assert.equal(first.state.state.units.find(u=>u.id==='pvp_nereia').mana,
   actor.mana-SkillDatabase.get('nereia_tsunami').manaCost);
 assert.ok(first.state.state.events.some(e=>e.text.includes('Water Volume')));
 const otherView=pair.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.view;
 assert.ok(otherView.units.every(u=>u.mapSkills===undefined));
 const retry=await send(pair.room,pair.ws[0],action,first.envelope.baseRevision,first.envelope.commandId);
 assert.equal(retry.state.revision,first.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).duplicate,true);
 const injected=await send(pair.room,pair.ws[0],{...action,damage:999999});
 assert.equal(injected.state.revision,first.state.revision);
 assert.equal(pair.ws[0].sent.at(-1).error,'CLIENT_RESULT_FORBIDDEN');
 pair.room.do=new PvpRoom(pair.room.ctx,pair.service.env);
 const opened=await post(pair.service.env,`/v1/rooms/${pair.players[0].code}/opening`,{},pair.players[0].token);
 assert.equal(opened.status,200);assert.equal(opened.data.match.revision,first.state.revision);
});

test('two seats reconnect after Durable Object instance reconstruction; revision, private views and command receipts survive',async()=>{
 const match=await createReadyRoom(true);
 await prepare(match);
 const first=await send(match.room,match.ws[0],{type:'BEGIN_BATTLE'});
 const stored=structuredClone(first.state);
 assert.equal(stored.state.phase,'PLAYER_CARD_PHASE');
 const oldA=match.ws[0],oldB=match.ws[1];
 // Simulate a hibernated/new Durable Object JS instance using the SAME storage
 // and hibernated socket handles; not a live Cloudflare network deployment.
 match.room.do=new PvpRoom(match.room.ctx,match.service.env);
 await openSocket(match.service,match.players[0].code,match.players[0].token);
 const newA=match.room.ctx.getWebSockets().find(ws=>ws.deserializeAttachment()?.seat===0);
 assert.ok(newA&&newA!==oldA);
 assert.equal(oldA.code,4001);
 assert.equal(oldB.readyState,1,'reconnecting A must not kick opponent B');
 await openSocket(match.service,match.players[1].code,match.players[1].token);
 const newB=match.room.ctx.getWebSockets().find(ws=>ws.deserializeAttachment()?.seat===1);
 assert.ok(newB&&newB!==oldB);
 assert.equal(oldB.code,4001);
 const db=await match.room.ctx.storage.get('authoritative-battle-session');
 assert.deepEqual(db,stored,'a new JS instance must not change persisted world or revision');
 for(const [seat,socket] of [[0,newA],[1,newB]]){
   const packet=socket.sent.findLast(x=>x.type==='MATCH_STATE');
   const render=socket.sent.findLast(x=>x.type==='PVP_RENDER_SNAPSHOT');
   assert.equal(packet.match.revision,stored.revision);
   assert.equal(packet.match.view.seat,seat);
   assert.equal(packet.match.view.own.hand.length,5);
   assert.equal(packet.match.view.opponent.handCount,5);
   assert.equal(packet.match.view.opponent.hand,undefined,'reconnect must not reveal enemy hand');
   assert.equal(render.seat,seat);
   assert.equal(render.revision,stored.revision);
 }
 const repeated=await send(match.room,newA,{type:'BEGIN_BATTLE'},
   first.envelope.baseRevision,first.envelope.commandId);
 assert.equal(repeated.state.revision,stored.revision);
 assert.equal(newA.sent.at(-1).type,'MATCH_ACK');
 assert.equal(newA.sent.at(-1).duplicate,true,'restart must preserve idempotence receipts');
 const advanced=await send(match.room,newA,{type:'END_CARD_PHASE'});
 assert.equal(advanced.state.revision,stored.revision+1);
 assert.equal(advanced.state.state.phase,'PLAYER_TACTICAL_PHASE');
 assert.equal(newB.sent.findLast(x=>x.type==='MATCH_STATE').match.revision,advanced.state.revision,
   'remaining seat receives committed state after reconnect');
});

test('queued command from superseded WebSocket cannot commit after seat reconnect',async()=>{
 const match=await createReadyRoom(true);
 const old=match.ws[0];
 const before=await match.room.ctx.storage.get('authoritative-battle-session');
 await openSocket(match.service,match.players[0].code,match.players[0].token);
 const replacement=match.room.ctx.getWebSockets().find(ws=>ws.deserializeAttachment()?.seat===0);
 assert.ok(replacement&&replacement!==old);
 assert.equal(old.readyState,3);
 const staleCommand={type:'MATCH_COMMAND',envelope:{protocol:PVP_COMMAND_PROTOCOL,
   baseRevision:before.revision,commandId:'superseded-queued-command-0001',
   action:{type:'KEEP_OPENING_HAND'}}};
 await match.room.do.webSocketMessage(old,JSON.stringify(staleCommand));
 const ignored=await match.room.ctx.storage.get('authoritative-battle-session');
 assert.equal(ignored.revision,before.revision,'closed socket must never advance the authoritative revision');
 const accepted=await send(match.room,replacement,{type:'KEEP_OPENING_HAND'});
 assert.equal(accepted.state.revision,before.revision+1,'replacement socket retains command authority');
 assert.equal(match.ws[1].sent.findLast(m=>m.type==='MATCH_STATE').match.revision,accepted.state.revision);
});

test('malformed JSON primitives are rejected without crashing the room or changing revision',async()=>{
 const match=await createReadyRoom(true);
 const before=await match.room.ctx.storage.get('authoritative-battle-session');
 const live=match.ws[0];
 for(const payload of ['null','false','42','"oops"','[]']){
   await assert.doesNotReject(match.room.do.webSocketMessage(live,payload));
   assert.deepEqual(live.sent.at(-1),{type:'ERROR',error:'BAD_MESSAGE'});
 }
 const unchanged=await match.room.ctx.storage.get('authoritative-battle-session');
 assert.equal(unchanged.revision,before.revision);
 const x=await send(match.room,live,{type:'KEEP_OPENING_HAND'});
 assert.equal(x.state.revision,before.revision+1);
});

test('failed delivery to one WebSocket cannot block opponent committed snapshot or corrupt receipts',async()=>{
 const match=await createReadyRoom(true);
 const first=await send(match.room,match.ws[0],{type:'KEEP_OPENING_HAND'});
 const broken=match.ws[0],receiver=match.ws[1];
 broken.send=()=>{throw Error('SIMULATED_DELIVERY_FAILURE');};
 const second=await send(match.room,receiver,{type:'KEEP_OPENING_HAND'});
 assert.equal(second.state.revision,first.state.revision+1);
 assert.equal(receiver.sent.findLast(m=>m.type==='MATCH_STATE').match.revision,second.state.revision,
   'healthy opponent must receive the new committed revision');
 assert.equal(broken.readyState,3,'unusable socket should close, not poison other seat broadcasts');
 const retry=await send(match.room,receiver,{type:'KEEP_OPENING_HAND'},
   second.envelope.baseRevision,second.envelope.commandId);
 assert.equal(retry.state.revision,second.state.revision);
 assert.equal(receiver.sent.at(-1).duplicate,true);
});

test('canonical PVP inventory: two private player loadouts persist, equip the correct occurrence, consume once and survive DO reconnect',async()=>{
 const {ItemInventoryEngine}=await import('../../js/item-inventory-engine.js');
 const cards=Array(20).fill('imperial_swordsman_card');
 function preparation(first){
   const loadouts={imperial_swordsman_card:ItemInventoryEngine.deckEntries(cards).map((entry,i)=>
     ({key:entry.key,items:i===0?first:[]}))};
   const stash=Object.fromEntries(first.map(id=>[id,first.filter(k=>k===id).length]));
   return {stash,loadouts};
 }
 const aItems=preparation(['torch','hp_potion_small']);
 const bItems=preparation(['mp_potion_small']);
 const service=createService(true),a=(await post(service.env,'/v1/rooms',{name:'Inventory A'})).data;
 const b=(await post(service.env,`/v1/rooms/${a.code}/join`,{name:'Inventory B'})).data;
 assert.equal((await post(service.env,`/v1/rooms/${a.code}/deck`,{cards,inventory:aItems},a.token)).status,200);
 assert.equal((await post(service.env,`/v1/rooms/${a.code}/deck`,{cards,inventory:bItems},b.token)).status,200);
 await openSocket(service,a.code,a.token);await openSocket(service,a.code,b.token);
 const room=service.rooms.get(`ct2:${a.code}`),ws=room.ctx.getWebSockets();
 await room.do.webSocketMessage(ws[0],JSON.stringify({type:'SET_READY',ready:true}));
 await room.do.webSocketMessage(ws[1],JSON.stringify({type:'SET_READY',ready:true}));
 let authority=await room.ctx.storage.get('authoritative-battle-session');
 assert.deepEqual(authority.state.preparedItems[0].imperial_swordsman_card[0].items,aItems.loadouts.imperial_swordsman_card[0].items);
 assert.deepEqual(authority.state.preparedItems[1].imperial_swordsman_card[0].items,bItems.loadouts.imperial_swordsman_card[0].items);
 assert.equal(ws[1].sent.findLast(x=>x.type==='MATCH_STATE').match.view.own.itemConsumptions,undefined);
 await send(room,ws[0],{type:'KEEP_OPENING_HAND'});
 await send(room,ws[1],{type:'KEEP_OPENING_HAND'});
 await send(room,ws[0],{type:'BEGIN_BATTLE'});
 authority=await room.ctx.storage.get('authoritative-battle-session');
 const base=authority.state.battlefield.deploymentPoints.find(p=>p.owner==='PLAYER').area[0];
 const deployed=await send(room,ws[0],{type:'DEPLOY_CARD',cardId:'imperial_swordsman_card',x:base.x,y:base.y});
 const soldier=deployed.state.state.units[0];
 assert.deepEqual(soldier.inventory.map(p=>p.itemId),['torch','hp_potion_small']);
 assert.ok(soldier.inventory.every(p=>p.owned===false&&p.source==='PVP_PREPARATION'));
 assert.equal(deployed.state.state.preparedItems[0].imperial_swordsman_card.length,19);
 assert.equal(deployed.state.state.preparedItems[1].imperial_swordsman_card.length,20);
 assert.equal(ws[1].sent.findLast(x=>x.type==='MATCH_STATE').match.view.opponent.itemConsumptions,undefined);
 await send(room,ws[0],{type:'END_CARD_PHASE'});
 // Injure fixture only; actual item use goes through official ItemRuntimeEngine.
 authority=await room.ctx.storage.get('authoritative-battle-session');
 authority.state.units[0].hp-=60;
 authority.state.units[0].acted=false;authority.state.units[0].waited=false;
 await room.ctx.storage.put('authoritative-battle-session',authority);
 const potion=soldier.inventory.find(p=>p.itemId==='hp_potion_small');
 const consumed=await send(room,ws[0],{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:potion.id});
 const after=consumed.state.state.units[0];
 assert.equal(after.hp,authority.state.units[0].hp+50);
 assert.deepEqual(after.inventory.map(p=>p.itemId),['torch']);
 assert.deepEqual(after.itemConsumptions,{hp_potion_small:1});
 assert.deepEqual(ws[0].sent.findLast(x=>x.type==='MATCH_STATE').match.view.own.itemConsumptions,{hp_potion_small:1});
 assert.equal(ws[1].sent.findLast(x=>x.type==='MATCH_STATE').match.view.own.itemConsumptions?.hp_potion_small,undefined);
 const retry=await send(room,ws[0],{type:'USE_BATTLE_ITEM',unitId:soldier.id,payloadId:potion.id},consumed.envelope.baseRevision,consumed.envelope.commandId);
 assert.equal(retry.state.revision,consumed.state.revision);
 assert.deepEqual(retry.state.state.units[0].itemConsumptions,{hp_potion_small:1});
 room.do=new PvpRoom(room.ctx,service.env);
 await openSocket(service,a.code,a.token);
 const returned=room.ctx.getWebSockets().find(s=>s.deserializeAttachment()?.seat===0);
 assert.deepEqual(returned.sent.findLast(x=>x.type==='MATCH_STATE').match.view.own.itemConsumptions,{hp_potion_small:1});
});

test('inventory claims fail closed outside gated PvP test rooms',async()=>{
 const {ItemInventoryEngine}=await import('../../js/item-inventory-engine.js');
 const service=createService(false),a=(await post(service.env,'/v1/rooms',{name:'Restricted'})).data;
 const cards=Array(20).fill('imperial_swordsman_card');
 const loadouts={imperial_swordsman_card:ItemInventoryEngine.deckEntries(cards).map((e,i)=>({key:e.key,items:i===0?['torch']:[]}))};
 const forbidden=await post(service.env,`/v1/rooms/${a.code}/deck`,{cards,inventory:{stash:{torch:1},loadouts}},a.token);
 assert.equal(forbidden.status,403);
 assert.equal(forbidden.data.error,'PVP_ITEMS_REQUIRE_TEST_ROOM');
 const unknown=await post(service.env,`/v1/rooms/${a.code}/deck`,{cards,inventory:{stash:{bad_item:1},loadouts}},a.token);
 assert.equal(unknown.status,400);assert.equal(unknown.data.error,'INVALID_ITEM_STASH');
 const allowed=await post(service.env,`/v1/rooms/${a.code}/deck`,{cards},a.token);
 assert.equal(allowed.status,200);
});
