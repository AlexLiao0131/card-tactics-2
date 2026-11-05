/**
 * Canonical variant-charge controller adapter for the *original* two-stage
 * TacticalActionController. No movement, knockback, guard or HP-link formulas
 * are defined here. The official battle room is the only command authority.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {createCanonicalAreaFields} from './pvp-field-controller.mjs';
const TEAM=['P','E'], PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');

/** The authored charge variants are validated by *capability shape*, not by
 * hardcoding a hero name, variant id, a numerical distance or an HP-link value. */
export function isCanonicalChargeVariant(base,skill){
  if(!base||!skill||skill.baseSkillId!==base.id||
     !base.variants?.some(v=>v.id===skill.variantId)||
     base.approach?.type!=='CHARGE'||!Number.isSafeInteger(base.approach?.stopDistance)||
     base.approach.stopDistance!==1||!skill.weapon||Number(skill.power)<=0||
     !skill.range||!Number.isFinite(skill.range.min)||!Number.isFinite(skill.range.max)||
     !['ATTACK','MAGIC'].includes(skill.category)||
     skill.utilityAction||skill.channel||skill.verdictCross||skill.bloodShadow||skill.moveToTarget||
     skill.bloodBurst||skill.sanctuary||skill.smokeField||skill.shape||
     skill.terrainTargeting||skill.hydrologyFlood||skill.environmentForces||
     skill.areaDamage||skill.aoeDamage||skill.relationEffects)return false;
  if(skill.target==='ENEMY')return skill.category==='ATTACK'&&
    !!skill.attackType&&!skill.effects&&
    (!skill.postEffects||skill.postEffects.every(e=>e.type==='KNOCKBACK'&&Number.isFinite(e.distance)))&&
    (!skill.afterUseEffects||skill.afterUseEffects.every(e=>e.type==='BUFF'));
  if(skill.target==='ALLY')return skill.category==='MAGIC'&&
    skill.attackType==null&&Array.isArray(skill.effects)&&skill.effects.length>0&&
    skill.effects.every(e=>e.type==='HP_LINK'&&Number.isSafeInteger(e.duration)&&e.duration>0)&&
    !skill.postEffects?.length&&!skill.afterUseEffects?.length&&
    Number(skill.holyPowerOnHit||0)===0;
  return false;
}
export function canonicalChargeOptions(unit,engine){
  if(!unit?.alive||unit.moved||unit.acted||unit.waited)return [];
  return SkillDatabase.list(engine.effect.skillIds(unit)).flatMap(base=>
    (base.variants||[]).map(v=>SkillDatabase.resolveVariant(base,v.id))
      .filter(skill=>isCanonicalChargeVariant(base,skill)&&engine.unitRuntime.canUseSkill(unit,skill))
      .map(skill=>({skillId:base.id,variantId:skill.variantId,
        name:skill.name,target:skill.target,category:skill.category})));
}
export function resolveCanonicalChargeVariant(unit,skillId,variantId,engine){
  if(typeof skillId!=='string'||typeof variantId!=='string')return null;
  if(!engine.effect.skillIds(unit).includes(skillId))return null;
  let base;
  try{base=SkillDatabase.get(skillId)}catch{return null}
  const variant=SkillDatabase.resolveVariant(base,variantId);
  return isCanonicalChargeVariant(base,variant)?variant:null;
}
// All movement and environment callbacks are the identical official adapters
// that normal PVP movement uses, and all action decisions remain in the
// browser's original TacticalActionController.approachForSkill/executeEffectSkill.
function originalController(game,engine,hooks,checkMatchEnd,actor){
  const env=createCanonicalEnvironmentController(game,hooks);
  const fields=createCanonicalAreaFields(game,engine,hooks);
  const traverseUnitPath=(unit,path,options)=>{
    const old={x:unit.x,y:unit.y};
    const result=env.traverseUnitPath(unit,path,options);
    if(unit.x!==old.x||unit.y!==old.y){
      engine.effect.interruptChannel(unit,'MOVE');fields.syncSmokeCover(unit);
    }
    return result;
  };
  const enterTile=unit=>{const result=env.enterTile(unit);if(unit.alive)fields.syncSmokeCover(unit);return result;};
  return globalThis.TacticalActionController.create({
    TEAM:{PLAYER:actor.team,ENEMY:TEAM.find(t=>t!==actor.team)},
    actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState,selected:actor}),
    combatTargets:()=>game.units.filter(u=>u.alive),
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    resourceFor:(u,s)=>engine.unitRuntime.resourceCost?.(u,s),
    targetType:s=>s.targetType||'SINGLE',traverseUnitPath,enterTile,
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    pushLog:hooks.pushLog,handleDefeated:hooks.handleDefeated,damageUnitFlat:hooks.damageUnitFlat,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},render:()=>{},emitState:()=>{},
    clearEngagement:()=>{}
  });
}
export function castCanonicalCharge(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','variantId','targetId'])||
     action.type!=='CAST_CHARGE'||
     ![action.unitId,action.skillId,action.variantId,action.targetId].every(x=>typeof x==='string'&&x.length))
    fail('INVALID_CHARGE_COMMAND');
  const actor=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  const target=game.units.find(u=>u.id===action.targetId&&u.alive);
  if(!actor||actor.acted||actor.waited||actor.moved||!target||actor.id===target.id)
    fail('CHARGE_ACTOR_OR_TARGET_UNAVAILABLE');
  const variant=resolveCanonicalChargeVariant(actor,action.skillId,action.variantId,engine);
  if(!variant||!engine.unitRuntime.canUseSkill(actor,variant))fail('CHARGE_SKILL_NOT_AVAILABLE');
  if(variant.target==='ALLY'?target.team!==actor.team:target.team===actor.team)
    fail('INVALID_CHARGE_RELATION');
  if(!TacticalEngine.canTarget(game.battlefield.map,actor,target,variant,game.environmentState))
    fail('ILLEGAL_CHARGE_TARGET');
  const from={x:actor.x,y:actor.y},controller=originalController(game,engine,hooks,checkMatchEnd,actor);
  // The original path rule picks a legal adjacent square, traverses all
  // environmental collisions, and commits movement before impact.
  if(controller.approachForSkill(actor,target,variant)!==true)
    fail('OFFICIAL_CHARGE_APPROACH_REJECTED');
  if(!actor.alive){actor.moved=true;actor.acted=true;actor.waited=true;
    return {accepted:true,state:game,approachDefeated:true};}
  const impact={...variant,range:{min:1,max:1},approach:null,approachCommitted:true};
  if(!TacticalEngine.canTarget(game.battlefield.map,actor,target,impact,game.environmentState))
    fail('CHARGE_IMPACT_TARGET_CHANGED');
  if(variant.target==='ALLY'){
    if(controller.executeEffectSkill(actor,target,impact)!==true)fail('OFFICIAL_CHARGE_RESCUE_REJECTED');
    return {accepted:true,state:game,unitId:actor.id,targetId:target.id,variantId:variant.variantId,
      from,to:{x:actor.x,y:actor.y},targetHp:target.hp};
  }
  if(game.pendingAttack)fail('ATTACK_ALREADY_PENDING');
  game.pendingAttack={kind:'CHARGE',attackerId:actor.id,targetId:target.id,skillId:variant.id,
    variantId:variant.variantId,attackingSeat:seat,defendingSeat:1-seat};
  game.phase='PVP_REACTION_PENDING';game.activeSeat=1-seat;
  return {accepted:true,state:game,unitId:actor.id,targetId:target.id,variantId:variant.variantId,
    from,to:{x:actor.x,y:actor.y},reactionPending:true};
}
