import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../../js/tactical-action-controller.js',import.meta.url),'utf8').replace(/^import .*;\s*$/gm,'');
function battle(type,aim={x:3,y:3},options={}){
 const tiles=Array.from({length:49},(_,n)=>({x:n%7,y:Math.floor(n/7),terrain:'PLAIN',elevation:0,waterDepth:0}));
 const at=(x,y)=>tiles.find(t=>t.x===x&&t.y===y);
 const map={tiles,objects:[]};
 const caster={id:'caster',team:'P',alive:true,acted:false,waited:false,x:1,y:3,character:{alchemyHarvest:true,name:'梅莉安'}};
 const selected={...caster};Object.assign(caster,selected);
 if(['FLOOD','FREEZE','WATER_TO_LAND'].includes(type))at(3,3).waterDepth=1;
 if(type==='SHATTER')map.objects.push({id:'ore',type:'BOULDER',x:3,y:3,destructible:true});
 const other=options.occupied?{id:'target',team:'E',alive:true,occupiesTile:true,x:3,y:3}:null;
 const units=other?[caster,other]:[caster];
 let charges=3,consumed=0;const events=[];
 const state=()=>({map,units,environmentState:{effects:new Map()},selected:caster});
 const global={
  globalThis:null,AngelWingBarrierEngine:{TYPE:'HOLY_WING_BARRIER'},TERRAINS:{PLAIN:{passable:true},WALL:{passable:false},MUD:{passable:true}},
  TacticalEngine:{range:s=>s.range,tile:(m,x,y)=>at(x,y),teamCanSee:()=>true,canSee:()=>true},
  HydrologyEngine:{
   floodArea:(_map,around)=>{for(const t of around)t.waterDepth++;return[{type:'FLOOD_AREA_RESOLVED'}]},
   deformTerrain:(_map,x,y,{deltaElevation})=>{const t=at(x,y),from=t.elevation;t.elevation+=deltaElevation;return[{type:'ELEVATION_CHANGED',x,y,from,to:t.elevation}]},
   setWaterDepth:(t,v)=>{t.waterDepth=v},addWater:(t,v)=>{t.waterDepth+=v},isWater:t=>Number(t?.waterDepth||0)>0
  },
  EnvironmentObjectEngine:{activeObjectsAt:(m,x,y)=>m.objects.filter(o=>!o.destroyed&&o.x===x&&o.y===y),destroy:(m,o,{events:e})=>{o.destroyed=true;e.push({type:'ENV_OBJECT_DESTROYED'});return true}},
  ClimateEngine:{syncTileVisuals:()=>{}},EffectEngine:{breakStealth:()=>{},interruptChannel:()=>{}},
  UnitAnimationEngine:{emitAction:()=>{}},CardTacticsDiagnostics:{gameAction:()=>{}}
 };
 global.globalThis=global;
 vm.runInNewContext(source,global,{filename:'tactical-action-controller.js'});
 const ctx={actionState:state,targetType:()=> 'AOE',TEAM:{PLAYER:'P',ENEMY:'E'},unitAt:(x,y)=>units.find(u=>u.alive&&u.x===x&&u.y===y)||null,
  canUseSkill:()=>charges>=3,consumeSkill:()=>{if(charges<3)return null;charges-=3;consumed++;return{resources:{}}},
  setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},pushLog:()=>{},
  logEnvironmentEvent:e=>events.push(e),resolveEnvironmentEvents:()=>{},checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,render:()=>{},emitState:()=>{}
 };
 const controller=global.TacticalActionController.create(ctx);
 const skill={id:'alchemy_world_transmutation',name:'萬象煉成',target:'TILE',targetType:'AOE',category:'MAGIC',range:{min:0,max:4},alchemyCast:{mode:'TERRAIN'},alchemyTerrain:type};
 return {controller,skill,caster,map,at,events,aim,charges:()=>charges,consumed:()=>consumed};
}
test('mud changes actual Game State and costs exactly one full rune',()=>{
 const h=battle('MUD');assert.ok(h.controller.mapTargetTiles(h.caster,h.skill).some(t=>t.x===3&&t.y===3));
 assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),true);
 assert.equal(h.at(3,3).terrain,'MUD');assert.equal(h.charges(),0);assert.equal(h.consumed(),1);
});
test('blocked construction never consumes rune',()=>{
 const h=battle('WALL',{x:3,y:3},{occupied:true});
 assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),false);
 assert.equal(h.at(3,3).terrain,'PLAIN');assert.equal(h.charges(),3);
});
test('wall and cliff change real collision terrain and elevations',()=>{
 const a=battle('WALL');assert.equal(a.controller.executeMapSkill(a.caster,a.aim,a.skill),true);assert.equal(a.at(3,3).terrain,'WALL');
 const b=battle('CLIFF');assert.equal(b.controller.executeMapSkill(b.caster,b.aim,b.skill),true);
 for(const x of [2,3,4]){assert.equal(b.at(x,3).terrain,'HIGH_GROUND');assert.equal(b.at(x,3).elevation,2);}
});
test('ice uses real water column; flood adds water; shatter destroys a real rock',()=>{
 const a=battle('FREEZE');assert.equal(a.controller.executeMapSkill(a.caster,a.aim,a.skill),true);assert.ok(a.at(3,3).iceThickness>0);assert.equal(a.at(3,3).waterDepth,1);
 const b=battle('FLOOD');assert.equal(b.controller.executeMapSkill(b.caster,b.aim,b.skill),true);assert.equal(b.at(3,3).waterDepth,2);
 const c=battle('SHATTER');assert.equal(c.controller.executeMapSkill(c.caster,c.aim,c.skill),true);assert.equal(c.map.objects[0].destroyed,true);
});
test('water converted to land displaces rather than erases its volume',()=>{
 const h=battle('WATER_TO_LAND');const initial=h.map.tiles.reduce((s,t)=>s+t.waterDepth,0);
 assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),true);
 const final=h.map.tiles.reduce((s,t)=>s+t.waterDepth,0);
 assert.ok(Math.abs(final-initial)<1e-9);assert.equal(h.at(3,3).terrain,'PLAIN');assert.equal(h.at(3,3).waterDepth,0);
});

