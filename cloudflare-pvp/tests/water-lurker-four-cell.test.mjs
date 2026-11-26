import test from 'node:test';
import assert from 'node:assert/strict';
import {MonsterDatabase,EncounterEngine} from '../../js/monster-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {NeutralActorEngine} from '../../js/neutral-actor-engine.js';
import {AreaSpellMechanics} from '../../js/area-spell-mechanics.js';
import {CHARACTERS} from '../../js/character-database.js';
import {VISUALS} from '../../js/visual-database.js';

globalThis.window=globalThis;
globalThis.TERRAINS={WATER:{passable:true,moveCost:1,evasion:0},PLAIN:{passable:true,moveCost:1,evasion:0},WALL:{passable:false,moveCost:Infinity,evasion:0}};
globalThis.HydrologyEngine={isWater:t=>Number(t?.waterDepth||0)>0,
  waterDepth:t=>Number(t?.waterDepth||0),
  tileAt:(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y),
  waterSurfaceZ:t=>Number(t.elevation||0)+Number(t.waterDepth||0)};
globalThis.VerticalMobilityEngine={canOccupyTerrain:(u,t)=>!!t&&globalThis.TERRAINS[t.terrain]?.passable&&
  (!u?.character?.terrainTraits?.includes('AQUATIC')||globalThis.HydrologyEngine.isWater(t)),
  traversalZ:(_u,t)=>Number(t.elevation||0),verticalSpan:()=>({bottom:0,top:2})};
globalThis.SkillDatabase??={passiveList:()=>[],get:()=>null};
globalThis.ColinShieldMobilityEngine??={};

const map=(w=7,h=7,wet=true)=>({id:'2x2-test',width:w,height:h,objects:[],tiles:Array.from({length:w*h},(_,i)=>({
  x:i%w,y:Math.floor(i/w),terrain:wet?'WATER':'PLAIN',waterDepth:wet?3:0,elevation:0
}))});
const unit=(id,x,y,characterId='water_lurker')=>({id,x,y,alive:true,team:'N',monsterId:'water_lurker',
  footprint:{width:2,height:2},occupiesTile:true,character:{...CHARACTERS[characterId],skills:['water_tentacle'],combat:{move:3},weapons:{claw:{}}}});
