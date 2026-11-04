/**
 * Server command transport for the original TacticalActionController's
 * blood-shadow transit, uncounterable engagement, healing and memory choice.
 * Only seat/command/persistence validation is owned here. The browser and
 * Cloudflare both execute the same original action and EffectEngine rules.
 * Experimental until the complete tactical UI/event contract is verified.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import '../../js/tactical-action-controller.js';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {createOfficialEnchantmentController} from './pvp-headless-enchantment.mjs';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const TEAM=['P','E'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(action,fields)=>!!action&&typeof action==='object'&&!Array.isArray(action)&&
  Object.keys(action).sort().join('|')===fields.slice().sort().join('|');
const isId=value=>typeof value==='string'&&value.length>0;
const ownerUnit=(game,seat,id)=>game.units.find(u=>u.id===id&&u.team===TEAM[seat]&&u.alive);

export function canonicalBloodShadowSkills(unit,engine){
  if(!unit?.alive)return [];
  return SkillDatabase.list(engine.effect.skillIds(unit)).filter(skill=>
    skill.bloodShadow===true&&skill.target==='ENEMY'&&skill.weapon&&
    skill.category==='SPECIAL');
}

/** Legal landing is calculated ONLY by the official controller. Never accept
 * a destination cell or attacker/defender HP value from the client. */
export function canonicalBloodShadowTargets(game,actor,engine){
  if(!actor?.alive||actor.acted||actor.waited)return [];
  const skills=canonicalBloodShadowSkills(actor,engine).filter(skill=>
    engine.unitRuntime.canUseSkill(actor,skill));
  if(!skills.length)return [];
  const controller=globalThis.TacticalActionController.create({
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState})
  });
  return skills.flatMap(skill=>game.units.filter(unit=>unit.alive&&unit.team!==actor.team&&
    controller.bloodShadowLanding(actor,unit)).map(target=>({
      skillId:skill.id,skillName:skill.name,targetId:target.id,
      targetName:target.character?.name||target.id
    })));
}

function officialController(game,engine,hooks,checkMatchEnd,actor){
  const environment=createCanonicalEnvironmentController(game,hooks);
  const enchantment=createOfficialEnchantmentController(game,engine,hooks,checkMatchEnd,actor);
  return globalThis.TacticalActionController.create({
    // In PvP both sides are human players. Force the *original* optional
    // memory selection path rather than its single-player enemy auto-pick.
    TEAM:{PLAYER:actor.team,ENEMY:TEAM.find(team=>team!==actor.team)},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    targetType:s=>s.targetType||'SINGLE',
    handleDefeated:hooks.handleDefeated,
    enterTile:environment.enterTile,
    logBattleAction:entry=>{
      environment.resolveWaterSkillHit(entry);
      if(entry.enchantment)enchantment.resolveEnchantmentImpact(entry);
    },
    logPostEffect:entry=>{
      if(entry?.result?.applied)fail('POST_ENGAGEMENT_FOLLOWUP_NOT_CONNECTED');
    },
    setPendingCopySkill:pending=>{
      if(!pending){game.pendingBloodMemoryChoice=null;return;}
      if(pending.attacker.id!==actor.id)fail('BLOOD_MEMORY_ACTOR_MISMATCH');
      game.pendingBloodMemoryChoice={unitId:actor.id,targetId:pending.target.id,
        skillIds:pending.options.map(skill=>skill.id)};
    },
    getPendingCopySkill:()=>game.pendingBloodMemoryChoice,
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
    clearEngagement:()=>{},render:()=>{},pushLog:hooks.pushLog
  });
}

/** One synchronous command commits the actual move/engagement/drain. If the
 * drain creates copyable skill candidates, only the *choice* remains pending. */
