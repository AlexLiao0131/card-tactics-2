import test from 'node:test';
import assert from 'node:assert/strict';
import '../../js/terrain-database.js';
import '../../js/tactical-engine.js';
import '../../js/displacement-engine.js';
import '../../js/collision-engine.js';
import '../../js/fall-engine.js';
import '../../js/trajectory-engine.js';
import '../../js/post-engagement-engine.js';
import '../../js/unit-animation-engine.js';
const T=globalThis.TacticalEngine,C=globalThis.CollisionEngine,P=globalThis.PostEngagementEngine;
const world=()=>({width:9,height:9,tiles:Array.from({length:81},(_,i)=>({x:i%9,y:Math.floor(i/9),elevation:0,terrain:'PLAIN'})),objects:[]});
const monster=(z=0)=>({id:'oct',team:'N',alive:true,hp:1000,x:3,y:3,z,occupiesTile:true,footprint:{width:2,height:2},character:{collision:{height:1},displacement:{weightClass:'HEAVY'}}});
const hero=(x,y)=>({id:'hero',team:'P',alive:true,hp:100,x,y,z:0,occupiesTile:true,character:{combat:{move:3},passives:[],displacement:{weightClass:'LIGHT'}}});
globalThis.EffectEngine={applyDamage:(u,d)=>{u.hp=Math.max(0,u.hp-d);return{hpLoss:d}}};
globalThis.SkillDatabase={passiveList:()=>[]};
test('CollisionEngine checks the canonical footprint, not just anchor, and reports overlap',()=>{
 const oct=monster();for(const {x,y} of T.occupiedCells(oct))assert.equal(C.occupantAt([oct],x,y),oct);
 assert.equal(C.occupantAt([oct],4,4,{excludeId:'oct'}),null);
 assert.deepEqual(C.occupancyConflicts([oct,hero(4,4)]),[{x:4,y:4,unitIds:['oct','hero']}]);
 const rider={...hero(4,4),occupiesTile:false};assert.equal(C.occupantAt([rider],4,4),null);assert.deepEqual(C.occupancyConflicts([oct,rider]),[]);
});
test('actual PULL from each cardinal side ends outside all four cells, including non-anchor sides',()=>{
 for(const [x,y,endX,endY] of [[6,4,5,4],[1,4,2,4],[4,1,4,2],[4,6,4,5]]){
  const oct=monster(),victim=hero(x,y),map=world(),units=[oct,victim];
  globalThis.UnitAnimationEngine.clear();
  const r=P.forcedMove({map,units,source:oct,target:victim,effect:{type:'PULL',distance:2}});
  assert.deepEqual([victim.x,victim.y],[endX,endY]);assert.equal(r.occupancySafe,true);assert.deepEqual(C.occupancyConflicts(units),[]);
  assert.equal(victim.acted,undefined);assert.equal(victim.waited,undefined);
  assert.ok(r.steps.every(p=>!T.occupiesCell(oct,p.x,p.y)));assert.ok(T.canOccupyFootprint(map,units,victim,x,y));
  const e=globalThis.UnitAnimationEngine.drain().find(e=>e.kind==='FORCED_MOVE');assert.ok(e);assert.deepEqual(e.path.at(-1),{x:endX,y:endY,z:0});
 }
});
test('submerged monster still blocks ground occupancy without vertical hit contact',()=>{
 const oct=monster(-4),victim=hero(6,4),map=world();const r=P.forcedMove({map,units:[oct,victim],source:oct,target:victim,effect:{type:'PULL',distance:2}});
 assert.deepEqual([victim.x,victim.y],[5,4]);assert.equal(r.occupancySafe,true);assert.equal(C.occupancyConflicts([oct,victim]).length,0);
});
test('generic multi-cell target is prevented from landing over another unit',()=>{
 const target=monster(),source=hero(0,3),blocker={...hero(2,4),id:'blocker'};
 const r=P.forcedMove({map:world(),units:[source,target,blocker],source,target,effect:{type:'PULL',distance:2,resistAxes:{horizontal:false}}});
 assert.equal(r.occupancySafe,true);assert.deepEqual([target.x,target.y],[3,3]);assert.deepEqual(C.occupancyConflicts([target,blocker]),[]);
});
