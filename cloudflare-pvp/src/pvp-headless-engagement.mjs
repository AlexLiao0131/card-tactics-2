import {isCanonicalEnvironmentContactSkill} from './pvp-headless-environment-contact.mjs';
/**
 * Experimental server-owned ATTACK -> DEFENDER_REACTION -> OFFICIAL RESOLUTION.
 * This is an orchestration adapter, not an alternative combat rules engine.
 * The production Worker must remain gated until full tactical/event/UI parity.
 */
import {SkillDatabase} from '../../js/skill-database.js';
import {resolveCanonicalChargeVariant} from './pvp-headless-charge.mjs';
import {chooseAutonomousBattleReaction} from '../../js/battle-reaction-decision-engine.js';
import {TacticalEngine} from '../../js/tactical-engine.js';
import {officialEngagementForecast} from '../../js/battle-engagement-forecast.js';
import '../../js/post-engagement-engine.js';
import '../../js/trajectory-engine.js';
import {PvpCommandError} from '../../shared/pvp-command-contract.mjs';
import {createCanonicalEnvironmentController} from './pvp-environment-controller.mjs';
import {applyCanonicalPostEngagementEffect} from './pvp-headless-post-effect.mjs';
import {createCanonicalAreaFields} from './pvp-field-controller.mjs';
import '../../js/tactical-action-controller.js';
import {canonicalTargetPlan} from './pvp-headless-target-plan.mjs';
import {createOfficialEnchantmentController} from './pvp-headless-enchantment.mjs';

const TEAM=['P','E'];
const PHASE=['PLAYER_TACTICAL_PHASE','ENEMY_TACTICAL_PHASE'];
const REACTION_PHASE='PVP_REACTION_PENDING';
const fail=code=>{throw new PvpCommandError(code)};
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===keys.slice().sort().join('|');

function combatant(game,id,team){return game.units?.find(u=>u.id===id&&u.alive&&u.team===team)||null;}
/** One direct-target engagement uses the canonical BattleResolution for its
 * COMPLETE result, not only its first damage number. Statuses, inherent
 * multi-hits, hit/backstab rules, passive effects and forced displacement are
 * executed by BattleResolution / PostEngagementEngine. No separate PVP skill
 * IDs or numeric combat rules are maintained here.
 *
 * Skills with a separate map/choice/approach/cross-explosion operation must
 * continue through their own canonical command; accepting them as a direct
 * attack would silently discard part of the original skill.
 */
export function isCanonicalDirectAttackSkill(skill){
  return !!skill&&['ATTACK','MAGIC','SPECIAL'].includes(skill.category)&&
    skill.target==='ENEMY'&&(!skill.targetType||skill.targetType==='SINGLE')&&
    !!skill.weapon&&Number(skill.power)>0&&!!skill.attackType&&
    !skill.utilityAction&&!skill.approach&&!skill.moveToTarget&&!skill.bloodShadow&&
    !skill.channel&&!skill.effects&&!skill.relationEffects&&!skill.bloodBurst&&
    (!skill.verdictCross||globalThis.PostEngagementEngine?.canResolveVerdictCross?.(skill))&&
    !skill.terrainTargeting&&!skill.hydrologyFlood&&
    !skill.areaDamage&&!skill.aoeDamage&&!skill.trapPlacement&&
    !skill.environmentForces&&!skill.shape&&!skill.sanctuary&&!skill.smokeField&&
    // Water-bullet's optional burning-terrain target is a separate map action;
    // do not advertise the entire skill while that second route is absent.
    (!skill.environmentTarget||isCanonicalEnvironmentContactSkill(skill))&&
    (!skill.postEffects||skill.postEffects.every(e=>
      (e.type==='KNOCKBACK'||e.type==='PULL')&&Number.isFinite(e.distance)))&&
    (!skill.statusEffects||Array.isArray(skill.statusEffects))&&
    (!skill.afterUseEffects||Array.isArray(skill.afterUseEffects))&&
    (!skill.affixes||Array.isArray(skill.affixes));
}
export function canonicalDirectAttackSkillOptions(actor){
  if(!actor?.alive)return[];
  const ids=globalThis.EffectEngine?.skillIds?.(actor)||actor.character?.skills||[];
  return SkillDatabase.list(ids).map(s=>globalThis.UnitRuntimeEngine?.skillForUnit?.(actor,s)||s).filter(isCanonicalDirectAttackSkill);
}
function basicAttackSkill(actor,skillId){
  const skill=canonicalDirectAttackSkillOptions(actor).find(s=>s.id===skillId);
  if(!skill)fail('FULL_SKILL_ORCHESTRATION_REQUIRED');
  return skill;
}

