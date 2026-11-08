/**
 * One durable command, two ORIGINAL TacticalActionController selections.
 * The browser chooses a passenger then a landing tile, but neither selection
 * commits state. Only a verified server command creates the controller and
 * completes pickup + release before returning to the Durable Object.
 *
 * No passenger, drop, elevation, range, MP or fall rules live in this adapter.
 * A rejected instruction must be discarded by the authority's transactional
 * reducer, never persisted as an incomplete carrying operation.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {createCanonicalAreaFields} from './pvp-field-controller.mjs';

const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const TEAM=['P','E'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(value,fields)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
const validId=value=>typeof value==='string'&&value.length>0;

// Capability filter, not a skill/character ID whitelist. Any additional
// gameplay payload must be implemented by the shared controller before
// admission: otherwise a new skill could be silently half-executed.
export function isCanonicalTransportSkill(skill){
  const pickup=skill?.utilityAction;
  if(!pickup||!['CARRY_ALLY','CARRY_ENEMY'].includes(pickup.type)||
     skill.category!==(pickup.type==='CARRY_ALLY'?'SPECIAL':'ATTACK')||
     skill.target!==(pickup.type==='CARRY_ALLY'?'ALLY':'ENEMY')||
     (skill.targetType&&skill.targetType!=='SINGLE')||!validId(pickup.releaseSkillId)||
     skill.moveToTarget||skill.approach||skill.weapon||skill.attackType||
     skill.effects||skill.relationEffects||skill.statusEffects||skill.postEffects||
     skill.afterUseEffects||skill.channel||skill.variants?.length||
     skill.trapPlacement||skill.environmentForces||skill.areaDamage||skill.aoeDamage||
     skill.bloodShadow||skill.sanctuary||skill.smokeField||skill.shape||
     skill.hydrologyFlood||skill.terrainTargeting||skill.environmentTarget||
     skill.waterContact||Number(skill.power||0)!==0)return false;
  const release=SkillDatabase.get(pickup.releaseSkillId);
  if(!release||release.utilityAction?.type!=='RELEASE_CARRIED'||
     release.category!=='SPECIAL'||release.target!=='TILE'||
     release.targetType!=='AOE'||Number(release.radius||0)!==0||
     release.weapon||release.attackType||release.effects||release.postEffects||
     release.afterUseEffects||release.statusEffects||release.channel||
     release.moveToTarget||release.shape||release.sanctuary||release.smokeField||
     release.areaDamage||release.aoeDamage||release.environmentForces||
     Number(release.power||0)!==0)return false;
  // Each unrecognized utility mode must remain explicitly unsupported.
  if(pickup.type==='CARRY_ALLY')return pickup.consumeTurn===false&&
    exact(pickup,['type','releaseSkillId','consumeTurn'])&&
    release.utilityAction.consumeTurn===true&&
    exact(release.utilityAction,['type','consumeTurn']);
  return pickup.consumeTurn===true&&Number.isFinite(pickup.minDrop)&&pickup.minDrop>=0&&
    exact(pickup,['type','releaseSkillId','consumeTurn','minDrop'])&&
    release.utilityAction.mode==='DROP'&&release.utilityAction.consumeTurn===true&&
    exact(release.utilityAction,['type','mode','consumeTurn']);
}

function actorTransportSkills(actor,engine){
  if(!actor?.alive||actor.acted||actor.waited)return [];
  return SkillDatabase.list(engine.effect.skillIds(actor))
    .filter(skill=>isCanonicalTransportSkill(skill)&&engine.unitRuntime.canUseSkill(actor,skill));
}

function originalController(game,engine,hooks,checkMatchEnd,actor,{preview=false}={}){
  const area=preview?null:createCanonicalAreaFields(game,engine,hooks);
  const environment=preview?null:createCanonicalEnvironmentController(game,hooks);
  const enterTile=(unit)=>{
    const result=environment.enterTile(unit);
    if(unit?.alive)area.syncSmokeCover(unit);
    return result;
  };
  const traverseUnitPath=(unit,path,options)=>{
    const before={x:unit.x,y:unit.y};
    const result=environment.traverseUnitPath(unit,path,options);
    if(unit.x!==before.x||unit.y!==before.y){
      engine.effect.interruptChannel(unit,'MOVE');
      area.syncSmokeCover(unit);
    }
    return result;
  };
  let selectedSkill=null;
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:actor.team,ENEMY:TEAM.find(team=>team!==actor.team)},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState,selected:actor,selectedSkill}),
    combatTargets:()=>game.units.filter(unit=>unit.alive),
    canUseSkill:(unit,skill)=>engine.unitRuntime.canUseSkill(unit,skill),
    consumeSkill:(unit,skill)=>engine.unitRuntime.consumeSkill(unit,skill),
    effectiveSkill:(unit,skill)=>engine.unitRuntime.applyResourceScaling(unit,skill),
    targetType:skill=>skill.targetType||'SINGLE',
    resourceFor:(unit,skill)=>engine.unitRuntime.resourceCost?.(unit,skill),
    unitAt:(x,y)=>game.units.find(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y)||null,
    enterTile:preview?undefined:enterTile,
    traverseUnitPath:preview?undefined:traverseUnitPath,
    handleDefeated:hooks?.handleDefeated,
    damageUnitFlat:hooks?.damageUnitFlat,
    pushLog:hooks?.pushLog||(()=>{}),
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:skill=>{selectedSkill=skill},setSelectedSkillVariant:()=>{},
    setMode:()=>{},setCommandPanelCollapsed:()=>{},render:()=>{},emitState:()=>{}
  });
  return {controller,getSelectedSkill:()=>selectedSkill};
}

// TacticalEngine.reachable() may normalize facing during a range preview.
// Never allow a rejected instruction or a private skill projection to mutate
// the authoritative room merely by asking which locations are selectable.
function previewWorld(game){
  return {...game,units:game.units.map(unit=>({...unit,
    verticalState:unit.verticalState?{...unit.verticalState}:unit.verticalState}))};
}

export function canonicalTransportOptions(game,actor,engine){
  const skills=actorTransportSkills(actor,engine);
  if(!skills.length)return [];
  const preview=previewWorld(game),previewActor=preview.units.find(u=>u.id===actor.id);
  const {controller}=originalController(preview,engine,null,null,previewActor,{preview:true});
  return skills.flatMap(skill=>controller.targetableEntities(previewActor,skill)
    .map(target=>({skillId:skill.id,skillName:skill.name,
      targetId:target.id,targetName:target.character?.name||target.id})));
}

export function castCanonicalTransport(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','skillId','targetId','x','y'])||
     action.type!=='CAST_TRANSPORT'||
     ![action.unitId,action.skillId,action.targetId].every(validId)||
     !Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
    fail('INVALID_TRANSPORT_COMMAND');
  const actor=game.units.find(u=>u.id===action.unitId&&u.team===TEAM[seat]&&u.alive);
  const target=game.units.find(u=>u.id===action.targetId&&u.alive);
  if(!actor||actor.acted||actor.waited||!target||target.id===actor.id)
    fail('TRANSPORT_ACTOR_OR_TARGET_UNAVAILABLE');
  const skill=actorTransportSkills(actor,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  if(skill.utilityAction.type==='CARRY_ALLY'?target.team!==actor.team:target.team===actor.team)
    fail('INVALID_TRANSPORT_RELATION');
  const preview=previewWorld(game);
  const previewActor=preview.units.find(u=>u.id===actor.id);
  const previewTarget=preview.units.find(u=>u.id===target.id);
  const probe=originalController(preview,engine,null,null,previewActor,{preview:true});
  if(!probe.controller.targetableEntities(previewActor,skill).some(u=>u.id===target.id))
    fail('ILLEGAL_TRANSPORT_TARGET');
  probe.controller.prepareAttack(previewActor,previewTarget,skill);
  const release=SkillDatabase.get(skill.utilityAction.releaseSkillId);
  if(probe.getSelectedSkill()?.id!==release?.id)fail('OFFICIAL_TRANSPORT_PICKUP_REJECTED');
  const destination=TacticalEngine.tile(game.battlefield.map,action.x,action.y);
  if(!destination||!probe.controller.mapTargetTiles(previewActor,release)
    .some(tile=>tile.x===destination.x&&tile.y===destination.y))
    fail('ILLEGAL_TRANSPORT_LANDING');
  // Recompute with authoritative, current references. No client-supplied
  // path, altitude, fall damage or carry state is accepted.
  const {controller,getSelectedSkill}=originalController(game,engine,hooks,checkMatchEnd,actor);
  controller.prepareAttack(actor,target,skill);
  if(getSelectedSkill()?.id!==release.id)fail('OFFICIAL_TRANSPORT_PICKUP_REJECTED');
  const from={x:actor.x,y:actor.y},passengerFrom={x:target.x,y:target.y,z:target.z},
    manaBefore=actor.mana,passengerHpBefore=target.hp;
  if(controller.executeMapSkill(actor,destination,release)!==true)
    fail('OFFICIAL_TRANSPORT_RELEASE_REJECTED');
  // No pending transport survives this synchronous command. Death, falls,
  // resource costs and collision results are ONLY those of the official core.
  return {accepted:true,state:game,unitId:actor.id,targetId:target.id,
    skillId:skill.id,from,passengerFrom,
    to:{x:actor.x,y:actor.y},passengerTo:{x:target.x,y:target.y,z:target.z},
    manaBefore,manaAfter:actor.mana,passengerHpBefore,passengerHpAfter:target.hp};
}
