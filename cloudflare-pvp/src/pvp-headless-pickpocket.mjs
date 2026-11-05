/**
 * PVP authority bridge for the existing STEAL_LOOT utility action.
 * All loot selection, capacity, one-victim limit, MP and turn-ending rules
 * remain in RewardEngine and TacticalActionController, shared with offline.
 * The Worker command has no client-provided loot, gold, geometry or resource.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {RewardEngine} from '../../js/reward-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const TEAM=['P','E'], PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const identifier=s=>typeof s==='string'&&s.length>0;

export function isCanonicalPickpocketSkill(skill){
  return !!skill&&skill.category==='SPECIAL'&&skill.target==='ENEMY'&&
    (!skill.targetType||skill.targetType==='SINGLE')&&
    Number(skill.power||0)===0&&
    skill.utilityAction?.type==='STEAL_LOOT'&&
    exact(skill.utilityAction,['type','consumeTurn'])&&
    skill.utilityAction.consumeTurn===true&&
    !!skill.range&&Number.isFinite(skill.range.min)&&Number.isFinite(skill.range.max)&&
    !skill.effects&&!skill.relationEffects&&!skill.statusEffects&&
    !skill.postEffects&&!skill.afterUseEffects&&!skill.weapon&&!skill.attackType&&
    !skill.approach&&!skill.moveToTarget&&!skill.channel&&!skill.bloodShadow&&
    !skill.bloodBurst&&!skill.areaDamage&&!skill.aoeDamage&&!skill.variants?.length&&
    !skill.stance&&!skill.sanctuary&&!skill.smokeField&&!skill.shape&&
    !skill.terrainTargeting&&!skill.environmentTarget&&!skill.environmentForces&&
    !skill.waterContact&&!skill.hydrologyFlood&&!skill.trapPlacement;
}
function ownerSkills(actor,engine){
  if(!actor?.alive||actor.acted||actor.waited)return [];
  return SkillDatabase.list(engine.effect.skillIds(actor))
    .filter(skill=>isCanonicalPickpocketSkill(skill)&&engine.unitRuntime.canUseSkill(actor,skill));
}
function targetLegal(game,actor,target,skill){
  if(!target?.alive||!target.character||actor.id===target.id||target.team===actor.team||
     target.kind==='CORE'||!RewardEngine.stealable(actor,target))return false;
  const map=game.battlefield.map,environment=game.environmentState;
  // A hidden enemy must never appear in a seat-private target list.
  return TacticalEngine.teamCanSee(map,game.units,actor.team,target,environment)&&
    TacticalEngine.canTarget(map,actor,target,skill,environment);
}
export function canonicalPickpocketOptions(game,actor,engine){
  return ownerSkills(actor,engine).flatMap(skill=>game.units.filter(target=>
    targetLegal(game,actor,target,skill)).map(target=>({
      skillId:skill.id,skillName:skill.name,targetId:target.id,
      targetName:target.character?.name||target.id
    })));
}
export function castCanonicalPickpocket(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','targetId'])||action.type!=='CAST_PICKPOCKET'||
     ![action.unitId,action.skillId,action.targetId].every(identifier))
    fail('INVALID_PICKPOCKET_COMMAND');
  if(game.pendingAttack||game.pendingBloodMemoryChoice||game.pendingEnchantmentFollowup)
    fail('PENDING_CHOICE_REQUIRED');
  const actor=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  const target=game.units.find(u=>u.id===action.targetId&&u.alive);
  if(!actor||actor.acted||actor.waited||!target)fail('PICKPOCKET_ACTOR_OR_TARGET_UNAVAILABLE');
  const skill=ownerSkills(actor,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  if(!targetLegal(game,actor,target,skill))fail('ILLEGAL_PICKPOCKET_TARGET');
  const manaBefore=actor.mana,previousItems=Array.isArray(actor.inventory)?actor.inventory.length:0;
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:actor.team,ENEMY:TEAM[1-seat]},
    actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
    setCommandPanelCollapsed:()=>{},setMode:()=>{},render:()=>{},emitState:()=>{},
    pushLog:hooks.pushLog
  });
  if(controller.executeUtilitySkill(actor,target,skill)!==true||!target.lootState?.stolen||
     !actor.acted||!actor.waited||!(actor.mana<manaBefore))
    fail('OFFICIAL_PICKPOCKET_REJECTED');
  return {accepted:true,state:game,unitId:actor.id,targetId:target.id,skillId:skill.id,
    manaBefore,manaAfter:actor.mana,
    itemTransferred:(actor.inventory||[]).length>previousItems,
    matchGold:game.matchRewards?.goldByTeam?.[actor.team]||0};
}