export function castCanonicalBloodShadow(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','targetId','skillId'])||
     action.type!=='CAST_BLOOD_SHADOW'||
     ![action.unitId,action.targetId,action.skillId].every(isId))
    fail('INVALID_BLOOD_SHADOW_COMMAND');
  if(game.pendingBloodMemoryChoice)fail('BLOOD_MEMORY_CHOICE_PENDING');
  const actor=ownerUnit(game,seat,action.unitId);
  const target=game.units.find(u=>u.id===action.targetId&&u.team===TEAM[1-seat]&&u.alive);
  if(!actor||actor.acted||actor.waited||!target)fail('BLOOD_SHADOW_ACTOR_OR_TARGET_UNAVAILABLE');
  const skill=canonicalBloodShadowSkills(actor,engine).find(s=>s.id===action.skillId);
  if(!skill||!engine.unitRuntime.canUseSkill(actor,skill))fail('BLOOD_SHADOW_SKILL_UNAVAILABLE');
  const controller=officialController(game,engine,hooks,checkMatchEnd,actor);
  const landing=controller.bloodShadowLanding(actor,target);
  if(!landing)fail('BLOOD_SHADOW_NO_LEGAL_LANDING');
  const from={x:actor.x,y:actor.y,z:actor.z},before=target.hp,mana=actor.mana;
  if(controller.prepareAttack(actor,target,skill)!==true)
    fail('OFFICIAL_BLOOD_SHADOW_REJECTED');
  return {accepted:true,state:game,unitId:actor.id,targetId:target.id,
    from,to:{x:actor.x,y:actor.y,z:actor.z},
    targetHpBefore:before,targetHpAfter:target.hp,
    manaBefore:mana,manaAfter:actor.mana,
    memoryChoicePending:!!game.pendingBloodMemoryChoice};
}

/** Save only a source skill ID and the three choice IDs. No unit objects or
 * UI closures enter Durable Object storage; no skill cost is spent twice. */
export function chooseCanonicalBloodMemory(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)
    fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId'])||action.type!=='CHOOSE_BLOOD_MEMORY'||
     !isId(action.unitId)||!(action.skillId===null||isId(action.skillId)))
    fail('INVALID_BLOOD_MEMORY_COMMAND');
  const pending=game.pendingBloodMemoryChoice;
  if(!pending||pending.unitId!==action.unitId)fail('NO_BLOOD_MEMORY_CHOICE');
  const actor=ownerUnit(game,seat,pending.unitId);
  const target=game.units.find(u=>u.id===pending.targetId);
  if(!actor||!target)fail('BLOOD_MEMORY_SOURCE_MISSING');
  if(action.skillId!==null){
    // Current authoritative skill, candidate set and saved choice must agree.
    const legal=engine.effect.copyableSkills(target,actor).map(s=>s.id);
    if(!pending.skillIds.includes(action.skillId)||!legal.includes(action.skillId))
      fail('ILLEGAL_BLOOD_MEMORY_SKILL');
    if(!engine.effect.rememberBloodSkill(actor,action.skillId,target))
      fail('BLOOD_MEMORY_GRANT_FAILED');
    hooks.pushLog(`${actor.character.name} 記下「${SkillDatabase.get(action.skillId)?.name||action.skillId}」的血液記憶。`,'BATTLE');
  }
  const controller=officialController(game,engine,hooks,checkMatchEnd,actor);
  if(controller.finishActiveSkill(actor)!==true)fail('OFFICIAL_BLOOD_MEMORY_FINISH_FAILED');
  game.pendingBloodMemoryChoice=null;
  return {accepted:true,state:game,unitId:actor.id,rememberedSkillId:action.skillId};
}

export function bloodMemoryOptionsForSeat(game,seat){
  const pending=game.pendingBloodMemoryChoice;
  if(!pending||!game.units.some(u=>u.id===pending.unitId&&u.team===TEAM[seat]))return null;
  return {unitId:pending.unitId,options:pending.skillIds.map(id=>({
    id,name:SkillDatabase.get(id)?.name||id
  }))};
}
