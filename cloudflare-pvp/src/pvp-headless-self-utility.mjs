/**
 * Self utility skills invoke exactly the original TacticalActionController.
 * No PvP-specific stealth, flight, dive, mana, or turn-ending rules.
 * Network inputs are only skill + variant IDs, never client-selected modes.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {VerticalMobilityEngine} from '../../js/vertical-mobility-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const fail=code=>{throw new PvpCommandError(code)};
const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const validId=v=>typeof v==='string'&&v.length>0;

/** Match the two utility action families explicitly implemented by the
 * existing single-player controller. Unknown utility types fail closed. */
function supportedAction(action){
  if(!action||typeof action!=='object')return false;
  if(action.type==='ENTER_STEALTH')
    return exact(action,['type','consumeTurn'])&&action.consumeTurn===true;
  if(action.type==='SET_VERTICAL_MODE')
    return exact(action,['type','mode','consumeTurn'])&&
      ['GROUND','FLYING','DIVING','SWIMMING'].includes(action.mode)&&
      action.consumeTurn===false;
  return false;
}
function validSelfSkill(skill){
  return !!skill&&skill.category==='SPECIAL'&&skill.target==='SELF'&&
    (!skill.targetType||skill.targetType==='SINGLE')&&
    Number(skill.power||0)===0&&!skill.weapon&&!skill.attackType&&
    !skill.effects&&!skill.relationEffects&&!skill.statusEffects&&
    !skill.postEffects&&!skill.afterUseEffects&&!skill.stance&&
    !skill.bloodBurst&&!skill.bloodShadow&&!skill.channel&&
    !skill.sanctuary&&!skill.smokeField&&!skill.approach&&
    !skill.moveToTarget&&!skill.shape&&!skill.areaDamage&&
    !skill.terrainTargeting&&!skill.hydrologyFlood&&!skill.waterContact&&
    !skill.environmentTarget&&!skill.environmentForces&&
    !skill.trapPlacement&&!skill.highDimensional&&!skill.affixes?.length;
}
export function isCanonicalSelfUtilitySkill(skill){
  if(!validSelfSkill(skill))return false;
  if(Array.isArray(skill.variants)&&skill.variants.length)
    return !skill.utilityAction&&skill.variants.every(v=>{
      if(!validId(v.id)||v.target&&v.target!=='SELF')return false;
      const resolved=SkillDatabase.resolveVariant(skill,v.id);
      return validSelfSkill(resolved)&&supportedAction(resolved.utilityAction);
    });
  return supportedAction(skill.utilityAction);
}
export function canonicalSelfUtilityOptions(unit,engine,map){
  if(!unit?.alive||unit.acted||unit.waited)return[];
  return withActorMap(unit,map,()=>
    SkillDatabase.list(engine.effect.skillIds(unit)).filter(isCanonicalSelfUtilitySkill)
      .flatMap(base=>(base.variants?.length?base.variants.map(v=>SkillDatabase.resolveVariant(base,v.id)):[base])
        .map(skill=>({id:base.id,name:skill.name,variantId:skill.variantId??null,
          resourceLabel:engine.unitRuntime.resourceLabel(unit,skill),
          usable:engine.unitRuntime.canUseSkill(unit,skill)}))));
}
/** Runtime's original water prerequisite reads a unit's map reference.
 * Battle-room units cannot *persist* that map reference (circular/huge).
 * Bind it only during this synchronous official action; restore it always. */
function withActorMap(actor,map,callback){
  const owns=Object.hasOwn(actor,'_runtimeMap'),before=actor._runtimeMap;
  try {actor._runtimeMap=map;return callback();}
  finally {if(owns)actor._runtimeMap=before;else delete actor._runtimeMap;}
}
export function castCanonicalSelfUtility(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','variantId'])||
    action.type!=='CAST_SELF_UTILITY'||!validId(action.unitId)||
    !validId(action.skillId)||!(action.variantId===null||validId(action.variantId)))
    fail('INVALID_SELF_UTILITY_COMMAND');
  if(game.pendingAttack||game.pendingEnchantmentFollowup||game.pendingBloodMemoryChoice)
    fail('PENDING_CHOICE_REQUIRED');
  const actor=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===TEAM[seat]);
  if(!actor||actor.acted||actor.waited)fail('SELF_UTILITY_ACTOR_UNAVAILABLE');
  const parent=SkillDatabase.list(engine.effect.skillIds(actor))
    .find(skill=>skill.id===action.skillId&&isCanonicalSelfUtilitySkill(skill));
  if(!parent)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  if(parent.variants?.length ? action.variantId===null : action.variantId!==null)
    fail('SELF_UTILITY_VARIANT_REQUIRED');
  const skill=parent.variants?.length?
    SkillDatabase.resolveVariant(parent,action.variantId):parent;
  if(!skill)fail('INVALID_SKILL_VARIANT');
  const map=game.battlefield.map,tile=TacticalEngine.tile(map,actor.x,actor.y);
  if(!tile)fail('INVALID_ACTOR_TILE');
  return withActorMap(actor,map,()=>{
    if(!engine.unitRuntime.canUseSkill(actor,skill))fail('SELF_UTILITY_REQUIREMENTS_UNAVAILABLE');
    const verticalBefore=actor.verticalState?.requestedMode||actor.verticalState?.mode;
    const mode=skill.utilityAction.type;
    // Reject no-op transitions before the official controller can consume MP.
    if(mode==='SET_VERTICAL_MODE'){
      if(verticalBefore===skill.utilityAction.mode)fail('VERTICAL_MODE_ALREADY_SELECTED');
      const candidate=VerticalMobilityEngine.describe(actor,tile,{mode:skill.utilityAction.mode});
      if(!candidate||candidate.mode!==skill.utilityAction.mode&&
        !(['GROUND','SWIMMING'].includes(skill.utilityAction.mode)&&
          ['GROUND','WADING','SWIMMING'].includes(candidate.mode)))
        fail('VERTICAL_MODE_UNAVAILABLE');
    }
    const mpBefore=actor.mana,actedBefore=actor.acted;
    const controller=globalThis.TacticalActionController.create({
      TEAM:{PLAYER:TEAM[seat],ENEMY:TEAM[1-seat]},
      actionState:()=>({map,units:game.units,environmentState:game.environmentState}),
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
      consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
      effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
      checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
      clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
      setCommandPanelCollapsed:()=>{},setMode:()=>{},render:()=>{},emitState:()=>{},
      pushLog:hooks.pushLog
    });
    controller.prepareAttack(actor,actor,skill);
    if(mode==='ENTER_STEALTH'){
      if(!engine.effect.isStealthed(actor)||!actor.acted||actedBefore)
        fail('OFFICIAL_STEALTH_REJECTED');
    }else if(actor.verticalState?.requestedMode!==skill.utilityAction.mode||actor.acted!==actedBefore)
      fail('OFFICIAL_VERTICAL_MODE_REJECTED');
    return {accepted:true,state:game,unitId:actor.id,skillId:skill.id,
      variantId:action.variantId,mpBefore,mpAfter:actor.mana,
      verticalMode:actor.verticalState?.mode||null,stealthed:engine.effect.isStealthed(actor)};
  });
}
