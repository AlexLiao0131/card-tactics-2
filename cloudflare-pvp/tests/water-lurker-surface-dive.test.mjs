import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=(file)=>readFileSync(new URL(file,import.meta.url),'utf8');
const source=read('../../js/vfx-manager.js');
const section=source.split('class WaterLurkerSurfaceModel{')[1]?.split('const factories=Object.freeze({')[0];
assert.ok(section);
class Vec{
  constructor(x=0,y=0,z=0){this.set(x,y,z)}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  setAll(n){return this.set(n,n,n)}
}
class Node{
  constructor(name){this.name=name;this.position=new Vec();this.rotation=new Vec();this.scaling=new Vec(1,1,1);this.children=[];this.disposed=false}
  set parent(p){if(this._parent){const i=this._parent.children.indexOf(this);if(i>=0)this._parent.children.splice(i,1)}this._parent=p;if(p)p.children.push(this)}
  get parent(){return this._parent}
  getChildMeshes(){return this.children.flatMap(c=>[...(c.isMesh?[c]:[]),...c.getChildMeshes()])}
  setEnabled(on){this.enabled=on}
  dispose(){this.disposed=true;for(const c of [...this.children])c.dispose()}
}
class Material{dispose(){}}
const BABYLON={TransformNode:Node,StandardMaterial:Material,
  Color3:class Color3{constructor(...args){this.rgb=args}},
  MeshBuilder:Object.fromEntries(['CreateSphere','CreateCylinder','CreateTorus']
    .map(key=>[key,name=>{const m=new Node(name);m.isMesh=true;return m}]))};
const Model=vm.runInNewContext('class WaterLurkerSurfaceModel{'+section+';WaterLurkerSurfaceModel',
 {BABYLON,TILE_SIZE:2,ELEVATION_HEIGHT:1,performance:{now:()=>1000},Math,Map,Set,Number,String});
const fixture=()=>{
 const model=new Model({onDisposeObservable:{addOnce:()=>{}}});
 const unit={id:'oct',visualId:'water_lurker_default',monsterId:'water_lurker',alive:true,
   x:2,y:2,footprint:{width:2,height:2},verticalMode:'SWIMMING'};
 const map={id:'lake',tiles:Array.from({length:16},(_,i)=>({x:i%4+1,y:Math.floor(i/4)+1,waterSurfaceZ:3}))};
 return {model,unit,map};
};
test('水面上浮有真正的頭、眼、虹膜、喙、虹吸管和水下身體，不是只有觸手',()=>{
 const {model,unit,map}=fixture();model.sync({map,units:[unit]});model.updateFrame(1000);
 const fx=model.entries.get('oct');
 const names=fx.root.getChildMeshes().map(m=>m.name);
 for(const name of ['raised-mantle','face','brow','beak','eye-socket','glowing-eye','pupil','siphon','underbody'])
   assert.ok(names.some(n=>n.includes(name)),name);
 assert.equal(fx.arms.length,5);
 assert.ok(fx.headRig.position.y+fx.head.position.y+fx.head.scaling.y/2>0,
   'The upper half of the mantle must emerge above the water surface');
 assert.ok(fx.headRig.position.y+fx.eyes[0].position.y>0,'eyes must be above the water surface');
 assert.equal(fx.root.position.y,3,'body follows the real water surface');
 model.dispose();
});
test('DIVING 真的把章魚頭部移入水中，SWIMMING 又平滑上浮；同一隻四格怪沒有重建',()=>{
 const {model,unit,map}=fixture();model.sync({map,units:[unit]});model.updateFrame(1000);
 const fx=model.entries.get('oct');const original=fx.root;
 const surfaced=fx.headRig.position.y+fx.head.position.y+fx.head.scaling.y/2;
 unit.verticalMode='DIVING';model.sync({map,units:[unit]});
 for(let t=1100;t<=3600;t+=100)model.updateFrame(t);
 const submerged=fx.headRig.position.y+fx.head.position.y+fx.head.scaling.y/2;
 assert.ok(surfaced>0 && submerged<0,{surfaced,submerged});
 assert.ok(fx.diveBlend>.99);
 assert.equal(fx.root,original);assert.equal(model.entries.size,1);
 unit.verticalMode='SWIMMING';model.sync({map,units:[unit]});
 for(let t=3700;t<=6200;t+=100)model.updateFrame(t);
 assert.ok(fx.headRig.position.y+fx.head.position.y+fx.head.scaling.y/2>0);
 assert.ok(fx.diveBlend<.01);
 model.dispose();
});
test('水位升降只改 Babylon 根節點，不改地形或怪物 HP / 2×2 footprint',()=>{
 const {model,unit,map}=fixture();const before=structuredClone(map.tiles);
 model.sync({map,units:[unit]});model.updateFrame(1000);
 map.tiles.forEach(tile=>tile.waterSurfaceZ+=2);
 model.sync({map,units:[unit]});
 assert.equal(model.entries.get('oct').root.position.y,5);
 assert.deepEqual(map.tiles.map(t=>t.waterSurfaceZ),before.map(t=>t.waterSurfaceZ+2));
 assert.deepEqual(unit.footprint,{width:2,height:2});
 model.dispose();
});
test('深潭巨章依自己的實際碰撞高度取得潛水能力，不更改其他角色預設',()=>{
 const character=read('../../js/character-database.js');
 const entry=character.split('water_lurker:{')[1]?.split('\n\nnereia:{')[0];
 assert.ok(entry);
 assert.match(entry,/footprint:\{width:2,height:2\},collision:\{height:1\}/);
 assert.ok(entry.includes('modes:["SWIMMING","DIVING"]'));
});