/** Commit the exact original planned path through the same environment
 * controller used for MOVE_UNIT. An interrupted traversal is a real move,
 * never a remote reaction, and does not charge an uncast skill. */
export function commitCanonicalTargetApproach(game,actor,plan,skill,engine,callbacks,checkMatchEnd){
  if(!plan||!Array.isArray(plan.path))fail('CANONICAL_ATTACK_PLAN_REQUIRED');
  if(!plan.path.length)return {ready:true,movement:null};
  const start={x:actor.x,y:actor.y};
  const environment=createCanonicalEnvironmentController(game,callbacks);
  globalThis.LiviaDualityEngine?.beginMove?.(actor);
  actor._liviaEntryFrom={x:actor.x,y:actor.y};
  const movement=environment.traverseUnitPath(actor,plan.path,{kind:'UNIT'});
  globalThis.LiviaDualityEngine?.endMove?.(actor);
  createCanonicalAreaFields(game,engine,callbacks).syncSmokeCover(actor);
  if(actor.x!==start.x||actor.y!==start.y)engine.effect.interruptChannel(actor,'MOVE');
  actor.moved=true;
  if(movement?.completed!==true||!actor.alive){
    checkMatchEnd?.();
    return {ready:false,movement};
  }
  callbacks.pushLog(`${actor.character.name} 自動移動至可使用「${skill.name}」的位置。`,'DETAIL');
  return {ready:true,movement};
}

