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
import { DeathLifecycleEngine } from '../../js/death-lifecycle-engine.js';
import { BattleCoreCaptureController } from '../../js/battle-core-capture-controller.js';
import { BattleObjectiveController } from '../../js/battle-objective-controller.js';
import '../../js/objective-engine.js';
import { CardPhaseEngine } from '../../js/card-phase-engine.js';
import { PvpCommandError } from '../../shared/pvp-command-contract.mjs';
import { deployCanonicalCard } from './pvp-headless-deployment.mjs';
import { withCanonicalEngines } from './pvp-engine-context.mjs';
import { createCanonicalEnvironmentController } from './pvp-environment-controller.mjs';
import {declareCanonicalAttack,reactCanonicalAttack,pendingReactionOptions,canonicalDirectAttackSkillOptions} from './pvp-headless-engagement.mjs';
import {advanceCanonicalRound} from './pvp-headless-turns.mjs';
import {castCanonicalDirectEffectSkill,canonicalDirectEffectSkillOptions} from './pvp-headless-effect-skills.mjs';
import {castCanonicalEnchantment,completeCanonicalEnchantmentFollowup,canonicalEnchantmentOptions,createOfficialEnchantmentController} from './pvp-headless-enchantment.mjs';
import {playCanonicalInstantCard} from './pvp-headless-instant-cards.mjs';
import {playCanonicalTargetedCard} from './pvp-headless-targeted-cards.mjs';
import {castCanonicalBloodShadow,chooseCanonicalBloodMemory,canonicalBloodShadowTargets,bloodMemoryOptionsForSeat} from './pvp-headless-blood-shadow.mjs';
import {castCanonicalBloodBurst,canonicalBloodBurstSkills} from './pvp-headless-blood-burst.mjs';
import {castCanonicalAreaField,canonicalAreaFieldSkillOptions,createCanonicalAreaFields} from './pvp-field-controller.mjs';
import {castCanonicalMapSkill,canonicalImmediateMapSkillOptions} from './pvp-headless-map-skills.mjs';
import {castCanonicalTransport,canonicalTransportOptions} from './pvp-headless-transport.mjs';
import {createCanonicalPerception,castCanonicalPerception,canonicalPerceptionOptions,canonicalWorldForViewer} from './pvp-perception-controller.mjs';
import './pvp-canonical-setup.mjs';
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
function snapshotUnit(u){return {
  id:u.id,team:u.team,characterId:u.character?.id,x:u.x,y:u.y,z:u.z,
  hp:u.hp,mana:u.mana,alive:u.alive,moved:u.moved,acted:u.acted,waited:u.waited,
  facing:u.facing,resources:u.resources
};}
function serverCallbacks(game,engine){
  const logs=game.events??=([]);
  const pushLog=(message,type='SYSTEM')=>{
    logs.push({type,text:String(message)});
    if(logs.length>160)logs.splice(0,logs.length-160);
  };
  const stageEvent=event=>{
    if(!eventTypes.has(event?.type))fail('CANONICAL_STAGE_EVENT_UNSUPPORTED');
    const spawned=()=>fail('STAGE_SPAWN_NOT_CONNECTED');
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
      const initial={x:unit.x,y:unit.y};
      const movement=environment.traverseUnitPath(unit,path);
      createCanonicalAreaFields(game,engine,hooks).syncSmokeCover(unit);
      if(unit.alive && (unit.x!==initial.x||unit.y!==initial.y))engine.effect.interruptChannel(unit,'MOVE');
      unit.moved=true;
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
      if(!skill||skill.category!=='ATTACK'||skill.target!=='ENEMY'||
        (skill.targetType&&skill.targetType!=='SINGLE')||!skill.weapon||
        skill.utilityAction||skill.approach||skill.bloodShadow||skill.channel||
        skill.effects||skill.relationEffects||skill.verdictCross||skill.affixes?.length||
        unit.character.passives?.includes('AMBUSH'))fail('FULL_CORE_SKILL_ORCHESTRATION_REQUIRED');
      if(!TacticalEngine.canTarget(game.battlefield.map,unit,target,skill,game.environmentState))
        fail('ILLEGAL_CORE_ATTACK_TARGET');
      if(!engine.unitRuntime.canUseSkill(unit,skill))fail('ATTACK_RESOURCES_UNAVAILABLE');
      const ctx={TEAM:{PLAYER:'P',ENEMY:'E'},
        actionState:()=>({map:game.battlefield.map,units:game.units,environmentState:game.environmentState}),
        canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
        consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
        effectiveSkill:(u,s)=>engine.unitRuntime.applyResourceScaling(u,s),
        damageCore:coreHost.damageCore,
        clearEngagement:()=>{},setSelectedSkill:()=>{},setSelectedSkillVariant:()=>{},
        setMode:()=>{},render:()=>{},maybeAutoEndPlayerTurn:()=>false,
        pushLog:hooks.pushLog,
        aoeTiles:()=>fail('ENCHANTMENT_FOLLOWUP_NOT_CONNECTED'),
        resolveEnvironmentEvents:()=>fail('ENCHANTMENT_FOLLOWUP_NOT_CONNECTED'),
        logEnvironmentEvent:()=>fail('ENCHANTMENT_FOLLOWUP_NOT_CONNECTED'),
        unitAt:()=>fail('ENCHANTMENT_FOLLOWUP_NOT_CONNECTED'),
        applyEnvironmentHazardToUnit:()=>fail('ENCHANTMENT_FOLLOWUP_NOT_CONNECTED'),
        damageUnitFlat:hooks.damageUnitFlat};
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
    const world={map:game.battlefield.map,units:game.units,
      cores:game.battlefield.cores,stage,environmentState:game.environmentState};
    const visible=game.units.filter(u=>u.team===UNIT_TEAM[seat]||
      TacticalEngine.teamCanIdentifyUnit(world,UNIT_TEAM[seat],u,game.environmentState));
    return {phase:game.phase,activeSeat:game.activeSeat,round:game.round,
      // Only the owning seat receives its unit's battle skill options.
      // The resolved runtime character (loadout + effects) is the authority,
      // not the raw CharacterDatabase template.
      units:visible.map(unit=>({
        ...snapshotUnit(unit),
        ...(unit.team===UNIT_TEAM[seat]?{
          bloodShadowOptions:canonicalBloodShadowTargets(game,unit,engine),
          areaFieldSkills:canonicalAreaFieldSkillOptions(unit,engine)
            .filter(skill=>engine.unitRuntime.canUseSkill(unit,skill))
            .map(skill=>({id:skill.id,name:skill.name})),
          transportOptions:canonicalTransportOptions(game,unit,engine),
          perceptionSkills:canonicalPerceptionOptions(unit,engine)
            .map(skill=>({id:skill.id,name:skill.name})),
          mapSkills:canonicalImmediateMapSkillOptions(unit,engine)
            .filter(skill=>engine.unitRuntime.canUseSkill(unit,skill))
            .map(skill=>({id:skill.id,name:skill.name})),
          bloodBurstSkills:canonicalBloodBurstSkills(unit,engine,game.units,{map:world.map,environmentState:game.environmentState})
            .map(skill=>({id:skill.id,name:skill.name})),
          attackSkills:canonicalDirectAttackSkillOptions(unit)
            .map(skill=>({id:skill.id,name:skill.name,weaponSlot:skill.weapon})),
          effectSkills:canonicalDirectEffectSkillOptions(unit,engine)
            .map(skill=>({id:skill.id,name:skill.name,target:skill.target})),
          enchantmentOptions:canonicalEnchantmentOptions(game,unit,engine,serverCallbacks(game,engine)),
          enchantedTerrainSkills:canonicalDirectAttackSkillOptions(unit)
            .filter(skill=>engine.effect.weaponEnchantment(unit,skill.weapon))
            .map(skill=>({id:skill.id,name:skill.name,weaponSlot:skill.weapon}))
        }:{})
      })),
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
  reduce(game,action,{seat}) {
    if(game.phase==='BATTLEFIELD_READY'){
      if(seat!==0||!sameKeys(action,['type'])||action.type!=='BEGIN_BATTLE')
        fail('BATTLE_NOT_STARTED');
      beginCanonicalPlayerCardPhase(game);
      return {accepted:true,state:game};
    }
    const result=resolveCanonicalPlayerCommand(game,action,seat);
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
