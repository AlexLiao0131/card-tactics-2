import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {applyCanonicalPostEngagementEffect} from '../src/pvp-headless-post-effect.mjs';

function fixture(){
 const collisions=[],entered=[],messages=[],interruptions=[];
 const environment={
   resolveCollisionRuntime:(c,ctx)=>collisions.push({c,ctx}),
   enterTile:u=>entered.push(u.id)
 };
 const callbacks={pushLog:(text,kind)=>messages.push({text,kind})};
 const previous=globalThis.EffectEngine;
 globalThis.EffectEngine={interruptChannel:(u,why)=>interruptions.push([u.id,why])};
 return {collisions,entered,messages,interruptions,environment,callbacks,restore:()=>globalThis.EffectEngine=previous};
}
const source={id:'s',character:{name:'莉維亞'}},target={id:'t',character:{name:'敵人'},hp:50,alive:true};

test('native reaction: applied knockback visits landing exactly once',()=>{
 const f=fixture();try{
  const result=applyCanonicalPostEngagementEffect({source,target,effect:{type:'KNOCKBACK'},result:{applied:true,steps:[{x:1,y:2}],collisions:[],falls:[]}},f.environment,f.callbacks);
  assert.equal(result,true);assert.deepEqual(f.entered,['t']);assert.deepEqual(f.interruptions,[['t','FORCED_MOVE']]);
  assert.equal(f.messages[0].text,'莉維亞 → 敵人：擊退 1 格。');
  assert.equal(f.messages.at(-1).kind,'DETAIL');
 }finally{f.restore();}
});
test('native reaction: PULL uses original forced-move semantics',()=>{
 const f=fixture();try{applyCanonicalPostEngagementEffect({source,target,effect:{type:'PULL'},result:{applied:true,steps:[1,2],collisions:[]}},f.environment,f.callbacks);
 assert.match(f.messages[0].text,/拉近 2 格/);assert.equal(f.entered.length,1);}finally{f.restore();}
});
test('native collision: chained target uses collision surface as mover',()=>{
 const f=fixture();try{
  const other={id:'chain',character:{name:'友軍'}};
  const entry={source,target,effect:{type:'KNOCKBACK'},result:{applied:true,steps:[{x:1}],collisions:[{kind:'UNIT',surface:{unit:other},chain:{collisions:[{kind:'BOUNDARY'}]}}]}};
  applyCanonicalPostEngagementEffect(entry,f.environment,f.callbacks);
  assert.deepEqual(f.collisions.map(c=>c.ctx.mover.id),['t','chain']);
  assert.ok(f.collisions.every(c=>c.ctx.source.id==='s'));assert.deepEqual(f.entered,['t']);
 }finally{f.restore();}
});
test('native collision: reported fall damage never rolls or applies HP again',()=>{
 const f=fixture();const falling={...target,hp:13};try{
  applyCanonicalPostEngagementEffect({source,target:falling,effect:{type:'KNOCKBACK'},result:{applied:true,steps:[],collisions:[],falls:[{from:7,to:2}],fallDamage:37}},f.environment,f.callbacks);
  assert.equal(falling.hp,13);assert.match(f.messages[1].text,/Z7→H2.*37.*13/);
  assert.equal(f.interruptions.length,0);
 }finally{f.restore();}
});
test('native collision: dead target never re-enters environment',()=>{
 const f=fixture();try{applyCanonicalPostEngagementEffect({source,target:{...target,alive:false},effect:{type:'KNOCKBACK'},result:{applied:true,steps:[1],collisions:[]}},f.environment,f.callbacks);
 assert.deepEqual(f.entered,[]);}finally{f.restore();}
});
test('native collision: unapplied effect cannot trigger environmental damage',()=>{
 const f=fixture();try{assert.equal(applyCanonicalPostEngagementEffect({source,target,effect:{type:'PULL'},result:{applied:false,steps:[]}},f.environment,f.callbacks),false);
 assert.equal(f.collisions.length+f.entered.length+f.messages.length,0);}finally{f.restore();}
});
test('native collision: missing real environment hook is rejected',()=>{
 const f=fixture();try{assert.throws(()=>applyCanonicalPostEngagementEffect({source,target,effect:{type:'KNOCKBACK'},result:{applied:true,steps:[1]}},{},f.callbacks),/CANONICAL_POST_ENGAGEMENT_HOOK_REQUIRED/);}finally{f.restore();}
});
test('native collision: both direct attack and blood shadow use same event bridge',()=>{
 const root=resolve(import.meta.dirname,'../../');
 const read=p=>readFileSync(resolve(root,p),'utf8');
 assert.match(read('cloudflare-pvp/src/pvp-headless-engagement.mjs'),/onPostEffect:entry=>applyCanonicalPostEngagementEffect\(entry,environment,callbacks\)/);
 assert.match(read('cloudflare-pvp/src/pvp-headless-blood-shadow.mjs'),/logPostEffect:entry=>applyCanonicalPostEngagementEffect\(entry,environment,hooks\)/);
 assert.doesNotMatch(read('cloudflare-pvp/src/pvp-headless-blood-shadow.mjs'),/POST_ENGAGEMENT_FOLLOWUP_NOT_CONNECTED/);
});
test('Core enchantment uses native environment+AOE callbacks instead of throwing',()=>{
 const root=resolve(import.meta.dirname,'../../');
 const s=readFileSync(resolve(root,'cloudflare-pvp/src/pvp-headless-tactical.mjs'),'utf8');
 const e=readFileSync(resolve(root,'cloudflare-pvp/src/pvp-headless-enchantment.mjs'),'utf8');
 assert.match(s,/\.\.\.canonicalEnchantmentImpactHooks\(game,hooks\)/);
 assert.doesNotMatch(s,/ENCHANTMENT_FOLLOWUP_NOT_CONNECTED/);
 assert.match(e,/aoeTiles:\(center,radius\)=>TacticalEngine\.aoeTiles/);
 assert.match(e,/resolveEnvironmentEvents:environment\.resolveEnvironmentEvents/);
 assert.match(e,/applyEnvironmentHazardToUnit:environment\.applyEnvironmentHazardToUnit/);
});
function originalEnchantmentHookFixture(){
 const f=resolve(import.meta.dirname,'../src/pvp-headless-enchantment.mjs');
 const code=readFileSync(f,'utf8');
 const marker='export function canonicalEnchantmentImpactHooks(game,hooks){';
 const start=code.indexOf(marker);assert.ok(start>=0);
 let level=0,end=-1;
 for(let i=start+marker.length-1;i<code.length;i++){
   if(code[i]==='{')level++;
   else if(code[i]==='}'&&--level===0){end=i+1;break;}
 }
 assert.ok(end>start,'actual function body is extractable');
 const eventHits=[],tileHits=[];
 const env={
   logEnvironmentEvent:event=>eventHits.push(event),
   resolveEnvironmentEvents:events=>eventHits.push(...events),
   applyEnvironmentHazardToUnit:unit=>eventHits.push(unit.id)
 };
 const sandbox={
   TacticalEngine:{aoeTiles:(map,center,radius)=>{tileHits.push([map,center,radius]);return[{x:1,y:1}]}},
   createCanonicalEnvironmentController:(game,hooks)=>{
     assert.equal(game.battlefield.map.id,'test_map');
     assert.equal(typeof hooks.damageUnitFlat,'function');return env;
   }
 };
 vm.runInNewContext(code.slice(start,end).replace('export ','')+';globalThis.hooks=canonicalEnchantmentImpactHooks',sandbox);
 const game={battlefield:{map:{id:'test_map'}},units:[
   {id:'friendly',alive:true,occupiesTile:true,x:1,y:1},
   {id:'dead',alive:false,x:2,y:2},
   {id:'airborne',alive:true,occupiesTile:false,x:3,y:3}
 ]};
 const harm=[];
 const hooks=sandbox.hooks(game,{damageUnitFlat:(unit,n,kind)=>harm.push([unit.id,n,kind])});
 return {hooks,harm,eventHits,tileHits};
}
test('Core enchantment: canonical AOE selects official TacticalEngine tiles',()=>{
 const {hooks,tileHits}=originalEnchantmentHookFixture();
 assert.equal(hooks.aoeTiles({x:2,y:3},2)[0].x,1);
 assert.equal(tileHits.length,1);
 assert.equal(tileHits[0][0].id,'test_map');assert.equal(tileHits[0][2],2);
});
test('Core enchantment: no dead/non-occupying target is hit by explosion',()=>{
 const {hooks,harm}=originalEnchantmentHookFixture();
 assert.equal(hooks.unitAt(1,1).id,'friendly');
 assert.equal(hooks.unitAt(2,2),null);assert.equal(hooks.unitAt(3,3),null);
 hooks.damageUnitFlat(hooks.unitAt(1,1),8,'爆裂');
 assert.deepEqual(harm,[['friendly',8,'爆裂']]);
});
test('Core enchantment: environment events and hazards are routed unchanged',()=>{
 const {hooks,eventHits}=originalEnchantmentHookFixture();
 const e={type:'THUNDER',tiles:[{x:1,y:2}]};
 hooks.logEnvironmentEvent(e);hooks.resolveEnvironmentEvents([e]);
 hooks.applyEnvironmentHazardToUnit({id:'friendly'});
 assert.deepEqual(eventHits,[e,e,'friendly']);
});
function stageSpawnFixture({smoke=false}={}){
 const root=resolve(import.meta.dirname,'../src/pvp-headless-tactical.mjs');
 const code=readFileSync(root,'utf8');
 const marker='function serverCallbacks(game,engine){';const start=code.indexOf(marker);assert.ok(start>0);
 let level=0,end=-1;
 for(let i=start+marker.length-1;i<code.length;i++){
   if(code[i]==='{')level++;
   else if(code[i]==='}'&&--level===0){end=i+1;break;}
 }
 assert.ok(end>start);
 const spawned=[],smokeSync=[],passiveSync=[];
 const game={events:[],activeSeat:0,perceptionState:null,round:2,
   units:[],stageState:{},battlefield:{map:{id:'map'}},environmentState:{rain:true},
   fieldState:smoke?{smokeFields:[{id:'smoke'}]}:{smokeFields:[]}};
 const engine={random:()=>0.5,unitRuntime:{
   create:payload=>{spawned.push(payload);return {...payload,alive:true,character:{id:payload.characterId,name:'角色'},_runtimeMap:{unserializable:true}}},
   syncLiveRoster:()=>{}
 },effect:{syncConditionalPassives:units=>passiveSync.push(units.map(u=>u.id)),applyDamage:()=>({hpLoss:0})}};
 const sandbox={
   eventTypes:new Set(['ENTER_TILE','ROUND_START','UNIT_DEFEATED','DEPLOYMENT_POINT_CAPTURED']),
   fail:code=>{throw Error(code)},
   StageEngine:{run:(state,event,callbacks)=>{
     if(event.type==='ROUND_START')return callbacks.spawn({type:'SPAWN',team:event.team,characterId:'npc',x:event.x,y:event.y});
     return null;
   }},
   DeathLifecycleEngine:{create:()=>({finalize:()=>{}})},
   createCanonicalAreaFields:()=>({syncSmokeCover:u=>smokeSync.push(u.id)}),
   CHARACTERS:{npc:{id:'npc',name:'角色'}}
 };
 vm.runInNewContext(code.slice(start,end)+';globalThis.make=serverCallbacks',sandbox);
 return {game,engine,callbacks:sandbox.make(game,engine),spawned,smokeSync,passiveSync};
}
test('PVP stage script spawns the original character with a serializable authoritative ID',()=>{
 const f=stageSpawnFixture();f.callbacks.stageEvent({type:'ROUND_START',team:'PLAYER',x:4,y:5});
 assert.equal(f.game.units.length,1);assert.equal(f.game.units[0].id,'ps0');
 assert.equal(f.game.units[0].team,'P');
 assert.equal(f.game.units[0]._runtimeMap,undefined);
 assert.deepEqual(JSON.parse(JSON.stringify(f.passiveSync)),[['ps0']]);
 assert.doesNotThrow(()=>structuredClone(f.game));
});
test('Stage spawns never overwrite an occupied tile or duplicate existing ID',()=>{
 const f=stageSpawnFixture();f.callbacks.stageEvent({type:'ROUND_START',team:'ENEMY',x:1,y:1});
 f.callbacks.stageEvent({type:'ROUND_START',team:'ENEMY',x:1,y:1});
 f.callbacks.stageEvent({type:'ROUND_START',team:'ENEMY',x:2,y:1});
 assert.equal(f.spawned.length,2);assert.deepEqual(f.game.units.map(u=>u.id),['es0','es1']);
});
test('Neutral stage spawn fails closed until native autonomous neutral turns are available',()=>{
 const f=stageSpawnFixture({smoke:true});
 assert.throws(()=>f.callbacks.stageEvent({type:'ROUND_START',team:'NEUTRAL',x:2,y:1}),/CANONICAL_NEUTRAL_ACTOR_TURN_REQUIRED/);
 assert.equal(f.game.units.length,0);assert.deepEqual(f.smokeSync,[]);
});
