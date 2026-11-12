import {ColinShieldMobilityEngine} from "../../js/colin-shield-mobility-engine.js";
/**
 * Headless battle command integration under development. NOT DEPLOYED.
 *
 * Every geometry, environment, card and unit rule is delegated to the exact
 * js/ engine. This adapter only verifies player identity/phase and supplies
 * mandatory event callbacks. It must not become a second game ruleset.
 *
 * Basic attack/reactions, capture and Core attacks have integration tests.
 * Advanced skills, spell cards and full environmental event parity remain
 * incomplete, so this may not be activated in production.
 */
import { CardDatabase } from '../../js/card-database.js';
import { SkillDatabase } from '../../js/skill-database.js';
import { StageDatabase } from '../../js/stage-database.js';
import { StageEngine } from '../../js/stage-engine.js';
import { DeploymentEngine } from '../../js/deployment-engine.js';
import { TacticalEngine } from '../../js/tactical-engine.js';
import { VerticalMobilityEngine } from '../../js/vertical-mobility-engine.js';
import { ItemRuntimeEngine } from '../../js/item-runtime-engine.js';
import { DeathLifecycleEngine } from '../../js/death-lifecycle-engine.js';
import { BattleCoreCaptureController } from '../../js/battle-core-capture-controller.js';
import { BattleObjectiveController } from '../../js/battle-objective-controller.js';
import '../../js/objective-engine.js';
import { CardPhaseEngine } from '../../js/card-phase-engine.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import { deployCanonicalCard,projectLegalDeploymentTiles } from './pvp-headless-deployment.mjs';
import { withCanonicalEngines } from './pvp-engine-context.mjs';
import { createCanonicalEnvironmentController } from './pvp-environment-controller.mjs';
import {declareCanonicalAttack,reactCanonicalAttack,pendingReactionOptions,canonicalDirectAttackSkillOptions,commitCanonicalTargetApproach} from './pvp-headless-engagement.mjs';
import {canonicalTargetPlan} from './pvp-headless-target-plan.mjs';
import {advanceCanonicalRound} from './pvp-headless-turns.mjs';
import {castCanonicalDirectEffectSkill,canonicalDirectEffectSkillOptions} from './pvp-headless-effect-skills.mjs';
import {castCanonicalSelfUtility,canonicalSelfUtilityOptions} from './pvp-headless-self-utility.mjs';
import {castCanonicalEnvironmentContact,canonicalEnvironmentContactOptions} from './pvp-headless-environment-contact.mjs';
import {castCanonicalEnchantment,completeCanonicalEnchantmentFollowup,canonicalEnchantmentOptions,createOfficialEnchantmentController,canonicalEnchantmentImpactHooks} from './pvp-headless-enchantment.mjs';
import {playCanonicalInstantCard} from './pvp-headless-instant-cards.mjs';
import {playCanonicalTargetedCard} from './pvp-headless-targeted-cards.mjs';
import {castCanonicalBloodShadow,chooseCanonicalBloodMemory,canonicalBloodShadowTargets,bloodMemoryOptionsForSeat} from './pvp-headless-blood-shadow.mjs';
import {castCanonicalBloodBurst,canonicalBloodBurstSkills} from './pvp-headless-blood-burst.mjs';
import {castCanonicalAreaField,canonicalAreaFieldSkillOptions,createCanonicalAreaFields} from './pvp-field-controller.mjs';
import {castCanonicalMapSkill,canonicalImmediateMapSkillOptions} from './pvp-headless-map-skills.mjs';
import {castCanonicalTransport,canonicalTransportOptions} from './pvp-headless-transport.mjs';
import {castCanonicalCharge,canonicalChargeOptions} from './pvp-headless-charge.mjs';
import {castCanonicalPickpocket,canonicalPickpocketOptions} from './pvp-headless-pickpocket.mjs';
import {createCanonicalPerception,castCanonicalPerception,canonicalPerceptionOptions,canonicalWorldForViewer} from './pvp-perception-controller.mjs';
import './pvp-canonical-setup.mjs';
import '../../js/unit-animation-engine.js';
import {projectCanonicalAimOptions} from './pvp-headless-aim-projection.mjs';
import '../../js/tactical-action-controller.js';

const OWNER=['PLAYER','ENEMY'];
const UNIT_TEAM=['P','E'];
const CARD_PHASE=['PLAYER_CARD_PHASE','ENEMY_CARD_PHASE'];
const TACTICAL_PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const eventTypes=new Set(['ENTER_TILE','ROUND_START','UNIT_DEFEATED','DEPLOYMENT_POINT_CAPTURED']);
function fail(code){throw new PvpCommandError(code);}
function sameKeys(o, expected) {
  return o && typeof o==='object' && !Array.isArray(o) &&
    Object.keys(o).sort().join('|')===expected.slice().sort().join('|');
}
function requireReady(game){
  if(!game?.battlefield?.map||!game.environmentState||!game.stageState||
     !Array.isArray(game.units)||!Array.isArray(game.cards)||game.cards.length!==2||
     !Number.isSafeInteger(game.round))fail('CANONICAL_WORLD_REQUIRED');
}
function seatOwner(game,seat){
  if(seat!==0&&seat!==1)fail('BAD_SEAT');
  return game.activeSeat===seat;
}
/** Core attacks have a stricter official orchestration contract than a
 * normal direct engagement. This predicate is shared by the command reducer
 * and the seat-private menu projection: the client does not infer eligibility.
 */
