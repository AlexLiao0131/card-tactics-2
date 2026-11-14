import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ResourceEngine} from '../../js/resource-engine.js';
import {UnitTraitEngine as traits} from '../../js/unit-trait-engine.js';
import {BattlefieldFieldEngine as fields} from '../../js/battlefield-field-engine.js';
import {NeutralActorEngine as ai} from '../../js/neutral-actor-engine.js';
import {BattleRoundRuleEngine as roundRules} from '../../js/battle-round-rule-engine.js';
import {UnitRuntimeEngine as rt} from '../../js/unit-runtime-engine.js';
function unit(overrides={}){
  const x={id:'L',character:{id:'livia',name:'Livia',resourceRules:{mana:true,duality:{}},skills:['nether_slash','shadow_step'],equipment:[],combat:{move:4},weapons:{}},
    team:'P',alive:true,participatesInTurn:true,x:1,y:1,resources:{},mana:5,maxMana:100,acted:false,moved:false,waited:false};
  return {...x,...overrides};
}
const world=(u=unit(),width=5,height=5)=>({map:{tiles:Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width),terrain:'PLAIN',elevation:0})),objects:[],spatialDistortions:[],manaWells:[]},units:[u]});
function setup(u=unit()){traits.initialize(u);return u;}
function commitAt(u,round,skill='nether_slash'){
  const c=u.resourceMechanicStates.duality;c.round=round;
  traits.afterCommittedSkill(u,{id:skill});
}
test('one resource core: declared duality at 50, all mutations use shared ResourceEngine',()=>{
  const u=setup();assert.equal(ResourceEngine.value(u,'duality'),50);
  assert.equal(rt.changeResource(u,'duality',30),30);assert.equal(ResourceEngine.value(u,'duality'),80);
  assert.equal(traits.setPolarity(u,20),-60);assert.equal(rt.resourceSnapshot(u).duality.value,20);
  assert.equal(traits.status(u).berserk,false);
});
test('non-authored unit cannot forge duality via runtime API',()=>{
  const u=unit({id:'enemy',character:{id:'enemy',resourceRules:{mana:true},attributes:{}}});
  assert.equal(rt.changeResource(u,'duality',50),0);assert.equal(u.resources.duality,undefined);
  assert.equal(traits.hasResource(u),false);
});
test('purple full in 5 locks FULL 6, starts blue recovery 7; refreshed commit in 6 locks 7',()=>{
  const u=setup();const w=world(u);traits.setPolarity(u,78);commitAt(u,5);
  assert.equal(traits.polarity(u),100);assert.equal(u.resourceMechanicStates.duality.holdUntil,6);
  roundRules.onRoundStart({...w,round:6,random:()=>.999});assert.equal(traits.polarity(u),100);
  roundRules.onRoundStart({...w,round:7,random:()=>.999});assert.equal(traits.polarity(u),90);
  traits.setPolarity(u,100);commitAt(u,7);
  roundRules.onRoundStart({...w,round:8,random:()=>.999});assert.equal(traits.polarity(u),100);
  roundRules.onRoundStart({...w,round:9,random:()=>.999});assert.equal(traits.polarity(u),90);
});
test('berserk on first recovery tick DOES NOT lose additional recovery',()=>{
  const u=setup();const w=world(u);traits.setPolarity(u,78);commitAt(u,5);
  roundRules.onRoundStart({...w,round:6,random:()=>0});assert.equal(traits.polarity(u),100);
  const result=roundRules.onRoundStart({...w,round:7,random:()=>0});
  assert.deepEqual(result.berserk,['L']);assert.equal(traits.polarity(u),90);
  assert.equal(u.team,'N');assert.equal(traits.isUncontrolled(u),true);
  assert.equal(traits.status(u).berserk,true);
});
test('berserk is controlled by same gauge until 50 without forced reset',()=>{
  const u=setup();const w=world(u);traits.setPolarity(u,100);u.resourceMechanicStates.duality.holdUntil=3;
  roundRules.onRoundStart({...w,round:2,random:()=>.99});
  roundRules.onRoundStart({...w,round:3,random:()=>0});
  assert.equal(traits.polarity(u),100);assert.equal(u.team,'N');
  for(const [r,value] of [[4,90],[5,80],[6,70],[7,60]]){
    roundRules.onRoundStart({...w,round:r,random:()=>0});assert.equal(traits.polarity(u),value);assert.equal(u.team,'N');
  }
  roundRules.onRoundStart({...w,round:8,random:()=>0});assert.equal(traits.polarity(u),50);
  assert.equal(u.team,'P');assert.equal(u.participatesInTurn,true);assert.equal(traits.status(u).berserk,false);
});
test('neutral AI cannot refresh full-purple hold when committed',()=>{
  const u=setup();const w=world(u);traits.setPolarity(u,100);u.resourceMechanicStates.duality.holdUntil=3;
  roundRules.onRoundStart({...w,round:2,random:()=>.99});
  roundRules.onRoundStart({...w,round:3,random:()=>0});
  const v=traits.polarity(u),hold=u.resourceMechanicStates.duality.holdUntil;
  traits.afterCommittedSkill(u,{id:'nether_slash'});
  assert.equal(traits.polarity(u),v);assert.equal(u.resourceMechanicStates.duality.holdUntil,hold);
});
test('recovery is at most once per round across multiple initiators',()=>{
  const u=setup();const w=world(u);traits.setPolarity(u,80);
  roundRules.onRoundStart({...w,round:2});roundRules.onRoundStart({...w,round:2});
  assert.equal(traits.polarity(u),70);
});
test('special skill variants are sourced from data in shared profile; not a hero engine',()=>{
  const u=setup(),skill={id:'nether_slash',name:'幽冥斬擊',target:'ENEMY',power:1};
  assert.equal(traits.transformedSkill(u,skill).id,'nether_slash');
  traits.setPolarity(u,0);assert.equal(traits.transformedSkill(u,skill).purifiedSlash.length,4);
  traits.setPolarity(u,100);assert.equal(traits.transformedSkill(u,skill).hitCount,4);
  traits.resetBlueAfterUltimate(u);assert.equal(traits.polarity(u),50);
});
test('mana wells use the shared field system; entering well restores MP once',()=>{
  const u=setup(),w=world(u);u.mana=0;u.maxMana=120;
  globalThis.TacticalEngine={canOccupyTerrain:()=>true,isBlockedByObject:()=>false,canTraverseElevation:()=>true,tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)};
  globalThis.UnitRuntimeEngine={restoreMana:rt.restoreMana};
  const created=fields.spawnWells(w.map,w.units,1,()=>0);
  assert.equal(created,1);const well=w.map.manaWells[0];u.x=well.x;u.y=well.y;
  const hit=fields.onEnterTile(w.map,w.units,u,1,{random:()=>.99});
  assert.equal(hit.restored,24);assert.equal(w.map.manaWells.length,0);assert.equal(u.mana,24);
});
test('spatial distortion spans 2 full future rounds and expires in N+3',()=>{
  const u=setup(),w=world(u);fields.createDistortion(w.map,'P',[{x:2,y:2}],5);
  assert.equal(w.map.spatialDistortions[0].expireRound,8);
  fields.onRoundStart({...w,round:6,random:()=>.5});assert.equal(w.map.spatialDistortions.length,1);
  fields.onRoundStart({...w,round:7,random:()=>.5});assert.equal(w.map.spatialDistortions.length,1);
  fields.onRoundStart({...w,round:8,random:()=>.5});assert.equal(w.map.spatialDistortions.length,0);
});
test('spatial displacement checks occupancy and emits official teleport only',()=>{
  const u=setup(),w=world(u);const enemy=unit({id:'E',team:'E',x:2,y:2,character:{id:'enemy',name:'Enemy'}});
  w.units.push(enemy);globalThis.TacticalEngine={canOccupyTerrain:()=>true,isBlockedByObject:()=>false,canTraverseElevation:()=>true,tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)};
  const moves=[];globalThis.UnitAnimationEngine={emitMove:(...args)=>moves.push(args)};
  fields.createDistortion(w.map,'P',[{x:2,y:2}],3);
  fields.beginMove(enemy);const hit=fields.onEnterTile(w.map,w.units,enemy,4,{random:()=>0});fields.endMove(enemy);
  assert.equal(hit.distorted,true);assert.equal(moves.length,1);assert.equal(moves[0][1].kind,'TELEPORT');
  assert.equal(enemy.x===2&&enemy.y===2,false);
});
test('neutral AI selects only legal trackable targets and marks one action per round',()=>{
  const u=setup();const w=world(u);u.team='N';u.controlOverride={type:'BERSERK',sourceResource:'duality',originalTeam:'P',startedRound:3,actionDoneRound:null};
  const enemy=unit({id:'E',team:'E',x:2,y:1,character:{id:'enemy',name:'Enemy'}});w.units.push(enemy);
  globalThis.SkillDatabase={get:id=>({id,weapon:'black_sword',target:'ENEMY',targetType:'SINGLE'})};
  globalThis.TacticalEngine={canTarget:()=>true,actorCanTrackTarget:()=>true};
  const runtime={canUseSkill:()=>true,skillForUnit:(u,s)=>s};
  assert.equal(ai.chooseAttack({...w,unit:u,runtime,random:()=>.4}).target.id,'E');
  assert.equal(ai.availableActors(w.units,3).length,1);ai.markActed(u,3);
  assert.equal(ai.availableActors(w.units,3).length,0);
  assert.equal(ai.availableActors(w.units,4).length,1);
});
test('pvp/unified code has NO import of deleted Livia-only engine or copied gameplay authority',()=>{
  for(const p of ['js/unit-runtime-engine.js','js/tactical-game.js','js/tactical-action-controller.js','js/effect-engine.js','js/battle-resolution.js','cloudflare-pvp/src/pvp-headless-tactical.mjs']){
    const s=readFileSync(new URL('../../'+p,import.meta.url),'utf8');
    assert.doesNotMatch(s,/LiviaDualityEngine|livia-duality-engine\.js/);
  }
  assert.match(readFileSync(new URL('../../js/battle-round-rule-engine.js',import.meta.url),'utf8'),/UnitTraitEngine\.onRoundStart/);
});