const spawn=(world,units=[],count=1)=>{
  const state=EncounterEngine.create([{id:'ecology_water_lurker',monsterId:'water_lurker',spawn:{count,terrain:'WATER',minWaterDepth:1,preferDeepest:true}}],{map:world,units});
  return EncounterEngine.spawnInitial(state,{map:world,units,createUnit:(id,team,characterId,x,y)=>({
    id,team,x,y,character:{name:'深潭巨章',id:characterId,terrainTraits:['AQUATIC']},alive:true,occupiesTile:true
  })});
};
test('正式怪物資料只有一隻、四格，不拆成四個單位',()=>{
  assert.deepEqual({...MonsterDatabase.get('water_lurker').footprint},{width:2,height:2});
  assert.equal(CHARACTERS.water_lurker.footprint.width,2);
  assert.equal(VISUALS.characters.water_lurker_default.battle.kind,'AQUATIC_MONSTER');
});
test('至少四個連續合法水格才能生成',()=>{
  const world=map(1,5);
  assert.equal(spawn(world).length,0);
  const good=map(4,4),created=spawn(good);
  assert.equal(created.length,1);
  assert.deepEqual(created[0].footprint,{width:2,height:2});
  assert.equal(TacticalEngine.occupiedCells(created[0]).length,4);
});
test('四格其中一格被其他單位佔據，不能從那裡生成',()=>{
  const world=map(2,2);
  const occupied=[{id:'hero',x:1,y:1,alive:true,occupiesTile:true}];
  assert.equal(spawn(world,occupied).length,0);
});
test('兩隻四格水怪不會互相重疊',()=>{
  const world=map(4,2),units=[];
  const created=spawn(world,units,2);
  assert.equal(created.length,2);
  const cells=created.flatMap(u=>TacticalEngine.occupiedCells(u).map(t=>`${t.x},${t.y}`));
  assert.equal(new Set(cells).size,8);
});
test('地圖四格任何一格都找到同一個實際單位',()=>{
  const oct=unit('n-1',2,2),units=[oct];
  for(const t of [{x:2,y:2},{x:3,y:2},{x:2,y:3},{x:3,y:3}])
    assert.equal(TacticalEngine.occupantAt(units,t.x,t.y)?.id,'n-1');
  assert.equal(TacticalEngine.occupantAt(units,4,4),null);
});
test('四格外圍的距離由真正碰撞格計算，非主座標',()=>{
  const oct=unit('n',2,2),hero={id:'p',alive:true,x:4,y:3,team:'P',character:{combat:{move:4},passives:[]}};
  assert.equal(TacticalEngine.distanceBetween(hero,oct),1);
  assert.equal(TacticalEngine.distanceBetween({...hero,x:5},oct),2);
  assert.equal(TacticalEngine.distanceBetween({...hero,x:4,y:4},oct),2);
});
test('四格移動不能穿牆，不能壓過其他人的一格',()=>{
  const world=map(5,4),oct=unit('n',0,0);const characters=[oct];
  assert.equal(TacticalEngine.canOccupyFootprint(world,characters,oct,1,0),true);
  world.tiles.find(t=>t.x===2&&t.y===1).terrain='WALL';
  assert.equal(TacticalEngine.canOccupyFootprint(world,characters,oct,1,0),false);
  world.tiles.find(t=>t.x===2&&t.y===1).terrain='WATER';
  characters.push({id:'p',alive:true,x:2,y:1,occupiesTile:true});
  assert.equal(TacticalEngine.canOccupyFootprint(world,characters,oct,1,0),false);
});
test('合法移動集合所有四格完整可通行，並能由同一 pathTo 邏輯出路徑',()=>{
  const world=map(4,3),oct=unit('n',0,0);
  const reaches=TacticalEngine.reachable(world,[oct],oct);
  assert.equal(reaches.has('1,0'),true);
  assert.equal(reaches.has('2,0'),true);
  assert.equal(reaches.has('3,0'),false);
  const path=TacticalEngine.pathTo(world,[oct],oct,2,0);
  assert.ok(path.length>0);
  for(const t of path)assert.equal(TacticalEngine.canOccupyFootprint(world,[oct],oct,t.x,t.y,{ignoreElevation:true}),true);
});
test('中立 AI 可在一回合行動一次，但不把怪物變成失控莉維亞',()=>{
  const oct=unit('n',2,2);
  assert.equal(NeutralActorEngine.availableActors([oct],1).length,1);
  assert.equal(NeutralActorEngine.markActed(oct,1),true);
  assert.equal(oct.neutralActionRound,1);
  assert.equal(NeutralActorEngine.availableActors([oct],1).length,0);
  assert.equal(NeutralActorEngine.availableActors([oct],2).length,1);
  assert.equal(oct.controlOverride,undefined);
});
test('龍捲風覆蓋四格時只有一次真正強制位移',()=>{
  const oct=unit('n',1,1),world=map(4,4),moved=[];
  globalThis.EnvironmentEngine={EFFECT:{FIRE_TORNADO:'FIRE_TORNADO',TORNADO:'TORNADO'},
    createTornado:(_e,x,y)=>({type:'TORNADO_CREATED',x,y}),
    effectAt:()=>[{type:'TORNADO',pushDistance:2,damage:20}]};
  const affected=TacticalEngine.occupiedCells(oct),result=AreaSpellMechanics.resolveAreaPush({
    map:world,environmentState:{},center:{x:1,y:1},affected,
    effect:{type:'AREA_PUSH',distance:2,damage:20},name:'龍捲風',
    unitAt:(x,y)=>TacticalEngine.occupantAt([oct],x,y),
    applyForcedMovement:(_center,target)=>moved.push(target.id),
    logEnvironmentEvent:()=>{},resolveEnvironmentEvents:()=>{}
  });
  assert.deepEqual(moved,['n']);assert.equal(result.contacts,1);
});
test('四格中任何一格受到外圈衝擊，仍只計算一次',()=>{
  const oct=unit('n',2,2),world=map(6,6),moved=[];
  const res=AreaSpellMechanics.resolveShockwave({center:{x:1,y:1},innerRadius:0,
    shockwave:{outerRadius:4,distance:2},aoeTiles:(center,r)=>
      world.tiles.filter(t=>Math.abs(t.x-center.x)+Math.abs(t.y-center.y)<=r),
    unitAt:(x,y)=>TacticalEngine.occupantAt([oct],x,y),
    applyForcedMovement:(_center,target)=>moved.push(target.id),name:'星隕'});
  assert.equal(res.contacts,1);assert.deepEqual(moved,['n']);
});
test('合法水格中四格巨章可由右側邊緣被近戰鎖定，而非只看左上座標',()=>{
  const world=map(7,7),oct=unit('n',2,2),hero={id:'p',x:4,y:3,alive:true,team:'P',
    character:{passives:[],terrainTraits:[],weapons:{claw:{attackType:'STRIKE'}}},facing:'W'};
  const skill={id:'test_slash',attackType:'STRIKE',target:'ENEMY',targetType:'SINGLE',
    range:{min:1,max:1},weapon:'claw'};
  assert.equal(TacticalEngine.canTarget(world,hero,oct,skill),true);
  assert.equal(TacticalEngine.canTarget(world,{...hero,x:6},oct,skill),false);
});
test('生成不允許四格中只有一格水深達標，其他三格太淺',()=>{
  const world=map(2,2);world.tiles.find(t=>t.x===1&&t.y===0).waterDepth=.4;
  assert.equal(spawn(world).length,0);
  world.tiles.find(t=>t.x===1&&t.y===0).waterDepth=3;
  assert.equal(spawn(world).length,1);
});
