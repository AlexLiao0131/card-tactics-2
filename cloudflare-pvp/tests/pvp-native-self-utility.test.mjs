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

test('native self utility predicates admit original stealth/vertical choice metadata and reject unrelated action',()=>{
 for(const id of ['cat_hide','aquatic_depth_control','angel_wing_control'])
   assert.equal(isCanonicalSelfUtilitySkill(SkillDatabase.get(id)),true,id);
 for(const id of ['cat_pickpocket','angel_release_ally','templar_charge','colin_full_shield_defense'])
   assert.equal(isCanonicalSelfUtilitySkill(SkillDatabase.get(id)),false,id);
 assert.equal(isCanonicalSelfUtilitySkill({...SkillDatabase.get('cat_hide'),postEffects:[{type:'KNOCKBACK',distance:2}]}),false);
 assert.equal(isCanonicalSelfUtilitySkill({...SkillDatabase.get('cat_hide'),utilityAction:{type:'GIVE_GOLD',consumeTurn:true}}),false);
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

test('angel flight variant uses original controller, stays free, and never accepts forged mode/options',()=>{
 const g=game(),angel=spawn(g,'angel','angel_archer_hero');
 const opts=tacticalDebugProjection(g,0).units.find(u=>u.id===angel.id).selfUtilitySkills;
 assert.ok(opts.some(s=>s.id==='angel_wing_control'&&s.variantId==='ANGEL_LAND'));
 const before=angel.verticalState?.requestedMode;
 const change=before==='FLYING'?'ANGEL_LAND':'ANGEL_TAKEOFF';
 const switched=cast(g,angel.id,'angel_wing_control',change);
 assert.equal(switched.accepted,true);
 assert.equal(angel.verticalState.requestedMode,change==='ANGEL_LAND'?'GROUND':'FLYING');
 assert.equal(angel.acted,false);
 assert.equal('_runtimeMap' in angel,false);
 assert.doesNotThrow(()=>structuredClone(g));
 assert.throws(()=>cast(g,angel.id,'angel_wing_control','FAKE_FLY'),{code:'INVALID_SKILL_VARIANT'});
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_SELF_UTILITY',unitId:angel.id,skillId:'angel_wing_control',variantId:'ANGEL_TAKEOFF',mode:'BURROWED'},0),{code:'INVALID_SELF_UTILITY_COMMAND'});
 assert.throws(()=>cast(g,angel.id,'angel_wing_control',null),{code:'SELF_UTILITY_VARIANT_REQUIRED'});
});

test('aquatic depth variants require an actual wet tile: client cannot fake water or choose raw movement mode',()=>{
 const g=game(),nereia=spawn(g,'nereia','nereia');
 assert.throws(()=>cast(g,nereia.id,'aquatic_depth_control','AQUATIC_DIVE'),
   {code:'SELF_UTILITY_REQUIREMENTS_UNAVAILABLE'});
 assert.equal(nereia.acted,false);
 assert.equal('_runtimeMap' in nereia,false);
 assert.throws(()=>resolveCanonicalPlayerCommand(g,{type:'CAST_SELF_UTILITY',unitId:nereia.id,skillId:'aquatic_depth_control',variantId:'AQUATIC_DIVE',depth:999},0),
   {code:'INVALID_SELF_UTILITY_COMMAND'});
});

test('opponent cannot use another seat self utility, or cast unearned skills',()=>{
 const g=game(),cat=spawn(g,'cat','cat_thief_hero');
 assert.throws(()=>cast(g,cat.id,'cat_hide',null,1),{code:'NOT_YOUR_TURN'});
 assert.throws(()=>cast(g,cat.id,'angel_wing_control','ANGEL_LAND'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
 assert.throws(()=>cast(g,cat.id,'cat_pickpocket'),{code:'FULL_SKILL_ORCHESTRATION_REQUIRED'});
});

test('aquatic depth control follows the real hydrology tile depth and original mode transitions',()=>{
 const g=game(),nereia=spawn(g,'nereia','nereia');
 const tile=g.battlefield.map.tiles.find(t=>t.x===nereia.x&&t.y===nereia.y);
 tile.waterDepth=Math.max(6,Number(nereia.character.collision?.height||2)+2);
 const diveOption=tacticalDebugProjection(g,0).units.find(u=>u.id===nereia.id)
   .selfUtilitySkills.find(s=>s.id==='aquatic_depth_control'&&s.variantId==='AQUATIC_DIVE');
 assert.ok(diveOption?.usable,'the actual current map water enables the original dive requirement');
 const dive=cast(g,nereia.id,'aquatic_depth_control','AQUATIC_DIVE');
 assert.equal(dive.accepted,true);
 assert.equal(nereia.verticalState.mode,'DIVING');
 assert.equal(nereia.acted,false);
 const surface=cast(g,nereia.id,'aquatic_depth_control','AQUATIC_SURFACE');
 assert.equal(surface.accepted,true);
 assert.equal(nereia.verticalState.mode,'SWIMMING');
 assert.equal(nereia.acted,false);
 assert.equal('_runtimeMap' in nereia,false);
 assert.doesNotThrow(()=>structuredClone(g));
});
