import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalSelfUtilitySkill} from '../src/pvp-headless-self-utility.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';

function game(){
 const deck=Array(20).fill('imperial_archer_card');
 const g=createOpeningGame({decks:[deck,deck],serverSeed:18371});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1});
 beginCanonicalPlayerCardPhase(g);
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function spawn(g,id,characterId,team='P'){
 return withCanonicalEngines(g,engine=>{
   const tile=g.battlefield.map.tiles.find(t=>globalThis.TERRAINS[t.terrain]?.passable&&t.terrain!=='WATER');
   const unit=engine.unitRuntime.create({id,team,characterId,x:tile.x,y:tile.y,map:g.battlefield.map,cores:g.battlefield.cores});
   assert.ok(unit,characterId);
   const {_runtimeMap,...persist}=unit;
   persist.acted=false;persist.waited=false;persist.moved=false;
   g.units.push(persist);
   return persist;
 });
}
const cast=(g,unitId,skillId,variantId=null,seat=0)=>
 resolveCanonicalPlayerCommand(g,{type:'CAST_SELF_UTILITY',unitId,skillId,variantId},seat);

test('obsolete flight/dive skill entries are removed from canonical data',()=>{
  assert.equal(isCanonicalSelfUtilitySkill(SkillDatabase.get('cat_hide')),true);
  for(const id of ['aquatic_depth_control','angel_wing_control'])assert.throws(()=>SkillDatabase.get(id),/Unknown skill:/,id);
  for(const id of ['cat_pickpocket','angel_release_ally','templar_charge','colin_full_shield_defense'])
    assert.equal(isCanonicalSelfUtilitySkill(SkillDatabase.get(id)),false,id);
  assert.equal(isCanonicalSelfUtilitySkill({...SkillDatabase.get('cat_hide'),postEffects:[{type:'KNOCKBACK',distance:2}]}),false);
});

test('actual cat stealth commits original EffectEngine effect, consumes action and stays room-serializable',()=>{
 const g=game(),cat=spawn(g,'cat','cat_thief_hero');
 const visible=tacticalDebugProjection(g,0).units.find(u=>u.id===cat.id);
 assert.ok(visible.selfUtilitySkills.some(s=>s.id==='cat_hide'&&s.usable));
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id===cat.id)?.selfUtilitySkills,undefined);
 const result=cast(g,cat.id,'cat_hide');
 assert.ok(result.accepted);
 assert.equal(result.stealthed,true);
 assert.ok(cat.effects.some(e=>e.type==='STEALTH'));
 assert.deepEqual([cat.acted,cat.moved,cat.waited],[true,true,true]);
 assert.doesNotThrow(()=>structuredClone(g));
 assert.equal('_runtimeMap' in cat,false);
 assert.throws(()=>cast(g,cat.id,'cat_hide'),{code:'SELF_UTILITY_ACTOR_UNAVAILABLE'});
});

test('angel retains native height control but no wing-control skill',()=>{
  const g=game(),angel=spawn(g,'angel','angel_archer_hero');
  const shown=tacticalDebugProjection(g,0).units.find(u=>u.id===angel.id);
  assert.ok(shown.flightControl);
  assert.equal(shown.selfUtilitySkills.some(s=>s.id==='angel_wing_control'),false);
  const before=angel.verticalState.flightAltitude;
  const raised=resolveCanonicalPlayerCommand(g,{type:'ADJUST_FLIGHT_ALTITUDE',unitId:angel.id,steps:1},0);
  assert.equal(raised.accepted,true);
  assert.ok(angel.verticalState.flightAltitude>before);
  assert.equal(angel.acted,false);
  assert.throws(()=>cast(g,angel.id,'angel_wing_control','ANGEL_LAND'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
  assert.doesNotThrow(()=>structuredClone(g));
});

test('dry ground rejects native diving and any client-forged depth',()=>{
  const g=game(),nereia=spawn(g,'nereia','nereia');
  const shown=tacticalDebugProjection(g,0).units.find(u=>u.id===nereia.id);
  assert.equal(shown.diveControl,null);
  assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'ADJUST_DIVE_MODE',unitId:nereia.id,steps:-1},0),{code:'DIVE_CONTROL_UNAVAILABLE'});
  assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'ADJUST_DIVE_MODE',unitId:nereia.id,steps:-1,depth:999},0),{code:'INVALID_UNIT_CONTROL_COMMAND'});
  assert.equal(nereia.acted,false);
});

test('opponent cannot use another seat self utility, or cast unearned skills',()=>{
  const g=game(),cat=spawn(g,'cat','cat_thief_hero');
  assert.throws(()=>cast(g,cat.id,'cat_hide',null,1),{code:'NOT_YOUR_TURN'});
  assert.throws(()=>cast(g,cat.id,'angel_wing_control','ANGEL_LAND'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
  assert.throws(()=>cast(g,cat.id,'cat_pickpocket'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
});

test('deep-water native dive and surface use original vertical engine without spending action',()=>{
  const g=game(),nereia=spawn(g,'nereia','nereia');
  const tile=g.battlefield.map.tiles.find(t=>t.x===nereia.x&&t.y===nereia.y);
  tile.waterDepth=Math.max(6,Number(nereia.character.collision?.height||2)+2);
  const control=tacticalDebugProjection(g,0).units.find(u=>u.id===nereia.id).diveControl;
  assert.ok(control?.canDive);
  const dive=resolveCanonicalPlayerCommand(g,{type:'ADJUST_DIVE_MODE',unitId:nereia.id,steps:-1},0);
  assert.equal(dive.accepted,true);
  assert.equal(nereia.verticalState.mode,'DIVING');
  assert.equal(nereia.acted,false);
  assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'ADJUST_DIVE_MODE',unitId:nereia.id,steps:-1},0),{code:'DIVE_MODE_UNAVAILABLE'});
  const surface=resolveCanonicalPlayerCommand(g,{type:'ADJUST_DIVE_MODE',unitId:nereia.id,steps:1},0);
  assert.equal(surface.accepted,true);
  assert.equal(nereia.verticalState.mode,'SWIMMING');
  assert.equal(nereia.acted,false);
  assert.equal('_runtimeMap' in nereia,false);
  assert.doesNotThrow(()=>structuredClone(g));
});
