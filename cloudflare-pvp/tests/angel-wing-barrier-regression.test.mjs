import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {VerticalMobilityEngine} from '../../js/vertical-mobility-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {LoadoutDatabase} from '../../js/loadout-database.js';
import {AngelWingBarrierEngine as W} from '../../js/angel-wing-barrier-engine.js';

const actor=()=>({id:'angel-a',team:'P',alive:true,acted:false,waited:false,moved:false,
  x:5,y:5,facing:'N',hp:240,mana:100,
  character:{id:'angel_archer_hero',combat:{move:5},attributes:{vit:14},
    terrainTraits:['FLYING'],verticalMobility:{canFly:true,modes:['FLYING'],flightAltitude:2,maxFlightAltitude:4}},
  verticalState:{mode:'FLYING',requestedMode:'FLYING',flightAltitude:2,altitude:2}});
const map=()=>({id:'barrier-test',width:12,height:12,objects:[],tiles:Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12),terrain:'PLAIN',elevation:0,waterDepth:0}))});
const options=()=>({map:map(),actor:actor()});
const skill=SkillDatabase.get('angel_holy_wing_barrier');

test('one complete angel carry skill exposes no standalone drop in default loadout',()=>{
 const skills=LoadoutDatabase.get('angel_archer_hero_default').skillIds;
 assert.equal(skills.includes('angel_carry_ally'),true);
 assert.equal(skills.includes('angel_release_ally'),false);
 assert.equal(SkillDatabase.get('angel_carry_ally').utilityAction.releaseSkillId,'angel_release_ally');
 assert.equal(SkillDatabase.get('angel_release_ally').utilityAction.type,'RELEASE_CARRIED');
});
test('four shields are contiguous one row ahead; 28 MP defensive action',()=>{
 assert.equal(W.isCanonicalSkill(skill),true);
 const cells=W.wallTiles({x:5,y:5},'N');
 assert.equal(cells.length,4);
 assert.deepEqual(cells.map(c=>c.y),[4,4,4,4]);
 assert.equal(new Set(cells.map(c=>c.x)).size,4);
 assert.equal(skill.manaCost,28);
});
test('grounded angel wall blocks enemy route & incoming arrows/magic, never friendly movement or counters',()=>{
 const m=map(),angel=actor(),units=[angel];
 assert.equal(VerticalMobilityEngine.describe(angel,TacticalEngine.tile(m,5,5)).mode,'FLYING');
 const pre=W.candidate(m,units,angel,TacticalEngine.tile(m,5,5));
 assert.ok(pre,'legal ground landing with four empty forward tiles');
 const result=W.cast({map:m,units,actor:angel,landing:TacticalEngine.tile(m,5,5),skill,
   consumeSkill:()=>({type:'MANA',cost:0})});
 assert.equal(result.ok,true);
 assert.equal(angel.verticalState.mode,'GROUND');
 assert.equal(m.objects.filter(o=>o.type===W.TYPE).length,4);
 const front={x:5,y:1,team:'E',alive:true,character:{combat:{move:5}}};
 const rear={x:5,y:8,team:'P',alive:true};
 const hit={category:'ATTACK',attackType:'SHOT',attackClass:'RANGED',weapon:'bow'};
 assert.equal(TacticalEngine.isBlockedByObject(m,5,4,front),true);
 assert.equal(TacticalEngine.isBlockedByObject(m,5,4,rear),false);
 assert.equal(W.blocksIncoming(m,front,rear,hit),true);
 assert.equal(W.blocksIncoming(m,front,rear,{category:'MAGIC',attackType:'MAGIC'}),true);
 assert.equal(W.blocksIncoming(m,rear,front,hit),false);
 assert.equal(W.blocksIncoming(m,rear,front,{category:'MAGIC',attackType:'MAGIC'}),false);
 assert.equal(W.reconcile(m,units),false);
 angel.x=4;
 assert.equal(W.reconcile(m,units),true);
 assert.equal(m.objects.filter(o=>o.type===W.TYPE).length,0);
});
test('already grounded angel casts four-tile wing wall immediately without a flight transition',()=>{
 const m=map(),angel=actor(),anchor=TacticalEngine.tile(m,5,5),units=[angel];
 const grounded=VerticalMobilityEngine.setMode(angel,anchor,'GROUND');
 assert.equal(grounded.ok,true);
 assert.equal(angel.verticalState.mode,'GROUND');
 assert.equal(skill.requirements?.flying,undefined);
 assert.equal(W.isCanonicalSkill(skill),true);
 assert.ok(W.legalTiles(m,units,angel).some(t=>t.x===5&&t.y===5));
 let consumed=0,traversals=0;
 const result=W.cast({map:m,units,actor:angel,landing:anchor,skill,
   traverse:()=>{traversals++;throw Error('Grounded same-tile cast must not traverse');},
   consumeSkill:()=>{consumed++;return true;}});
 assert.equal(result.ok,true);
 assert.equal(consumed,1);
 assert.equal(traversals,0);
 assert.equal(angel.verticalState.mode,'GROUND');
 assert.equal(m.objects.filter(o=>o.type===W.TYPE).length,4);
 assert.equal(W.reconcile(m,units),false);
});
test('grounded actor who already moved may cast from current square but not relocate again',()=>{
 const m=map(),angel=actor(),units=[angel];
 VerticalMobilityEngine.setMode(angel,TacticalEngine.tile(m,5,5),'GROUND');
 angel.moved=true;
 const choices=W.legalTiles(m,units,angel);
 assert.deepEqual(choices.map(t=>[t.x,t.y]),[[5,5]]);
 const attempt=W.candidate(m,units,angel,TacticalEngine.tile(m,6,5));
 assert.equal(attempt,null);
 const cast=W.cast({map:m,units,actor:angel,landing:TacticalEngine.tile(m,5,5),skill,consumeSkill:()=>true});
 assert.equal(cast.ok,true);
});
test('grounded cast preserves the one-way line-of-fire and allied movement rules',()=>{
 const m=map(),angel=actor();
 VerticalMobilityEngine.setMode(angel,TacticalEngine.tile(m,5,5),'GROUND');
 assert.equal(W.cast({map:m,units:[angel],actor:angel,landing:TacticalEngine.tile(m,5,5),skill,consumeSkill:()=>true}).ok,true);
 const foe={x:5,y:1,team:'E',alive:true,character:{combat:{move:5}}};
 const friend={x:5,y:8,team:'P',alive:true};
 const arrow={category:'ATTACK',attackClass:'RANGED',attackType:'SHOT'};
 assert.equal(TacticalEngine.isBlockedByObject(m,5,4,foe),true);
 assert.equal(TacticalEngine.isBlockedByObject(m,5,4,friend),false);
 assert.equal(W.blocksIncoming(m,foe,friend,arrow),true);
 assert.equal(W.blocksIncoming(m,friend,foe,arrow),false);
});
test('real flight engine still allows rising, landing and taking off with altitude controls',()=>{
 const m=map(),angel=actor(),tile=TacticalEngine.tile(m,5,5);
 assert.equal(VerticalMobilityEngine.adjustFlightAltitude(angel,tile,-1).ok,true);
 assert.equal(VerticalMobilityEngine.adjustFlightAltitude(angel,tile,-1).ok,true);
 const grounded=VerticalMobilityEngine.adjustFlightAltitude(angel,tile,-1);
 assert.equal(grounded.ok,true);
 assert.equal(grounded.state.mode,'GROUND');
 assert.equal(VerticalMobilityEngine.adjustFlightAltitude(angel,tile,-1).ok,false);
 const airborne=VerticalMobilityEngine.adjustFlightAltitude(angel,tile,1);
 assert.equal(airborne.ok,true);
 assert.equal(airborne.state.mode,'FLYING');
});
test('invalid front-row positions cannot create partial shield rows',()=>{
 const m=map(),angel=actor();angel.x=0;angel.y=0;
 assert.equal(W.candidate(m,[angel],angel,TacticalEngine.tile(m,0,0)),null);
 assert.equal(m.objects.length,0);
});
