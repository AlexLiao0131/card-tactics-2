/**
 * Official weapon-enchantment command bridge for headless PvP.
 * No enchantment HP, MP, duration, eligibility or impact formula is owned here.
 * The browser and server both call TacticalActionController's one canonical
 * executeEnchantmentChoice(). Pending self-enchant follow-up is serializable
 * so a Durable Object can restore it after process restart.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const fail=code=>{throw new PvpCommandError(code)};
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const TEAM=['P','E'];
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const isText=t=>typeof t==='string'&&t.length>0;

export function isCanonicalEnchantmentSkill(skill){
  return !!skill && skill.utilityAction?.type==='ENCHANT_WEAPON' &&
    skill.target==='ALLY' && (!skill.targetType||skill.targetType==='SINGLE') &&
    skill.enchantment && Array.isArray(skill.enchantment.attackTypes) &&
    Number.isFinite(Number(skill.enchantment.power)) &&
    !skill.bloodShadow && !skill.channel && !skill.approach &&
    !skill.moveToTarget && !skill.sanctuary && !skill.smokeField &&
    !skill.effects && !skill.areaDamage && !skill.relationEffects &&
    !skill.postEffects?.length && !skill.afterUseEffects?.length;
}

export function createOfficialEnchantmentController(game,engine,hooks,checkMatchEnd,selected=null){
  const environment=createCanonicalEnvironmentController(game,hooks);
  return globalThis.TacticalActionController.create({
    TEAM:{PLAYER:'P',ENEMY:'E'},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState,selected}),
    canUseSkill:(unit,skill)=>engine.unitRuntime.canUseSkill(unit,skill),
    consumeSkill:(unit,skill)=>engine.unitRuntime.consumeSkill(unit,skill),
    effectiveSkill:(unit,skill)=>engine.unitRuntime.applyResourceScaling(unit,skill),
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},
    pushLog:hooks.pushLog,
    aoeTiles:(center,radius)=>TacticalEngine.aoeTiles(game.battlefield.map,center,radius),
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    damageUnitFlat:hooks.damageUnitFlat,
    logEnvironmentEvent:environment.logEnvironmentEvent,
    resolveEnvironmentEvents:environment.resolveEnvironmentEvents,
    applyEnvironmentHazardToUnit:environment.applyEnvironmentHazardToUnit
  });
}

/** Official candidates are recomputed on every command from the current state.
 * No client-provided variant/equipment type is trusted.
 */
export function canonicalEnchantmentOptions(game,caster,engine,hooks){
  if(!caster?.alive||caster.acted||caster.waited||game.pendingEnchantmentFollowup)return[];
  if(!engine.unitRuntime.canUseSkill)return[];
  const actionController=createOfficialEnchantmentController(game,engine,hooks,null,caster);
  const ids=engine.effect.skillIds(caster);
  return SkillDatabase.list(ids).filter(isCanonicalEnchantmentSkill).flatMap(parent=>{
    const variants=parent.variants?.length?parent.variants:[null];
    return variants.flatMap(variant=>{
      const skill=SkillDatabase.resolveVariant(parent,variant?.id);
      if(!skill||!engine.unitRuntime.canUseSkill(caster,skill))return[];
      return actionController.enchantmentCandidates(caster,skill).map(({target,weapon})=>({
        skillId:parent.id,skillName:skill.name,variantId:variant?.id??null,
        targetId:target.id,targetName:target.character?.name||target.id,
        weaponSlot:weapon.slot,weaponName:weapon.name,element:skill.element
      }));
    });
  });
}

export function castCanonicalEnchantment(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','targetId','skillId','variantId','weaponSlot'])||
      action.type!=='CAST_ENCHANTMENT'||
      ![action.unitId,action.targetId,action.skillId,action.weaponSlot].every(isText)||
      !(action.variantId===null||isText(action.variantId)))
    fail('INVALID_ENCHANTMENT_COMMAND');
  if(game.pendingEnchantmentFollowup)fail('ENCHANTMENT_FOLLOWUP_PENDING');
  const caster=game.units.find(u=>u.alive&&u.team===TEAM[seat]&&u.id===action.unitId);
  if(!caster||caster.acted||caster.waited)fail('CASTER_NOT_AVAILABLE');
  const candidate=canonicalEnchantmentOptions(game,caster,engine,hooks).find(option=>
    option.skillId===action.skillId&&option.variantId===action.variantId&&
    option.targetId===action.targetId&&option.weaponSlot===action.weaponSlot);
  if(!candidate)fail('ILLEGAL_ENCHANTMENT_SELECTION');
  const parent=SkillDatabase.list(engine.effect.skillIds(caster)).find(s=>s.id===action.skillId);
  const skill=SkillDatabase.resolveVariant(parent,action.variantId);
  if(!skill||!isCanonicalEnchantmentSkill(skill))fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  const controller=createOfficialEnchantmentController(game,engine,hooks,checkMatchEnd,caster);
  const manaBefore=caster.mana;
  if(controller.executeEnchantmentChoice(caster,skill,action.targetId,action.weaponSlot)!==true)
    fail('OFFICIAL_ENCHANTMENT_REJECTED');
  const next=controller.enchantmentFollowup();
  game.pendingEnchantmentFollowup=next?{unitId:next.unitId,weaponSlot:next.weaponSlot}:null;
  return {accepted:true,state:game,casterId:caster.id,targetId:action.targetId,
    weaponSlot:action.weaponSlot,element:skill.element,followup:game.pendingEnchantmentFollowup,
    manaBefore,manaAfter:caster.mana};
}

export function completeCanonicalEnchantmentFollowup(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId'])||action.type!=='END_ENCHANT_FOLLOWUP'||!isText(action.unitId))
    fail('INVALID_ENCHANTMENT_FOLLOWUP');
  const followup=game.pendingEnchantmentFollowup;
  if(!followup||followup.unitId!==action.unitId)fail('NO_ENCHANTMENT_FOLLOWUP');
  const caster=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===TEAM[seat]);
  if(!caster||caster.acted||caster.waited)fail('CASTER_NOT_AVAILABLE');
  const controller=createOfficialEnchantmentController(game,engine,hooks,checkMatchEnd,caster);
  if(controller.finishActiveSkill(caster)!==true)fail('OFFICIAL_ENCHANTMENT_FINISH_FAILED');
  game.pendingEnchantmentFollowup=null;
  return {accepted:true,state:game,unitId:caster.id};
}
