/**
 * Shared, deterministic choice policy for an autonomous SINGLE-target defender.
 *
 * This module does not decide legality, hit, dodge %, damage, defenses, costs,
 * counter order or guards. It selects among capabilities published by the
 * existing BattleResolution / UnitRuntimeEngine / TacticalEngine, and passes
 * the resulting official reaction back to BattleResolution.resolve().
 *
 * Single-player AI currently settles attacks without active reactions; this
 * optional policy is introduced for autonomous units in perception simulations
 * and may be adopted by other hosts without importing any PVP state.
 */
import {TacticalEngine} from './tactical-engine.js';
import {WeaponMaterialEngine} from './weapon-material-engine.js';
import {CombatContactRules} from './combat-contact-rules.js';

/** No RNG, invented weights, resource expenditure, or mutation of units. */
export function chooseAutonomousBattleReaction({map,units,attacker,defender,skill,
  environmentState=null,resolution,canUseSkill,eligibleCounterSkill=()=>true}={}){
  if(!map||!Array.isArray(units)||!attacker?.alive||!defender?.alive||
     !skill||!resolution?.prepareSingleTargetReaction||!resolution?.createReaction||
     !resolution?.actionSpeed||typeof canUseSkill!=='function')
    throw new Error('CANONICAL_AUTONOMOUS_REACTION_DEPENDENCIES_REQUIRED');
  // False contacts are one-hit illusions, not actual living agents that can
  // spend mana, parry or execute a follow-up attack.
  if(defender.hallucination===true)
    return {reaction:null,interception:null,kind:'HALLUCINATION_CONTACT'};

  const attackType=skill.attackType==='INHERIT'?
    attacker.character?.weapons?.[skill.weapon]?.attackType:skill.attackType;
  const options=resolution.prepareSingleTargetReaction({defender,attacker,attackSkill:skill,canUseSkill});
  const counters=options.counterSkills.filter(counter=>
    eligibleCounterSkill(counter) &&
    TacticalEngine.canTarget(map,defender,attacker,counter,environmentState));
  // Compare ONLY the existing official BattleEngine action-speed calculation.
  // No PVP-specific stats, probabilities, or artificial scoring constants.
  const speedOf=(actor,target,ability)=>resolution.actionSpeed({actor,target,skill:ability});
  const attackerSpeed=speedOf(attacker,defender,skill);
  const orderedCounters=counters.map((counter,index)=>({counter,index,
    speed:speedOf(defender,attacker,counter)}))
    .sort((a,b)=>b.speed-a.speed||a.index-b.index);
  const counter=orderedCounters[0]||null;

  // Official linked guardians are applied by BattleResolution.createContext;
  // active guard interception is only chosen when the guardian has more HP to
  // absorb the impact than its protected ally. No new hit/damage rule exists.
  const guardians=resolution.guardCandidates({map,units,target:defender});
  const eligibleGuardian=guardians.find(entry=>
    Number(entry.guardian.hp)>Number(defender.hp) &&
    entry.profiles.some(profile=>profile?.vs?.[attackType]));
  if(eligibleGuardian){
    const method=eligibleGuardian.profiles.find(profile=>profile?.vs?.[attackType]);
    return {reaction:null,
      interception:resolution.createGuardInterception(eligibleGuardian.guardian,method.id),
      kind:'GUARD'};
  }

  if(counter && counter.speed>=attackerSpeed)
    return {reaction:resolution.createReaction('COUNTER',{skill:counter.counter}),
      interception:null,kind:'COUNTER'};

  // Profiles and their per-attack chance/reduction come from the original
  // equipment, passive and effect data. An explicitly impossible chance or an
  // unblockable pure-Holy attack should not trigger a meaningless active guard.
  const eligibleDefenses=skill.pureHoly?[]:options.defenseMethods.filter(profile=>{
    const rule=profile?.vs?.[attackType];
    if(!rule)return false;
    const material=WeaponMaterialEngine.defenseMatchup({attacker,defender,skill,method:profile,attackType});
    return material.chance===null||material.chance>0;
  });
  // Preserve the existing choice order outside the star-iron material branch.
  // If a weapon has a physical deflection alternative, choose the option with
  // the greater expected physical reduction, using only its canonical profile.
  const materialDeflect=eligibleDefenses.find(profile=>profile.physicalOnly===true);
  const materialChoices=materialDeflect?
    eligibleDefenses.filter(profile=>profile.sourceId===materialDeflect.sourceId):[];
  const expectedReduction=profile=>{
    const rule=profile.vs[attackType];
    const material=WeaponMaterialEngine.defenseMatchup({attacker,defender,skill,method:profile,attackType});
    const probability=material.chance===null?1:material.chance/100;
    const multiplier=profile.method==='PARRY'?0:Number(rule.damageMultiplier??1);
    return probability*(1-multiplier);
  };
  materialChoices.sort((a,b)=>expectedReduction(b)-expectedReduction(a));
  const defense=materialChoices[0]||eligibleDefenses[0]||null;
  if(defense)return {reaction:resolution.createReaction('DEFENSE',{methodId:defense.id}),
    interception:null,kind:'DEFENSE'};
  if(counter)return {reaction:resolution.createReaction('COUNTER',{skill:counter.counter}),
    interception:null,kind:'COUNTER'};
  return CombatContactRules.canActiveEvade(attacker,skill)?
    {reaction:resolution.createReaction('EVADE'),interception:null,kind:'EVADE'}:
    {reaction:null,interception:null,kind:'ACCEPT_MAGIC'};
}