test('共用中立 AI 依正式觸手技能射程選擇浮頭攻擊或安全下潛，四格都需有深度',async()=>{
 // NeutralActorEngine is pure policy. Test the actual function with official
 // capability names; don't duplicate a PvP-exclusive decision function.
 const neutralCode=read('../../js/neutral-actor-engine.js');
 const start=neutralCode.indexOf('function chooseAquaticStance(');
 const end=neutralCode.indexOf('\nfunction availableActors',start);
 assert.ok(start>=0&&end>start);
 const input=neutralCode.slice(start,end);
 const fakeVertical={
   describe:u=>({mode:u.mode}),
   setMode:(u,tile,mode)=>{u.mode=mode;return {ok:true,state:{mode}}},
   capabilities:()=>({canDive:true}),waterDepth:t=>t.depth,bodyHeight:()=>1
 };
 const fakeTactical={
   tile:(map,x,y)=>map.tiles.find(t=>t.x===x&&t.y===y),
   occupiedCells:u=>Array.from({length:4},(_,i)=>({x:u.x+i%2,y:u.y+Math.floor(i/2)})),
   distanceBetween:(a,b)=>Math.max(0,Math.abs(a.x-b.x)-1)+Math.max(0,Math.abs(a.y-b.y)-1),
   actorCanTrackTarget:()=>true
 };
 const ctx={globalThis:{VerticalMobilityEngine:fakeVertical,TacticalEngine:fakeTactical,
     SkillDatabase:{get:()=>({target:'ENEMY',weapon:'claw',range:{min:1,max:2}})}},
   Math,Number,String};
 const policy=vm.runInNewContext(input+';chooseAquaticStance',ctx);
 const map={tiles:Array.from({length:16},(_,i)=>({x:i%4,y:Math.floor(i/4),depth:1}))};
 const actor={id:'monster',team:'N',alive:true,x:1,y:1,monsterId:'water_lurker',
   character:{skills:['water_tentacle'],id:'water_lurker'},mode:'SWIMMING'};
 const foe={id:'hero',team:'P',alive:true,x:3,y:2};
 assert.equal(policy({map,units:[actor,foe],unit:actor}),null,'nearby foe keeps monster surfaced');
 foe.x=9;
 assert.equal(policy({map,units:[actor,foe],unit:actor}).to,'DIVING');
 foe.x=3;
 assert.equal(policy({map,units:[actor,foe],unit:actor}).to,'SWIMMING');
 foe.x=9;map.tiles.find(t=>t.x===2&&t.y===2).depth=.4;
 assert.equal(policy({map,units:[actor,foe],unit:actor}),null,'shallow one of four cells blocks dive');
 assert.equal(actor.mode,'SWIMMING');
});
test('單機與 PVP 均使用同一中立狀態策略且沒有另造第二套動畫引擎',()=>{
 const offline=read('../../js/tactical-game.js');
 const pvp=read('../src/pvp-headless-tactical.mjs');
 assert.match(offline,/dual\.chooseAquaticStance\?\.\(/);
 assert.match(pvp,/NeutralActorEngine\.chooseAquaticStance\?\.\(/);
 assert.match(source,/fx\.targetDive=fx\.verticalMode==='DIVING'/);
});
