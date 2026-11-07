import "../../js/tactical-action-controller.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCanonicalWorld} from '../src/pvp-canonical-setup.mjs';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {SkillDatabase} from '../../js/skill-database.js';
import {EnvironmentEngine} from '../../js/environment-engine.js';
import {EffectEngine} from '../../js/effect-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {HydrologyEngine} from '../../js/hydrology-engine.js';
import {WaterInteractionEngine} from '../../js/battle-environment-controller.js';
import {createCanonicalEnvironmentController} from '../src/pvp-environment-controller.mjs';
import {readFileSync} from 'node:fs';

test('humidity HUD has dedicated sea-blue color distinct from MP and cache-busted CSS entry',()=>{
 const css=readFileSync(new URL('../../css/unit-hud.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
 const mp=css.match(/\.unit-hud-mana-fill\{background:(#[\da-fA-F]{6})\}/);
 const humidity=css.match(/\.unit-hud-resource\[data-resource="humidity"\] \.unit-hud-fill\{background:(#[\da-fA-F]{6})\}/);
 assert.ok(mp,'MP bar uses its official color');
 assert.equal(humidity?.[1]?.toLowerCase(),'#14b8e6');
 assert.notEqual(humidity[1].toLowerCase(),mp[1].toLowerCase());
 assert.match(html,/\.\/css\/unit-hud\.css\?v=20261107-humidity-seablue/);
});

const deck=Array(20).fill('imperial_swordsman_card');
const create=()=>initializeCanonicalWorld({seed:1234,mapSize:'SMALL',decks:[deck,deck]});
const unit=(world,id,team,characterId,x,y)=>UnitRuntimeEngine.create({id,team,characterId,loadoutId:characterId==='nereia'?'nereia_default':null,x,y,map:world.battlefield.map});
const waterTile=(world,x,y,depth=3)=>{const tile=TacticalEngine.tile(world.battlefield.map,x,y);assert.ok(tile);tile.waterDepth=depth;tile.terrain='WATER';tile.waterSurfaceZ=tile.elevation+depth;return tile};

test('queen: exact agreed new skills + 100 blue resource shape',()=>{
 const world=create();const queen=unit(world,'queen','P','nereia',3,3);
 assert.equal(queen.resources.humidity.value,100);
 assert.equal(queen.resources.humidity.max,100);
 assert.equal(queen.resources.humidity.label,'濕度');
 assert.equal(queen.character.combat.mdef,125);
 assert.equal(SkillDatabase.get('nereia_trident_throw').power,.8);
 assert.deepEqual(SkillDatabase.get('nereia_trident_throw').range,{min:2,max:4});
 assert.equal(SkillDatabase.get('nereia_trident_throw').manaCost,undefined);
 assert.equal(SkillDatabase.get('nereia_whirlpool').manaCost,20);
 assert.equal(SkillDatabase.get('nereia_tsunami').manaCost,28);
 assert.equal(SkillDatabase.get('nereia_tsunami').tsunamiWave.width,5);
 assert.equal(UnitRuntimeEngine.skillManaCost(queen,SkillDatabase.get('nereia_water_bullet')),9);
 assert.equal(UnitRuntimeEngine.skillManaCost(queen,SkillDatabase.get('nereia_tsunami')),20);
});

test('real magic HP loss only spends 10% humidity with 15 maximum',()=>{
 const world=create();const q=unit(world,'queen','P','nereia',3,3);
 EffectEngine.applyDamage(q,50,{damageType:'MAGIC'});
 assert.equal(q.resources.humidity.value,95);
 EffectEngine.applyDamage(q,20,{damageType:'PHYSICAL'});
 assert.equal(q.resources.humidity.value,95);
 EffectEngine.applyDamage(q,200,{damageType:'MAGIC'});
 assert.equal(q.resources.humidity.value,80);
 const s=EffectEngine.apply({source:q,target:q,effect:{type:'SHIELD',id:'W_TEST',name:'水盾',amount:100,duration:2}});
 assert.equal(s.applied,true);
 EffectEngine.applyDamage(q,60,{damageType:'MAGIC'});
 assert.equal(q.resources.humidity.value,80);
});

test('rain + deep water recovery accumulates once when invoked, capped at 100',()=>{
 const world=create();const q=unit(world,'queen','P','nereia',3,3);
 UnitRuntimeEngine.changeHumidity(q,-30);
 const tile=waterTile(world,3,3,3);
 const delta=UnitRuntimeEngine.advanceHumidity(q,tile,{weather:'HEAVY_RAIN'});
 assert.equal(delta,20);
 assert.equal(q.resources.humidity.value,90);
 UnitRuntimeEngine.advanceHumidity(q,tile,{weather:'HEAVY_RAIN'});
 assert.equal(q.resources.humidity.value,100);
});

test('diving hides against surface enemy lock and permits underwater observer',()=>{
 const world=create();const queen=unit(world,'queen','P','nereia',3,3),foe=unit(world,'foe','E','imperial_swordsman',4,3);
 const tile=waterTile(world,3,3,3);
 assert.equal(globalThis.VerticalMobilityEngine.setMode(queen,tile,'DIVING').ok,true);
 assert.equal(TacticalEngine.canSee(world.battlefield.map,foe,queen,world.environmentState),false);
 assert.equal(TacticalEngine.canTarget(world.battlefield.map,foe,queen,SkillDatabase.get('nereia_trident_thrust'),world.environmentState),false);
});

test('submerge is not instant drowning HP damage; water tick applies drowning',()=>{
 const world=create();const foe=unit(world,'foe','E','imperial_swordsman',4,3),tile=waterTile(world,4,3,3);
 const res=WaterInteractionEngine.forceSubmerge(foe,tile,{turns:1,impactDamage:0});
 assert.equal(res.applied,true);
 assert.equal(res.damage,0);
 assert.equal(foe.waterInteraction.state,'SINKING');
 const tick=WaterInteractionEngine.resolve(foe,tile,{trigger:'TICK'});
 assert.ok(tick.damage>0);
});

test('tsunami front follows actual map & filters non-passable/high terrain',()=>{
 const tiles=[];for(let y=0;y<9;y++)for(let x=0;x<9;x++)tiles.push({x,y,elevation:0,terrain:'PLAIN',waterDepth:0});
 const map={tiles,width:9,height:9,objects:[]};
 const forward=EnvironmentEngine.planTsunami(map,{x:4,y:2},{x:4,y:5},{width:5,surfaceRise:1.25});
 assert.equal(forward.fronts.length,3);
 assert.equal(forward.fronts[0].length,5);
 map.tiles.find(t=>t.x===4&&t.y===3).elevation=5;
 const blocked=EnvironmentEngine.planTsunami(map,{x:4,y:2},{x:4,y:5},{width:5,surfaceRise:1.25});
 assert.ok(blocked.cells.length<forward.cells.length);
 assert.ok(!blocked.cells.some(t=>t.x===4&&t.y===5));
});

test('only enemy is eligible for queen-authored vortex metadata',()=>{
 const world=create();for(let y=2;y<=6;y++)for(let x=2;x<=6;x++)waterTile(world,x,y,3);
 const events=EnvironmentEngine.createWhirlpool(world.environmentState,world.battlefield.map,4,4,{sourceTeam:'P',sourceUnitId:'queen',onlyEnemies:true,duration:2,radius:2,damage:0});
 const pulse=events.find(e=>e.type==='WHIRLPOOL_PULSE');
 assert.equal(pulse.sourceTeam,'P');
 assert.equal(pulse.onlyEnemies,true);
 assert.equal(pulse.radius,2);
});

// Real PVP map commands are routed through the same player action controller.
const pvpCmd=async()=>import('../src/pvp-headless-map-skills.mjs');
const gameWithQueen=()=>{
 const game=create();game.phase='PLAYER_TACTICAL_PHASE';game.activeSeat=0;game.units=[];game.round=1;
 const queen=unit(game,'queen','P','nereia',3,3),ally=unit(game,'ally','P','imperial_swordsman',5,4),enemy=unit(game,'enemy','E','imperial_swordsman',5,3);
 game.units.push(queen,ally,enemy);
 return {game,queen,ally,enemy};
};
const hooks=()=>({pushLog:()=>{},stageEvent:()=>{},handleDefeated:()=>{},damageUnitFlat:()=>{},random:()=>.5});
const engine={unitRuntime:UnitRuntimeEngine,effect:EffectEngine,random:()=>.5};
test('PVP official map command casts queen vortex only on enemies',async()=>{
 const {isCanonicalImmediateMapSkill,castCanonicalMapSkill}=await pvpCmd();
 assert.equal(isCanonicalImmediateMapSkill(SkillDatabase.get('nereia_whirlpool')),true);
 const {game,queen,ally,enemy}=gameWithQueen();
 for(let y=2;y<=5;y++)for(let x=3;x<=6;x++)waterTile(game,x,y,3);
 const res=castCanonicalMapSkill(game,{type:'CAST_MAP_SKILL',unitId:'queen',skillId:'nereia_whirlpool',x:5,y:3},0,engine,hooks(),()=>false);
 assert.equal(res.accepted,true);
 assert.equal(queen.acted,true);
 assert.ok(queen.mana<queen.maxMana);
 assert.equal(EffectEngine.hasEffect(ally,'WHIRLPOOL_TRAPPED'),false);
 assert.ok(game.environmentState.effects instanceof Map);
 const author=[...game.environmentState.effects.values()].flat().find(x=>x.type==='WHIRLPOOL');
 assert.equal(author?.sourceTeam,'P');
 assert.equal(author?.onlyEnemies,true);
});

test('PVP official directional tsunami creates ally shield and real hydrology change',async()=>{
 const {castCanonicalMapSkill}=await pvpCmd();
 const {game,queen,ally,enemy}=gameWithQueen();
 const before=game.battlefield.map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0);
 const res=castCanonicalMapSkill(game,{type:'CAST_MAP_SKILL',unitId:'queen',skillId:'nereia_tsunami',x:6,y:3},0,engine,hooks(),()=>false);
 assert.equal(res.accepted,true);
 const waterShield=EffectEngine.state(ally).find(x=>x.id==='NEREIA_TSUNAMI_WATER_SHIELD');
 assert.equal(waterShield?.shieldHp,queen.character.combat.matk);
 assert.equal(waterShield?.duration,2);
 assert.ok(game.battlefield.map.tiles.reduce((s,t)=>s+Number(t.waterDepth||0),0)>=before);
 assert.equal(queen.acted,true);
});

test('PVP official effect command makes adjacent drowning only after submerge',async()=>{
 const drag=SkillDatabase.get('nereia_deep_drag');
 assert.equal(drag.utilityAction.type,'SUBMERGE_ENEMY');
 const {game,queen,enemy}=gameWithQueen();
 enemy.x=4;enemy.y=3;
 const queenWater=waterTile(game,3,3,3),enemyWater=waterTile(game,4,3,3);
 assert.equal(globalThis.VerticalMobilityEngine.setMode(queen,queenWater,'DIVING').ok,true);
 globalThis.VerticalMobilityEngine.syncUnit(enemy,enemyWater);
 const hp=enemy.hp;
 const controller=globalThis.TacticalActionController.create({actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),TEAM:{PLAYER:'P',ENEMY:'E'},canUseSkill:(u,sk)=>UnitRuntimeEngine.canUseSkill(u,sk),consumeSkill:(u,sk)=>UnitRuntimeEngine.consumeSkill(u,sk),checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},pushLog:()=>{}});
 const result=controller.executeUtilitySkill(queen,enemy,drag);
 assert.equal(result,true);
 assert.equal(queen.acted,true);
 assert.equal(enemy.hp,hp);
 assert.equal(enemy.waterInteraction.state,'SINKING');
});

test('vortex trapped unit has no active reachable tiles until released',async()=>{
 const {castCanonicalMapSkill}=await pvpCmd();
 const {game,queen,enemy,ally}=gameWithQueen();
 for(let y=2;y<=5;y++)for(let x=3;x<=6;x++)waterTile(game,x,y,3);
 castCanonicalMapSkill(game,{type:'CAST_MAP_SKILL',unitId:'queen',skillId:'nereia_whirlpool',x:5,y:3},0,engine,hooks(),()=>false);
 assert.equal(EffectEngine.hasEffect(enemy,'WHIRLPOOL_TRAPPED'),true);
 assert.equal(TacticalEngine.reachable(game.battlefield.map,game.units,enemy).size,0);
 assert.equal(EffectEngine.hasEffect(ally,'WHIRLPOOL_TRAPPED'),false);
 EffectEngine.removeEffectById(enemy,'WHIRLPOOL_TRAPPED');
 assert.equal(EffectEngine.hasEffect(enemy,'WHIRLPOOL_TRAPPED'),false);
});

test('shoreline drag pulls adjacent land enemy into actual deep water before submerging',()=>{
 const {game,queen,enemy}=gameWithQueen();
 enemy.x=4;enemy.y=3;
 const queenTile=waterTile(game,3,3,3),destination=waterTile(game,4,4,3);
 const shore=TacticalEngine.tile(game.battlefield.map,4,3);shore.waterDepth=0;shore.terrain='PLAIN';shore.waterSurfaceZ=null;destination.elevation=shore.elevation;destination.waterSurfaceZ=destination.elevation+destination.waterDepth;
 assert.equal(globalThis.VerticalMobilityEngine.setMode(queen,queenTile,'DIVING').ok,true);
 const environment=createCanonicalEnvironmentController(game,hooks());
 const controller=globalThis.TacticalActionController.create({actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),TEAM:{PLAYER:'P',ENEMY:'E'},canUseSkill:(u,sk)=>UnitRuntimeEngine.canUseSkill(u,sk),consumeSkill:(u,sk)=>UnitRuntimeEngine.consumeSkill(u,sk),checkMatchEnd:()=>false,maybeAutoEndPlayerTurn:()=>false,applyForcedMovement:environment.applyForcedMovement,setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},pushLog:()=>{}});
 const hp=enemy.hp,ok=controller.executeUtilitySkill(queen,enemy,SkillDatabase.get('nereia_deep_drag'));
 assert.equal(ok,true);
 assert.deepEqual([enemy.x,enemy.y],[destination.x,destination.y]);
 assert.equal(enemy.waterInteraction.state,'SINKING');
 assert.equal(enemy.hp,hp);
});