test('the same trait engine supports another authored polarity resource without hero-specific JS',()=>{
  const u=unit({id:'generic',character:{id:'generic',name:'Other',resourceRules:{mana:true,
    eclipse:{label:'Eclipse',max:100,initial:40,naturalRecovery:0,
      polarity:{center:40,blueFull:0,purpleFull:100,roundRecovery:5,holdFullFutureRounds:1,
        skillDeltas:{special_cast:60},corruptionRiskIncreasePerRound:0},
      berserk:{type:'BERSERK',damageMultiplier:1.2,releaseAt:40}}}}});
  const w=world(u);traits.initialize(u);assert.equal(traits.resourceKey(u),'eclipse');
  assert.equal(ResourceEngine.value(u,'eclipse'),40);
  u.resourceMechanicStates.eclipse.round=5;
  traits.afterCommittedSkill(u,{id:'special_cast'});
  assert.equal(ResourceEngine.value(u,'eclipse'),100);
  roundRules.onRoundStart({...w,round:6,random:()=>0});assert.equal(traits.polarity(u),100);
  roundRules.onRoundStart({...w,round:7,random:()=>0});assert.equal(traits.polarity(u),95);
});

test('the same field owner can spawn a mana well from any declared resource profile',()=>{
  const u=unit({id:'other',character:{id:'other',resourceRules:{mana:true,special:{label:'Special',max:10,initial:0,
    manaWells:{recovery:7,perRound:1,maxPerTeam:1}}}}});
  const w=world(u);globalThis.TacticalEngine={canOccupyTerrain:()=>true,isBlockedByObject:()=>false,canTraverseElevation:()=>true};
  assert.equal(fields.spawnWells(w.map,w.units,2,()=>0),1);
  assert.equal(w.map.manaWells[0].amount,7);
});

