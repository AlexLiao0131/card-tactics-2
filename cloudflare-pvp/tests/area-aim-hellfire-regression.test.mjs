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
test('aim drag only owns gestures started inside footprint, retains offset, outside pans, taps are read-only',()=>{
 const save={window:globalThis.window,document:globalThis.document,CustomEvent:globalThis.CustomEvent};
 const events=[];const node={addEventListener(){},removeEventListener(){},dispatchEvent(e){events.push(e.type)}};globalThis.window=node;globalThis.document=node;globalThis.CustomEvent=class{constructor(type){this.type=type}};
 const canvas={...node,style:{},getBoundingClientRect:()=>({left:10,top:20}),setPointerCapture(){},releasePointerCapture(){}};
 const picks=[];let pans=0,active=true,center={x:2,y:2};
 const ctl=new BattleInputController(canvas,{camera:{panByPixels(){pans++},getViewState:()=>({zoom:1}),setZoom(){},rotate(){}},picker:{pickCurrent:(x,y)=>({x:Math.round(x/10),y:Math.round(y/10)})},onTilePicked:(x,y,opts)=>{picks.push({x,y,opts});if(opts?.aimOnly)center={x,y}},getAreaAim:()=>active?{center,contains:(x,y)=>Math.abs(center.x-x)+Math.abs(center.y-y)<=1}:null});
 const ev=(x,y,id=1)=>({clientX:x,clientY:y,pointerId:id,pointerType:'touch',isPrimary:id===1,button:0,preventDefault(){}});
 try{
  // Finger begins on the left edge, not on the center. No HUD timer is armed.
  ctl.onPointerDown(ev(20,40));assert.equal(ctl.gesture.type,'AIM');assert.equal(ctl.holdTimer,null);
  ctl.onPointerMove(ev(50,70));ctl.onPointerMove(ev(50,70));ctl.onPointerUp(ev(50,70));
  assert.deepEqual(picks,[{x:5,y:5,opts:{aimOnly:true}}]);assert.equal(pans,0);
  // A new gesture outside the orange area pans; dragging across it must not steal ownership.
  ctl.onPointerDown(ev(20,30));assert.equal(ctl.gesture.type,'PAN');assert.notEqual(ctl.holdTimer,null);
  ctl.onPointerMove(ev(60,70));ctl.onPointerUp(ev(60,70));assert.equal(pans,1);assert.equal(picks.length,1);
  // Tap outside relocates (authority still validates); releasing on orange is not a cast.
  ctl.onPointerDown(ev(30,40));ctl.onPointerUp(ev(30,40));assert.deepEqual(picks.at(-1),{x:2,y:2,opts:{aimOnly:true}});
  ctl.onPointerDown(ev(30,40));ctl.onPointerUp(ev(30,40));assert.equal(picks.length,2);
  // A second finger is always a camera gesture; cancelling is safe.
  ctl.onPointerDown(ev(30,40));ctl.onPointerDown(ev(60,70,2));assert.equal(ctl.gesture.type,'MULTI_PENDING');
  ctl.onPointerMove(ev(90,90,2));ctl.onPointerUp(ev(90,90,2));ctl.onPointerUp(ev(30,40));assert.equal(picks.length,2);
  ctl.onPointerDown(ev(30,40));active=false;ctl.onPointerUp(ev(30,40));assert.equal(picks.length,2);
  ctl.onPointerDown(ev(30,40));assert.equal(ctl.gesture.type,'PAN');assert.notEqual(ctl.holdTimer,null);ctl.onPointerCancel(ev(30,40));assert.equal(ctl.pointers.size,0);
 }finally{ctl.dispose();Object.assign(globalThis,save);}
});
test('initial aim is deterministic, forward-nearest, read only, falls back to legal nonempty footprint',()=>{
 const actor={x:3,y:3,facing:'E',team:'P'},legal=[{x:3,y:2},{x:2,y:3},{x:5,y:3},{x:4,y:3},{x:4,y:4}];
 const old=JSON.stringify({actor,legal});assert.deepEqual(TacticalEngine.defaultAreaAim(actor,legal),{x:4,y:3});
 assert.deepEqual(TacticalEngine.defaultAreaAim(actor,legal,t=>t.x!==4),{x:5,y:3});
 assert.deepEqual(TacticalEngine.defaultAreaAim(actor,legal.slice(0,2)),{x:3,y:2});
 assert.equal(TacticalEngine.defaultAreaAim(actor,legal,()=>false),null);assert.equal(JSON.stringify({actor,legal}),old);
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

test('center crosshair and legal blue tiles are separate existing highlights and clear when aim ends',async()=>{
 const {HighlightRenderer}=await import('../../js/highlight-renderer.js');
 const r=Object.create(HighlightRenderer.prototype);r.terrain={};r.environment={publishedCoverGeometry:()=>[]};r.dynamic=new Map();r.fields=new Map();r.areas=new Map();r.materials={aimPreview:{},aimLegal:{},aimCenter:{}};
 r.indicatorGeometry=()=>({positions:[0,1,0,1,1,0,0,1,1],indices:[0,1,2]});r.syncMesh=(prev,name,parts,material,order)=>({name,parts,order,dispose(){this.disposed=true}});
 const tiles=[{x:1,y:1,aimPreview:true,aimCenter:true,aimLegal:true},{x:2,y:1,aimLegal:true,attackable:true}];r.sync({map:{tiles}});
 assert.ok(r.dynamic.has('aimPreview'));assert.ok(r.dynamic.has('aimLegal'));const center=r.dynamic.get('aimCenter');assert.ok(center);assert.equal(center.parts.length,2);assert.ok(center.order>r.dynamic.get('aimPreview').order);assert.equal(center.renderingGroupId,1);
 r.sync({map:{tiles:[{x:1,y:1},{x:2,y:1}]}});assert.equal(r.dynamic.size,0);assert.equal(center.disposed,true);
});