export function declareCanonicalAttack(game,action,seat,engine,callbacks,checkMatchEnd){
  if(game.phase!==PHASE[seat]||game.activeSeat!==seat)fail('NOT_TACTICAL_TURN');
  if(!exact(action,['type','attackerId','targetId','skillId'])||
     action.type!=='DECLARE_ATTACK'||
     ![action.attackerId,action.targetId,action.skillId].every(s=>typeof s==='string'))
    fail('INVALID_ATTACK_DECLARATION');
  if(game.pendingAttack)fail('ATTACK_ALREADY_PENDING');
  // Only the affected seat can act in the isolated mirror. The unaffected
  // human sees the real battlefield and must NEVER receive a phantom reaction.
  const mirror=game.perceptionState?.session;
  if(mirror?.active && mirror.team!==TEAM[seat])
    fail('PERCEPTION_CROSS_WORLD_REACTION_UNAVAILABLE');
  const attacker=combatant(game,action.attackerId,TEAM[seat]);
  const defender=combatant(game,action.targetId,TEAM[1-seat]);
  if(!attacker||!defender||attacker.acted||attacker.waited)fail('ATTACKER_NOT_AVAILABLE');
  const skill=basicAttackSkill(attacker,action.skillId);
  if(!engine.unitRuntime.canUseSkill(attacker,skill))fail('ATTACK_RESOURCES_UNAVAILABLE');
  const plan=canonicalTargetPlan(game,attacker,defender,skill,engine);
  if(!plan)fail('ILLEGAL_ATTACK_TARGET');
  const approach=commitCanonicalTargetApproach(game,attacker,plan,skill,engine,callbacks,checkMatchEnd);
  if(!approach.ready)return {accepted:true,state:game,movement:approach.movement,attackInterrupted:true};
  // An environmental entry hazard may change the living unit, visibility,
  // LOS or a skill requirement during the planned walk. Do NOT roll damage or
  // prompt the opponent for an attack which never legally took place.
  if(!TacticalEngine.canTarget(game.battlefield.map,attacker,defender,skill,game.environmentState)||
      !engine.unitRuntime.canUseSkill(attacker,skill)){
    callbacks.pushLog(`${attacker.character.name} 移動後無法完成「${skill.name}」攻擊。`,'SYSTEM');
    return {accepted:true,state:game,movement:approach.movement,attackInterrupted:true};
  }
  if(mirror?.active){
    // In the official single-player battle, attacking an enemy not controlled
    // by a human uses BattleResolution's default (no deliberate reaction).
    // This invokes that SAME resolution, hooks and death engine on the mirror
    // world. It is not a new hit/guard/counter or damage algorithm.
    if(!attacker.mirrorOfUnitId || !defender.mirrorOfUnitId && !defender.hallucination ||
       defender.team!==TEAM[1-seat])
      fail('PERCEPTION_MIRROR_COMBATANT_REQUIRED');
    const autonomous=chooseAutonomousBattleReaction({map:game.battlefield.map,
      units:game.units,attacker,defender,skill,environmentState:game.environmentState,
      resolution:engine.battleResolution,
      canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
      eligibleCounterSkill:isCanonicalDirectAttackSkill});
    return settleCanonicalAttack(game,{attackingSeat:seat},attacker,defender,skill,
      engine,callbacks,checkMatchEnd,autonomous);
  }
  // Real-world attacks remain two-seat transactions: no damage/MP is spent
  // before the human defender chooses an official reaction.
  game.pendingAttack={attackerId:attacker.id,targetId:defender.id,
    skillId:skill.id,attackingSeat:seat,defendingSeat:1-seat};
  game.phase=REACTION_PHASE;
  game.activeSeat=1-seat;
  return {accepted:true,state:game};
}

export function pendingReactionOptions(game,seat,engine){
  const p=game.pendingAttack;
  if(p&&game.perceptionState?.session?.active)
    fail('PERCEPTION_CROSS_WORLD_REACTION_UNAVAILABLE');
  if(!p||seat!==p.defendingSeat)return null;
  const attacker=combatant(game,p.attackerId,TEAM[p.attackingSeat]);
  const defender=combatant(game,p.targetId,TEAM[p.defendingSeat]);
  if(!attacker||!defender)fail('PENDING_COMBATANT_MISSING');
  const resolution=engine.battleResolution;
  const prep=resolution.prepareSingleTargetReaction({defender,attacker,
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s)});
  const counterSkills=prep.counterSkills.filter(s=>TacticalEngine.canTarget(
    game.battlefield.map,defender,attacker,s,game.environmentState));
  const guardians=resolution.guardCandidates({map:game.battlefield.map,units:game.units,target:defender});
  const attackSkill=basicAttackSkill(attacker,p.skillId);
  // Do not leak an unseen attacker's stats through a read-only forecast.
  const canIdentify=TacticalEngine.teamCanIdentifyUnit({map:game.battlefield.map,
    units:game.units,environmentState:game.environmentState},TEAM[seat],attacker,game.environmentState);
  const forecast=canIdentify?officialEngagementForecast({map:game.battlefield.map,attacker,defender,
    skill:attackSkill,unitRuntime:engine.unitRuntime,resolution}):null;
  return {attackerId:attacker.id,targetId:defender.id,skillId:p.skillId,forecast,
    choices:['ACCEPT','EVADE','DEFENSE','COUNTER','GUARD'],
    defenses:prep.defenseMethods.map(m=>({id:m.id,name:m.name})),
    counters:counterSkills.map(s=>({id:s.id,name:s.name})),
    guardians:guardians.map(x=>({guardianId:x.guardian.id,
      methods:x.profiles.map(m=>({id:m.id,name:m.name}))}))};
}

