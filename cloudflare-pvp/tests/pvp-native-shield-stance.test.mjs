import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillDatabase} from '../../js/skill-database.js';
import {createOpeningGame,openingGameCore} from '../src/pvp-match-core.mjs';
import {beginCanonicalPlayerCardPhase,resolveCanonicalPlayerCommand,tacticalDebugProjection} from '../src/pvp-headless-tactical.mjs';
import {isCanonicalDirectEffectSkill} from '../src/pvp-headless-effect-skills.mjs';
import {withCanonicalEngines} from '../src/pvp-engine-context.mjs';

function game(){
 const deck=Array(20).fill('imperial_archer_card');
 const g=createOpeningGame({decks:[deck,deck],serverSeed:34117});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:0});
 openingGameCore.reduce(g,{type:'KEEP_OPENING_HAND'},{seat:1});
 beginCanonicalPlayerCardPhase(g);resolveCanonicalPlayerCommand(g,{type:'END_CARD_PHASE'},0);
 return g;
}
function spawn(g,id,characterId,team){
 return withCanonicalEngines(g,e=>{
  const tile=g.battlefield.map.tiles.find(t=>globalThis.TERRAINS[t.terrain]?.passable&&t.terrain!=='WATER');
  const original=e.unitRuntime.create({id,team,characterId,x:tile.x,y:tile.y,map:g.battlefield.map});
  assert.ok(original);const {_runtimeMap,...u}=original;
  u.acted=false;u.moved=false;u.waited=false;g.units.push(u);return u;
 });
}
test('a full shield stance uses canonical BUFF collision + battle defense profiles',()=>{
 const skill=SkillDatabase.get('colin_full_shield_defense');
 assert.equal(isCanonicalDirectEffectSkill(skill),true);
 assert.equal(isCanonicalDirectEffectSkill({...skill,effects:[{type:'BUFF',id:'DECOY',duration:1}]}),false);
 const g=game(),colin=spawn(g,'shield','colin','P'),enemy=spawn(g,'enemy','imperial_swordsman','E');
 const before=withCanonicalEngines(g,e=>e.battleResolution.prepareSingleTargetReaction({defender:colin,attacker:enemy,
  canUseSkill:(u,s)=>e.unitRuntime.canUseSkill(u,s)}).defenseMethods.map(m=>m.id));
 assert.equal(before.includes('full_shield_stance_guard'),false);
 const menu=tacticalDebugProjection(g,0).units.find(u=>u.id===colin.id);
 assert.ok(menu.effectSkills.some(s=>s.id===skill.id&&s.target==='SELF'));
 assert.equal(tacticalDebugProjection(g,1).units.find(u=>u.id===colin.id)?.effectSkills,undefined);
 const result=resolveCanonicalPlayerCommand(g,{type:'CAST_EFFECT_SKILL',unitId:colin.id,targetId:colin.id,skillId:skill.id},0);
 assert.equal(result.accepted,true);
 assert.deepEqual([colin.acted,colin.moved,colin.waited],[true,true,true]);
 const effect=colin.effects.find(e=>e.id==='FULL_SHIELD_DEFENSE');
 assert.ok(effect?.collision?.solid);
 assert.equal(effect.defenseProfiles?.[0].id,'full_shield_stance_guard');
 const after=withCanonicalEngines(g,e=>e.battleResolution.prepareSingleTargetReaction({defender:colin,attacker:enemy,
  canUseSkill:(u,s)=>e.unitRuntime.canUseSkill(u,s)}).defenseMethods.map(m=>m.id));
 assert.equal(after.includes('full_shield_stance_guard'),true);
 assert.doesNotThrow(()=>structuredClone(g));
});
