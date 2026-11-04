/** PvP seat/command adapter for the canonical browser+server area-field engine. */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {createBattleAreaFieldEngine,createBattleAreaFieldState} from '../../js/battle-area-field-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const TEAM=['P','E'],PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');

export function createCanonicalAreaFields(game,engine,hooks){
  game.fieldState??=createBattleAreaFieldState();
  return createBattleAreaFieldEngine({state:game.fieldState,map:()=>game.battlefield.map,
    units:()=>game.units,round:()=>game.round,effect:()=>engine.effect,
    pushLog:hooks.pushLog,handleDefeated:hooks.handleDefeated});
}

/** Capability is declared by SkillDatabase, never by a hard-coded skill ID. */
export function isCanonicalAreaFieldSkill(skill){
  if(!skill||!['SPECIAL','MAGIC'].includes(skill.category)||skill.target!=='SELF'||
     (skill.targetType&&skill.targetType!=='SINGLE')||
     !Number.isFinite(Number(skill.radius))||Number(skill.radius)<0||
     Number(skill.power||0)!==0||skill.weapon||skill.attackType||
     skill.effects?.length||skill.relationEffects?.length||skill.postEffects?.length||
     skill.afterUseEffects?.length||skill.utilityAction||skill.channel||
     skill.bloodBurst||skill.bloodShadow||skill.moveToTarget||skill.approach||
     skill.trapPlacement||skill.terrainTargeting||skill.hydrologyFlood||skill.waterContact||
     skill.highDimensional||skill.variants?.length||skill.affixes?.length)
    return false;
  const sanctuary=skill.sanctuary,smoke=skill.smokeField;
  if(!!sanctuary===!!smoke)return false;
  if(sanctuary)return Number.isInteger(sanctuary.duration)&&sanctuary.duration>=1&&
    Number.isFinite(Number(sanctuary.healing?.amount))&&
    Number.isFinite(Number(sanctuary.punishment?.amount))&&
    typeof sanctuary.punishment?.element==='string';
  return Number.isInteger(smoke.duration)&&smoke.duration>=1;
}

export function canonicalAreaFieldSkillOptions(unit,engine){
  if(!unit?.alive)return [];
  return SkillDatabase.list(engine.effect.skillIds(unit)).filter(isCanonicalAreaFieldSkill);
}

export function castCanonicalAreaField(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId'])||action.type!=='CAST_AREA_FIELD'||
     typeof action.unitId!=='string'||!action.unitId||
     typeof action.skillId!=='string'||!action.skillId)fail('INVALID_AREA_FIELD_COMMAND');
  const actor=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  if(!actor||actor.acted||actor.waited)fail('FIELD_ACTOR_UNAVAILABLE');
  const skill=canonicalAreaFieldSkillOptions(actor,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('CANONICAL_FIELD_SKILL_UNAVAILABLE');
  if(!TacticalEngine.canTarget(game.battlefield.map,actor,actor,skill,game.environmentState))
    fail('ILLEGAL_AREA_FIELD_TARGET');
  if(!engine.unitRuntime.canUseSkill(actor,skill))fail('FIELD_RESOURCES_UNAVAILABLE');
  const area=createCanonicalAreaFields(game,engine,hooks);
  if(!area.sanctuaryTiles(actor,skill.radius).length)fail('FIELD_BLOCKED');
  const before={mana:actor.mana,faith:engine.unitRuntime.faithValue(actor)};
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    sanctuaryTiles:area.sanctuaryTiles,activateSanctuary:area.activateSanctuary,
    activateSmoke:area.activateSmoke,
    handleDefeated:hooks.handleDefeated,
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setMode:()=>{},render:()=>{},pushLog:hooks.pushLog
  });
  if(controller.prepareAttack(actor,actor,skill)!==true)
    fail('OFFICIAL_AREA_FIELD_REJECTED');
  return {accepted:true,state:game,unitId:actor.id,skillId:skill.id,
    manaBefore:before.mana,manaAfter:actor.mana,
    faithBefore:before.faith,faithAfter:engine.unitRuntime.faithValue(actor)};
}
