import test from 'node:test';
import assert from 'node:assert/strict';
import {LiviaDualityEngine as d} from '../../js/livia-duality-engine.js';
const original={...globalThis};
const grid=(w=8,h=8)=>({id:'duality-integration',width:w,height:h,tiles:Array.from({length:w*h},(_,i)=>({x:i%w,y:Math.floor(i/w),terrain:'PLAIN',elevation:0}))});
const livia=(id='livia1',team='P',x=3,y=3)=>({id,team,x,y,z:0,alive:true,participatesInTurn:true,mana:40,maxMana:120,character:{id:'livia',name:'莉維亞',skills:['black_slash','nether_slash','shadow_step'],equipment:[]},resources:{}});
const soldier=(id,team,x,y)=>({id,team,x,y,z:0,alive:true,mana:10,maxMana:80,character:{id,name:id,skills:['black_slash']}});
const skillData={
 black_slash:{id:'black_slash',name:'黑劍斬擊',target:'ENEMY',targetType:'SINGLE',weapon:'black_sword',power:1,range:{min:1,max:1}},
 nether_slash:{id:'nether_slash',name:'幽冥斬擊',target:'ENEMY',targetType:'SINGLE',weapon:'black_sword',power:1.25,range:{min:1,max:3}},
 shadow_step:{id:'shadow_step',name:'幽影步',target:'TILE',targetType:'AOE',range:{min:1,max:4}}};
const visible=(m,u,t)=>Math.abs(u.x-t.x)+Math.abs(u.y-t.y)<=4;
globalThis.TacticalEngine={
 tile:(m,x,y)=>m.tiles.find(t=>t.x===x&&t.y===y)||null,
 canOccupyTerrain:(u,t)=>t.terrain!=='WALL',
 isBlockedByObject:()=>false,
 canTraverseElevation:(a,b)=>Math.abs(a.elevation-b.elevation)<=1,
 canTarget:(m,u,t,s)=>visible(m,u,t)&&Math.abs(u.x-t.x)+Math.abs(u.y-t.y)>=Number(s.range?.min||0)&&Math.abs(u.x-t.x)+Math.abs(u.y-t.y)<=Number(s.range?.max||0),
 actorCanTrackTarget:(m,us,u,t)=>t.hidden!==true&&visible(m,u,t),
 reachable:(m,us,u)=>new Map(m.tiles.filter(t=>t.terrain!=='WALL'&&Math.abs(t.x-u.x)+Math.abs(t.y-u.y)<=3&&!us.some(o=>o!==u&&o.alive&&o.x===t.x&&o.y===t.y)).map(t=>[`${t.x},${t.y}`,Math.abs(t.x-u.x)+Math.abs(t.y-u.y)])),
 pathTo:(m,us,u,x,y)=>[{x,y,elevation:0}]
};
globalThis.SkillDatabase={get:id=>skillData[id]};
globalThis.UnitRuntimeEngine={restoreMana:(u,amt)=>{const n=Math.min(amt,u.maxMana-u.mana);u.mana+=n;return n}};
globalThis.EffectEngine={syncModifiers:()=>{}};