/** One official settlement path for both a human reaction in the real world
 * and an autonomous defender in an isolated perception world. The latter
 * chooses only officially legal reactions, never prompts an outside human,
 * and keeps all official passive,
 * linked-guard, environment, reward-scope and random behavior.
 */
function settleCanonicalAttack(game,p,attacker,defender,skill,engine,callbacks,checkMatchEnd,
  {reaction=null,interception=null}={}){
  if(typeof callbacks?.handleDefeated!=='function'||
     typeof callbacks?.pushLog!=='function')fail('CANONICAL_ENGAGEMENT_CALLBACKS_REQUIRED');
  // Unmodified official resolution owns action order, dodge rolls, guard,
  // counter, hit/critical, damage absorption, statuses, and skill resource use.
  // All event/death hooks are required. If a post-effect cannot be processed,
  // the authority session rejects the entire cloned draft transaction.
  if(!globalThis.PostEngagementEngine?.process)fail('OFFICIAL_POST_ENGAGEMENT_REQUIRED');
  const environment=createCanonicalEnvironmentController(game,callbacks);
  const enchantedImpact=createOfficialEnchantmentController(game,engine,callbacks,checkMatchEnd,attacker);
  const results=[];
  const outcome=engine.battleResolution.resolve({map:game.battlefield.map,
    units:game.units,initiator:attacker,target:defender,skill,actions:[],
    reaction,interception},{
    canUseSkill:(u,s)=>engine.unitRuntime.canUseSkill(u,s),
    consumeSkill:(u,s)=>engine.unitRuntime.consumeSkill(u,s),
    onDefeated:callbacks.handleDefeated,
    onAction:entry=>{
      results.push({role:entry.role,actorId:entry.actor.id,targetId:entry.target.id,
        skillId:entry.skill.id,damage:entry.result.damage,hit:entry.result.hit,
        crit:entry.result.crit,evadeOutcome:entry.result.evadeOutcome??null});
      environment.resolveWaterSkillHit(entry);
      // Weapon enchantments have their own official environmental impact
      // controller: fire-arrow blast, terrain ignition and thunder conduction.
      // Never recompute this as PvP-only elemental damage.
      if(entry.enchantment)enchantedImpact.resolveEnchantmentImpact(entry);
    },
    onPostEffect:entry=>applyCanonicalPostEngagementEffect(entry,environment,callbacks),
    // Backstep is committed by the same shared BattleResolution after one
    // combat transaction; the official environment owns landing hazards,
    // plant soul pickup and shield-passenger synchronization.
    onBackstep:(unit,tile)=>environment.enterTile(unit)
  });
  if(!outcome.results.length)fail('OFFICIAL_COMBAT_RESOLUTION_EMPTY');
  // Authored verdict's second hit is never a second action or a made-up PvP
  // area attack: reuse exactly the offline PostEngagementEngine cross effect.
  const verdict=skill.verdictCross?globalThis.PostEngagementEngine.resolveVerdictCross({
    attacker,defender,skill,engagement:outcome,units:game.units,
    random:engine.random,onLog:callbacks.pushLog,onDefeated:callbacks.handleDefeated
  }):[];
  attacker.moved=true;attacker.acted=true;attacker.waited=true;
  if(game.pendingEnchantmentFollowup?.unitId===attacker.id)
    game.pendingEnchantmentFollowup=null;
  game.pendingAttack=null;
  game.phase=PHASE[p.attackingSeat];
  game.activeSeat=p.attackingSeat;
  callbacks.pushLog(`${attacker.character.name} → ${defender.character.name}｜${skill.name}｜${results.map(e=>e.damage).join('/')} HP 損失`,'BATTLE');
  checkMatchEnd?.();
  return {accepted:true,state:game,engagement:results,verdict};
}

