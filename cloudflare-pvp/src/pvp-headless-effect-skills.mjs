/**
 * Server-owned targetable effect-skill command.
 * This adapter has NO healing, buff, resource or status math. All such rules are
 * executed by the original TacticalActionController -> EffectEngine pipeline.
 * Deliberately excludes actions whose extra world/target/choice orchestration
 * has not yet been connected to the canonical headless battle coordinator.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {EffectEngine} from '../../js/effect-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const fail=code=>{throw new PvpCommandError(code)};
const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');

export function isCanonicalDirectEffectSkill(skill){
  if(!skill||!['MAGIC','SPECIAL'].includes(skill.category)||
      !['SELF','ALLY'].includes(skill.target)||
      (skill.targetType&&skill.targetType!=='SINGLE')||
      !Array.isArray(skill.effects)||!skill.effects.length||
      !skill.effects.every(e=>EffectEngine.isStandaloneDirectEffectType(e?.type))||
      Number(skill.power||0)!==0||skill.weapon||skill.attackType||
      skill.utilityAction||skill.channel||skill.sanctuary||skill.smokeField||
      skill.bloodBurst||skill.bloodShadow||skill.moveToTarget||skill.approach||
      skill.stance||skill.areaDamage||skill.terrainTargeting||skill.highDimensional||
      skill.hydrologyFlood||skill.waterContact||skill.relationEffects||
      skill.postEffects?.length||skill.afterUseEffects?.length||
      skill.statusEffects?.length||skill.variants?.length||skill.affixes?.length)
    return false;
  return true;
}

/** Self-channel spells delegate both start and subsequent round ticks to the
 * official TacticalActionController / EffectEngine. No channel numbers live here.
 */
export function isCanonicalSelfChannelSkill(skill){
  return !!skill && ['MAGIC','SPECIAL'].includes(skill.category) &&
    skill.target==='SELF' && (!skill.targetType||skill.targetType==='SINGLE') &&
    !skill.effects && !skill.weapon && !skill.attackType &&
    Number(skill.power||0)===0 && EffectEngine.isSupportedChannelRule(skill.channel) &&
    !skill.utilityAction && !skill.sanctuary && !skill.smokeField &&
    !skill.bloodBurst && !skill.bloodShadow && !skill.moveToTarget &&
    !skill.approach && !skill.stance && !skill.areaDamage &&
    !skill.terrainTargeting && !skill.highDimensional &&
    !skill.hydrologyFlood && !skill.waterContact && !skill.relationEffects &&
    !skill.postEffects?.length && !skill.afterUseEffects?.length &&
    !skill.statusEffects?.length && !skill.variants?.length;
}

export function canonicalDirectEffectSkillOptions(unit,engine){
  if(!unit?.alive)return[];
  const ids=engine.effect.skillIds?.(unit)||unit.character?.skills||[];
  return SkillDatabase.list(ids).filter(skill=>isCanonicalDirectEffectSkill(skill)||isCanonicalSelfChannelSkill(skill));
}

export function castCanonicalDirectEffectSkill(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','targetId','skillId'])||
      action.type!=='CAST_EFFECT_SKILL'||
      ![action.unitId,action.targetId,action.skillId].every(s=>typeof s==='string'&&s.length>0))
    fail('INVALID_EFFECT_SKILL_COMMAND');
  const caster=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===TEAM[seat]);
  const target=game.units.find(u=>u.id===action.targetId&&u.alive);
  if(!caster||caster.acted||caster.waited)fail('CASTER_NOT_AVAILABLE');
  if(!target)fail('EFFECT_TARGET_NOT_AVAILABLE');
  const skill=canonicalDirectEffectSkillOptions(caster,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  // Target relationship, height, line of sight, range and special visibility
  // are evaluated by the same TacticalEngine as the browser game.
  if(!TacticalEngine.canTarget(game.battlefield.map,caster,target,skill,game.environmentState))
    fail('ILLEGAL_EFFECT_TARGET');
  if(!engine.unitRuntime.canUseSkill(caster,skill))fail('SKILL_RESOURCES_UNAVAILABLE');
  const hpBefore=target.hp,manaBefore=caster.mana;
  const actionController=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    checkMatchEnd:checkMatchEnd||(()=>false),
    maybeAutoEndPlayerTurn:()=>false,
    clearEngagement:()=>{},setSelectedSkill:()=>{},
    setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
    pushLog:hooks.pushLog
  });
  if((isCanonicalSelfChannelSkill(skill)
        ?(caster.id===target.id&&actionController.executeChannelSkill(caster,skill))
        :actionController.executeEffectSkill(caster,target,skill))!==true)
    fail('OFFICIAL_EFFECT_SKILL_REJECTED');
  return {accepted:true,state:game,casterId:caster.id,targetId:target.id,
    skillId:skill.id,targetHpBefore:hpBefore,targetHpAfter:target.hp,
    casterManaBefore:manaBefore,casterManaAfter:caster.mana};
}
