import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/pvp-match-core.mjs';
import '../src/pvp-headless-tactical.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';
import {createOfficialBattlefield} from '../src/pvp-battlefield.mjs';
import {createBattleAreaFieldEngine,createBattleAreaFieldState,activeFieldTiles} from '../../js/battle-area-field-engine.js';
import {tickRoundStatusEffects} from '../../js/battle-round-sequence.js';
import {BattleInputController} from '../../js/battle-input-controller.js';
import {DimensionalRiftVfx} from '../../js/dimensional-rift-vfx.js';
import {projectCanonicalAimOptions} from "../src/pvp-headless-aim-projection.mjs";
const skill=id=>SkillDatabase.get(id);
const fixture=fn=>{
 const world=createOfficialBattlefield({serverSeed:1234,mapSize:'SMALL'});
 const state={randomState:1,fieldState:createBattleAreaFieldState(),units:[]};
 return withCanonicalEngines(state,e=>{
  const spawn=(id,characterId,team,x,y)=>{const u=e.unitRuntime.create({id,characterId,team,x,y,map:world.map,cores:world.cores});state.units.push(u);return u};
  return fn({e,world,state,spawn,v:spawn('viola','viola','P',3,3),f:spawn('enemy','imperial_heavy_guard','E',3,4)});
 });
};
test('actual Hellfire combat applies status immediately and ticks exactly three future rounds with logs',()=>fixture(({e,world,state,v,f})=>{
 e.unitRuntime.changeResource(v,'soulStone',1);
 const log=[],hp=f.hp;
 const res=BattleResolution.resolve({map:world.map,units:state.units,initiator:v,target:f,skill:{...skill('viola_hellfire'),accuracy:100,forceHit:true},actions:[]},{consumeSkill:(u,s)=>e.unitRuntime.consumeSkill(u,s)});
 assert.ok(res.results.length);assert.ok(f.hp<hp);assert.equal(v.resources.soulStone.value,0);
 for(const entry of res.results)BattleResolution.logStatusResults(entry,msg=>log.push(msg));
 assert.equal(f.effects.find(x=>x.id==='HELLFIRE_BURN')?.remaining,3);
 assert.ok(log.some(s=>s.includes('附加 地獄火')));const after=f.hp;
 e.effect.exchangeWaterBurn(f,9999);assert.equal(f.hp,after);
 for(let i=1;i<=3;i++){
  tickRoundStatusEffects({units:state.units,effectEngine:e.effect,onDefeated:u=>{u.alive=false},pushLog:msg=>log.push(msg)});
  assert.equal(f.hp,after-i*12);assert.equal(f.effects.find(x=>x.id==='HELLFIRE_BURN')?.remaining,i===3?undefined:3-i);
 }
 assert.equal(log.filter(x=>x.includes('DOT 12 HP')).length,3);
 tickRoundStatusEffects({units:state.units,effectEngine:e.effect});assert.equal(f.hp,after-36);
}));
test('persistent firestorm projection uses actual stored cells and expires on final pulse',()=>fixture(({e,world,state,v,f})=>{
 let round=1;const field=()=>createBattleAreaFieldEngine({state:state.fieldState,map:()=>world.map,units:()=>state.units,round:()=>round,effect:()=>e.effect,pushLog(){},handleDefeated(u){u.alive=false},random:()=>.5});
 field().activatePersistentArea(v,{x:3,y:4},skill('viola_firestorm'));
 const view=()=>activeFieldTiles({map:world.map,units:state.units,fieldState:state.fieldState,round,viewerTeam:'P'});
 const stored=state.fieldState.persistentAreas[0];assert.deepEqual([...view().keys()].sort(),[...stored.cells].sort());assert.equal(view().get('3,4')[0].remaining,2);
 round++;field().tickSanctuaries('P');assert.equal(view().get('3,4')[0].remaining,1);
 round++;field().tickSanctuaries('P');assert.equal(view().size,0);
}));
test('healing song projection follows actual effect radius, visibility and interruption',()=>fixture(({e,world,state,spawn})=>{
 const o=spawn('song','ophi','P',4,3);const channel=skill('ophi_healing_song').channel;
 e.effect.apply({source:o,target:o,effect:{...channel,classification:'POSITIVE'}});
 const view=(viewerTeam,canSeeUnit=()=>false)=>activeFieldTiles({map:world.map,units:state.units,fieldState:state.fieldState,round:1,viewerTeam,canSeeUnit});
 assert.deepEqual([...view('P').keys()].sort(),TacticalEngine.aoeTiles(world.map,o,channel.radius).map(t=>`${t.x},${t.y}`).sort());
 assert.equal(view('E').size,0);
 e.effect.interruptChannel(o,'MOVE');assert.equal(view('P').size,0);
}));
test('shared area geometry matches existing actual fan, tsunami and circle calculations',()=>fixture(({world,v})=>{
 const center={x:3,y:6};const fan={fanShot:{length:3,width:3}},wave={tsunamiWave:{width:5},hydrologyFlood:{surfaceRise:1.25}};
 assert.deepEqual(TacticalEngine.areaImpactTiles(world.map,v,center,fan),TacticalEngine.fanTiles(world.map,v,center,fan.fanShot));
 assert.deepEqual(TacticalEngine.areaImpactTiles(world.map,v,center,wave),EnvironmentEngine.planTsunami(world.map,v,center,{width:5,surfaceRise:1.25}).cells);
 assert.deepEqual(TacticalEngine.areaImpactTiles(world.map,v,center,skill('viola_firestorm')),TacticalEngine.aoeTiles(world.map,center,2));
}));
test('aim drag updates only read-only preview and release does not cast or pan',()=>{
 const save={window:globalThis.window,document:globalThis.document,CustomEvent:globalThis.CustomEvent};
 const node={addEventListener(){},removeEventListener(){},dispatchEvent(){}};globalThis.window=node;globalThis.document=node;globalThis.CustomEvent=class{};
 const canvas={...node,style:{},getBoundingClientRect:()=>({left:10,top:20}),setPointerCapture(){},releasePointerCapture(){}};
 const picks=[];let pans=0,active=true;
 const ctl=new BattleInputController(canvas,{camera:{panByPixels(){pans++}},picker:{pickCurrent:(x,y)=>({x:Math.round(x/10),y:Math.round(y/10)})},onTilePicked:(x,y,opts)=>picks.push({x,y,opts}),canAimDrag:()=>active});
 const ev=(x,y)=>({clientX:x,clientY:y,pointerId:1,pointerType:'touch',isPrimary:true,button:0,preventDefault(){}});
 try{ctl.onPointerDown(ev(20,30));ctl.onPointerMove(ev(50,60));ctl.onPointerMove(ev(50,60));ctl.onPointerUp(ev(50,60));assert.deepEqual(picks,[{x:4,y:4,opts:{aimOnly:true}}]);assert.equal(pans,0);
 ctl.onPointerDown(ev(20,30));active=false;ctl.onPointerUp(ev(20,30));assert.equal(picks.length,1);
 }finally{ctl.dispose();Object.assign(globalThis,save);}
});
test('persistent hellfire meshes follow visible effect and dispose on cleanse, expiry or concealment',()=>{
 const original=globalThis.BABYLON;class Vec{set(x,y,z){Object.assign(this,{x,y,z})}}class Node{constructor(){this.position=new Vec();this.scaling=new Vec();this.rotation=new Vec();}dispose(){this.disposed=true;}}
 globalThis.BABYLON={Vector3:Vec,Color3:Vec,StandardMaterial:Node,TransformNode:Node,MeshBuilder:{CreateSphere:()=>new Node()},Engine:{ALPHA_ADD:1}};
 try{const vfx=new DimensionalRiftVfx({});const unit={id:'burned',x:2,y:2,alive:true,effects:[{id:'HELLFIRE_BURN',remaining:3}]};const snapshot={map:{id:'test'},round:1,units:[unit]};
 vfx.sync(snapshot);assert.equal(vfx.hellfireAuras.size,1);const root=vfx.hellfireAuras.get('burned').root;unit.x=4;vfx.sync(snapshot);assert.equal(vfx.hellfireAuras.get('burned').root,root);vfx.updateFrame(500);assert.ok(root.position.x>0);
 unit.effects=[];vfx.sync(snapshot);assert.equal(root.disposed,true);assert.equal(vfx.hellfireAuras.size,0);
 unit.effects=[{id:'HELLFIRE_BURN',remaining:1}];vfx.sync(snapshot);snapshot.units=[];vfx.sync(snapshot);assert.equal(vfx.hellfireAuras.size,0);
 }finally{globalThis.BABYLON=original;}
});

test('Worker aim projection sends firestorm footprint without spending a soul stone',()=>fixture(({e,world,state,v})=>{
 e.unitRuntime.changeResource(v,'soulStone',3);
 const game={...state,battlefield:world,environmentState:null,phase:'PLAYER_TACTICAL_PHASE',activeSeat:0};
 const option=projectCanonicalAimOptions(game,0,v,e).find(o=>o.skillId==='viola_firestorm');
 assert.ok(option?.actionableTiles.length);assert.ok(option.areaFootprints);
 const center=option.actionableTiles[0];
 assert.deepEqual(option.areaFootprints[`${center.x},${center.y}`],TacticalEngine.aoeTiles(world.map,center,2).map(t=>({x:t.x,y:t.y})));
 assert.equal(v.resources.soulStone.value,3);assert.equal(v.acted,false);
}));