test('full blue persists through ordinary combat and drains on actual spatial skill, not on enchantments',()=>{
 const a=livia();d.initialize(a);d.setPolarity(a,0);
 d.afterCommittedSkill(a,{id:'elemental_enchant'});assert.equal(d.polarity(a),0);
 d.afterCommittedSkill(a,{id:'black_slash'});assert.equal(d.statBonus(a),.15);
 d.afterCommittedSkill(a,skillData.shadow_step);assert.equal(d.polarity(a),18);assert.equal(d.statBonus(a),0);
});
test('one shared field event absorbs only once and avoids a second MP refund',()=>{
 const m=grid(),a=livia(),friend=soldier('a','P',5,5);
 m.manaWells=[{x:5,y:5,team:'P',amount:24}];let commits=0,logs=[];
 const first=d.handleEntry({map:m,units:[a,friend],round:2},friend,{random:()=>.5,log:s=>logs.push(s),commit:()=>commits++});
 const second=d.handleEntry({map:m,units:[a,friend],round:2},friend,{random:()=>.5,log:s=>logs.push(s),commit:()=>commits++});
 assert.equal(first.restored,24);assert.equal(second.restored,0);assert.equal(friend.mana,34);
 assert.equal(commits,1);assert.equal(logs.length,1);assert.equal(m.manaWells.length,0);
});
test('private mana wells cannot restore enemy resources and never spawn on walls',()=>{
 const m=grid(5,5),a=livia('livia','P',0,0);
 m.tiles.filter(t=>t.x===1||t.y===1).forEach(t=>t.terrain='WALL');
 d.initialize(a);d.spawnWells(m,[a],1,()=>0);
 // The starting cell is isolated by walls: there are no reachable candidates.
 assert.equal(m.manaWells.length,0);
 const bad=soldier('enemy','E',0,0);m.manaWells=[{x:0,y:0,team:'P',amount:24}];
 const before=bad.mana;assert.equal(d.handleEntry({map:m,units:[a,bad],round:1},bad).restored,0);
 assert.equal(bad.mana,before);assert.equal(m.manaWells.length,1);
});
test('distortion requires enemy entry, uses valid landing and interrupts exactly one action',()=>{
 const m=grid(),a=livia(),enemy=soldier('enemy','E',4,4),logs=[];
 d.createDistortion(m,'P',[{x:4,y:4}],1);
 d.beginMove(enemy);const first=d.handleEntry({map:m,units:[a,enemy],round:1},enemy,{random:()=>0,log:msg=>logs.push(msg)});
 assert.equal(first.distorted,true);assert.equal(enemy._liviaMoveInterrupted,true);
 const second=d.handleEntry({map:m,units:[a,enemy],round:1},enemy,{random:()=>0});assert.equal(second.distorted,false);
 d.endMove(enemy);assert.equal(enemy._liviaMoveActionActive,undefined);
 assert.equal(logs.length,1);
});
test('distortions persist for two complete future rounds, excluding cast round',()=>{
 const m=grid(),a=livia();d.createDistortion(m,'P',[{x:3,y:3}],5);
 assert.equal(m.spatialDistortions[0].expireRound,8);
 d.onRoundStart({map:m,units:[a],round:6,random:()=>.9});assert.equal(m.spatialDistortions.length,1);
 d.onRoundStart({map:m,units:[a],round:7,random:()=>.9});assert.equal(m.spatialDistortions.length,1);
 d.onRoundStart({map:m,units:[a],round:8,random:()=>.9});assert.equal(m.spatialDistortions.length,0);
});
test('purple misses do not change rules; only actual commits maintain high dimensional hold',()=>{
 const a=livia(),m=grid();d.initialize(a);d.setPolarity(a,100);a._liviaRound=1;a._liviaHoldUntil=2;
 d.onRoundStart({map:m,units:[a],round:2,random:()=>.9});assert.equal(d.polarity(a),100);
 // No actual commit in second turn: next round naturally shifts to blue.
 d.onRoundStart({map:m,units:[a],round:3,random:()=>.9});assert.equal(d.polarity(a),90);
});
test('berserk remains neutral through multiple rounds and restores on actual blue recovery',()=>{
 const a=livia(),m=grid();d.initialize(a);d.setPolarity(a,100);a._liviaHoldUntil=3;
 d.onRoundStart({map:m,units:[a],round:2,random:()=>.99});
 const r=d.onRoundStart({map:m,units:[a],round:3,random:()=>0});
 assert.deepEqual(r.berserk,[a.id]);assert.equal(a.team,'N');assert.equal(a.participatesInTurn,false);
 const stable=d.onRoundStart({map:m,units:[a],round:3,random:()=>0});
 assert.deepEqual(stable.berserk,[]);assert.equal(a.team,'N');
 for(const [round,value] of [[4,90],[5,80],[6,70],[7,60]]){
   d.onRoundStart({map:m,units:[a],round,random:()=>.99});
   assert.equal(a.team,'N');assert.equal(d.polarity(a),value);
 }
 d.onRoundStart({map:m,units:[a],round:8,random:()=>.99});
 assert.equal(a.team,'P');assert.equal(a.participatesInTurn,true);
 assert.equal(a._liviaBerserkEndRound,undefined);assert.equal(d.polarity(a),50);
});
test('berserk chooses visible legal enemies OR former allies, never fog-hidden targets',()=>{
 const m=grid(),a=livia(),friend=soldier('friend','P',2,3),foe=soldier('foe','E',4,3),hidden=soldier('hidden','E',3,2);
 hidden.hidden=true;a.team='N';a._liviaOriginalTeam='P';a._liviaBerserkEndRound=2;
 const runtime={canUseSkill:()=>true,skillForUnit:(u,s)=>s};
 const low=d.chooseBerserkAttack({map:m,units:[a,friend,foe,hidden],unit:a,runtime,random:()=>0});
 const high=d.chooseBerserkAttack({map:m,units:[a,friend,foe,hidden],unit:a,runtime,random:()=>.999});
 assert.ok(low&&high);assert.notEqual(low.target.id,high.target.id);
 assert.notEqual(low.target.id,'hidden');assert.notEqual(high.target.id,'hidden');
});
test('berserk pathfinding uses real reachability and targets both factions',()=>{
 const m=grid(),a=livia('livia','N',0,0),foe=soldier('foe','E',2,2);
 const path=d.chooseBerserkMove({map:m,units:[a,foe],unit:a,random:()=>0});
 assert.ok(path.length);assert.ok(Math.abs(path[0].x-foe.x)+Math.abs(path[0].y-foe.y)<4);
});
test('cloak is never applied to physical or explicitly unresistable magic',()=>{
 const a=livia();a.character.equipment=[{id:'blue_cloak',affixes:['MAGIC_RESIST']}];
 assert.equal(d.resistMagic(a,101,{random:()=>0}).damage,51);
 assert.equal(d.resistMagic(a,101,{random:()=>0,unresistable:true}).damage,101);
 a.character.equipment=[];assert.equal(d.resistMagic(a,101,{random:()=>0}).damage,101);
});
