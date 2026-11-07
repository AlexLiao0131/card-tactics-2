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
import {canonicalTargetPlan} from './pvp-headless-target-plan.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {commitCanonicalTargetApproach} from './pvp-headless-engagement.mjs';

const fail=code=>{throw new PvpCommandError(code)};
const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const exact=(obj,fields)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===fields.slice().sort().join('|');

/** A stance can travel through the existing effect pipeline only when its
 * physical collision and defense profiles are carried by its applied BUFF.
 * This is a structural contract, not an ID or character whitelist. */
function isCanonicalAppliedStance(skill){
  if(!skill?.stance)return false;
  const rule=skill.stance;
  if(typeof rule.type!=='string'||!rule.type||
     !Array.isArray(skill.effects)||skill.effects.length!==1)return false;
  const effect=skill.effects[0];
  return skill.target==='SELF'&&effect?.type==='BUFF'&&
    effect.id===rule.type&&Number.isInteger(effect.duration)&&effect.duration>0&&
    effect.collision?.solid===true&&Array.isArray(effect.defenseProfiles)&&
    effect.defenseProfiles.length>0&&
    Object.keys(rule).every(k=>['type','protectsBehind','blocksEnemyRoute','enhancedGuard'].includes(k))&&
    Object.values(rule).slice(1).every(value=>typeof value==='boolean');
}
export function isCanonicalDirectEffectSkill(skill){
  const stance=isCanonicalAppliedStance(skill);
  if(!skill||!['MAGIC','SPECIAL'].includes(skill.category)||
      !['SELF','ALLY','ENEMY'].includes(skill.target)||
      (skill.targetType&&skill.targetType!=='SINGLE')||
      !Array.isArray(skill.effects)||!skill.effects.length||
      !skill.effects.every(e=>EffectEngine.isStandaloneDirectEffectType(e?.type))||
      Number(skill.power||0)!==0||skill.weapon||skill.attackType||
      skill.utilityAction||skill.channel||skill.sanctuary||skill.smokeField||
      skill.bloodBurst||skill.bloodShadow||skill.moveToTarget||skill.approach||
      (skill.stance&&!stance)||skill.areaDamage||skill.terrainTargeting||skill.highDimensional||
      skill.hydrologyFlood||skill.waterContact||skill.relationEffects||
      skill.postEffects?.length||skill.afterUseEffects?.length||
      skill.statusEffects?.length||skill.variants?.length||
      (skill.affixes?.length&&!skill.targeting?.requiresObservationNetwork&&!stance))
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

export function isCanonicalSubmergeSkill(skill){
  return !!skill&&skill.category==='SPECIAL'&&skill.target==='ENEMY'&&
    (!skill.targetType||skill.targetType==='SINGLE')&&skill.power===0&&
    skill.requirements?.diving===true&&skill.utilityAction?.type==='SUBMERGE_ENEMY'&&
    skill.utilityAction.consumeTurn===true&&
    !skill.effects&&!skill.relationEffects&&!skill.approach&&!skill.bloodShadow&&
    !skill.channel&&!skill.postEffects?.length&&!skill.afterUseEffects?.length;
}
export function canonicalDirectEffectSkillOptions(unit,engine){
  if(!unit?.alive)return[];
  const ids=engine.effect.skillIds?.(unit)||unit.character?.skills||[];
  return SkillDatabase.list(ids).filter(skill=>isCanonicalDirectEffectSkill(skill)||isCanonicalSelfChannelSkill(skill)||isCanonicalSubmergeSkill(skill));
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
  if(!engine.unitRuntime.canUseSkill(caster,skill))fail('SKILL_RESOURCES_UNAVAILABLE');
  const plan=canonicalTargetPlan(game,caster,target,skill,engine);
  if(!plan)fail('ILLEGAL_EFFECT_TARGET');
  const approach=commitCanonicalTargetApproach(game,caster,plan,skill,engine,hooks,checkMatchEnd);
  if(!approach.ready)return {accepted:true,state:game,movement:approach.movement,castInterrupted:true};
  if(!TacticalEngine.canTarget(game.battlefield.map,caster,target,skill,game.environmentState)||
      !engine.unitRuntime.canUseSkill(caster,skill)){
    hooks.pushLog(`${caster.character.name} 移動後無法完成「${skill.name}」施放。`,'SYSTEM');
    return {accepted:true,state:game,movement:approach.movement,castInterrupted:true};
  }
  const hpBefore=target.hp,manaBefore=caster.mana;
  const environment=isCanonicalSubmergeSkill(skill)?createCanonicalEnvironmentController(game,hooks):null;
  const actionController=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    checkMatchEnd:checkMatchEnd||(()=>false),
    maybeAutoEndPlayerTurn:()=>false,
    applyForcedMovement:environment?.applyForcedMovement,
    clearEngagement:()=>{},setSelectedSkill:()=>{},
    setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
    pushLog:hooks.pushLog
  });
  if((isCanonicalSubmergeSkill(skill)
        ?actionController.executeUtilitySkill(caster,target,skill)
        :isCanonicalSelfChannelSkill(skill)
          ?(caster.id===target.id&&actionController.executeChannelSkill(caster,skill))
          :actionController.executeEffectSkill(caster,target,skill))!==true)
    fail('OFFICIAL_EFFECT_SKILL_REJECTED');
  return {accepted:true,state:game,casterId:caster.id,targetId:target.id,
    skillId:skill.id,targetHpBefore:hpBefore,targetHpAfter:target.hp,
    casterManaBefore:manaBefore,casterManaAfter:caster.mana};
}
