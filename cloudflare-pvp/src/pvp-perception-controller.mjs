/**
 * Browser / Worker bridge for the same BattlePerceptionEngine.
 * Only the room's official state is serialized; no client supplies world data.
 * The single-player rules for visibility, injected hallucinations, world
 * isolation and action/cost reconciliation live in js/battle-perception-engine.
 */
import {createBattlePerceptionEngine,createBattlePerceptionState} from '../../js/battle-perception-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {StageDatabase} from '../../js/stage-database.js';
import {SkillDatabase} from '../../js/skill-database.js';
import '../../js/tactical-action-controller.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';

const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const fail=code=>{throw new PvpCommandError(code)};
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join('|')===keys.slice().sort().join('|');
const validId=id=>typeof id==='string'&&id.length>0;

export function createCanonicalPerception(game,engine){
  game.perceptionState??=createBattlePerceptionState();
  const world=()=>({map:game.battlefield.map,units:game.units,
    stage:game.stage||StageDatabase.get(game.stageId),
    stageState:game.stageState,environmentState:game.environmentState,
    cores:game.battlefield.cores,fieldState:game.fieldState});
  const replaceWorld=next=>{
    game.battlefield.map=next.map;game.battlefield.cores=next.cores;
    game.stage=next.stage;game.stageState=next.stageState;
    game.environmentState=next.environmentState;game.units=next.units;
    game.fieldState=next.fieldState;
  };
  // The Worker has no browser ground-inventory singleton. Its card/item
  // commands may only manipulate the room's own persisted item collection.
  return createBattlePerceptionEngine({state:game.perceptionState,world,replaceWorld,
    tactical:TacticalEngine,unitRuntime:()=>engine.unitRuntime,
    itemDatabase:()=>globalThis.ItemDatabase,
    groundItems:()=>game.battleGroundItems||[],
    cardStates:()=>game.cards||[],
    restoreGroundItems:items=>{if(game.battleGroundItems!==undefined)game.battleGroundItems=items;},
    random:engine.random,
    teams:{PLAYER:TEAM[0],ENEMY:TEAM[1],NEUTRAL:'N'},
    storeRuntimeMap:false,
    onSwitch:()=>engine.unitRuntime.syncLiveRoster(game.units),
    onRestore:()=>{engine.unitRuntime.syncLiveRoster(game.units);
      engine.unitRuntime.reconcileCompanions(game.units);}
  });
}

/** A capability contract, not a Velsa or spell ID whitelist. */
export function isCanonicalPerceptionSkill(skill){
  const action=skill?.utilityAction;
  if(!action||action.type!=='SCHEDULE_TURN_SIMULATION'||
     action.mode!=='MIRROR_PERCEPTION'||action.illusionPool!=='OBSERVED_HOSTILES'||
     !Number.isSafeInteger(action.durationTurns)||action.durationTurns<1||
     !Number.isSafeInteger(action.illusionCount)||action.illusionCount<0||
     !exact(action,['type','mode','durationTurns','illusionPool','illusionCount'])||
     !['MAGIC','SPECIAL'].includes(skill.category)||skill.target!=='ENEMY'||
     (skill.targetType&&skill.targetType!=='SINGLE')||
     !skill.range||!Number.isSafeInteger(skill.range.min)||
     !Number.isSafeInteger(skill.range.max)||skill.range.min<0||skill.range.max<skill.range.min||
     Number(skill.power||0)!==0||skill.effects||skill.relationEffects||
     skill.statusEffects||skill.postEffects||skill.afterUseEffects||
     skill.bloodShadow||skill.bloodBurst||skill.sanctuary||skill.smokeField||
     skill.channel||skill.approach||skill.moveToTarget||skill.variants?.length||
     skill.terrainTargeting||skill.areaDamage||skill.aoeDamage||skill.environmentForces||
     skill.hydrologyFlood||skill.trapPlacement)return false;
  return true;
}

export function canonicalPerceptionOptions(actor,engine){
  if(!actor?.alive||actor.acted||actor.waited)return[];
  return SkillDatabase.list(engine.effect.skillIds(actor))
    .filter(skill=>isCanonicalPerceptionSkill(skill)&&engine.unitRuntime.canUseSkill(actor,skill));
}

export function castCanonicalPerception(game,action,seat,engine,hooks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','unitId','targetId','skillId'])||action.type!=='CAST_PERCEPTION'||
     ![action.unitId,action.targetId,action.skillId].every(validId))
    fail('INVALID_PERCEPTION_COMMAND');
  if(game.pendingAttack)fail('ATTACK_ALREADY_PENDING');
  const actor=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===TEAM[seat]);
  const target=game.units.find(u=>u.id===action.targetId&&u.alive&&u.team===TEAM[1-seat]);
  if(!actor||actor.acted||actor.waited||!target)fail('PERCEPTION_ACTOR_OR_TARGET_UNAVAILABLE');
  const skill=canonicalPerceptionOptions(actor,engine).find(s=>s.id===action.skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  // The same official controller determines actual range / visibility. The
  // client may not provide illusion positions, duration or resource values.
  const perception=createCanonicalPerception(game,engine);
  let scheduled=false;
  const controller=globalThis.TacticalActionController.create({
    TEAM:{PLAYER:TEAM[seat],ENEMY:TEAM[1-seat]},
    actionState:()=>({map:game.battlefield.map,units:game.units,
      environmentState:game.environmentState}),
    combatTargets:()=>game.units.filter(u=>u.alive),
    targetType:s=>s.targetType||'SINGLE',
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
    scheduleTurnSimulation:data=>{
      const record=perception.schedule(data);scheduled=!!record;return record;
    },
    checkMatchEnd:checkMatchEnd||(()=>false),maybeAutoEndPlayerTurn:()=>false,
    setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},setMode:()=>{},
    render:()=>{},pushLog:hooks.pushLog
  });
  if(!controller.targetableEntities(actor,skill).some(u=>u.id===target.id))
    fail('ILLEGAL_PERCEPTION_TARGET');
  const manaBefore=actor.mana;
  controller.prepareAttack(actor,target,skill);
  if(!scheduled||actor.mana>=manaBefore&&Number(skill.manaCost||0)>0||!actor.acted)
    fail('OFFICIAL_PERCEPTION_SCHEDULE_REJECTED');
  return {accepted:true,state:game,unitId:actor.id,skillId:skill.id,
    targetTeam:target.team,manaBefore,manaAfter:actor.mana};
}

/** A projection for the unaffected side MUST never expose a mirror-only unit. */
export function canonicalWorldForViewer(game,seat){
  const session=game.perceptionState?.session;
  if(!session?.active||session.team===TEAM[seat])return game;
  const real=session.real;
  return {...game,battlefield:{...game.battlefield,map:real.map,cores:real.cores},
    units:real.units,stage:real.stage,stageState:real.stageState,
    environmentState:real.environmentState,fieldState:real.fieldState};
}
