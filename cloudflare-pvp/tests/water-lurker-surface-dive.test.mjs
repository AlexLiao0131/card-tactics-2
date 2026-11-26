import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './water-lurker-render-fixture.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const source=read('../../js/unit-renderer.js');
test('SWIMMING and DIVING preserve one rig, surface and actual water level',()=>{
 const x=fixture();x.sync();x.tick(1000);const fx=x.entry(),root=fx.root;
 const top=()=>fx.headRig.position.y+fx.head.position.y+fx.head.scaling.y/2;
 assert.ok(top()>0);assert.ok(fx.headRig.position.y+fx.eyes[0].position.y>0);
 x.monster.verticalMode='DIVING';x.sync();for(let t=1100;t<=3600;t+=100)x.tick(t);assert.ok(top()<0);assert.ok(fx.diveBlend>.99);
 x.monster.verticalMode='SWIMMING';x.sync();for(let t=3700;t<=6200;t+=100)x.tick(t);assert.ok(top()>0);assert.equal(x.entry().root,root);
 x.map.tiles.forEach(t=>t.waterSurfaceZ=5);x.sync();assert.equal(root.position.y,4);assert.deepEqual(x.monster.footprint,{width:2,height:2});
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