export function isCanonicalCoreAttackSkill(unit,skill){
  return !!skill&&skill.category==='ATTACK'&&skill.target==='ENEMY'&&
    (!skill.targetType||skill.targetType==='SINGLE')&&!!skill.weapon&&
    !skill.utilityAction&&!skill.approach&&!skill.bloodShadow&&!skill.channel&&
    !skill.effects&&!skill.relationEffects&&!skill.verdictCross&&
    !skill.affixes?.length&&!unit.character?.passives?.includes('AMBUSH');
}
function officialSkillView(unit,skill,engine){
  const range=TacticalEngine.range(skill);
  return {id:skill.id,name:skill.name,range:{min:range.min,max:range.max},
    resourceLabel:engine.unitRuntime.resourceLabel(unit,skill)};
}
function snapshotUnit(u){return {
  id:u.id,team:u.team,characterId:u.character?.id,x:u.x,y:u.y,z:u.z,
  shieldPassengerId:u.shieldPassengerId||null,shieldRidingOn:u.shieldRidingOn||null,
  shieldMobilityMode:u.shieldMobilityMode||null,
  hp:u.hp,mana:u.mana,alive:u.alive,moved:u.moved,acted:u.acted,waited:u.waited,
  facing:u.facing,resources:u.resources
};}
function serverCallbacks(game,engine){
  const logs=game.events??=([]);
  const pushLog=(message,type='SYSTEM')=>{
    logs.push({type,text:String(message),seat:game.activeSeat});
    if(logs.length>160)logs.splice(0,logs.length-160);
  };
  const stageEvent=event=>{
    if(event?.type==='ENTER_TILE'&&event.unitId){
      const carrier=game.units.find(u=>u.id===event.unitId);
      if(carrier?.shieldPassengerId)ColinShieldMobilityEngine.syncPassenger(game.units,carrier,{movement:true});
      if(ColinShieldMobilityEngine.shieldOccupied(carrier))engine.effect.removeEffectById(carrier,"FULL_SHIELD_DEFENSE");
    }
    if(!eventTypes.has(event?.type))fail('CANONICAL_STAGE_EVENT_UNSUPPORTED');
    // Script spawns follow tactical-game.spawnFromScript one-to-one, but the
    // resulting unit is persisted in the authoritative room rather than a
    // browser-local roster. StageEngine is still the only script dispatcher.
    const spawned=action=>{
      const requested=String(action.team||'ENEMY').toUpperCase();
      const team=requested==='PLAYER'?'P':requested==='NEUTRAL'?'N':'E';
      // A neutral character needs its original autonomous actor turn before
      // committing a room that cannot legally advance to the next round.
      if(team==='N')fail('CANONICAL_NEUTRAL_ACTOR_TURN_REQUIRED');
      if(game.units.some(u=>u.alive&&u.x===action.x&&u.y===action.y))return null;
      const character=globalThis.CHARACTERS?.[action.characterId];
      if(!character)return null;
      const prefix=team==='P'?'p':team==='N'?'n':'e';
      let n=0,id;
      do{id=`${prefix}s${n++}`;}while(game.units.some(u=>u.id===id));
      const created=engine.unitRuntime.create({id,team,
        characterId:action.characterId,x:action.x,y:action.y,
        map:game.battlefield.map});
      if(!created)return null;
      const {_runtimeMap,...unit}=created;
      game.units.push(unit);
      engine.unitRuntime.syncLiveRoster(game.units);
      engine.effect.syncConditionalPassives([unit],game.environmentState);
      if(game.fieldState?.smokeFields?.length)
        createCanonicalAreaFields(game,engine,{pushLog,handleDefeated}).syncSmokeCover(unit);
      pushLog(`${character.name} 出現在 (${action.x},${action.y})。`);
      return unit;
    };
    StageEngine.run(game.stageState,event,{units:game.units,
      log:pushLog,spawn:spawned,onObjectiveChanged:()=>{}});
  };
  const death=DeathLifecycleEngine.create({stageEvent,pushLog,
    cardStateFor:unit=>game.perceptionState?.session?.defeatCards?.[unit.team==='P'?0:1]||
      game.cards[unit.team==='P'?0:1],
    deathScope:()=>game.perceptionState?.session,allowRewards:()=>!game.perceptionState?.session?.active,
    onDefeated:()=>{},onFinalized:()=>{}});
  const handleDefeated=(unit,source,cause)=>death.finalize(unit,source,cause);
  const damageUnitFlat=(unit,rawDamage,name='ENVIRONMENT')=>{
    if(!unit?.alive)return;
    const actual=engine.effect.applyDamage(unit,rawDamage,{kind:'EXTERNAL'});
    if(!actual)fail('CANONICAL_ENVIRONMENT_DAMAGE_FAILED');
    pushLog(`${name} → ${unit.character.name}｜${actual.hpLoss} 傷害｜HP ${unit.hp}。`,'BATTLE');
    if(unit.hp<=0)handleDefeated(unit,null,{type:'ENVIRONMENT',name});
  };
  return {damageUnitFlat,handleDefeated,stageEvent,pushLog,random:engine.random};
}
// Official objectives are the sole Core victory authority for all actions.
function matchObjectiveAuthority(game,hooks){
  const stage=StageDatabase.get(game.stageId);
  stage.cores=game.battlefield.cores;
  stage.deploymentPoints=game.battlefield.deploymentPoints;
  const getState=()=>({stage,stageState:game.stageState,units:game.units,
    cores:game.battlefield.cores,round:game.round,cardState:game.cards[0],
    enemyCardState:game.cards[1],matchResult:game.matchResult});
  const objective=BattleObjectiveController.create({state:getState,
    setMatchResult:result=>{game.matchResult=result;game.phase='MATCH_ENDED';game.activeSeat=null;},
    onMatchEnd:result=>hooks.pushLog(`Match ended: ${result}`,'SYSTEM')});
  return {stage,getState,objective,checkMatchEnd:()=>game.perceptionState?.session?.active?false:objective.checkMatchEnd()};
}
/** Only a verified authoritative server may start. Never accept seed/maps from clients. */
export function beginCanonicalPlayerCardPhase(game){
  requireReady(game);
  if(game.phase!=='BATTLEFIELD_READY')fail('BATTLE_ALREADY_STARTED');
  if(game.activeSeat!=null)fail('BAD_PREBATTLE_SEAT');
  game.events=[];
  game.activeSeat=0;
  game.phase=CARD_PHASE[0];
  const stage=StageDatabase.get(game.stageId);
  game.stageState??=StageEngine.create(stage.scriptId,{victory:stage.victory,defeat:stage.defeat});
  return withCanonicalEngines(game,engine=>{
    const hooks=serverCallbacks(game,engine);
    hooks.stageEvent({type:'ROUND_START',round:game.round,team:OWNER[0]});
    CardPhaseEngine.begin(game.cards[0]);
    return game;
  });
}
/** Explicit turn + card-phase validation only; official engines perform action rules. */
export function resolveCanonicalPlayerCommand(game,action,seat){
  requireReady(game);
  if(!seatOwner(game,seat))fail('NOT_YOUR_TURN');
  return withCanonicalEngines(game,engine=>{
    // Viewing/rotating the moved actor is NOT a tactical commitment.
    // Preserve the official pending-move origin until an actual action
    // commits it, or until CANCEL_MOVE explicitly restores it.
    if(game.pendingMove&& !['CANCEL_MOVE','ROTATE_UNIT','ADJUST_FLIGHT_ALTITUDE','ADJUST_DIVE_MODE'].includes(action?.type))
      game.pendingMove=null;
    if(action?.type==='CANCEL_MOVE'){
      if(game.phase!==TACTICAL_PHASE[seat]||
         !sameKeys(action,['type','unitId'])||typeof action.unitId!=='string')
        fail('INVALID_CANCEL_MOVE_COMMAND');
      const origin=game.pendingMove;
      const unit=game.units.find(u=>u.id===action.unitId&&u.team===UNIT_TEAM[seat]&&u.alive);
      if(!unit||origin?.unitId!==unit.id||origin.seat!==seat||unit.acted||!unit.moved)
        fail('NO_CANCELABLE_MOVE');
      if(game.units.some(u=>u.alive&&u.id!==unit.id&&u.x===origin.x&&u.y===origin.y))
        fail('MOVE_ORIGIN_OCCUPIED');
      if(globalThis.TacticalActionController?.restorePendingMove(unit,origin,{units:game.units,map:game.battlefield.map})!==true)
        fail('CANONICAL_MOVE_RESTORE_FAILED');
      game.pendingMove=null;
      return {accepted:true,state:game,unitId:unit.id};
    }
    engine.unitRuntime.syncLiveRoster(game.units);
    const hooks=serverCallbacks(game,engine);
    // A blood-shadow attack has already committed teleport/drain before the
    // optional memory choice. No later instruction may replay that attack.
    if(game.pendingBloodMemoryChoice&&action?.type!=='CHOOSE_BLOOD_MEMORY')
      fail('BLOOD_MEMORY_CHOICE_REQUIRED');
    if(action?.type==='CHOOSE_BLOOD_MEMORY')return chooseCanonicalBloodMemory(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    // A self-enchantment is one action with one optional weapon attack. The
    // choice is in the room state (not a transient browser/controller closure).
    // No other unit, spell or turn-end can bypass it after the MP has been paid.
    if(game.pendingEnchantmentFollowup){
      const follow=game.pendingEnchantmentFollowup;
      if(['DECLARE_ATTACK','ATTACK_CORE','ATTACK_ENCHANTED_TERRAIN'].includes(action?.type)){
        const actorId=action.type==='DECLARE_ATTACK'?action.attackerId:action.unitId;
        const caster=game.units.find(u=>u.id===actorId&&u.alive);
        const skill=SkillDatabase.list(caster?engine.effect.skillIds(caster):[]).find(s=>s.id===action.skillId);
        if(actorId!==follow.unitId||skill?.weapon!==follow.weaponSlot)
          fail('ENCHANTMENT_FOLLOWUP_WEAPON_REQUIRED');
      }else if(action?.type!=='REACT_ATTACK'&&action?.type!=='END_ENCHANT_FOLLOWUP')
        fail('ENCHANTMENT_FOLLOWUP_REQUIRED');
    }
    if(action?.type==='CAST_PERCEPTION')return castCanonicalPerception(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_PICKPOCKET')return castCanonicalPickpocket(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_CHARGE')return castCanonicalCharge(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_TRANSPORT')return castCanonicalTransport(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_MAP_SKILL')return castCanonicalMapSkill(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_AREA_FIELD')return castCanonicalAreaField(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_BLOOD_BURST')return castCanonicalBloodBurst(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_BLOOD_SHADOW')return castCanonicalBloodShadow(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_ENCHANTMENT')return castCanonicalEnchantment(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='END_ENCHANT_FOLLOWUP')return completeCanonicalEnchantmentFollowup(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='ATTACK_ENCHANTED_TERRAIN'){
      if(game.phase!==TACTICAL_PHASE[seat]||
         !sameKeys(action,['type','unitId','skillId','x','y'])||
         ![action.unitId,action.skillId].every(x=>typeof x==='string'&&x.length>0)||
         !Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
        fail('INVALID_ENCHANTED_TERRAIN_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.waited)fail('UNIT_CANNOT_ATTACK_TERRAIN');
      const skill=canonicalDirectAttackSkillOptions(unit).find(s=>s.id===action.skillId);
      if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
      if(!engine.effect.weaponEnchantment(unit,skill.weapon))fail('ENCHANTMENT_NOT_ACTIVE');
      const aim=TacticalEngine.tile(game.battlefield.map,action.x,action.y);
      if(!aim)fail('ILLEGAL_TERRAIN_TARGET');
      const {checkMatchEnd}=matchObjectiveAuthority(game,hooks);
      const ctrl=createOfficialEnchantmentController(game,engine,hooks,checkMatchEnd,unit);
      if(ctrl.executeMapSkill(unit,aim,{...skill,terrainTargeting:true})!==true)
        fail('OFFICIAL_TERRAIN_ATTACK_REJECTED');
      if(game.pendingEnchantmentFollowup?.unitId===unit.id)
        game.pendingEnchantmentFollowup=null;
      return {accepted:true,state:game,unitId:unit.id,skillId:skill.id,x:aim.x,y:aim.y};
    }
    if(action?.type==='DECLARE_ATTACK')return declareCanonicalAttack(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='PLAY_TARGET_CARD')return playCanonicalTargetedCard(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='PLAY_INSTANT_CARD')return playCanonicalInstantCard(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_ENVIRONMENT_CONTACT')return castCanonicalEnvironmentContact(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_SELF_UTILITY')return castCanonicalSelfUtility(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='CAST_EFFECT_SKILL')return castCanonicalDirectEffectSkill(
      game,action,seat,engine,hooks,matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='REACT_ATTACK')return reactCanonicalAttack(game,action,seat,engine,hooks,
      matchObjectiveAuthority(game,hooks).checkMatchEnd);
    if(action?.type==='DEPLOY_CARD'){
      // Only official card/deployment engine may commit the character and crystal cost.
      const result=deployCanonicalCard(game,action,seat);
      engine.unitRuntime.reconcileCompanions(game.units);
      // Single-player CardPhaseController.deployAt applies environmental entry
      // hazards immediately after deployment. Do not omit this on the server.
      const deployed=game.units.find(u=>u.id===result.unitId);
      if(!deployed)fail('CANONICAL_DEPLOYED_UNIT_MISSING');
      createCanonicalEnvironmentController(game,hooks).applyEnvironmentHazardToUnit(
        deployed,{reason:'部署進入環境',waterTrigger:'ENTER'});
      createCanonicalAreaFields(game,engine,hooks).syncSmokeCover(deployed);
      return result;
    }
    if(action?.type==='END_CARD_PHASE'){
      if(game.phase!==CARD_PHASE[seat]||!sameKeys(action,['type']))fail('INVALID_END_CARD_PHASE');
      CardPhaseEngine.end(game.cards[seat]);
      game.phase=TACTICAL_PHASE[seat];
      if(seat===1){
        // Single-player enemy phase resets actions only *after* its card phase,
        // and re-locks everything deployed this same round.
        engine.unitRuntime.resetActions(game.units,UNIT_TEAM[seat]);
        engine.unitRuntime.resetActions(game.units,'N');
        engine.effect.syncConditionalPassives(game.units,game.environmentState,{rearmTeam:UNIT_TEAM[seat]});
        game.units.filter(u=>u.team===UNIT_TEAM[seat]&&u.deployedRound===game.round)
          .forEach(u=>{u.moved=true;u.acted=true;u.waited=true;});
      }
      return {accepted:true,state:game};
    }
    if(['DROP_BATTLE_ITEM','PICKUP_BATTLE_ITEM','TRANSFER_BATTLE_ITEM'].includes(action?.type)){
      if(game.phase!==TACTICAL_PHASE[seat]||typeof action.unitId!=='string')
        fail('INVALID_ITEM_INTERACTION');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit)fail('INVALID_ITEM_ACTOR');
      let result;
      if(action.type==='DROP_BATTLE_ITEM'){
        if(!sameKeys(action,['type','unitId','payloadId'])||typeof action.payloadId!=='string')
          fail('INVALID_ITEM_INTERACTION');
        result=ItemRuntimeEngine.drop(unit,action.payloadId);
      }else if(action.type==='PICKUP_BATTLE_ITEM'){
        if(!sameKeys(action,['type','unitId','groundId'])||typeof action.groundId!=='string')
          fail('INVALID_ITEM_INTERACTION');
        result=ItemRuntimeEngine.pickup(unit,action.groundId);
      }else{
        if(!sameKeys(action,['type','unitId','payloadId','targetUnitId'])||
           typeof action.payloadId!=='string'||typeof action.targetUnitId!=='string')
          fail('INVALID_ITEM_INTERACTION');
        const target=game.units.find(u=>u.id===action.targetUnitId&&u.alive&&u.team===UNIT_TEAM[seat]);
        if(!target)fail('INVALID_ITEM_RECIPIENT');
        result=ItemRuntimeEngine.transfer(unit,target,action.payloadId);
      }
      if(!result?.ok)fail(result?.reason||'ITEM_INTERACTION_DENIED');
      hooks.pushLog(`${unit.character.name} 道具操作｜${action.type}`,'BATTLE');
      return{accepted:true,state:game,unitId:unit.id,itemId:result.payload?.itemId};
    }
    if(action?.type==='USE_BATTLE_ITEM'){
      if(game.phase!==TACTICAL_PHASE[seat]||
         !sameKeys(action,['type','unitId','payloadId'])||
         typeof action.unitId!=='string'||typeof action.payloadId!=='string')
        fail('INVALID_ITEM_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.waited)fail('UNIT_CANNOT_USE_ITEM');
      const available=ItemRuntimeEngine.list(unit).find(({payload})=>payload.id===action.payloadId);
      if(!available||!ItemRuntimeEngine.canUse(unit,action.payloadId))fail('ITEM_NOT_AVAILABLE');
      // Owned player stash is browser-private: this test backend cannot
      // consume its localStorage counter as if it were an authoritative DB.
      if(available.payload.owned===true)fail('PVP_OWNED_INVENTORY_NOT_CONNECTED');
      const result=ItemRuntimeEngine.use(unit,action.payloadId);
      if(!result.ok)fail('CANONICAL_ITEM_USE_REJECTED');
      if(result.consumeAction){unit.acted=true;unit.waited=true;unit.moved=true;}
      hooks.pushLog(`${unit.character.name} 使用「${result.item.name}」。`,'BATTLE');
      return {accepted:true,state:game,itemId:result.item.id,unitId:unit.id};
    }
    // Native UnitControlUI input, with no duplicate facing/flight formulas.
    // Official TacticalEngine and VerticalMobilityEngine are the only owners.
    if(['ROTATE_UNIT','ADJUST_FLIGHT_ALTITUDE','ADJUST_DIVE_MODE'].includes(action?.type)){
      if(game.phase!==TACTICAL_PHASE[seat]||
         !sameKeys(action,['type','unitId','steps'])||
         typeof action.unitId!=='string'||!Number.isInteger(action.steps)||
         ![-1,1].includes(action.steps))fail('INVALID_UNIT_CONTROL_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.waited)fail('UNIT_CONTROL_UNAVAILABLE');
      if(action.type==='ROTATE_UNIT'){
        const facing=TacticalEngine.rotateFacing(unit,action.steps);
        if(!facing)fail('INVALID_UNIT_FACING');
        return {accepted:true,state:game,facing};
      }
      const tile=TacticalEngine.tile(game.battlefield.map,unit.x,unit.y);
      if(!tile)fail('INVALID_UNIT_POSITION');
      if(action.type==='ADJUST_DIVE_MODE'){
        const vertical=VerticalMobilityEngine;
        const before=vertical.describe(unit,tile),waterDepth=vertical.waterDepth(tile);
        if(!vertical.capabilities(unit).canDive||waterDepth<=0)
          fail('DIVE_CONTROL_UNAVAILABLE');
        if(action.steps<0
          ?before.mode==='DIVING'||waterDepth<vertical.bodyHeight(unit)
          :before.mode!=='DIVING')fail('DIVE_MODE_UNAVAILABLE');
        const desired=action.steps<0?'DIVING':'SWIMMING';
        const changed=vertical.setMode(unit,tile,desired);
        if(!changed?.ok||changed.state?.mode!==desired)fail('DIVE_MODE_UNAVAILABLE');
        return {accepted:true,state:game,verticalMode:changed.state.mode,depth:changed.state.depth};
      }
      const before=VerticalMobilityEngine.describe(unit,tile);
      const next=VerticalMobilityEngine.adjustFlightAltitude(unit,tile,action.steps);
      if(!next?.ok||(next.state?.flightAltitude===before.flightAltitude&&next.state?.mode===before.mode))
        fail('FLIGHT_ALTITUDE_UNAVAILABLE');
      return {accepted:true,state:game,flightAltitude:next.state.flightAltitude};
    }
    if(action?.type==='BOARD_SHIELD_PASSENGER'||action?.type==='DISEMBARK_SHIELD_PASSENGER'){
      if(game.phase!==TACTICAL_PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
      const boarding=action.type==='BOARD_SHIELD_PASSENGER';
      if(!sameKeys(action,boarding?['type','unitId','passengerId']:['type','unitId','x','y']))
        fail('INVALID_SHIELD_PASSENGER_COMMAND');
      const carrier=game.units.find(u=>u.alive&&u.id===action.unitId&&u.team===UNIT_TEAM[seat]);
      if(!carrier||carrier.acted||carrier.waited)fail('SHIELD_CARRIER_UNAVAILABLE');
      const passenger=boarding?game.units.find(u=>u.id===action.passengerId):null;
      const accepted=boarding
        ?ColinShieldMobilityEngine.board(game.battlefield.map,game.units,carrier,passenger)
        :ColinShieldMobilityEngine.dismount(game.battlefield.map,game.units,carrier,action.x,action.y);
      if(!accepted)fail('SHIELD_PASSENGER_NOT_LEGAL');
      ColinShieldMobilityEngine.syncPassenger(game.units,carrier);
      hooks.pushLog(`${carrier.character.name} 完成大盾搭乘操作。`,'SYSTEM');
      return {accepted:true,state:game};
    }
    if(action?.type==='MOVE_UNIT'){
      if(game.phase!==TACTICAL_PHASE[seat]||!sameKeys(action,['type','unitId','x','y'])||
         typeof action.unitId!=='string'||!Number.isSafeInteger(action.x)||!Number.isSafeInteger(action.y))
        fail('INVALID_MOVE_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.moved||unit.waited)fail('UNIT_CANNOT_MOVE');
      const path=TacticalEngine.pathTo(game.battlefield.map,game.units,unit,action.x,action.y);
      if(!path.length||path.at(-1)?.x!==action.x||path.at(-1)?.y!==action.y)
        fail('ILLEGAL_MOVE_PATH');
      const environment=createCanonicalEnvironmentController(game,hooks);
      const passenger=game.units.find(u=>u.id===unit.shieldPassengerId);
      const initial={unitId:unit.id,seat,x:unit.x,y:unit.y,z:unit.z,facing:unit.facing,
        passengerId:passenger?.id||null,passengerMoved:!!passenger?.moved,
        passengerRideMoved:!!passenger?.shieldRideMoved};
      let movement={completed:true};
      let previousTile=TacticalEngine.tile(game.battlefield.map,unit.x,unit.y);
      for(const step of path){
        if(ColinShieldMobilityEngine.hasShield(unit))
          unit.shieldMobilityMode=ColinShieldMobilityEngine.modeAt(unit,step,previousTile);
        movement=environment.traverseUnitPath(unit,[step]);
        if(!movement.completed)break;
        previousTile=step;
      }
      if(ColinShieldMobilityEngine.hasShield(unit)){
        let previous=TacticalEngine.tile(game.battlefield.map,initial.x,initial.y);
        let sliding=false;
        for(const step of path){
          if(ColinShieldMobilityEngine.isSnowDescent(unit,previous,step))sliding=true;
          previous=step;
        }
        unit.shieldMobilityMode=ColinShieldMobilityEngine.modeAt(unit,TacticalEngine.tile(game.battlefield.map,unit.x,unit.y));
        unit._shieldMoveKind=sliding?"SNOW_SLED":null;
      }
      ColinShieldMobilityEngine.syncPassenger(game.units,unit,{movement:true});
      if(movement?.completed&&path.some(step=>step.shieldTransit)||
         movement?.completed&&["SNOW_SLED","ICE_SLED","BOAT"].includes(unit._shieldMoveKind||unit.shieldMobilityMode)){
        const start=TacticalEngine.tile(game.battlefield.map,initial.x,initial.y),points=[];
        let support=null;
        for(const step of path){
          if(step.shieldTransit){support=step.shieldTransit.guardianId;points.push({...step.shieldTransit.via});}
          const tile=TacticalEngine.tile(game.battlefield.map,step.x,step.y);
          points.push({x:step.x,y:step.y,z:VerticalMobilityEngine.describe(unit,tile).renderZ});
        }
        const kind=support?"SHIELD_STEP":unit._shieldMoveKind==="SNOW_SLED"?"SHIELD_SNOW_SLED":unit.shieldMobilityMode==="ICE_SLED"?"SHIELD_ICE_SLED":"SHIELD_BOAT";
        globalThis.UnitAnimationEngine?.emitMove?.(unit,{from:{...initial,z:VerticalMobilityEngine.describe(unit,start)?.renderZ??initial.z},path:points,kind,shieldSupportId:support,
          shieldSupportFacing:support?TacticalEngine.facingToward(initial,path.find(step=>step.shieldTransit)||path.at(-1),unit.facing):null});
      }
      delete unit._shieldMoveKind;
      createCanonicalAreaFields(game,engine,hooks).syncSmokeCover(unit);
      if(unit.alive && (unit.x!==initial.x||unit.y!==initial.y))engine.effect.interruptChannel(unit,'MOVE');
      unit.moved=true;
      // As in the local game, an interrupted/forced movement is committed.
      game.pendingMove=unit.alive&&movement?.completed===true?initial:null;
      return {accepted:true,state:game,movement};
    }
    if(action?.type==='END_TACTICAL_PHASE'){
      if(game.phase!==TACTICAL_PHASE[seat]||!sameKeys(action,['type']))fail('INVALID_END_TACTICAL');
      if(seat===1)return advanceCanonicalRound(game,engine,hooks,
        matchObjectiveAuthority(game,hooks).checkMatchEnd);
      // Original tactical-game.endPlayerTurn: real card consumption and
      // turn-end effects happen while the mirror is active; then restore
      // the real world BEFORE enemy field pulses and enemy hallucinations.
      CardPhaseEngine.resolveTurnEndEffects(game.cards[seat],{units:game.units,team:UNIT_TEAM[seat]});
      createCanonicalPerception(game,engine).end(UNIT_TEAM[seat]);
      createCanonicalAreaFields(game,engine,hooks).tickSanctuaries(UNIT_TEAM[1]);
      if(matchObjectiveAuthority(game,hooks).checkMatchEnd())return {accepted:true,state:game};
      createCanonicalPerception(game,engine).begin(UNIT_TEAM[1]);
      game.activeSeat=1;
      game.phase=CARD_PHASE[1];
      const stage=StageDatabase.get(game.stageId);
      CardPhaseEngine.begin(game.cards[1],{handSize:stage.enemyCardRules?.handSize||stage.cardRules?.handSize});
      return {accepted:true,state:game};
    }
    if(action?.type==='ATTACK_CORE'){
      if(game.phase!==TACTICAL_PHASE[seat]||
         !sameKeys(action,['type','unitId','skillId','coreOwner'])||
         ![action.unitId,action.skillId,action.coreOwner].every(x=>typeof x==='string'))
        fail('INVALID_CORE_ATTACK_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.waited)fail('UNIT_CANNOT_ATTACK_CORE');
      const {getState,checkMatchEnd}=matchObjectiveAuthority(game,hooks);
      const coreHost=BattleCoreCaptureController.create({TEAM:{PLAYER:'P',ENEMY:'E'},
        state:getState,pushLog:hooks.pushLog,checkMatchEnd,
        commitPendingMove:()=>true});
      const otherOwner=OWNER[1-seat];
      if(action.coreOwner!==otherOwner)fail('CANNOT_ATTACK_FRIENDLY_CORE');
      const enemyCore=coreHost.coreForOwner(otherOwner);
      const target=coreHost.coreCombatTarget(enemyCore,UNIT_TEAM[seat]);
      if(!target)fail('CORE_DESTROYED');
      // UnitRuntimeEngine and TacticalEngine are canonical sources; complex
      // variant/ambush/enchantment follow-ups are not yet permitted here.
      const skill=globalThis.SkillDatabase.list(unit.character.skills).find(x=>x.id===action.skillId);
      if(!isCanonicalCoreAttackSkill(unit,skill))fail('FULL_CORE_SKILL_ORCHESTRATION_REQUIRED');
      if(!engine.unitRuntime.canUseSkill(unit,skill))fail('ATTACK_RESOURCES_UNAVAILABLE');
      const plan=canonicalTargetPlan(game,unit,target,skill,engine,{extraTargets:[target]});
      if(!plan)fail('ILLEGAL_CORE_ATTACK_TARGET');
      const approach=commitCanonicalTargetApproach(game,unit,plan,skill,engine,hooks,checkMatchEnd);
      if(!approach.ready)return {accepted:true,state:game,movement:approach.movement,attackInterrupted:true};
      if(!TacticalEngine.canTarget(game.battlefield.map,unit,target,skill,game.environmentState)||
          !engine.unitRuntime.canUseSkill(unit,skill)){
        hooks.pushLog(`${unit.character.name} 移動後無法完成對 Core 的「${skill.name}」攻擊。`,'SYSTEM');
        return {accepted:true,state:game,movement:approach.movement,attackInterrupted:true};
      }
      const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
        actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),
        canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
        consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
        effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
        damageCore:coreHost.damageCore,
        clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
        setMode:()=>{},render:()=>{},maybeAutoEndPlayerTurn:()=>false,
        pushLog:hooks.pushLog,
        ...canonicalEnchantmentImpactHooks(game,hooks)};
      const hpBefore=enemyCore.hp;
      const success=globalThis.TacticalActionController.create(ctx).resolveDirectTargetAttack(unit,target,skill);
      if(success!==true)fail('OFFICIAL_CORE_ATTACK_REJECTED');
      if(game.pendingEnchantmentFollowup?.unitId===unit.id)game.pendingEnchantmentFollowup=null;
      return {accepted:true,state:game,coreHpBefore:hpBefore,coreHpAfter:enemyCore.hp};
    }
    if(action?.type==='CAPTURE_POINT'){
      if(game.phase!==TACTICAL_PHASE[seat]||!sameKeys(action,['type','unitId'])||
        typeof action.unitId!=='string')fail('INVALID_CAPTURE_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted)fail('UNIT_CANNOT_CAPTURE');
      const {getState,checkMatchEnd}=matchObjectiveAuthority(game,hooks);
      const capture=BattleCoreCaptureController.create({TEAM:{PLAYER:'P',ENEMY:'E'},
        state:getState,pushLog:hooks.pushLog,checkMatchEnd,
        stageEvent:hooks.stageEvent,
        commitPendingMove:()=>{
          if(game.pendingMove!=null)fail('UNCOMMITTED_MOVE_NOT_SUPPORTED');
          return true;
        }});
      if(!capture.canUnitCapture(unit)||!capture.executeCapture(unit))fail('ILLEGAL_CAPTURE');
      return {accepted:true,state:game};
    }
    if(action?.type==='WAIT_UNIT'){
      if(game.phase!==TACTICAL_PHASE[seat]||!sameKeys(action,['type','unitId'])||
          typeof action.unitId!=='string')fail('INVALID_WAIT_COMMAND');
      const unit=game.units.find(u=>u.id===action.unitId&&u.alive&&u.team===UNIT_TEAM[seat]);
      if(!unit||unit.acted||unit.waited)fail('UNIT_CANNOT_WAIT');
      unit.moved=true;unit.acted=true;unit.waited=true;
      return {accepted:true,state:game};
    }
    // No fake attack/spell/capture/end-turn transitions before original flows.
    fail('FULL_TACTICAL_ACTION_NOT_CONNECTED');
  });
}
export function tacticalDebugProjection(game,seat){
  requireReady(game);if(seat!==0&&seat!==1)fail('BAD_SEAT');
  // A non-affected player must see the authoritative real world, never the
  // isolated perception battle or its fake units. This is a read-only view.
  game=canonicalWorldForViewer(game,seat);
  return withCanonicalEngines(game,engine=>{
    engine.unitRuntime.syncLiveRoster(game.units);
    const stage=StageDatabase.get(game.stageId);
    stage.cores=game.battlefield.cores;
    stage.deploymentPoints=game.battlefield.deploymentPoints;
    globalThis.AngelWingBarrierEngine?.reconcile?.(game.battlefield.map,game.units);
    const world={map:game.battlefield.map,units:game.units,
      cores:game.battlefield.cores,stage,environmentState:game.environmentState};
    const visible=game.units.filter(u=>u.team===UNIT_TEAM[seat]||
      TacticalEngine.teamCanIdentifyUnit(world,UNIT_TEAM[seat],u,game.environmentState));
    // A private command log is never the global authority event stream.
    // Limit entries to actions from this player's seat and omit any mention of
    // an opponent the OFFICIAL LOS engine says is currently hidden.
    const hidden=game.units.filter(u=>u.alive&&u.team!==UNIT_TEAM[seat]&&
      !TacticalEngine.teamCanIdentifyUnit(world,UNIT_TEAM[seat],u));
    const hiddenNames=hidden.map(u=>u.character?.name).filter(Boolean);
    const battleLog=(game.events||[]).filter(e=>e?.seat===seat&&
      ['BATTLE','SYSTEM','DETAIL'].includes(e.type)&&typeof e.text==='string'&&
      !hiddenNames.some(name=>e.text.includes(name)))
      .slice(-160).map(e=>({type:e.type,text:e.text}));
    // Authenticated MATCH_STATE contract marker: lets mobile clients detect
    // that a deployed Worker is older than the canonical tactical projection.
    return {tacticalProjectionContract:'CT2_NATIVE_TACTICAL_V4',
      phase:game.phase,activeSeat:game.activeSeat,round:game.round,battleLog,
       // Authenticated seat's official current deployable tiles.
       deployableTiles:game.phase===CARD_PHASE[seat]&&game.activeSeat===seat
         ?projectLegalDeploymentTiles(game,seat):[],
      // Only the owning seat receives its unit's battle skill options.
      // The resolved runtime character (loadout + effects) is the authority,
      // not the raw CharacterDatabase template.
      units:visible.map(unit=>({
        ...snapshotUnit(unit),
        // Only already-visible unit effects are exposed; hidden enemies and
        // their buffs never enter this seat-private tactical projection.
        positiveBuffs:engine.effect.positiveBuffChoices(unit),
        ...(unit.team===UNIT_TEAM[seat]?{
          bloodShadowOptions:canonicalBloodShadowTargets(game,unit,engine),
          areaFieldSkills:canonicalAreaFieldSkillOptions(unit,engine)
            .filter(skill=>engine.unitRuntime.canUseSkill(unit,skill))
            .map(skill=>({id:skill.id,name:skill.name})),
          transportOptions:canonicalTransportOptions(game,unit,engine),
          chargeOptions:canonicalChargeOptions(unit,engine),
          pickpocketOptions:canonicalPickpocketOptions(game,unit,engine),
          perceptionSkills:canonicalPerceptionOptions(unit,engine)
            .map(skill=>({id:skill.id,name:skill.name})),
          mapSkills:canonicalImmediateMapSkillOptions(unit,engine)
            .filter(skill=>engine.unitRuntime.canUseSkill(unit,skill))
            .map(skill=>({id:skill.id,name:skill.name,category:skill.category})),
          bloodBurstSkills:canonicalBloodBurstSkills(unit,engine,game.units,{map:world.map,environmentState:game.environmentState})
            .map(skill=>({id:skill.id,name:skill.name})),
           // Full official loadout catalog for the same native skill menu as
           // single-player. Capability-specific option lists below remain the
           // only authority for actionable commands and target legality.
           // Never silently make an owned skill disappear merely because
           // a conditional command has no targets this frame.
           aimOptions:(()=>{
             const aims=projectCanonicalAimOptions(game,seat,unit,engine,{
               coreAttackSkillIds:SkillDatabase.list(unit.character.skills)
                 .filter(skill=>isCanonicalCoreAttackSkill(unit,skill)&&engine.unitRuntime.canUseSkill(unit,skill))
                 .map(skill=>skill.id)
             });
             return aims.map(aim=>{
               const skill=SkillDatabase.get(aim.skillId);
               if(!globalThis.AngelWingBarrierEngine?.isCanonicalSkill?.(skill))return aim;
               const tiles=globalThis.AngelWingBarrierEngine.legalTiles(
                 game.battlefield.map,game.units,unit,{cores:game.battlefield.cores})
                 .map(tile=>({x:tile.x,y:tile.y}));
               return{...aim,tiles,actionableTiles:tiles};
             });
           })(),
           skillCatalog:SkillDatabase.list(engine.effect.skillIds(unit)).map(skill=>({
             ...officialSkillView(unit,skill,engine),category:skill.category,
             usable:engine.unitRuntime.canUseSkill(unit,skill)
           })),
          // The same DeploymentEngine legality drives the offline and online
          // command menu. A capture option is absent until a real point is legal.
          shieldBoardOptions:ColinShieldMobilityEngine.hasShield(unit)&&!unit.shieldPassengerId
            ?game.units.filter(passenger=>ColinShieldMobilityEngine.canBoard(world.map,game.units,unit,passenger))
              .map(passenger=>({passengerId:passenger.id,name:passenger.character.name})):[],
          shieldDismountOptions:ColinShieldMobilityEngine.hasShield(unit)&&unit.shieldPassengerId
            ?ColinShieldMobilityEngine.dismountOptions(world.map,game.units,unit):[],
          itemInteractionAvailable:ItemRuntimeEngine.interactionAvailable(unit),
          groundItemChoices:(game.battleGroundItems||[])
            .filter(entry=>entry.x===unit.x&&entry.y===unit.y)
            .map(entry=>({groundId:entry.id,itemId:entry.itemId,
              name:globalThis.ItemDatabase.get(entry.itemId)?.name||entry.itemId})),
          itemTransferTargets:game.units.filter(other=>other.id!==unit.id&&other.alive&&
            other.team===unit.team&&
            Math.abs(other.x-unit.x)+Math.abs(other.y-unit.y)<=1&&
            ItemRuntimeEngine.list(other).length<ItemRuntimeEngine.capacity(other))
            .map(other=>({unitId:other.id,name:other.character?.name||other.id})),
          itemChoices:ItemRuntimeEngine.list(unit).map(({payload,item})=>({
            payloadId:payload.id,itemId:item.id,name:item.name,
            usable:payload.owned!==true&&ItemRuntimeEngine.canUse(unit,payload.id)
          })),
          capturePoint:(()=>{
            const point=DeploymentEngine.pointAt(stage,unit.x,unit.y);
            return point&&DeploymentEngine.canCapture({stage,units:game.units,unit,point})
              ?{id:point.id,name:point.name}:null;
          })(),
          reachableTiles:game.activeSeat===seat&&game.phase===TACTICAL_PHASE[seat]&&
            !unit.acted&&!unit.moved&&!unit.waited
              ?[...TacticalEngine.reachable(world.map,game.units,unit).entries()].map(([key,cost])=>{
                const [x,y]=key.split(',').map(Number);return{x,y,cost};
              }):[],
          flightControl:(()=>{
            const range=VerticalMobilityEngine.flightAltitudeRange(unit);
            const tile=TacticalEngine.tile(game.battlefield.map,unit.x,unit.y);
            if(!range||!tile)return null;
            const info=VerticalMobilityEngine.describe(unit,tile);
            return {...range,altitude:info.flightAltitude,mode:info.mode};
          })(),
          diveControl:(()=>{
            const tile=TacticalEngine.tile(game.battlefield.map,unit.x,unit.y);
            const vertical=VerticalMobilityEngine;
            if(!tile||!vertical.capabilities(unit).canDive||vertical.waterDepth(tile)<=0)return null;
            const info=vertical.describe(unit,tile);
            return {mode:info.mode,depth:info.depth,maxDepth:info.waterDepth,
              canDive:info.mode!=='DIVING'&&info.waterDepth>=vertical.bodyHeight(unit),
              canSurface:info.mode==='DIVING'};
          })(),
          // Exactly the same official skill metadata as the offline menu,
          // intersected with actual server-implemented command contracts.
          attackSkills:canonicalDirectAttackSkillOptions(unit)
            .map(skill=>({...officialSkillView(unit,skill,engine),weaponSlot:skill.weapon,
              usable:engine.unitRuntime.canUseSkill(unit,skill)})),
          coreAttackSkillIds:SkillDatabase.list(unit.character.skills)
            .filter(skill=>isCanonicalCoreAttackSkill(unit,skill)&&engine.unitRuntime.canUseSkill(unit,skill))
            .map(skill=>skill.id),
          selfUtilitySkills:canonicalSelfUtilityOptions(unit,engine,game.battlefield.map),
          environmentContactSkillIds:canonicalEnvironmentContactOptions(unit,engine)
            .map(skill=>skill.id),
          effectSkills:canonicalDirectEffectSkillOptions(unit,engine)
            .map(skill=>({...officialSkillView(unit,skill,engine),target:skill.target,
              usable:engine.unitRuntime.canUseSkill(unit,skill)})),
          enchantmentOptions:canonicalEnchantmentOptions(game,unit,engine,serverCallbacks(game,engine)),
          enchantedTerrainSkills:canonicalDirectAttackSkillOptions(unit)
            .filter(skill=>engine.effect.weaponEnchantment(unit,skill.weapon))
            .map(skill=>({id:skill.id,name:skill.name,weaponSlot:skill.weapon}))
        }:{})
      })),
      pendingMoveUnitId:game.pendingMove?.seat===seat?game.pendingMove.unitId:null,
      own:{crystals:game.cards[seat].crystals,hand:[...game.cards[seat].zones.hand]},
      opponent:{handCount:game.cards[1-seat].zones.hand.length},
      reactionOptions:game.pendingAttack?.defendingSeat===seat
        ?pendingReactionOptions(game,seat,engine):null,
      bloodMemoryChoice:bloodMemoryOptionsForSeat(game,seat),
      enchantmentFollowup:game.pendingEnchantmentFollowup?.unitId &&
        game.units.some(u=>u.id===game.pendingEnchantmentFollowup.unitId&&u.team===UNIT_TEAM[seat])
          ?{...game.pendingEnchantmentFollowup}:null,
      pendingAttack:game.pendingAttack?{attackerId:game.pendingAttack.attackerId,
        defenderId:game.pendingAttack.targetId,skillId:game.pendingAttack.skillId,
        defendingSeat:game.pendingAttack.defendingSeat}:null};
  });
}

/**
 * Private integration-test GameCore for the existing revisioned command host.
 * NOT referenced by production worker.mjs until full attack/turn/fog systems
 * are connected. It cannot be used as a playable release.
 */
export const experimentalTacticalCore=Object.freeze({
  activeSeat(game) {
    requireReady(game);
    if(game.phase==='BATTLEFIELD_READY')return 0;
    return game.activeSeat===0||game.activeSeat===1?game.activeSeat:null;
  },
  reduce(game,action,{seat,revision}) {
    if(game.phase==='BATTLEFIELD_READY'){
      if(seat!==0||!sameKeys(action,['type'])||action.type!=='BEGIN_BATTLE')
        fail('BATTLE_NOT_STARTED');
      beginCanonicalPlayerCardPhase(game);
      return {accepted:true,state:game};
    }
    // The same UnitAnimationEngine observes both snapshots and receives the
    // true on-hit callbacks from BattleResolution. Clear its process-wide
    // singleton inside this synchronous, isolated transaction; it never owns
    // persistent match state or any authority. Rollback discards the draft.
    const visuals=globalThis.UnitAnimationEngine;
    const toVisual=()=>game.units.map(u=>({id:u.id,team:u.team,x:u.x,y:u.y,z:u.z,
      renderZ:u.renderZ??u.z,hp:u.hp,alive:u.alive,facing:u.facing,
      visualId:u.character?.visualId,characterId:u.character?.id,
      effects:(u.effects||[]).map(effect=>({...effect})),
      waterInteractionState:u.waterInteraction?.state||null}));
    const initialVisibility=[0,1].map(viewer=>{
      const world=canonicalWorldForViewer(game,viewer),viewTeam=UNIT_TEAM[viewer];
      return world.units.filter(u=>u.alive&&
        (u.team===viewTeam||TacticalEngine.teamCanIdentifyUnit({map:world.battlefield.map,
          units:world.units,environmentState:world.environmentState},viewTeam,u,world.environmentState)))
        .map(u=>u.id);
    });
    visuals?.clear?.();
    visuals?.observe?.({units:toVisual()});
    let result;
    try{
      result=resolveCanonicalPlayerCommand(game,action,seat);
      visuals?.observe?.({units:toVisual()});
      game.lastPresentation={revision:Number.isSafeInteger(revision)?revision+1:null,
        events:visuals?.drain?.()||[],visibleBefore:initialVisibility};
    }finally{visuals?.clear?.();}
    // Any canonical action (knockback, teleport, storm, card, movement) may
    // change a unit's location. Update smoke coverage once from the official
    // persisted fields, never from what the client says it sees.
    if(game.fieldState?.smokeFields?.length){
      withCanonicalEngines(game,engine=>{
        const fields=createCanonicalAreaFields(game,engine,serverCallbacks(game,engine));
        for(const unit of game.units)fields.syncSmokeCover(unit);
      });
    }
    return result;
  },
  project(game,seat){
    // Official battlefield projection already exists and never publishes private
    // hand zones; tactical view below adds only public units and private own hand.
    return tacticalDebugProjection(game,seat);
  }
});
