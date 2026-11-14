import test from 'node:test';
import assert from 'node:assert/strict';
import {LiviaDualityEngine as d} from '../../js/livia-duality-engine.js';
const grid=(w=5,h=5)=>({id:'test',width:w,height:h,tiles:Array.from({length:w*h},(_,i)=>({x:i%w,y:Math.floor(i/w),terrain:'PLAIN',elevation:0}))});
const u=(id='livia',team='P',x=2,y=2)=>({id,team,alive:true,x,y,character:{id:'livia',equipment:[{id:'blue_cloak',affixes:['MAGIC_RESIST']}],skills:['shadow_step','nether_slash']},mana:35,maxMana:120,resources:{}});
globalThis.TacticalEngine={
 tile:(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y)||null,
 canOccupyTerrain:()=>true,isBlockedByObject:()=>false,canTraverseElevation:()=>true,
 canTarget:(map,unit,target,skill)=>Math.abs(unit.x-target.x)+Math.abs(unit.y-target.y)<=skill.range.max
};
globalThis.UnitRuntimeEngine={restoreMana:(unit,n)=>{const before=unit.mana;unit.mana=Math.min(unit.maxMana,unit.mana+n);return unit.mana-before;}};
globalThis.EffectEngine={syncModifiers:()=>{}};
globalThis.SkillDatabase={get:id=>id==='nether_slash'?{id,target:'ENEMY',targetType:'SINGLE',weapon:'black_sword',power:1.25,range:{min:1,max:3}}:id==='shadow_step'?{id,target:'TILE',targetType:'AOE',range:{min:1,max:4}}:null};
test('normal recovery accumulates exactly one signed resource towards blue; complete form requires 0',()=>{
 const a=u();d.initialize(a);assert.equal(d.polarity(a),50);
 const map=grid();for(let round=2;round<=6;round++)d.onRoundStart({map,units:[a],round,random:()=>0});
 assert.equal(d.polarity(a),0);assert.equal(d.status(a).blueFull,true);
 const move=d.transformedSkill(a,{id:'shadow_step',range:{min:1,max:4}});
 assert.equal(move.id,'shadow_step');
 const blue=d.transformedSkill(a,{id:'nether_slash',power:1.25,range:{min:1,max:3}});
 assert.equal(blue.name,'奧義・淨界斬');assert.equal(blue.target,'TILE');assert.equal(blue.shape,'FAN');
 assert.equal(d.statBonus(a),.15);
 d.resetBlueAfterUltimate(a);assert.equal(d.polarity(a),50);assert.equal(d.statBonus(a),0);
});
test('purple corruption uses high-dimensional committed skill only, refreshes recovery hold and escalates risk',()=>{
 const a=u();const map=grid();d.initialize(a);
 d.afterCommittedSkill(a,{id:'shadow_step'});assert.equal(d.polarity(a),68);
 d.afterCommittedSkill(a,{id:'nether_slash'});assert.equal(d.polarity(a),90);
 d.afterCommittedSkill(a,{id:'nether_slash'});assert.equal(d.polarity(a),100);
 assert.equal(d.transformedSkill(a,{id:'nether_slash',power:1}).hitCount,4);
 d.onRoundStart({map,units:[a],round:2,random:()=>.999});
 assert.equal(d.polarity(a),100); // one skipped natural recovery
 d.afterCommittedSkill(a,{id:'nether_slash'});
 d.onRoundStart({map,units:[a],round:3,random:()=>.999});
 assert.equal(d.polarity(a),100); // high-dimensional skill refreshed skip
 d.onRoundStart({map,units:[a],round:4,random:()=>.999});
 assert.equal(d.polarity(a),90);
 assert.equal(d.status(a).purpleFull,false);
});
test('corruption loss of control persists until blue actually covers purple to center',()=>{
 const a=u();const map=grid();d.initialize(a);d.setPolarity(a,100);a._liviaHoldUntil=3;
 const a2=d.onRoundStart({map,units:[a],round:2,random:()=>0});
 assert.deepEqual(a2.berserk,[]);
 const a3=d.onRoundStart({map,units:[a],round:3,random:()=>0});
 assert.deepEqual(a3.berserk,['livia']);assert.equal(a.team,'N');
 assert.equal(a._liviaOriginalTeam,'P');assert.equal(a._liviaBerserkEndRound,3);
 for(const [round,value] of [[4,90],[5,80],[6,70],[7,60]]){
   d.onRoundStart({map,units:[a],round,random:()=>0});
   assert.equal(a.team,'N');assert.equal(d.polarity(a),value);
 }
 d.onRoundStart({map,units:[a],round:8,random:()=>0});
 assert.equal(a.team,'P');assert.equal(d.polarity(a),50);
});
test('mana wells spawn only on legal reachable cells, are team private and recover all friendly MP',()=>{
 const map=grid(4,4);const a=u('livia','P',0,0);d.initialize(a);
 const created=d.spawnWells(map,[a],1,()=>.5);
 assert.equal(created,1);assert.equal(d.spawnWells(map,[a],1,()=>.5),0);
 assert.equal(map.manaWells[0].team,'P');
 const well=map.manaWells[0],friend={id:'ally',team:'P',alive:true,x:well.x,y:well.y,mana:3,maxMana:40};
 const enemy={...friend,id:'enemy',team:'E',mana:1};
 assert.equal(d.onEnterTile(map,[a,enemy],enemy,1,{random:()=>.9}).restored,0);
 const r=d.onEnterTile(map,[a,friend],friend,1,{random:()=>.9});
 assert.equal(r.restored,24);assert.equal(friend.mana,27);assert.equal(map.manaWells.length,0);
});
test('distortion only acts upon enemy entry, once per move, with certified neighboring landing',()=>{
 const map=grid(6,6),actor=u('enemy','E',2,2);actor.character.id='enemy';
 d.createDistortion(map,'P',[{x:2,y:2}],1);
 assert.equal(d.onEnterTile(map,[],actor,1,{random:()=>1}).distorted,false);
 d.beginMove(actor);
 const got=d.onEnterTile(map,[],actor,1,{random:()=>0});
 assert.equal(got.distorted,true);assert.ok(Math.abs(actor.x-2)+Math.abs(actor.y-2)===1);
 const next=d.onEnterTile(map,[],actor,1,{random:()=>0});assert.equal(next.distorted,false);
 d.endMove(actor);
 assert.equal(d.onEnterTile(map,[],{...actor,team:'P',x:2,y:2},1,{random:()=>0}).distorted,false);
});
test('blue cloak rolls chance 30%, blocks 50% resistible magic only',()=>{
 const a=u();assert.deepEqual(d.resistMagic(a,100,{random:()=>0}),{damage:50,blocked:50,triggered:true});
 assert.equal(d.resistMagic(a,100,{random:()=>.99}).damage,100);
 assert.equal(d.resistMagic(a,100,{random:()=>0,unresistable:true}).damage,100);
});
test('berserk AI randomly selects either former ally or enemy, never itself',()=>{
 const map=grid(5,5),actor=u();d.initialize(actor);actor.team='N';actor._liviaOriginalTeam='P';actor._liviaBerserkEndRound=3;
 const formerAlly={...u('ally','P',2,1),character:{id:'ally'}},foe={...u('foe','E',1,2),character:{id:'foe'}};
 const runtime={canUseSkill:()=>true,skillForUnit:(unit,skill)=>skill};
 const low=d.chooseBerserkAttack({map,units:[actor,formerAlly,foe],unit:actor,runtime,random:()=>0});
 const high=d.chooseBerserkAttack({map,units:[actor,formerAlly,foe],unit:actor,runtime,random:()=>.999});
 assert.ok(low?.target);assert.ok(high?.target);
 assert.notEqual(low.target.id,high.target.id);
 assert.equal(low.target.id==='livia',false);assert.equal(high.target.id==='livia',false);
});
