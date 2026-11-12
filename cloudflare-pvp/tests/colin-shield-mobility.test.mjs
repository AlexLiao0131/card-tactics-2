import test from 'node:test';
import assert from 'node:assert/strict';
import {ColinShieldMobilityEngine as Shield} from '../../js/colin-shield-mobility-engine.js';
import {TacticalEngine as Tactical} from '../../js/tactical-engine.js';
import {VerticalMobilityEngine as Vertical} from '../../js/vertical-mobility-engine.js';

globalThis.TERRAINS={PLAIN:{passable:true,moveCost:1},HIGH_GROUND:{passable:true,moveCost:1},WALL:{passable:false,moveCost:99},WATER:{passable:true,moveCost:1}};
globalThis.SkillDatabase={passiveList:()=>[]};
globalThis.EquipmentDatabase={get:id=>id==='livia_light_armor'?{type:'LIGHT'}:id==='chainmail'?{type:'MEDIUM'}:null};
globalThis.HydrologyEngine={waterDepth:t=>Number(t?.waterDepth||0),waterSurfaceZ:t=>Number(t?.elevation||0)+Number(t?.waterDepth||0),isWater:t=>Number(t?.waterDepth||0)>0};
globalThis.ClimateEngine={isSolidIce:t=>Number(t?.iceThickness||0)>=1};
function tile(x,y,elevation=0,extra={}){return {x,y,elevation,terrain:'PLAIN',...extra};}
function colin(x=1,y=0){return{id:'c',team:'P',x,y,alive:true,occupiesTile:true,moved:false,character:{id:'colin',passives:['COLIN_SHIELD_MASTERY'],equipmentIds:['colin_full_body_shield'],armorId:'chainmail',combat:{move:4},collision:{height:2},terrainTraits:['MOUNTAIN_WALK']}};}
function ally(x=0,y=0,team='P',armorId='livia_light_armor'){return{id:'a',team,x,y,alive:true,occupiesTile:true,moved:false,character:{id:'livia',armorId,combat:{move:4},terrainTraits:[]}};}
function world(){return {tiles:[tile(0,0),tile(1,0),tile(2,0,2,{terrain:'HIGH_GROUND'}),tile(3,0,2,{terrain:'HIGH_GROUND'})]};}

test('shield stair gives ally an actual forward path across occupied Colin, with one height bonus',()=>{
 const map=world(),c=colin(),a=ally(),units=[a,c];
 const b=Tactical.reachable(map,units,a);
 assert.equal(b.has('2,0'),true);
 const path=Tactical.pathTo(map,units,a,2,0);
 assert.equal(path.length,1);
 assert.equal(path[0].shieldTransit.guardianId,'c');
 assert.equal(path[0].shieldTransit.via.z,1);
});
test('shield stair permits a real reverse path downhill through same support',()=>{
 const map=world(),c=colin(),a=ally(2,0),units=[a,c];
 const path=Tactical.pathTo(map,units,a,0,0);
 assert.equal(path.length,1);
 assert.equal(path[0].shieldTransit.guardianId,'c');
});
test('enemy cannot use ally-only stair even if adjacent to Colin',()=>{
 const map=world(),c=colin(),a=ally(0,0,'E');
 assert.equal(Tactical.reachable(map,[a,c],a).has('2,0'),false);
 assert.deepEqual(Tactical.pathTo(map,[a,c],a,2,0),[]);
});
test('an unsupported H3 rise cannot be manufactured by an H1 shield',()=>{
 const map=world();map.tiles.find(t=>t.x===2).elevation=3;
 const c=colin(),a=ally();assert.deepEqual(Tactical.pathTo(map,[a,c],a,2,0),[]);
});
test('snow-only downhill extends reach through real terrain descent, not uphill',()=>{
 const map={tiles:[tile(0,0,3,{snowDepth:1}),tile(1,0,2,{snowDepth:1}),tile(2,0,1,{snowDepth:1}),tile(3,0,0,{snowDepth:1})]};
 const c=colin(0);c.character.combat.move=1;
 assert.equal(Tactical.reachable(map,[c],c).has('3,0'),true);
 c.x=3;assert.equal(Tactical.reachable(map,[c],c).has('0,0'),false);
});
test('deep water uses the actual hydrology surface and a non-submerged boat layer',()=>{
 const c=colin();const water=tile(1,0,0,{waterDepth:3});c.x=1;
 assert.equal(Shield.modeAt(c,water),'BOAT');
 assert.equal(Vertical.describe(c,water).mode,'SHIELD_BOAT');
 assert.equal(Vertical.describe(c,water).physicalZ,3);
 assert.equal(Vertical.describe(c,water).layer,'WATER_SURFACE');
 assert.equal(Shield.modeAt(c,tile(1,0,0,{waterDepth:1})),null);
});
test('ice skating uses existing ice predicate rather than any snow',()=>{
 const c=colin();assert.equal(Shield.modeAt(c,tile(1,0,0,{iceThickness:1})),'ICE_SLED');
 assert.equal(Shield.modeAt(c,tile(1,0,0,{snowDepth:1})),null);
});
test('boarding one light-armor ally ties positions, blocks independent movement and preserves turn state',()=>{
 const map={tiles:[tile(0,0),tile(1,0),tile(2,0)]},c=colin(),a=ally(),units=[c,a];
 assert.equal(Shield.board(map,units,c,a),true);
 assert.equal(Shield.board(map,units,c,ally(2,0)),false);
 assert.equal(a.shieldRidingOn,'c');assert.equal(a.occupiesTile,false);
 assert.equal(Tactical.reachable(map,units,a).size,0);
 c.x=2;Shield.syncPassenger(units,c,{movement:true});
 assert.deepEqual([a.x,a.y],[2,0]);assert.equal(a.moved,true);
 assert.equal(Shield.dismount(map,units,c,1,0),true);
 assert.equal(a.shieldRidingOn,undefined);assert.equal(a.occupiesTile,true);
 assert.equal(a.moved,true);
});
test('medium armor and hostile units cannot board',()=>{
 const map={tiles:[tile(0,0),tile(1,0)]},c=colin(),medium=ally(0,0,'P','chainmail'),enemy=ally(0,0,'E');
 assert.equal(Shield.canBoard(map,[c,medium],c,medium),false);
 assert.equal(Shield.canBoard(map,[c,enemy],c,enemy),false);
});
test('any shield occupied by vehicle mode cannot be offered as a stair',()=>{
 const map=world(),c=colin(),a=ally();c.shieldMobilityMode='BOAT';
 assert.equal(Tactical.reachable(map,[a,c],a).has('2,0'),false);
});