test('the PVP attack approach enters the shared field mover and cannot invoke the deleted engine',()=>{
  const src=readFileSync(new URL('../src/pvp-headless-engagement.mjs',import.meta.url),'utf8');
  assert.match(src,/BattlefieldFieldEngine\.beginMove\(actor\)/);
  assert.match(src,/BattlefieldFieldEngine\.endMove\(actor\)/);
  assert.doesNotMatch(src,/LiviaDualityEngine|_livia/);
});

test('the shared magic-resist equipment trait still applies to non-polarity units',()=>{
  const other=unit({id:'mage',character:{id:'mage',resourceRules:{mana:true},
    equipment:[{affixes:['MAGIC_RESIST']}]}});
  const proc=traits.resistMagic(other,40,{random:()=>0});
  assert.deepEqual(proc,{damage:20,blocked:20,triggered:true});
  const noProc=traits.resistMagic(other,40,{random:()=>.99});
  assert.deepEqual(noProc,{damage:40,blocked:0,triggered:false});
});

test('all uncontrolled damage uses the existing 1.25x profile; control restoration removes it',()=>{
  const u=setup();
  assert.equal(traits.berserkDamageMultiplier(u),1);
  u.controlOverride={type:'BERSERK',sourceResource:'duality',originalTeam:'P',
    originalParticipation:true,damageMultiplier:1.25};u.team='N';traits.setPolarity(u,60);
  assert.equal(traits.berserkDamageMultiplier(u),1.25);
  assert.equal(traits.completeBerserk(u),false);
  traits.setPolarity(u,50);assert.equal(traits.completeBerserk(u),true);
  assert.equal(u.team,'P');assert.equal(traits.berserkDamageMultiplier(u),1);
});