export function reactCanonicalAttack(game,action,seat,engine,callbacks,checkMatchEnd){
  const p=game.pendingAttack;
  if(game.perceptionState?.session?.active)
    fail('PERCEPTION_CROSS_WORLD_REACTION_UNAVAILABLE');
  if(game.phase!==REACTION_PHASE||!p||game.activeSeat!==seat||p.defendingSeat!==seat)
    fail('NOT_DEFENDING_SEAT');
  const attacker=combatant(game,p.attackerId,TEAM[p.attackingSeat]);
  const defender=combatant(game,p.targetId,TEAM[p.defendingSeat]);
  if(!attacker||!defender)fail('PENDING_COMBATANT_MISSING');
  const charged=p.kind==='CHARGE';
  const charge=charged?resolveCanonicalChargeVariant(attacker,p.skillId,p.variantId,engine):null;
  if(charged&&(!charge||charge.target!=='ENEMY'))fail('CANONICAL_CHARGE_SKILL_REQUIRED');
  const skill=charged?{...charge,range:{min:1,max:1},approach:null,approachCommitted:true}
    :basicAttackSkill(attacker,p.skillId);
  if(charged&&!engine.unitRuntime.canUseSkill(attacker,skill))fail('CHARGE_RESOURCES_UNAVAILABLE');
  if(!TacticalEngine.canTarget(game.battlefield.map,attacker,defender,skill,game.environmentState))
    fail('ATTACK_TARGET_NO_LONGER_VALID');
  const opt=pendingReactionOptions(game,seat,engine);
  let reaction=null,interception=null;
  if(action?.type!=='REACT_ATTACK'||typeof action?.reaction!=='string')
    fail('INVALID_REACTION_COMMAND');
  if(action.reaction==='ACCEPT'||action.reaction==='EVADE'){
    if(!exact(action,['type','reaction']))fail('INVALID_REACTION_COMMAND');
    if(action.reaction==='EVADE')reaction=engine.battleResolution.createReaction('EVADE');
  }else if(action.reaction==='DEFENSE'){
    if(!exact(action,['type','reaction','methodId'])||
       !opt.defenses.some(m=>m.id===action.methodId))fail('ILLEGAL_DEFENSE_METHOD');
    reaction=engine.battleResolution.createReaction('DEFENSE',{methodId:action.methodId});
  }else if(action.reaction==='COUNTER'){
    if(!exact(action,['type','reaction','skillId'])||
       !opt.counters.some(m=>m.id===action.skillId))fail('ILLEGAL_COUNTER_SKILL');
    const counterSkill=SkillDatabase.get(action.skillId);
    reaction=engine.battleResolution.createReaction('COUNTER',{skill:counterSkill});
  }else if(action.reaction==='GUARD'){
    const guardKeys=action.counterSkillId==null?
      ['type','reaction','guardianId','methodId']:
      ['type','reaction','guardianId','methodId','counterSkillId'];
    if(!exact(action,guardKeys))fail('INVALID_GUARD_COMMAND');
    const candidate=opt.guardians.find(g=>g.guardianId===action.guardianId);
    if(!candidate?.methods.some(m=>m.id===action.methodId))fail('ILLEGAL_GUARD_METHOD');
    const guardian=combatant(game,action.guardianId,TEAM[seat]);
    interception=engine.battleResolution.createGuardInterception(guardian,action.methodId);
    if(action.counterSkillId!=null){
      if(!opt.counters.some(m=>m.id===action.counterSkillId))fail('ILLEGAL_COUNTER_SKILL');
      reaction=engine.battleResolution.createReaction('COUNTER',
        {skill:SkillDatabase.get(action.counterSkillId)});
    }
  }else fail('INVALID_REACTION_COMMAND');

  return settleCanonicalAttack(game,p,attacker,defender,skill,engine,callbacks,
    checkMatchEnd,{reaction,interception});
}
