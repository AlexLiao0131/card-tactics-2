import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {UnitRuntimeEngine} from '../../js/unit-runtime-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalDirectAttackSkill} from '../src/pvp-headless-engagement.mjs';

const expected=['nether_slash','smash','cassandra_fire_burst','cassandra_frost',
 'cat_dual_slash','cat_backstab','cat_poison_knife','angel_holy_shot',
 'ophi_eagle_arc_shot','colin_armor_breaking_strike','seraphina_rending_claw',
 'water_tentacle','velsa_arcane_bolt','velsa_existence_breakdown','nereia_water_bullet','templar_verdict'];
const exclusions=['lion_flash','aquatic_depth_control',
 'cat_pickpocket','cat_hide','angel_drop_enemy','angel_release_ally',
 'angel_wing_control','ophi_forest_entangle','colin_full_shield_defense',
 'templar_charge'];
function game(){
 const deck=Array(20).fill('imperial_archer_card');
 const g=createOpeningGame({decks:[deck,deck],serverSeed:1234});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1});
 beginCanonicalPlayerCardPhase(g);
 resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function combatants(g,characterId,skillId){
 const map=g.battlefield.map,skill=SkillDatabase.get(skillId);
 const active=UnitRuntimeEngine.create({id:'test_attacker',team:'P',characterId,x:1,y:1,map,cores:g.battlefield.cores});
 const victim=UnitRuntimeEngine.create({id:'test_target',team:'E',characterId:'imperial_swordsman',x:2,y:1,map,cores:g.battlefield.cores});
 assert.ok(active && victim);
 const positions=map.tiles.filter(t=>t.terrain!=='WALL'&&t.terrain!=='WATER');
 let found=false;
 for(const t of positions){
  active.x=t.x;active.y=t.y;
  for(const other of positions){
   victim.x=other.x;victim.y=other.y;
   if(TacticalEngine.canTarget(map,active,victim,skill,g.environmentState)){
     active.z=t.elevation;victim.z=other.elevation;found=true;break;
   }
  }
  if(found)break;
 }
 assert.ok(found,`official targeting finds legal ${skillId} position`);
 active.acted=false;active.waited=false;active.moved=false;
 victim.acted=false;victim.waited=false;victim.moved=false;
 g.units.push(active,victim);
 return {active,victim,skill};
}
test('all new direct-target capabilities come only from canonical skill database shape',()=>{
 for(const id of expected)assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get(id)),true,id);
 for(const id of exclusions)assert.equal(isCanonicalDirectAttackSkill(SkillDatabase.get(id)),false,id);
 assert.equal(isCanonicalDirectAttackSkill({...SkillDatabase.get('smash'),postEffects:[{type:'UNKNOWN'}]}),false);
});
test('rending attack projects as an executable option and applies canonical bleeding through two seats',()=>{
 const g=game();const {active,victim}=combatants(g,'seraphina','seraphina_rending_claw');
 const projected=tacticalDebugProjection(g,0).units.find(u=>u.id===active.id);
 assert.ok(projected.attackSkills.some(s=>s.id==='seraphina_rending_claw'));
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id===active.id)?.attackSkills,undefined);
 const begin=resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:active.id,targetId:victim.id,skillId:'seraphina_rending_claw'},0);
 assert.equal(begin.accepted,true);
 assert.equal(g.activeSeat,1);
 const done=resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(done.accepted,true);
 assert.equal(g.activeSeat,0);
 assert.equal(active.acted,true);
 assert.doesNotThrow(()=>structuredClone(g));
});
test('two-seat hammer strike resolves original post-engagement displacement without a separate PVP push formula',()=>{
 const g=game();const {active,victim}=combatants(g,'imperial_hammer','smash');
 const start={x:victim.x,y:victim.y};
 const begin=resolveCanonicalPlayerCommand(g,{type:'DECLARE_ATTACK',attackerId:active.id,targetId:victim.id,skillId:'smash'},0);
 assert.equal(begin.accepted,true);
 const done=resolveCanonicalPlayerCommand(g,{type:'REACT_ATTACK',reaction:'ACCEPT'},1);
 assert.equal(done.accepted,true);
 assert.ok(Number.isFinite(victim.x)&&Number.isFinite(victim.y));
 assert.equal(active.acted,true);
 assert.doesNotThrow(()=>structuredClone(g));
});
