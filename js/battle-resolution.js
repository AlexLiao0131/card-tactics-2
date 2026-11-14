import {ColinShieldMobilityEngine} from "./colin-shield-mobility-engine.js";
import {WeaponMaterialEngine} from "./weapon-material-engine.js";
import {chooseAutonomousBattleReaction} from "./battle-reaction-decision-engine.js";
import {CombatContactRules} from "./combat-contact-rules.js";
import {UnitRuntimeEngine} from "./unit-runtime-engine.js";
export function createBattleResolution({random=()=>Math.random()}={}){
  const ACTIVE_EVADE_PENALTY=20,GRAZE_DAMAGE_MULTIPLIER=.5;
  const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const resolveWithRandom=(map,a,t,skill,opt={})=>TacticalEngine.resolve(map,a,t,skill,{...opt,random,forceHit:opt.forceMiss?false:(opt.forceHit===true||CombatContactRules.isPureMagic(a,skill))});
  const isSingleTarget=s=>(s?.targetType||"SINGLE")==="SINGLE";
  function passiveDefenseProfiles(c){return SkillDatabase.passiveDefenseProfiles?SkillDatabase.passiveDefenseProfiles(c?.passives):[]}
  function effectDefenseProfiles(u){const profiles=[];for(const effect of u?.effects||[])for(const profile of effect?.defenseProfiles||[])profiles.push({...profile,sourceId:effect.id,sourceName:effect.name||effect.id,sourceType:"EFFECT"});return profiles}
  function defenseMethods(d){
    const profiles=[...EquipmentDatabase.defenseProfiles(d?.character),...passiveDefenseProfiles(d?.character),...effectDefenseProfiles(d)].filter(p=>p.counterOnly!==true);
    return ColinShieldMobilityEngine.shieldOccupied(d)
      ?profiles.filter(profile=>profile.id!=="colin_full_body_guard"&&profile.sourceId!=="FULL_SHIELD_DEFENSE")
      :profiles;
  }
  function passiveGuardRules(u){return SkillDatabase.passiveList(u?.character?.passives).map(p=>p?.guardRules).filter(Boolean)}
  function guardProfiles(u){return defenseMethods(u).filter(p=>p.canGuardAlly===true)}
  function guardCandidates({map,units,target}){
    if(!target?.alive)return[];const tt=TacticalEngine.tile(map,target.x,target.y);
    return(units||[]).filter(g=>{
      if(!g.alive||g.id===target.id||g.team!==target.team)return false;
      const link=globalThis.EffectEngine?.linkedGuardian?.(target,units);
      if(link?.id===g.id)return true;
      if(distance(g,target)!==1)return false;
      const gt=TacticalEngine.tile(map,g.x,g.y);
      return !!gt&&!!tt&&TacticalEngine.canTraverseElevation(gt,tt,g);
    }).map(guardian=>({guardian,profiles:guardProfiles(guardian)})).filter(x=>x.profiles.length);
  }
  function createGuardInterception(guardian,methodId){if(!guardian?.alive)throw new Error("Guard Ally requires a living guardian.");const p=guardProfiles(guardian).find(x=>x.id===methodId);if(!p)throw new Error(`Invalid Guard Ally method: ${methodId}`);return{type:"GUARD_ALLY",guardian,methodId:p.id}}
  function reactionTargetable(actor,target,skill){const map=actor?._runtimeMap||target?._runtimeMap;return !map||TacticalEngine.canTarget(map,actor,target,skill,null)}
  function supportSkills({ally,target,canUseSkill}){return SkillDatabase.list(ally.character.skills).filter(s=>{if(s.utilityAction||s.support!==true||s.target!=="ENEMY"||!isSingleTarget(s))return false;if(canUseSkill&&!canUseSkill(ally,s))return false;const r=s.range||{min:1,max:1},d=distance(ally,target);return d>=r.min&&d<=r.max&&reactionTargetable(ally,target,s)})}
  function supportAnchorDistance(ally){let value=1;for(const passive of SkillDatabase.passiveList(ally?.character?.passives)){const n=Number(passive?.supportRules?.allyDistance);if(Number.isFinite(n))value=Math.max(value,n)}return value}
  function supportCandidates({units,initiator,target,canUseSkill}){const out=[];for(const ally of units){if(!ally.alive||ally.id===initiator.id||ally.team!==initiator.team||ally.waited===true)continue;const anchor=Math.max(Math.abs(ally.x-initiator.x),Math.abs(ally.y-initiator.y));if(anchor>supportAnchorDistance(ally))continue;const skills=supportSkills({ally,target,canUseSkill});if(skills.length)out.push({ally,skills})}return out}
  function createSupportAction(ally,target,skill,index=0){return{id:`support-${ally.id}-${index}`,role:"SUPPORT",actor:ally,target,skill}}
  function counterSkillForm(defender,skill){
    if(!["nether_slash","ophi_forest_wrath"].includes(skill?.id))return skill;
    return UnitRuntimeEngine.skillForUnit(defender,{...skill,_reactionCounter:true})||
      {...skill,_reactionCounter:true,target:"ENEMY",targetType:"SINGLE"};
  }
  function counterSkills({defender,attacker,attackSkill=null,canUseSkill}){
    if(!defender?.alive||!attacker?.alive)return[];
    return SkillDatabase.list(defender.character.skills).map(s=>counterSkillForm(defender,s)).filter(s=>{
      if(s.utilityAction||s.target!=="ENEMY"||!isSingleTarget(s))return false;
      if(s.ganfan&&!CombatContactRules.canGanfanDefend(attacker,defender,attackSkill))return false;
      if(s.evasiveCounter&&!CombatContactRules.canActiveEvade(attacker,attackSkill))return false;
      if(canUseSkill&&!canUseSkill(defender,s))return false;
      const r=s.range||{min:1,max:1},d=distance(defender,attacker);
      if(d<r.min||d>r.max||!reactionTargetable(defender,attacker,s))return false;
      if(s.approach||s.bloodShadow){
        const map=defender._runtimeMap||attacker._runtimeMap;
        // Headless snapshots may omit the client-only _runtimeMap backlink;
        // preserve the existing candidate in that case and let the real
        // resolver validate the authoritative map before charging its cost.
        if(!map)return true;
        const living=(globalThis.UnitRuntimeEngine?.knownUnits?.()||[])
          .filter(u=>u.alive&&u._runtimeMap===map);
        const units=[...new Map([...living,defender,attacker].map(u=>[u.id,u])).values()];
        return !!counterTransitPlan({map,units,environmentState:null},defender,attacker,s);
      }
      return true;
    });
  }
  function createCounterAction(defender,attacker,skill){return{id:`counter-${defender.id}`,role:"COUNTER",actor:defender,target:attacker,skill}}
  function createReaction(type,options={}){if(!["COUNTER","DEFENSE","EVADE"].includes(type))throw new Error(`Unknown reaction type: ${type}`);return{type,...options}}
  function prepareSingleTargetReaction({defender,attacker,attackSkill=null,canUseSkill}){return{defender,attacker,counterSkills:counterSkills({defender,attacker,attackSkill,canUseSkill}),defenseMethods:defenseMethods(defender),choices:["COUNTER","DEFENSE",...(CombatContactRules.canActiveEvade(attacker,attackSkill)?["EVADE"]:[])]}}
  function createContext({map,units=[],environmentState=null,initiator,target,skill,actions=[],reaction=null,interception=null}){
    [initiator,target,...actions.map(a=>a.actor)].forEach(u=>TacticalEngine.ensureFacing(u));
    const linked=globalThis.EffectEngine?.linkedGuardian?.(target,units);
    const linkMethod=linked?guardProfiles(linked)[0]:null;
    const resolvedInterception=linked&&linkMethod?createGuardInterception(linked,linkMethod.id):interception;
    const originalTarget=target,guardian=resolvedInterception?.type==="GUARD_ALLY"&&resolvedInterception.guardian?.alive?resolvedInterception.guardian:null,effectiveTarget=guardian||originalTarget;
    TacticalEngine.faceToward(initiator,originalTarget);
    if(guardian)TacticalEngine.faceToward(guardian,initiator);
    const primary={id:"primary",role:"INITIATOR",actor:initiator,target:effectiveTarget,skill},participants=[],seen=new Set();
    [initiator,originalTarget,effectiveTarget,...actions.map(a=>a.actor)].forEach(u=>{if(u&&!seen.has(u.id)){seen.add(u.id);participants.push(u)}});
    return{map,units,environmentState,initiator,target:effectiveTarget,originalTarget,guardian,interception:guardian?resolvedInterception:null,skill,reaction,participants,actions:[primary,...actions]}
  }
  const actionSpeed=a=>BattleEngine.actionSpeed(a.actor.character,a.skill,a.target?.character||null);
  // Duel eligibility is a read-only predicate on the SAME authoritative roster
  // for browser and Worker. Neither mode assigns a synthetic speed value.
  function duelRules(actor,skill){
    const weapon=actor?.character?.weapons?.[skill?.weapon];
    if(!weapon)return null;
    return SkillDatabase.passiveList(actor.character?.passives||[]).map(p=>p.duelRules)
      .find(rule=>rule&&rule.weaponKind===weapon.weaponKind&&
        (skill?.targetType||"SINGLE")===rule.targetType&&skill?.target==="ENEMY")||null;
  }
  function hasDuel(c,actor,target,skill){
    if(!actor?.alive||!target?.alive||actor.team===target.team||distance(actor,target)!==1||!duelRules(actor,skill))return false;
    return !(c.units||[]).some(unit=>unit?.alive&&unit.id!==actor.id&&unit.id!==target.id&&
      unit.occupiesTile!==false&&!unit.carriedByUnitId&&
      (unit.team===target.team&&distance(unit,actor)===1||
       unit.team===actor.team&&distance(unit,target)===1));
  }
  function buildQueue(c){
    return c.actions.filter(a=>a.actor?.alive&&a.target?.alive&&a.skill)
      .map((a,index)=>({...a,index,spd:actionSpeed(a),duelFirst:hasDuel(c,a.actor,a.target,a.skill)&&duelRules(a.actor,a.skill)?.initiative==="FIRST"}))
      .sort((a,b)=>Number(b.duelFirst)-Number(a.duelFirst)||b.spd-a.spd||a.index-b.index);
  }
  function automaticDefenseCounter(c,defender,attacker,hooks){
    const passive=SkillDatabase.passiveList(defender.character?.passives||[])
      .find(p=>p.counterOnDefense?.selection==="BEST_ARMOR_MATCH");
    if(!passive||!defender.alive||!attacker.alive)return null;
    const legal=counterSkills({defender,attacker,canUseSkill:hooks.canUseSkill})
      .filter(skill=>TacticalEngine.canTarget(c.map,defender,attacker,skill,c.environmentState||null));
    // No new numeric coefficient: choose by the existing armor matchup, then
    // official skill power; stable loadout order breaks an exact tie.
    const scored=legal.map((skill,index)=>({skill,index,
      match:BattleEngine.physicalMatch(skill.attackType==="INHERIT"?
        defender.character.weapons?.[skill.weapon]?.attackType:skill.attackType,attacker.character),
      power:Number(skill.power||0)}));
    scored.sort((a,b)=>b.match-a.match||b.power-a.power||a.index-b.index);
    return scored[0]?.skill||null;
  }
  function attackType(a,s){const w=a?.character?.weapons?.[s?.weapon];return s?.attackType==="INHERIT"?w?.attackType:s?.attackType}
  const attackWeapon=(a,s)=>a?.character?.weapons?.[s?.weapon]||null,hasAffix=(i,id)=>i?.affixes?.includes(id)===true;
  function defenseProfileById(d,id){return id?defenseMethods(d).find(p=>p.id===id)||null:null}
  function isPrimaryIncomingAction(c,a){return a.role==="INITIATOR"&&a.actor?.id===c.initiator?.id&&a.target?.id===c.target?.id}
  function resolveEvade(map,a,t,s){const z=resolveWithRandom(map,a,t,s,{forceHit:true}),b=z.result,o=b.hc,f=Math.max(0,o-ACTIVE_EVADE_PENALTY),roll=random()*100;let outcome="MISS",m=0;if(roll<f){outcome="HIT";m=1}else if(roll<o){outcome="GRAZE";m=GRAZE_DAMAGE_MULTIPLIER}return{...z,result:{...b,hit:outcome!=="MISS",graze:outcome==="GRAZE",evadeOutcome:outcome,evadeRoll:roll,originalHitChance:o,activeHitChance:f,damage:Math.round(b.damage*m)}}}
  function resolveDefense(map,a,t,s,r){
    const p=defenseProfileById(t,r?.methodId);
    if(!p)return{...resolveWithRandom(map,a,t,s),defense:{method:null,valid:false,reason:"DEFENSE_METHOD_NOT_FOUND"}};
    const type=attackType(a,s),rule=p.vs?.[type];
    if(!rule)return{...resolveWithRandom(map,a,t,s),defense:{method:p,valid:false,reason:"ATTACK_TYPE_NOT_SUPPORTED",attackType:type}};
    const z=resolveWithRandom(map,a,t,s),b=z.result;
    if(!b.hit)return{...z,defense:{method:p,valid:true,attackType:type,triggered:false,reason:"ATTACK_MISSED"}};
    if(!s?.pureHoly&&p.method==="GUARD"&&hasAffix(attackWeapon(a,s),"PHYSICAL_DEFENSE_IGNORE")&&p.artifact!==true)return{...z,defense:{method:p,valid:true,attackType:type,triggered:false,bypassed:true,reason:"PHYSICAL_DEFENSE_IGNORE"}};
    const material=WeaponMaterialEngine.defenseMatchup({attacker:a,defender:t,skill:s,method:p,attackType:type});
    const effectiveChance=material.chance;
    let success=true,roll=null;
    if(effectiveChance!==null&&Number.isFinite(Number(effectiveChance))){roll=random()*100;success=roll<Number(effectiveChance)}
    let m=1,waitedMultiplier=1,afterInterceptEffects=[];
    if(success){
      m=s?.pureHoly?1:(p.method==="PARRY"?0:(Number.isFinite(Number(rule.damageMultiplier))?Number(rule.damageMultiplier):1));
      if(p.method==="GUARD"&&!s?.pureHoly)m*=Number(t?.character?.modifiers?.guardMultiplier??1);
      if(r?.guardInterception){
        for(const guardRules of passiveGuardRules(t)){
          if(t.waited&&Number.isFinite(Number(guardRules.waitedDamageMultiplier)))waitedMultiplier*=Number(guardRules.waitedDamageMultiplier);
          for(const effect of guardRules.afterInterceptEffects||[])afterInterceptEffects.push(effect);
        }
        if(!s?.pureHoly)m*=waitedMultiplier;
      }
    }
    return{...z,result:{...b,damage:Math.round(b.damage*m)},defense:{method:p,valid:true,attackType:type,triggered:true,success,roll,chance:effectiveChance!==null&&Number.isFinite(Number(effectiveChance))?Number(effectiveChance):null,
      baseChance:Number.isFinite(Number(rule.chance))?Number(rule.chance):null,
      materialPressure:material.pressure,materialAdvantage:material.materialAdvantage,
      physicalOnly:p.physicalOnly===true,damageMultiplier:m,waitedMultiplier,afterInterceptEffects:success&&r?.guardInterception?afterInterceptEffects:[]}};
  }
  function resolveAction(c,a){
    TacticalEngine.ensureFacing(a.actor);TacticalEngine.ensureFacing(a.target);
    globalThis.EffectEngine?.breakStealth?.(a.actor,"ACTION");
    // Taking an adjacent attack never cancels the target's stealth status.
    // Individual observers must succeed at probabilistic contact detection.
    if(a.role!=="INITIATOR")TacticalEngine.faceToward(a.actor,a.target);
    if(a.skill?.bloodShadow)return resolveWithRandom(c.map,a.actor,a.target,a.skill,{forceHit:true});
    if(!isPrimaryIncomingAction(c,a))return resolveWithRandom(c.map,a.actor,a.target,a.skill);
    if(c.interception?.type==="GUARD_ALLY")return resolveDefense(c.map,a.actor,a.target,a.skill,{type:"DEFENSE",methodId:c.interception.methodId,guardInterception:true});
    const evasiveCounter=c.reaction?.type==="COUNTER"&&c.reaction.skill?.evasiveCounter===true;
    if((c.reaction?.type==="EVADE"||evasiveCounter)&&CombatContactRules.canActiveEvade(a.actor,a.skill))
      return resolveEvade(c.map,a.actor,a.target,a.skill);
    if(c.reaction?.type==="DEFENSE")return resolveDefense(c.map,a.actor,a.target,a.skill,c.reaction);
    return resolveWithRandom(c.map,a.actor,a.target,a.skill)
  }
  function normalizeStatus(status){
    if(status.type==="DEF_DOWN")return{type:"BUFF",id:status.id||"DEF_DOWN",name:status.name||"防禦下降",classification:"NEGATIVE",duration:Number(status.duration||2),modifiers:{def:-Math.abs(Number(status.value||0))}};
    if(status.type==="BURN")return{type:"DAMAGE_OVER_TIME",id:status.id||"BURN",name:status.name||"燃燒",classification:"NEGATIVE",duration:Number(status.duration||2),amount:Number(status.amount||10)};
    const {chance,...effect}=status;return effect;
  }
  function applyStatuses(entry){
    if(!entry?.result?.hit||Number(entry.result.damage||0)<=0||!globalThis.EffectEngine)return[];const applied=[];
    for(const status of entry.skill?.statusEffects||[]){const chance=Math.max(0,Math.min(100,Number(status.chance??100)));if(random()*100>=chance)continue;const effect=normalizeStatus(status),result=EffectEngine.apply({source:entry.actor,target:entry.target,effect});if(result?.applied)applied.push({effect,result})}
    if(entry.skill?.giantUppercut===true&&
      uppercutHitsHeavyArmor(entry.target)){
      const result=EffectEngine.apply({source:entry.actor,target:entry.target,
        effect:normalizeStatus({type:'DEF_DOWN',id:'MAGDA_ARMOR_BREAK',name:'巨劍破甲',value:20,duration:2})});
      if(result?.applied)applied.push({effect:result.effect,result});
    }
    return applied;
  }
  function uppercutHitsHeavyArmor(target){
    const c=target?.character||{};
    const armor=c.armor||globalThis.EquipmentDatabase?.get?.(c.armorId);
    return String(armor?.type||'NONE').toUpperCase()==='HEAVY';
  }
  function postQueue(results){const q=[];for(const entry of results){if(!entry.result?.hit)continue;
      for(const effect of entry.skill?.postEffects||[])q.push({actionId:entry.id,role:entry.role,source:entry.actor,target:entry.target,skill:entry.skill,effect});
      // Giant uppercut is strictly vertical: the target stays on its original tile.
      // Heavy armor takes a DEF_DOWN status instead and is never launched.
      if(entry.skill?.giantUppercut===true&&entry.target?.alive&&
         !uppercutHitsHeavyArmor(entry.target)){
        const profile=globalThis.ResourceEngine?.RESOURCE_PROFILES?.rage;
        q.push({actionId:entry.id,role:entry.role,source:entry.actor,target:entry.target,
          skill:entry.skill,effect:{type:'KNOCKBACK',distance:0,lift:Number(profile?.uppercutLift||0)}});
      }
    }return q}

  // A weapon attack has one contact roll but independent critical results for physical and magical components.
  function enchantmentMagicDamage(actor,target,enchant,critical,skill){
    if(!enchant||!target?.character||!actor?.character||!skill)return 0;
    const weapon=actor.character.weapons?.[skill.weapon];
    const type=skill.attackType==="INHERIT"?weapon?.attackType:skill.attackType;
    const sourceClass=BattleEngine.attackClass(weapon,skill,type,{distance:distance(actor,target)});
    return BattleEngine.elementalEnchantmentDamage({matk:enchant.matkSnapshot,
      bonusPower:enchant.bonusPower,element:enchant.element,defender:target.character,
      critical,attackClass:sourceClass});
  }
  // Preview uses the same component calculator as committed attacks; neither
  // read-only forecasts nor selection may consume an enchantment charge.
  function previewEnchantmentBonus(actor,target,skill,{critical=false,defenseMultiplier=1,grazeMultiplier=1}={}){
    const enchant=globalThis.EffectEngine?.weaponEnchantment?.(actor,skill?.weapon);
    if(!enchant)return 0;
    return Math.round(enchantmentMagicDamage(actor,target,enchant,critical,skill)*defenseMultiplier*grazeMultiplier);
  }
  function componentCritical(actor,skill,hit){
    return !!hit&&random()*100<BattleEngine.critChance(actor.character,skill);
  }
  function withEnchantment(resolved,actor,target,enchant,skill){
    if(!enchant)return resolved;
    const base=resolved.result,magicalCrit=componentCritical(actor,skill,base.hit);
    let extra=0;
    if(base.hit){
      let multiplier=base.graze?GRAZE_DAMAGE_MULTIPLIER:1;
      const defense=resolved.defense;
      if(defense?.triggered&&defense.success!==false&&defense.physicalOnly!==true)multiplier*=Number(defense.damageMultiplier??1);
      extra=Math.round(enchantmentMagicDamage(actor,target,enchant,magicalCrit,skill)*multiplier);
    }
    return{...resolved,enchantment:enchant,result:{...base,damage:base.damage+extra,
      weaponDamage:base.damage,enchantmentDamage:extra,enchantmentElement:enchant.element,
      physicalCrit:base.type!=="MAGIC"&&base.crit===true,magicCrit:base.type==="MAGIC"&&base.crit===true||magicalCrit}};
  }
  function inherentMagicSource(actor,skill){
    const soulPower=globalThis.UnitRuntimeEngine?.forestSoulMagicPower?.(actor,skill)||0;
    if(soulPower>0)return{element:"NATURE",power:soulPower};
    return actor?.character?.weapons?.[skill?.weapon]?.inherentMagic||null;
  }
  function inherentMagicDamage(actor,target,skill,critical){
    const weapon=actor?.character?.weapons?.[skill?.weapon];
    const inherent=inherentMagicSource(actor,skill);
    if(!inherent||!target?.character)return 0;
    const type=skill.attackType==="INHERIT"?weapon?.attackType:skill.attackType;
    const sourceClass=BattleEngine.attackClass(weapon,skill,type,{distance:distance(actor,target)});
    return BattleEngine.elementalEnchantmentDamage({
      matk:Number(actor.character.combat?.matk||0),bonusPower:inherent.powerFromSkill?Number(skill.power||0):inherent.power,
      element:inherent.element,defender:target.character,critical,attackClass:sourceClass,unresistable:inherent.unresistable===true
    });
  }
  function previewInherentBonus(actor,target,skill,{critical=false,defenseMultiplier=1,grazeMultiplier=1}={}){
    if(skill?.skipInherentMagic)return 0;
    return Math.round(inherentMagicDamage(actor,target,skill,critical)*defenseMultiplier*grazeMultiplier);
  }
  function withInherentMagic(resolved,actor,target,skill){
    const inherent=inherentMagicSource(actor,skill);
    if(!inherent||skill.skipInherentMagic)return resolved;
    const base=resolved.result,magicalCrit=componentCritical(actor,skill,base.hit);
    let extra=0;
    if(base.hit){
      let multiplier=base.graze?GRAZE_DAMAGE_MULTIPLIER:1;
      const defense=resolved.defense;
      if(!inherent.unblockable&&defense?.triggered&&defense.success!==false&&defense.physicalOnly!==true)multiplier*=Number(defense.damageMultiplier??1);
      extra=Math.round(inherentMagicDamage(actor,target,skill,magicalCrit)*multiplier);
    }
    return {...resolved,result:{...base,weaponDamage:base.weaponDamage??base.damage,
      damage:base.damage+extra,inherentMagicDamage:extra,inherentMagicElement:inherent.element,
      physicalCrit:base.physicalCrit??(base.type!=="MAGIC"&&base.crit===true),magicCrit:!!base.magicCrit||magicalCrit}};
  }
  function splitActualHpLoss(base,hpLoss){
    const actual=Math.max(0,Math.round(Number(hpLoss||0)));
    const baseComponent=Math.max(0,Number(base.weaponDamage??base.damage??0));
    const weapon=base.type==="MAGIC"?0:baseComponent;
    const spell=base.type==="MAGIC"?baseComponent:0;
    const enchant=Math.max(0,Number(base.enchantmentDamage||0));
    const inherent=Math.max(0,Number(base.inherentMagicDamage||0));
    const total=weapon+spell+enchant+inherent;
    const physical=total>0?Math.max(0,Math.min(actual,Math.round(actual*weapon/total))):actual;
    return{physical,magic:actual-physical};
  }
  function attackDamageComponents(base,damageMultiplier){
    const weapon=base.type==="MAGIC"?0:Math.max(0,Number((base.weaponDamage??base.damage??0)));
    const magicBase=base.type==="MAGIC"?Math.max(0,Number((base.weaponDamage??base.damage??0))):0;
    const magicBonus=Math.max(0,Number(base.enchantmentDamage||0))+Math.max(0,Number(base.inherentMagicDamage||0));
    return{physical:Math.max(0,Math.round(weapon*damageMultiplier)),magic:Math.max(0,Math.round((magicBase+magicBonus)*damageMultiplier))};
  }
  function backstepDestination(c,actor,target,skill){
    if(!skill?.backstep||!actor?.alive||!target)return null;
    const dx=Number(actor.x)-Number(target.x),dy=Number(actor.y)-Number(target.y);
    const axes=Math.abs(dx)>=Math.abs(dy)?[[Math.sign(dx),0],[0,Math.sign(dy)]]:[[0,Math.sign(dy)],[Math.sign(dx),0]];
    for(const [ox,oy] of axes){
      if(!ox&&!oy)continue;
      const x=actor.x+ox,y=actor.y+oy;
      const tile=TacticalEngine.tile(c.map,x,y);
      if(tile&&TacticalEngine.canActiveMove(c.map,c.units,actor,x,y))return tile;
    }
    return null;
  }
  // A selected counter-attack is not exempt from authored movement.
  // Resolve landing from canonical map and roster while keeping the selection
  // screen read-only. The same executor runs in browser and PvP headless.
  function counterTransitPlan(c,actor,target,skill){
    if(!actor?.alive||!target?.alive||!c?.map)return null;
    if(skill?.approach){
      if(!TacticalEngine.canTarget(c.map,actor,target,skill,c.environmentState||null))return null;
      const stop=Math.max(1,Number(skill.approach.stopDistance||1));
      const candidates=(c.map.tiles||[]).filter(t=>
        Math.abs(t.x-target.x)+Math.abs(t.y-target.y)===stop&&
        !c.units.some(u=>u.alive&&u.occupiesTile!==false&&u.id!==actor.id&&u.x===t.x&&u.y===t.y));
      const valid=candidates.map(tile=>({tile,path:TacticalEngine.pathTo(c.map,c.units,{...actor},tile.x,tile.y)}))
        .filter(row=>row.path.length>0)
        .sort((a,b)=>a.path.length-b.path.length||a.tile.y-b.tile.y||a.tile.x-b.tile.x);
      return valid.length?{kind:"CHARGE",steps:valid[0].path}:null;
    }
    if(skill?.bloodShadow){
      if(!TacticalEngine.canTarget(c.map,actor,target,skill,c.environmentState||null))return null;
      const back={N:[0,1],S:[0,-1],E:[-1,0],W:[1,0]}[TacticalEngine.ensureFacing(target)];
      if(!back)return null;
      const landing=TacticalEngine.tile(c.map,target.x+back[0],target.y+back[1]);
      if(!landing||!TacticalEngine.canOccupyTerrain(actor,landing)||
         TacticalEngine.isBlockedByObject(c.map,landing.x,landing.y,actor))return null;
      if(c.units.some(u=>u.alive&&u.occupiesTile!==false&&u.id!==actor.id&&u.x===landing.x&&u.y===landing.y))return null;
      if(Math.abs(actor.x-landing.x)+Math.abs(actor.y-landing.y)>
         Number(actor.character?.combat?.move||0))return null;
      return{kind:"TELEPORT",steps:[landing]};
    }
    return null;
  }
  function commitCounterTransit(c,actor,plan,hooks){
    if(!plan)return false;
    for(const tile of plan.steps){
      if(!actor.alive)return false;
      const from={x:actor.x,y:actor.y,z:actor.z};
      if(from.x===tile.x&&from.y===tile.y)continue;
      // Path-to is authoritative for charge; teleport uses its destination
      // legality, never an invented traversed path.
      if(plan.kind==="CHARGE"&&!TacticalEngine.canActiveMove(c.map,c.units,actor,tile.x,tile.y))return false;
      actor.x=tile.x;actor.y=tile.y;
      if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(actor,tile);
      else actor.z=Number(tile.elevation||0);
      globalThis.UnitAnimationEngine?.emitMove?.(actor,{from,kind:plan.kind});
      hooks.onBackstep?.(actor,tile);
    }
    return actor.alive;
  }
  // One authored four-hit combo. Each blink must land on a REAL unoccupied
  // terrain tile, with a valid locked target and the original Shadow Step's
  // horizontal reach. This only plans a landing; no RNG or damage here.
  function liviaFlurryLanding(c,actor,target,skill,contactIndex,used){
    if(!c.map||!actor?.alive||!target?.alive)return null;
    const offsets=[[0,-1],[1,0],[0,1],[-1,0]];
    const maxBlink=Number(globalThis.SkillDatabase?.get?.('shadow_step')?.range?.max||0);
    if(maxBlink<=0)return null;
    for(let k=0;k<offsets.length;k++){
      const [ox,oy]=offsets[(contactIndex-1+k)%offsets.length];
      const tile=TacticalEngine.tile(c.map,target.x+ox,target.y+oy);
      if(!tile||used.has(`${tile.x},${tile.y}`)||distance(actor,tile)>maxBlink||
         !TacticalEngine.canOccupyTerrain(actor,tile)||
         TacticalEngine.isBlockedByObject(c.map,tile.x,tile.y,actor)||
         c.units.some(u=>u!==actor&&u.alive&&u.occupiesTile!==false&&u.x===tile.x&&u.y===tile.y)||
         !TacticalEngine.canTarget(c.map,{...actor,x:tile.x,y:tile.y},target,skill,c.environmentState||null))continue;
      return tile;
    }
    return null;
  }
  function execute(c,hooks={}){
    // Settle the primary attack's loss-of-control decision BEFORE speed-ordering
    // counterattacks. An enemy whose attack never reaches them cannot react to it.
    // This shares the official per-action random sequence and never alters UI target IDs.
    const primary=c.actions[0],runtime=globalThis.UnitRuntimeEngine;
    const eligiblePrimary=primary?.actor?.alive&&primary?.target?.alive&&
      (!hooks.canUseSkill||hooks.canUseSkill(primary.actor,primary.skill));
    const primarySkill=eligiblePrimary?(runtime?.applyResourceScaling?.(primary.actor,primary.skill)||primary.skill):null;
    const primaryLostControl=eligiblePrimary&&runtime?.rollSanityMisfire?.(primary.actor,primarySkill,random);
    const primaryFriends=primaryLostControl?(c.units||[]).filter(unit=>
      unit?.alive&&unit.id!==primary.actor.id&&unit.team===primary.actor.team&&
      unit.occupiesTile!==false&&!unit.carriedByUnitId&&
      TacticalEngine.canTarget(c.map,primary.actor,unit,{...primarySkill,target:"ALLY"},c.environmentState||null)):[];
    const primaryRedirect=primaryFriends.length?
      primaryFriends[Math.min(primaryFriends.length-1,Math.floor(random()*primaryFriends.length))]:null;
    const queue=buildQueue(c).filter(a=>!primaryRedirect||a.role!=="COUNTER"),results=[];
    // Ganfan promises an actual first sword cut BEFORE the incoming counter,
    // regardless of ordinary action-speed ordering. Other skills keep their order.
    if(c.skill?.ganfan&&c.reaction?.type==="COUNTER"){
      const first=queue.findIndex(a=>a.role==="INITIATOR"&&a.actor.id===c.initiator.id);
      const counter=queue.findIndex(a=>a.role==="COUNTER"&&a.actor.id===c.originalTarget.id);
      if(first>=0&&counter>=0&&counter<first){
        const [delayed]=queue.splice(counter,1);
        queue.splice(queue.findIndex(a=>a.role==="INITIATOR"&&a.actor.id===c.initiator.id)+1,0,delayed);
      }
    }
    const evasiveCounter=c.reaction?.type==="COUNTER"&&c.reaction.skill?.evasiveCounter===true;
    if(evasiveCounter){
      const first=queue.findIndex(a=>a.role==="INITIATOR"&&a.actor.id===c.initiator.id);
      const counter=queue.findIndex(a=>a.role==="COUNTER"&&a.actor.id===c.originalTarget.id);
      if(first>=0&&counter>=0&&counter<first){
        const [delayed]=queue.splice(counter,1);
        queue.splice(first+1,0,delayed);
      }
    }
    const defendingGanfan=c.reaction?.type==="COUNTER"&&c.reaction.skill?.ganfan&&
      CombatContactRules.canGanfanDefend(c.initiator,c.originalTarget,c.skill)&&!c.interception;
    if(defendingGanfan){
      const ix=queue.findIndex(a=>a.role==="COUNTER"&&a.actor.id===c.originalTarget.id&&a.skill?.ganfan);
      if(ix>=0)queue.splice(ix,1); // Defensive Ganfan never executes a free ordinary counter.
    }
    let ganfanFirstStrikeCommitted=false,ganfanParryResolved=false,defensiveGanfanChecked=false;
    let evasiveCounterChecked=false,evasiveCounterSucceeded=true;
    // Backward shooting is an attack ability, not an initiator-only movement.
    // Queue one authoritative landing for each actually executed action,
    // including a chosen or automatically generated COUNTER.
    const backsteps=[];
    for(let index=0;index<queue.length;index++){
      const a=queue[index];
      if(!a.actor.alive||!a.target.alive||a.skill?.utilityAction)continue;
      const followup=a.role==="FERVOR_FOLLOWUP"||a.role==="GANFAN_FOLLOWUP";
      if(!followup&&hooks.canUseSkill&&!hooks.canUseSkill(a.actor,a.skill))continue;
      let skill=globalThis.UnitRuntimeEngine?.applyResourceScaling?.(a.actor,a.skill)||a.skill;
      // Charge and Blood Shadow counterattacks must transit BEFORE the hit.
      // Invalid or interrupted landings do not spend a skill or deal damage.
      if(a.role==="COUNTER"&&(skill.approach||skill.bloodShadow)){
        const transit=counterTransitPlan(c,a.actor,a.target,skill);
        if(!transit||!commitCounterTransit(c,a.actor,transit,hooks))continue;
      }
      const bloodRuntime=globalThis.UnitRuntimeEngine;
      // Before resource consumption: use the SAME Sanity snapshot for damage scaling
      // and misfire chance. Target candidates must pass official range, height and LOS.
      const isPrimary=a.role==="INITIATOR"&&a.actor.id===c.initiator.id;
      const lostControl=!isPrimary&&!followup&&bloodRuntime?.rollSanityMisfire?.(a.actor,skill,random);
      const potentialFriends=lostControl?(c.units||[]).filter(unit=>
        unit?.alive&&unit.id!==a.actor.id&&unit.team===a.actor.team&&
        unit.occupiesTile!==false&&!unit.carriedByUnitId&&
        TacticalEngine.canTarget(c.map,a.actor,unit,{...skill,target:"ALLY"},c.environmentState||null)):[];
      const redirected=isPrimary?primaryRedirect:potentialFriends.length?
        potentialFriends[Math.min(potentialFriends.length-1,Math.floor(random()*potentialFriends.length))]:null;
      bloodRuntime?.beginBloodTransaction?.(a.actor);
      const spent=followup?{cost:0,resources:{}}:hooks.consumeSkill?.(a.actor,skill);
      if(spent===null){bloodRuntime?.endBloodTransaction?.(a.actor);continue;}
      // Consume analysis once at formal attack commitment, before accuracy,
      // defense, shield and critical calculations (also on a MISS).
      if(skill.analysisStatusId&&Number.isFinite(Number(skill.analysisPower))&&
        globalThis.EffectEngine?.state?.(a.target).some(effect=>
          effect.id===skill.analysisStatusId&&effect.sourceUnitId===a.actor.id)){
        EffectEngine.removeEffectById(a.target,skill.analysisStatusId);
        skill={...skill,power:Number(skill.analysisPower),analysisConsumed:true};
      }
      const bloodDamageMultiplier=followup?1:(bloodRuntime?.attackEnhancement?.(a.actor,skill)||1);
      const action={...a,skill,target:redirected||a.target,misfire:!!redirected};
      // Resolve the counter's legal landing against the actual participant
      // positions before its shot, just as for an initiator attack.
      const plannedBackstep=skill?.backstep?
        backstepDestination(c,action.actor,action.target,skill):null;
      // A legal backstep belongs to this COMMITTED attack action, not to its
      // hit/crit/damage outcome. MISS, active EVADE and successful GUARD never
      // revoke a planned landing; only actual movement legality/death can.
      if(plannedBackstep&&!followup)
        backsteps.push({unit:action.actor,tile:plannedBackstep});
      let friendlyHpLoss=0,successfulDefenseForCounter=false;
      let ganfanGuardContact=false;
      const enchantment=followup?null:globalThis.EffectEngine?.consumeWeaponEnchantment?.(action.actor,skill.weapon)||null;
      globalThis.EffectEngine?.interruptChannel?.(action.actor,"ATTACK");
      globalThis.EffectEngine?.interruptChannel?.(action.target,"ENGAGEMENT");
      // A normal attack is committed first. Only its target's selected, legally
      // reachable MELEE counter can be intercepted. The equipped black sword's
      // canonical PARRY profile and material matchup own the percentage.
      const ganfanCandidate=a.role==="COUNTER"&&!ganfanParryResolved&&
        ganfanFirstStrikeCommitted&&c.skill?.ganfan&&c.reaction?.type==="COUNTER"&&
        !c.interception&&a.actor.id===c.originalTarget.id&&a.target.id===c.initiator.id&&
        a.actor.alive&&a.target.alive&&distance(a.actor,a.target)===1&&
        TacticalEngine.attackDelivery(a.actor,skill)==="MELEE"&&
        TacticalEngine.canTarget(c.map,a.actor,a.target,skill,c.environmentState||null);
      if(ganfanCandidate){
        ganfanParryResolved=true;
        const profile=EquipmentDatabase.defenseProfiles(c.initiator.character).find(p=>p.counterOnly===true&&p.id===c.skill.ganfan.parryProfileId&&
          p.sourceId===attackWeapon(c.initiator,c.skill)?.id&&p.method==="PARRY");
        const incoming=attackType(a.actor,skill);
        if(profile?.vs?.[incoming]){
          const matchup=WeaponMaterialEngine.defenseMatchup({attacker:a.actor,defender:a.target,
            skill,method:profile,attackType:incoming});
          const chance=Number(matchup.chance);
          if(Number.isFinite(chance)&&chance>0){
            const roll=random()*100;
            if(roll<chance){
              // The attacker really initiated its counter; MP and enchantment
              // have already been consumed. No hit/status/post-effect gets through.
              globalThis.UnitAnimationEngine?.emitAction?.(a.actor,a.target,skill,{role:"COUNTER"});
              globalThis.UnitAnimationEngine?.emitOutcome?.(a.target,"PARRY");
              globalThis.UnitAnimationEngine?.emitPresentation?.("LIVIA_GANFAN_PARRY",{
                unitId:a.target.id,sourceId:a.actor.id,x:a.target.x,y:a.target.y,
                targetX:a.actor.x,targetY:a.actor.y,skillId:"ganfan"});
              const blocked={...action,id:`${a.id}-parried`,role:"GANFAN_PARRY",
                result:{hit:false,ganfanParry:true,damage:0,physicalHpDamage:0,magicHpDamage:0,crit:false,
                  hc:null,accuracy:0,evasion:0,shieldAbsorbed:0},hpAfter:a.target.hp,
                resolved:{terrain:{acc:0,eva:0},defense:{method:profile,valid:true,
                  attackType:incoming,triggered:true,success:true,roll,chance,
                  damageMultiplier:0}},enchantment:null};
              results.push(blocked);hooks.onAction?.(blocked);
              const first=SkillDatabase.get("ganfan");
              if(a.target.alive&&a.actor.alive&&TacticalEngine.canTarget(c.map,a.target,a.actor,first,c.environmentState||null)){
                queue.splice(index+1,0,{id:`ganfan-followup-${a.target.id}`,role:"GANFAN_FOLLOWUP",
                  actor:a.target,target:a.actor,skill:{...first,power:Number(first.ganfan.followupPower),
                    ganfanFollowup:true}});
              }
              bloodRuntime?.endBloodTransaction?.(a.actor);
              continue;
            }
          }
        }
      }
      // Defensive Ganfan: prevent the initiating MELEE strike once, before hit,
      // status, shield and post-effect. Failed parry takes the normal attack.
      if(isPrimary&&defendingGanfan&&!defensiveGanfanChecked){
        defensiveGanfanChecked=true;
        const guardSkill=c.reaction.skill;
        const profile=EquipmentDatabase.defenseProfiles(action.target.character).find(p=>
          p.counterOnly===true&&p.id===guardSkill.ganfan.parryProfileId&&p.method==="PARRY"&&
          p.sourceId===attackWeapon(action.target,guardSkill)?.id);
        const incoming=attackType(action.actor,skill);
        if(profile?.vs?.[incoming]){
          const match=WeaponMaterialEngine.defenseMatchup({attacker:action.actor,defender:action.target,
            skill,method:profile,attackType:incoming});
          const chance=Number(match.chance);
          const roll=random()*100;
          // One defense commitment. No follow-up if the incoming attack is not parried.
          hooks.consumeSkill?.(action.target,guardSkill);
          if(Number.isFinite(chance)&&roll<chance){
            globalThis.UnitAnimationEngine?.emitAction?.(action.actor,action.target,skill,{role:action.role});
            globalThis.UnitAnimationEngine?.emitOutcome?.(action.target,"PARRY");
            globalThis.UnitAnimationEngine?.emitPresentation?.("LIVIA_GANFAN_PARRY",{
              unitId:action.target.id,sourceId:action.actor.id,x:action.target.x,y:action.target.y,
              targetX:action.actor.x,targetY:action.actor.y,skillId:"ganfan"});
            const blocked={...action,id:`${a.id}-defensive-ganfan`,role:"GANFAN_PARRY",
              result:{hit:false,ganfanParry:true,damage:0,physicalHpDamage:0,magicHpDamage:0,crit:false,
                hc:null,accuracy:0,evasion:0,shieldAbsorbed:0},hpAfter:action.target.hp,
              resolved:{terrain:{acc:0,eva:0},defense:{method:profile,valid:true,
                attackType:incoming,triggered:true,success:true,roll,chance,damageMultiplier:0}},enchantment:null};
            results.push(blocked);hooks.onAction?.(blocked);
            if(action.target.alive&&action.actor.alive){
              queue.splice(index+1,0,{id:`ganfan-defensive-followup-${action.target.id}`,
                role:"GANFAN_FOLLOWUP",actor:action.target,target:action.actor,
                skill:{...guardSkill,power:Number(guardSkill.ganfan.followupPower),ganfanFollowup:true}});
            }
            bloodRuntime?.endBloodTransaction?.(a.actor);
            continue;
          }
        }
      }
      // Multi-contact weapons resolve independent hit/crit/damage rolls inside a
      // single committed action. Counter/support selection and resource cost
      // remain one per action, not one per blade.
      const hitCount=Math.max(1,Math.floor(Number(skill.hitCount||1)));
      const blinkCombo=action.actor.character?.id==='livia'&&skill.id==='nether_slash'&&
        hitCount>1&&!followup&&!action.misfire&&!c.interception;
      const origin=blinkCombo?{x:action.actor.x,y:action.actor.y,z:action.actor.z}:null;
      const blinkPath=blinkCombo?[{...origin}]:null,visited=new Set();
      if(blinkCombo)visited.add(`${origin.x},${origin.y}`);
      for(let hitIndex=0;hitIndex<hitCount&&action.target.alive&&action.actor.alive;hitIndex++){
        if(blinkCombo&&hitIndex>0){
          const landing=liviaFlurryLanding(c,action.actor,action.target,skill,hitIndex,visited);
          if(landing){
            action.actor.x=landing.x;action.actor.y=landing.y;
            if(globalThis.VerticalMobilityEngine?.syncUnit)
              VerticalMobilityEngine.syncUnit(action.actor,landing);
            else action.actor.z=Number(landing.elevation||0);
            visited.add(`${landing.x},${landing.y}`);
            TacticalEngine.faceToward(action.actor,action.target);
            // ENTER_TILE remains canonical for hazards, mana wells and terrain.
            const previouslyInterrupted=!!action.actor._fieldMoveInterrupted;
            hooks.onBackstep?.(action.actor,landing);
            if(!previouslyInterrupted&&action.actor._fieldMoveInterrupted){
              blinkPath.push({x:action.actor.x,y:action.actor.y,z:action.actor.z});
              break; // Spatial distortion interrupted this blink sequence.
            }
          }
          blinkPath.push({x:action.actor.x,y:action.actor.y,z:action.actor.z});
          if(!action.actor.alive||!action.target.alive)break;
        }
        const resolved=withInherentMagic(withEnchantment(resolveAction(c,action),action.actor,action.target,hitIndex===0?enchantment:null,skill),action.actor,action.target,skill);
        const original=resolved.result;
        // When a defended Ganfan strike is actually blocked or parried, the
        // defender's committed stance exposes the opening for one riposte.
        // A missed first cut or a failed/unavailable defensive method is not
        // a successful BLOCK and never grants a free second hit.
        if(isPrimary&&c.skill?.ganfan&&!action.misfire&&!c.interception&&
           c.reaction?.type==="DEFENSE"&&original.hit===true&&
           resolved.defense?.triggered===true&&resolved.defense.success===true&&
           Number(resolved.defense.damageMultiplier)<1)ganfanGuardContact=true;
        if(isPrimary&&!action.misfire&&!c.interception&&c.reaction&&
          SkillDatabase.passiveList(action.target.character?.passives||[])
            .some(p=>p.counterOnDefense?.methods?.includes(
              c.reaction.type==="EVADE"?"EVADE":resolved.defense?.method?.method))){
          if(c.reaction.type==="EVADE"&&original.evadeOutcome==="MISS"||
             c.reaction.type==="DEFENSE"&&resolved.defense?.method?.method==="PARRY"&&
             resolved.defense?.triggered&&resolved.defense?.success===true)
            successfulDefenseForCounter=true;
        }
        const sealMultiplier=action.misfire?1:
          a.vengeanceMultiplier||globalThis.EffectEngine?.vengeanceMultiplier?.(a.actor,action.target)||1;
        const bleedingBonus=skill.bloodShadow&&globalThis.EffectEngine?.hasEffect?.(action.target,"BLEEDING")?1.5:1;
        const berserkMultiplier=action.actor?.controlOverride?.type==='BERSERK'?
          (globalThis.UnitTraitEngine?.berserkDamageMultiplier?.(action.actor)||1):1;
        const components=attackDamageComponents(original,original.hit?bloodDamageMultiplier*bleedingBonus*sealMultiplier*berserkMultiplier:0);
        const visualEvent=hitIndex===0?globalThis.UnitAnimationEngine?.emitAction?.(action.actor,action.target,skill,{role:action.role,misfire:action.misfire,projectileKind:action.actor.character?.weapons?.[skill.weapon]?.weaponKind||null,
          enchantmentElement:enchantment?.element||null,visualOrigin:skill.visualOrigin||null,
          duelActive:hasDuel(c,action.actor,action.target,skill),hitCount:hitCount,blinkCombo:blinkCombo,
          backstepLanding:plannedBackstep?{x:plannedBackstep.x,y:plannedBackstep.y,
            z:Number(plannedBackstep.elevation||0)}:null}):null;
        const hallucinationHit=action.target?.hallucination===true&&original.hit;
        const hpBefore=Math.max(0,Number(action.target.hp||0));
        const executionLine=skill?.rageExecution===true&&original.hit&&
          action.target?.character?.unitRole!=='CORE'&&action.target?.kind!=='CORE'&&
          !action.target?.character?.traits?.includes('EXECUTION_IMMUNE')&&
          Number(skill.rageSnapshot||0)>0&&
          hpBefore/Math.max(1,Number(action.target.character?.combat?.hp||hpBefore))<=
            (Number(skill.rageSnapshot||0)/Math.max(1,Number(action.actor.resources?.rage?.max||100)))*
              Number(globalThis.ResourceEngine?.RESOURCE_PROFILES?.rage?.executeMaxHpRatio||0);
        let absorbed=0,physLoss=0,magicLoss=0;
        if(original.hit){
          // One attack event: each damage type passes through the official shield/immunity engine.
          const physical=globalThis.EffectEngine?.applyDamage?.(action.target,hallucinationHit?hpBefore:components.physical,{source:action.actor,damageType:"PHYSICAL"})||{hpLoss:0,absorbed:0};
          const magic=globalThis.EffectEngine?.applyDamage?.(action.target,hallucinationHit?0:components.magic,{source:action.actor,damageType:"MAGIC",unresistable:skill.pureHoly===true||skill.inherentMagic?.unresistable===true||action.actor.character?.weapons?.[skill.weapon]?.inherentMagic?.unresistable===true})||{hpLoss:0,absorbed:0};
          absorbed=Number(physical.absorbed||0)+Number(magic.absorbed||0);
          physLoss=Number(physical.hpLoss||0);magicLoss=Number(magic.hpLoss||0);
        }
        if(executionLine&&original.hit&&!globalThis.EffectEngine?.isInvulnerable?.(action.target)){
          const extra=globalThis.EffectEngine?.applyDamage?.(action.target,Math.max(0,Number(action.target.hp||0)),
            {source:action.actor,damageType:'PHYSICAL'})||{hpLoss:0};
          physLoss+=Number(extra.hpLoss||0);
        }
        // Colin's last line belongs to ONE successful ally interception, not
        // ordinary self-defense, AOE, environment damage or recurring DOT.
        // Both damage components are settled before checking fatality, so the
        // lifesaving HP is not consumed between physical and magical halves.
        if(isPrimary&&c.interception?.type==="GUARD_ALLY"&&c.guardian===action.target&&
           hpBefore>0&&action.target.hp===0&&!action.target._colinLastLineSpent&&
           action.target.character?.passives?.includes("COLIN_LAST_LINE")){
          action.target._colinLastLineSpent=true;action.target.hp=1;
          if(magicLoss>0)magicLoss=Math.max(0,magicLoss-1);
          else physLoss=Math.max(0,physLoss-1);
          globalThis.UnitAnimationEngine?.emitPresentation?.("COLIN_LAST_LINE",{
            unitId:action.target.id,x:action.target.x,y:action.target.y,renderZ:action.target.z,
            sourceId:action.actor.id});
        }
        const physicalCrit=original.type!=="MAGIC"&&(original.physicalCrit??original.crit)===true;
        const magicCrit=original.type==="MAGIC"&&original.crit===true||original.magicCrit===true;
        const result={...original,damage:physLoss+magicLoss,shieldAbsorbed:absorbed,
          physicalHpDamage:physLoss,magicHpDamage:magicLoss,
          physicalCrit,magicCrit,crit:physicalCrit||magicCrit,
          criticalComponents:{physical:physicalCrit,magic:magicCrit},hallucinationBroken:hallucinationHit};
        if(isPrimary&&evasiveCounter){
          evasiveCounterChecked=true;
          if(original.evadeOutcome!=="MISS")evasiveCounterSucceeded=false;
        }
        globalThis.UnitAnimationEngine?.emitResolvedHit?.(action.target,{damage:result.damage,critical:result.crit,
          components:{physical:physLoss,magic:magicLoss},criticalComponents:result.criticalComponents,
          element:original.el||skill.element,componentElements:{
            physical:original.type==="MAGIC"?null:original.el||skill.element,
            magic:original.enchantmentElement||original.inherentMagicElement||(original.type==="MAGIC"?original.el||skill.element:null)},skillId:skill.id});
        if(action.misfire)friendlyHpLoss+=result.damage;
        if(!result.hit)globalThis.UnitAnimationEngine?.emitOutcome?.(action.target,!action.misfire&&c.reaction?.type==="EVADE"&&result.evadeOutcome==="MISS"?"DODGE":"MISS");
        else if(resolved.defense?.triggered&&resolved.defense.success!==false&&Number(resolved.defense.damageMultiplier)<1){
          const swordCounterParry=resolved.defense.method?.method==="PARRY"&&
            SkillDatabase.passiveList(action.target.character?.passives||[])
              .some(p=>p.counterOnDefense?.methods?.includes("PARRY"));
          globalThis.UnitAnimationEngine?.emitOutcome?.(action.target,swordCounterParry?"PARRY":"BLOCK");
        }
        else if(result.graze)globalThis.UnitAnimationEngine?.emitOutcome?.(action.target,"GRAZE");
        const markTarget=(c.interception&&!action.misfire&&a.role==="INITIATOR"?c.originalTarget:action.target);
        if(result.hit)globalThis.EffectEngine?.markVengeance?.(markTarget,action.actor,c.interception?.guardian||null);
        if(result.hit){
          if(!followup&&Number(skill.holyPowerOnHit||0)>0)
            bloodRuntime?.changeHolyPower?.(a.actor,skill.holyPowerOnHit);
          if(!a.vengeanceMultiplier&&sealMultiplier>1)globalThis.EffectEngine?.consumeVengeance?.(a.actor,action.target);
        }
        if(visualEvent){
          visualEvent.enchantmentContact=!!(enchantment&&result.hit&&
            (result.damage>0||result.shieldAbsorbed>0));
          visualEvent.targetDefeated=action.target.hp===0;
        }
        if(Number(result.damage||0)>0&&skill?.rageOnHit===true&&
          globalThis.UnitRuntimeEngine?.rageUser?.(action.actor))
          globalThis.UnitRuntimeEngine.changeRage(action.actor,
            Number(globalThis.ResourceEngine?.RESOURCE_PROFILES?.rage?.slashBonus||0));
        if(action.target.hp===0){action.target.alive=false;hooks.onDefeated?.(action.target,action.actor,skill)}
        else if(result.hit&&result.damage>0)globalThis.UnitAnimationEngine?.emitHit?.(action.target,{sourceId:action.actor.id,skillId:skill?.id||null,damage:result.damage});
        if(action.target.alive&&globalThis.EffectEngine)for(const effect of resolved?.defense?.afterInterceptEffects||[])EffectEngine.apply({source:action.target,target:action.target,effect});
        const refund=globalThis.UnitRuntimeEngine?.criticalManaRefund?.(action.actor,skill,spent,result.crit)??0;
        const e={...action,refundedMana:refund,enchantment:resolved.enchantment||null,resolved:{...resolved,result},result,hpAfter:action.target.hp,
          vengeanceMultiplier:sealMultiplier};
        e.statusEffects=applyStatuses(e);
        // Mana drain reads the target's real remaining MP and only follows
        // actual HP loss. A fully blocking shield never loses mana.
        if(result.hit&&result.damage>0&&skill.manaBurn){
          const mark=skill.manaBurn.analysisId&&globalThis.EffectEngine?.state?.(action.target).some(effect=>
            effect.id===skill.manaBurn.analysisId&&effect.sourceUnitId===action.actor.id);
          const amount=mark?skill.manaBurn.analyzed:skill.manaBurn.normal;
          e.manaBurned=globalThis.UnitRuntimeEngine?.drainMana?.(action.target,amount)||0;
        }
        results.push(e);hooks.onAction?.(e);
        if(!followup&&result.hit&&result.crit&&action.target.alive&&SkillDatabase.passiveList(action.actor.character?.passives||[]).some(passive=>passive.followupOnCritical?.skillId===skill.id)){
          queue.splice(index+1,0,{...a,id:`${a.id}-fervor`,role:"FERVOR_FOLLOWUP",vengeanceMultiplier:sealMultiplier});
        }
      }
      if(blinkCombo&&blinkPath.length>1){
        // Publish *committed* coordinates only. Babylon may animate the figure
        // through these checkpoints, but it can never relocate Game State.
        globalThis.UnitAnimationEngine?.emitPresentation?.('LIVIA_FLURRY_PATH',{
          unitId:action.actor.id,team:action.actor.team,skillId:skill.id,
          targetId:action.target.id,targetX:action.target.x,targetY:action.target.y,
          path:blinkPath});
        if(origin.x!==action.actor.x||origin.y!==action.actor.y)
          globalThis.UnitAnimationEngine?.emitMove?.(action.actor,
            {from:origin,kind:'TELEPORT',duration:180});
      }
      if(isPrimary&&c.skill?.ganfan&&!action.misfire)ganfanFirstStrikeCommitted=true;
      // A successful enemy block is not a free way to turn off Ganfan.
      // Reuse the already authored 1.6-power followup, official hit, armor,
      // shield and critical rules; the defender's original active defense
      // applies to the FIRST committed strike only.
      if(ganfanGuardContact&&action.actor.alive&&action.target.alive&&
         TacticalEngine.canTarget(c.map,action.actor,action.target,c.skill,c.environmentState||null)){
        const first=SkillDatabase.get("ganfan");
        queue.splice(index+1,0,{id:`ganfan-block-followup-${action.actor.id}`,
          role:"GANFAN_FOLLOWUP",actor:action.actor,target:action.target,
          skill:{...first,power:Number(first.ganfan.followupPower),ganfanFollowup:true}});
        globalThis.UnitAnimationEngine?.emitPresentation?.("LIVIA_GANFAN_BREAK_STANCE",{
          unitId:action.actor.id,targetId:action.target.id,
          x:action.actor.x,y:action.actor.y,targetX:action.target.x,targetY:action.target.y,
          skillId:"ganfan"});
      }
      // A successful parry or full dodge schedules ONE legal counter after
      // the entire incoming attack. The reaction engine has no Leon branch.
      // Newly queued counters are not a primary defense: no infinite chain.
      if(isPrimary&&successfulDefenseForCounter&&action.target.alive&&action.actor.alive){
        const counter=automaticDefenseCounter(c,action.target,action.actor,hooks);
        if(counter)queue.splice(index+1,0,createCounterAction(action.target,action.actor,counter));
      }
      // A multi-contact spell grants one backlash refund for its total actual
      // friendly HP loss, capped by this action's real mana cost.
      if(action.misfire&&friendlyHpLoss>0){
        const manaRestored=bloodRuntime?.sanityBacklashRefund?.(action.actor,spent,friendlyHpLoss)||0;
        if(manaRestored>0)globalThis.UnitAnimationEngine?.emitPresentation?.("VELSA_BACKLASH",{
          unitId:action.actor.id,targetId:action.target.id,
          x:action.actor.x,y:action.actor.y,targetX:action.target.x,targetY:action.target.y,
          manaRestored,friendlyHpLoss,skillId:skill.id});
      }
      // Once per committed action even if the first contact defeated the target.
      if(action.actor.alive&&globalThis.EffectEngine&&!followup)
        for(const effect of skill?.afterUseEffects||[])
          EffectEngine.apply({source:action.actor,target:action.actor,effect});
      if(skill?._reactionCounter&&skill.purifiedSlash===true)
        globalThis.UnitTraitEngine?.resetBlueAfterUltimate?.(a.actor);
      bloodRuntime?.endBloodTransaction?.(a.actor);
      if(isPrimary&&evasiveCounter&&(!evasiveCounterChecked||!evasiveCounterSucceeded)){
        const counterIndex=queue.findIndex((candidate,j)=>j>index&&candidate.role==="COUNTER"&&
          candidate.actor.id===c.originalTarget.id&&candidate.skill?.evasiveCounter===true);
        if(counterIndex>=0)queue.splice(counterIndex,1);
      }
    }
    const pq=postQueue(results),post=globalThis.PostEngagementEngine?PostEngagementEngine.process({map:c.map,units:c.units,queue:pq},{
      onEffect:hooks.onPostEffect,
      onDefeated:(defeated,source,effect)=>{
        // The fall/knockback belongs to the triggering skill, including the
        // once-only Battle Hunger cost refund for a skill-caused fall kill.
        const record=pq.find(item=>item.target===defeated&&item.source===source&&item.effect===effect);
        hooks.onDefeated?.(defeated,source,record?.skill||effect);
      }
    }):{queue:pq,results:[]};
    for(const event of post.results||[])if(Number(event?.result?.fallDamage||0)>0)
      globalThis.UnitRuntimeEngine?.onRageForcedLanding?.(event.source,event.target,event.result);
    // Every executed backstep (including a defender's counterattack) commits
    // once after engagement, never when the reaction picker is opened.
    // Keep standard occupancy/elevation/terrain checks and the single official
    // tile-entry callback for water, hazards, passengers and soul pickup.
    for(const {unit,tile} of backsteps){
      if(!unit.alive||!TacticalEngine.canActiveMove(c.map,c.units,unit,tile.x,tile.y))continue;
      const from={x:unit.x,y:unit.y,z:unit.z};
      unit.x=tile.x;unit.y=tile.y;
      if(globalThis.VerticalMobilityEngine?.syncUnit)VerticalMobilityEngine.syncUnit(unit,tile);
      else unit.z=Number(tile.elevation||0);
      globalThis.UnitAnimationEngine?.emitMove?.(unit,{from,kind:"BACKSTEP"});
      hooks.onBackstep?.(unit,tile);
    }
    return{context:c,queue,results,postEngagement:post};
  }
  function resolve(options,hooks={}){
    // An offline AI defender uses the EXISTING autonomous reaction policy when
    // attacked with Ganfan. PvP human ACCEPT is never overwritten: the caller
    // must explicitly supply autonomousReaction=true for this choice.
    const autonomous=options.autonomousReaction===true&&options.skill?.ganfan&&!options.reaction&&
      options.initiator?.alive&&options.target?.alive?
      chooseAutonomousBattleReaction({map:options.map,units:options.units||[],
        attacker:options.initiator,defender:options.target,skill:options.skill,
        environmentState:options.environmentState||null,
        resolution:{prepareSingleTargetReaction,createReaction,actionSpeed,guardCandidates,createGuardInterception},
        canUseSkill:hooks.canUseSkill||(()=>true),eligibleCounterSkill:s=>s.ganfan==null}):null;
    const reaction=options.reaction||autonomous?.reaction||null;
    const interception=options.interception||autonomous?.interception||null;
    const actions=[...(options.actions||[])];
    if(reaction?.type==="COUNTER"&&reaction.skill)
      actions.push(createCounterAction(options.target,options.initiator,reaction.skill));
    return execute(createContext({...options,reaction,interception,actions}),hooks);
  }
  return{enchantmentMagicDamage,previewEnchantmentBonus,previewInherentBonus,splitActualHpLoss,createContext,buildQueue,execute,resolve,actionSpeed,isSingleTarget,supportSkills,supportCandidates,createSupportAction,counterSkills,createCounterAction,createReaction,defenseMethods,guardProfiles,guardCandidates,createGuardInterception,prepareSingleTargetReaction}
}
export const BattleResolution=createBattleResolution();
globalThis.BattleResolution=BattleResolution;
