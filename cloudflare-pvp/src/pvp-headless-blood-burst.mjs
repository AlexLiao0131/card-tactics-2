/**
 * Authority command wrapper for the original bloodBurst skill rule.
 * No PvP-only damage, bleeding, blood resource, AoE or hit formula exists here.
 * The shared TacticalActionController -> EffectEngine -> BattleEngine owns them.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');

// Skill metadata drives capabilities. There is no hardcoded character/skill ID list.
export function canonicalBloodBurstSkills(unit,engine,units,world=null){
  if(!unit?.alive||unit.acted||unit.waited)return [];
  const ids=engine.effect.skillIds(unit);
  return SkillDatabase.list(ids).filter(skill=>skill.bloodBurst===true&&
    skill.target==='SELF'&&skill.category==='SPECIAL'&&
    !!skill.weapon&&!!skill.attackType&&Number(skill.power)>0&&
    !skill.effects?.length&&!skill.relationEffects?.length&&
    engine.effect.bloodBurstCenters(unit,units,skill,world).length>0&&
    engine.unitRuntime.canUseSkill(unit,skill,world));
}

export function castCanonicalBloodBurst(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId'])||action.type!=='CAST_BLOOD_BURST'||
     typeof action.unitId!=='string'||!action.unitId||
     typeof action.skillId!=='string'||!action.skillId)
    fail('INVALID_BLOOD_BURST_COMMAND');
  const caster=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  if(!caster||caster.acted||caster.waited)fail('BLOOD_BURST_ACTOR_UNAVAILABLE');
  const world={map:game.battlefield.map,environmentState:game.environmentState};
  const skill=canonicalBloodBurstSkills(caster,engine,game.units,world)
    .find(s=>s.id===action.skillId);
  if(!skill)fail('BLOOD_BURST_SKILL_UNAVAILABLE');
  if(!TacticalEngine.canTarget(game.battlefield.map,caster,caster,skill,game.environmentState))
    fail('ILLEGAL_BLOOD_BURST_TARGET');
  const before={mana:caster.mana,affected:game.units.filter(u=>u.team!==caster.team)
    .map(u=>({id:u.id,hp:u.hp}))};
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s,world),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s,world),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    handleDefeated:hooks.handleDefeated,
    checkMatchEnd:checkMatchEnd||(()=>false),
    maybeAutoEndPlayerTurn:()=>false,
    clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setMode:()=>{},render:()=>{},pushLog:hooks.pushLog,
    random:engine.random
  });
  if(controller.executeEffectSkill(caster,caster,skill)!==true)
    fail('OFFICIAL_BLOOD_BURST_REJECTED');
  return {accepted:true,state:game,unitId:caster.id,skillId:skill.id,
    manaBefore:before.mana,manaAfter:caster.mana,
    affected:before.affected.map(old=>({id:old.id,hpBefore:old.hp,
      hpAfter:game.units.find(u=>u.id===old.id)?.hp??0}))};
}