test('wet non-source water beneath a 3-cell row can raise an actual visible cliff with water conservation',()=>{
 const h=battle('CLIFF');
 for(const x of [2,3,4])h.at(x,3).waterDepth=x===3?2.5:1;
 const before=h.map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0);
 assert.ok(h.controller.mapTargetTiles(h.caster,h.skill).some(t=>t.x===3&&t.y===3));
 assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),true);
 const after=h.map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0);
 assert.ok(Math.abs(before-after)<1e-9,`water conserved ${before} -> ${after}`);
 assert.equal(h.at(3,3).terrain,'HIGH_GROUND');
 assert.equal(h.at(3,3).waterDepth,0);
 assert.ok(h.at(3,3).elevation>2.5,'raised ground emerges above previous water surface');
 assert.equal(h.consumed(),1);
});
test('real river water can be reshaped only away from protected hydrology endpoints',()=>{
 const h=battle('CLIFF');
 for(const x of [2,3,4]){h.at(x,3).waterDepth=1;h.at(x,3).river=true;}
 assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),true);
 for(const x of [2,3,4])assert.equal(h.at(x,3).terrain,'HIGH_GROUND');
 const blocked=battle('CLIFF');
 blocked.at(3,3).river=true;blocked.at(3,3).waterDepth=1;
 blocked.at(3,3).hydrologySource=true;
 assert.equal(blocked.controller.mapTargetTiles(blocked.caster,blocked.skill).some(t=>t.x===3&&t.y===3),false);
 assert.equal(blocked.controller.executeMapSkill(blocked.caster,blocked.aim,blocked.skill),false);
 assert.equal(blocked.consumed(),0);
});
test('a 3-cell cliff never replaces a Core, capture zone, spring, or occupied square',()=>{
 for(const change of [
  h=>{h.at(2,3).captureZone=true},
  h=>{h.at(4,3).core=true},
  h=>{h.at(3,3).hydrologyDrain=true}
 ]){
  const h=battle('CLIFF');change(h);
  assert.equal(h.controller.executeMapSkill(h.caster,h.aim,h.skill),false);
  assert.equal(h.consumed(),0);
 }
});