test('H1 assistance is a single extra height for mountain walkers as well',()=>{
 const map=world(),c=colin(),a=ally();a.character.terrainTraits=['MOUNTAIN_WALK'];
 map.tiles.find(t=>t.x===2).elevation=3;
 assert.equal(Tactical.pathTo(map,[a,c],a,2,0).length,1);
 map.tiles.find(t=>t.x===2).elevation=4;
 assert.equal(Tactical.pathTo(map,[a,c],a,2,0).length,0);
});

test('cancel move returns both shield carrier and rider, restores their action flags',async()=>{
 await import('../../js/tactical-action-controller.js');
 const map={tiles:[tile(0,0),tile(1,0),tile(2,0)]},c=colin(),a=ally(),units=[c,a];
 assert.equal(Shield.board(map,units,c,a),true);
 const origin={unitId:'c',x:1,y:0,z:0,facing:'E',passengerId:a.id,
   passengerMoved:a.moved,passengerRideMoved:a.shieldRideMoved};
 c.x=2;c.moved=true;Shield.syncPassenger(units,c,{movement:true});
 assert.equal(a.moved,true);
 assert.equal(globalThis.TacticalActionController.restorePendingMove(c,origin,{units,map}),true);
 assert.equal(c.x,1);assert.equal(a.x,1);
 assert.equal(c.moved,false);assert.equal(a.moved,false);
 assert.equal(a.shieldRideMoved,false);
 assert.equal(a.shieldRidingOn,'c');
});

test('rider stays above water and has the same boat state as carrier',()=>{
 // Use the actual hydrology surface/boarding from the legal dry bank.
 const map={tiles:[tile(0,0),tile(1,0)]};
 const c=colin(),a=ally(),units=[c,a];
 assert.equal(Shield.board(map,units,c,a),true);
 const water=tile(1,0,0,{waterDepth:3});c.shieldMobilityMode='BOAT';
 Shield.syncPassenger(units,c,{movement:true});
 assert.equal(a.shieldRideSurfaceMode,'BOAT');
 assert.equal(Vertical.describe(a,water).mode,'SHIELD_BOAT');
 assert.equal(Vertical.ignoresWaterInteraction(a),true);
});

test('boat can launch from a bank, cross deep water and return to the bank',()=>{
 const map={tiles:[tile(0,0),tile(1,0,0,{waterDepth:3}),tile(2,0,0,{waterDepth:3})]};
 const c=colin(0),units=[c];
 assert.equal(Tactical.reachable(map,units,c).has('1,0'),true);
 assert.equal(Tactical.reachable(map,units,c).has('2,0'),true);
 c.x=1;c.shieldMobilityMode='BOAT';
 assert.equal(Tactical.reachable(map,units,c).has('0,0'),true);
});

test('real native shield guard cannot be used when the shield is a boat or sled',async()=>{
 const {BattleResolution}=await import('../../js/battle-resolution.js');
 globalThis.EquipmentDatabase.defenseProfiles=()=>[{id:'colin_full_body_guard',method:'GUARD',canGuardAlly:true}];
 const c=colin();
 assert.equal(BattleResolution.guardProfiles(c).length,1);
 c.shieldMobilityMode='BOAT';
 assert.equal(BattleResolution.guardProfiles(c).length,0);
 c.shieldMobilityMode='SNOW_SLED';
 assert.equal(BattleResolution.guardProfiles(c).length,0);
 c.shieldMobilityMode=null;
 assert.equal(BattleResolution.guardProfiles(c).length,1);
});
