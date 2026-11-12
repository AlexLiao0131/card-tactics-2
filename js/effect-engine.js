// Execution capability is declared by the owning effect engine, not separately
// in the PVP adapter. This subset is safe for single-target synchronous casts;
// new effect types must first have a real EffectEngine.apply handler.
const STANDALONE_DIRECT_EFFECT_TYPES=new Set([
  'HEAL','SHIELD','RESTORE_MANA','HEAL_OVER_TIME','DISPEL','DISPEL_POSITIVE',
  'BUFF','ATTRIBUTE_OVERRIDE','ATTRIBUTE_MODIFIER',
  'DAMAGE_OVER_TIME' // EffectEngine.apply and tick both own this status lifecycle.
]);
export function isStandaloneDirectEffectType(type){
  return typeof type==='string'&&STANDALONE_DIRECT_EFFECT_TYPES.has(type);
}
// Channel capability is owned by the canonical effect engine, not by a PvP
// skill-ID list. A new channel type is enabled only after EffectEngine.apply()
// and tick() both support it with an explicit validated contract.
export function isSupportedChannelRule(rule){
  return rule?.type==='HEALING_CHANNEL' && typeof rule.id==='string' &&
    rule.id.length>0 && Number.isFinite(Number(rule.radius)) &&
    Number.isFinite(Number(rule.amount)) &&
    Number.isFinite(Number(rule.duration)) && Number(rule.duration)>=1;
}

export function createEffectEngine({random=()=>Math.random(),sanctuaryProtects=null}={}) {
  // Browser defaults to its current battle field; the Worker supplies the
  // room-owned field state instead of reading an unrelated browser runtime.
  const underSanctuary=unit=>typeof sanctuaryProtects==='function'
    ?sanctuaryProtects(unit):!!globalThis.CardTacticsRuntime?.sanctuaryProtects?.(unit);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const relation=(source,target)=>source?.id===target?.id?"SELF":source?.team===target?.team?"ALLY":"ENEMY";
  const traits=unit=>new Set([...(unit?.character?.traits||[]),...(unit?.character?.race?[unit.character.race]:[])]);
  const hasTrait=(unit,trait)=>traits(unit).has(trait);
  function state(unit){
    if(!unit.effects)unit.effects=[];
    if(!unit.grantedSkills)unit.grantedSkills=[];
    return unit.effects;
  }
  function maxHp(unit){return Math.max(1,Number(unit?.character?.combat?.hp||unit?.hp||1));}
  function heal(unit,amount){const before=unit.hp;unit.hp=Math.min(maxHp(unit),unit.hp+Math.max(0,Math.round(Number(amount||0))));return unit.hp-before;}
  function saintHealing({source,target,amount,overflowShield=null,skill=null,critical=false}={}){
    const requested=Math.max(0,Math.round(Number(amount||0)*(critical?1.5:1)));
    const restored=heal(target,requested),overheal=Math.max(0,requested-restored);
    if(restored&&source?.alive)globalThis.UnitRuntimeEngine?.changeFaith?.(source,restored);
    let shieldGranted=0;
    if(overheal&&overflowShield){
      const existing=state(target).find(e=>e.type==="SHIELD"&&e.id===overflowShield.id);
      if(existing){if(overheal>Number(existing.shieldHp||0)){existing.shieldHp=overheal;existing.maxShieldHp=Math.max(Number(existing.maxShieldHp||0),overheal);shieldGranted=overheal;} }
      else {addEffect(target,{type:"SHIELD",id:overflowShield.id,name:overflowShield.name,classification:"POSITIVE",shieldHp:overheal,maxShieldHp:overheal,overhealSourceId:source?.id||null,overhealAbsorbed:0,overhealShield:true},source);shieldGranted=overheal;}
    }
    if(restored)globalThis.UnitAnimationEngine?.emitHealingOverTime?.(target,restored,{critical,skillId:skill?.id||"saint_hero_heal"});
    return{applied:true,type:"HEAL",amount:restored,requested,overheal,shieldGranted,critical};
  }
  function hasEffect(unit,id){return state(unit).some(effect=>effect.id===id||effect.type===id)}
  function isInvulnerable(unit){return !!unit?.alive&&state(unit).some(effect=>effect.invulnerable===true);}
  function linkedGuardian(target,units=[]){
    const link=state(target).find(e=>e.type==="HP_LINK"&&e.sourceUnitId);
    if(!link)return null;
    const guardian=(units||[]).find(u=>u.id===link.sourceUnitId)||globalThis.UnitRuntimeEngine?.getLiveUnit?.(link.sourceUnitId);
    return guardian?.alive&&guardian.team===target.team?guardian:null;
  }
  function vengeanceRule(unit){return globalThis.SkillDatabase?.passiveList?.(unit?.character?.passives||[]).find(p=>p?.seal)?.seal||null;}
  function markVengeance(protectedUnit,attacker,interceptor=null){
    if(!attacker?.alive)return false;
    const candidates=[protectedUnit,interceptor,linkedGuardian(protectedUnit)].filter(Boolean);
    const owner=candidates.find(u=>u.alive&&u.team!==attacker.team&&vengeanceRule(u));
    if(!owner)return false;
    const rule=vengeanceRule(owner),id=`${rule.id}:${owner.id}`;
    const result=apply({source:owner,target:attacker,effect:{type:"VENGEANCE_SEAL",id,name:"復仇聖印",classification:"NEGATIVE",duration:rule.duration,ownerId:owner.id}});
    return result?.applied===true;
  }
  function vengeanceMultiplier(attacker,target){
    if(!attacker?.alive||!target?.alive)return 1;
    const rule=vengeanceRule(attacker);
    return rule&&state(target).some(e=>e.type==="VENGEANCE_SEAL"&&e.ownerId===attacker.id)?Number(rule.damageMultiplier||1):1;
  }
  function consumeVengeance(attacker,target){
    const rule=vengeanceRule(attacker);
    if(!rule)return false;
    const before=state(target).length;
    target.effects=state(target).filter(e=>!(e.type==="VENGEANCE_SEAL"&&e.ownerId===attacker.id));
    if(before!==target.effects.length)syncModifiers(target);
    return before!==target.effects.length;
  }
  function shieldHp(unit){return state(unit).filter(effect=>effect.type==="SHIELD").reduce((sum,effect)=>sum+Math.max(0,Number(effect.shieldHp||0)),0)}
  // The single HP-loss result owns shield absorption and blood gain. Presentation must never create damage twice.
  function resolveIncomingDamage(unit,amount,{kind="EXTERNAL"}={}){
    let remaining=Math.max(0,Math.round(Number(amount||0))),absorbed=0,bloodAbsorbed=0;
    if(!unit||remaining<=0)return{damage:remaining,absorbed,bloodAbsorbed,shieldHp:shieldHp(unit)};
    for(const effect of state(unit)){
      if(effect.type!=="SHIELD"||remaining<=0||(kind==="INTERNAL"&&effect.overhealShield))continue;
      const available=Math.max(0,Number(effect.shieldHp||0));if(available<=0)continue;
      const blocked=Math.min(available,remaining);effect.shieldHp=available-blocked;remaining-=blocked;absorbed+=blocked;
      if(effect.overhealShield){
        effect.overhealAbsorbed=Number(effect.overhealAbsorbed||0)+blocked;
        if(effect.shieldHp<=0){
          const caster=globalThis.UnitRuntimeEngine?.getLiveUnit?.(effect.overhealSourceId||effect.sourceUnitId);
          if(caster)UnitRuntimeEngine.changeFaith(caster,effect.overhealAbsorbed);
        }
      }
    }
    unit.effects=state(unit).filter(effect=>effect.type!=="SHIELD"||Number(effect.shieldHp||0)>0);
    const runtime=globalThis.UnitRuntimeEngine;
    if(kind!=="INTERNAL"&&remaining>0&&unit._bloodAwakened&&runtime?.bloodUser?.(unit)){
      bloodAbsorbed=Math.min(remaining,runtime.bloodValue(unit));
      runtime.changeBlood(unit,-bloodAbsorbed);remaining-=bloodAbsorbed;absorbed+=bloodAbsorbed;
    }
    return{damage:remaining,absorbed,bloodAbsorbed,shieldHp:shieldHp(unit)};
  }
  function applyDamage(target,amount,{source=null,kind="EXTERNAL",charge="DIRECT",damageType="PHYSICAL"}={}){
    const hpBefore=Math.max(0,Number(target?.hp||0));
    if(!target||!target.alive)return{damage:0,absorbed:0,bloodAbsorbed:0,hpLoss:0};
    if(isInvulnerable(target))return{damage:0,absorbed:Math.max(0,Math.round(Number(amount||0))),bloodAbsorbed:0,hpLoss:0,shieldHp:shieldHp(target),invulnerable:true};
    if(damageType==="MAGIC"&&kind!=="INTERNAL"&&underSanctuary(target))
      return{damage:0,absorbed:Math.max(0,Math.round(Number(amount||0))),bloodAbsorbed:0,hpLoss:0,shieldHp:shieldHp(target),sanctuaryImmune:true};
    const shield=resolveIncomingDamage(target,amount,{kind});
    target.hp=Math.max(0,hpBefore-shield.damage);
    const hpLoss=hpBefore-target.hp;
    // Humidity responds to real HP loss from magic, after all shields and immunity.
    if(hpLoss>0&&damageType==="MAGIC"&&kind!=="INTERNAL")
      globalThis.UnitRuntimeEngine?.changeHumidity?.(target,-Math.min(15,Math.round(hpLoss*.10)));
    if(hpLoss&&source?.alive&&source.team!==target.team)globalThis.UnitRuntimeEngine?.changeFaith?.(source,-hpLoss);
    if(source?.alive&&source.team!==target.team&&globalThis.UnitRuntimeEngine?.bloodUser?.(source)&&hpLoss>0){
      const credit=charge==="BLEED"?hpLoss/2:charge==="DIRECT"?hpLoss:0;
      if(credit>0)UnitRuntimeEngine.changeBlood(source,credit);
    }
    return{...shield,hpLoss,damage:hpLoss};
  }
  function damage(unit,amount,options){const result=applyDamage(unit,amount,options);if(unit?.hp<=0)unit.alive=false;return result.hpLoss;}
  function bloodBurstCenters(source,units,skill=globalThis.SkillDatabase?.get?.("seraphina_blood_burst"),world=null){
    // The caller may supply the authoritative map and climate explicitly.
    // Durable Objects do not persist unit._runtimeMap, and its absence must
    // never silently reveal concealed units to a player.
    const map=world?.map??source?._runtimeMap??globalThis.CardTacticsRuntime?.getBattleMap?.()??null;
    const environmentState=world?.environmentState??globalThis.CardTacticsRuntime?.getEnvironmentState?.()??null;
    const max=Math.max(0,Number(skill?.range?.max||0));
    return(units||[]).filter(target=>target?.alive&&target.team!==source?.team&&
      Math.abs(target.x-source.x)+Math.abs(target.y-source.y)<=max&&hasEffect(target,"BLEEDING")&&
      (!map||!globalThis.TacticalEngine?.teamCanSee||
        TacticalEngine.teamCanSee(map,units,source.team,target,environmentState)));
  }
  function targetMatches(source,target,filter={}){
    if(filter.relation&&filter.relation!==relation(source,target))return false;
    if(filter.faction&&target?.character?.faction!==filter.faction)return false;
    if(filter.trait&&!hasTrait(target,filter.trait))return false;
    if(filter.notTrait&&hasTrait(target,filter.notTrait))return false;
    return true;
  }
  // Positive buffs are real EffectEngine instances. Enumerate only identities
  // which can be selected exactly and revalidated on the authoritative state.
  function positiveBuffChoices(target){
    const seen=new Set(),out=[];
    for(const entry of state(target)){
      if(entry.classification!=="POSITIVE"||typeof entry.id!=="string"||!entry.id||seen.has(entry.id))continue;
      seen.add(entry.id);out.push({id:entry.id,name:entry.name||entry.id,type:entry.type});
    }
    return out;
  }
  function rewardDispel(source){
    if(!source?.character)return 0;
    const refund=SkillDatabase.passiveList(source.character.passives||[])
      .reduce((sum,passive)=>Math.max(sum,Math.max(0,Number(passive.dispelManaRefund||0))),0);
    return refund>0?(globalThis.UnitRuntimeEngine?.restoreMana?.(source,refund)||0):0;
  }
  function dispelPositive(source,target,id){
    if(!source||!target?.alive||source.team===target.team||typeof id!=="string"||!id)
      return{applied:false,reason:"INVALID_POSITIVE_DISPEL_TARGET"};
    const candidates=state(target).filter(e=>e.classification==="POSITIVE"&&e.id===id);
    // An explicit instance key is required. Never guess the first buff.
    if(candidates.length!==1)return{applied:false,reason:"POSITIVE_BUFF_NOT_FOUND"};
    const entry=candidates[0];
    target.effects=state(target).filter(e=>e!==entry);
    syncModifiers(target);
    return{applied:true,type:"DISPEL_POSITIVE",removed:1,removedId:entry.id,
      removedName:entry.name||entry.id,refundedMana:rewardDispel(source)};
  }
  // Once-per-action crowd control. Do not decrement at global round ticks:
  // a unit hit after acting must still forfeit its next legal action only.
  function consumeActionSkip(unit){
    const pending=state(unit).find(effect=>effect.type==="STUN"&&effect.classification==="NEGATIVE");
    if(!pending)return false;
    removeEffectById(unit,pending.id,{type:"STUN"});
    return true;
  }
  // Exact status removal: water cannot dispel unrelated negative effects.
  function removeEffectById(target,id,{type=null}={}){
    if(!target?.effects?.length)return 0;
    const before=target.effects.length;
    target.effects=target.effects.filter(effect=>!(effect.id===id&&(type===null||effect.type===type)));
    const removed=before-target.effects.length;
    if(removed)syncModifiers(target);
    return removed;
  }
  // BURN remains a normal EffectEngine DOT. The shared EnvironmentEngine
  // fire-heat budget is authoritative for both unit and terrain fires; no
  // separate burning temperature or duplicate per-unit heat system.
  function exchangeWaterBurn(target,volume,{source=null,pulseKey=null}={}){
    const incoming=Math.max(0,Number(volume||0));
    if(!target?.alive||incoming<=0)return{incomingWater:incoming,evaporatedWater:0,remainingWater:incoming,extinguished:0};
    let remaining=incoming,evaporated=0,extinguished=0;
    for(const effect of [...state(target)]){
      if(remaining<=0)break;
      if(effect.id!=="BURN"||effect.type!=="DAMAGE_OVER_TIME")continue;
      // One ambient water exposure per actual climate pulse and source.
      // Distinct direct skill hits have no pulse key and remain independently real.
      if(source&&pulseKey!=null&&effect.wetExposureStamps?.[source]===pulseKey)continue;
      const heat=globalThis.EnvironmentEngine?.fireHeatReserve?.(effect);
      if(!Number.isFinite(heat))continue;
      const vaporized=Math.min(heat,remaining);
      effect.thermalWaterReserve=Math.max(0,heat-vaporized);
      if(source&&pulseKey!=null){effect.wetExposureStamps??={};effect.wetExposureStamps[source]=pulseKey;}
      evaporated+=vaporized;remaining-=vaporized;
      if(effect.thermalWaterReserve<=(globalThis.HydrologyEngine?.EPSILON??0))
        extinguished+=removeEffectById(target,effect.id,{type:effect.type});
    }
    return{incomingWater:incoming,evaporatedWater:evaporated,remainingWater:remaining,extinguished};
  }
  function removeNegative(target){
    const before=state(target).length;
    target.effects=target.effects.filter(e=>e.classification!=="NEGATIVE");
    return before-target.effects.length;
  }
  function consumeNegativeEffectGuard(target,effect){
    if(effect?.classification!=="NEGATIVE"||["DAMAGE","MAGIC_DAMAGE","DRAIN"].includes(effect?.type))return null;
    if(isInvulnerable(target))return{id:"HOLY_SHIELD",name:"聖盾"};
    if(underSanctuary(target))return{id:"SAINT_SANCTUARY_WARD",name:"聖域・庇護"};
    const guard=state(target).find(e=>e.classification==="POSITIVE"&&Number(e?.negativeEffectGuard?.charges||0)>0);
    if(!guard)return null;
    guard.negativeEffectGuard.charges=Math.max(0,Number(guard.negativeEffectGuard.charges||0)-1);
    if(guard.negativeEffectGuard.charges<=0)target.effects=state(target).filter(e=>e!==guard);
    syncModifiers(target);
    return guard;
  }
  function syncModifiers(unit){
    if(!unit?.character)return;
    if(!unit._effectBaseCombat)unit._effectBaseCombat=clone(unit.character.combat||{});
    if(!unit._effectBaseAttributes)unit._effectBaseAttributes=clone(unit.character.attributes||{});
    if(!unit._effectBaseModifiers)unit._effectBaseModifiers=clone(unit.character.modifiers||{});
    unit.character.combat=clone(unit._effectBaseCombat);
    unit.character.attributes=clone(unit._effectBaseAttributes);
    unit.character.modifiers=clone(unit._effectBaseModifiers);
    let damageTakenMultiplier=1,guardMultiplier=1;
    for(const e of state(unit)){
      // Once the physical shield becomes a boat/sled/passenger platform it
      // cannot simultaneously provide the full-shield defensive stance buff.
      if(e.id==="FULL_SHIELD_DEFENSE"&&
        globalThis.ColinShieldMobilityEngine?.shieldOccupied?.(unit))continue;
      if(e.type==="ATTRIBUTE_OVERRIDE")Object.assign(unit.character.attributes,e.values||{});
      if(e.type==="ATTRIBUTE_MODIFIER")for(const [k,v] of Object.entries(e.values||{}))unit.character.attributes[k]=Number(unit.character.attributes[k]||0)+Number(v||0);
      const m=e.modifiers||{};
      for(const key of ["atk","matk","def","mdef","move"])if(m[key]!=null)unit.character.combat[key]=Number(unit.character.combat[key]||0)+Number(m[key]);
      for(const key of ["accuracy","evasion","crit","speed"])if(m[key]!=null)unit.character.modifiers[key]=Number(unit.character.modifiers[key]||0)+Number(m[key]);
      if(m.damageTakenMultiplier!=null)damageTakenMultiplier*=Number(m.damageTakenMultiplier);
      if(m.guardMultiplier!=null)guardMultiplier*=Number(m.guardMultiplier);
    }
    if(unit._bloodAwakened){
      const restored=SkillDatabase.getPassive("PATIENT")?.bloodRestoration?.values||{};
      for(const [key,value] of Object.entries(restored))unit.character.attributes[key]=Number(value);
    }
    unit.character.combat.mdef+=Number(globalThis.UnitRuntimeEngine?.humidityMdefBonus?.(unit)||0);
    unit.character.modifiers.damageTakenMultiplier=damageTakenMultiplier;
    unit.character.modifiers.guardMultiplier=guardMultiplier;
    globalThis.UnitRuntimeEngine?.syncMana?.(unit);
  }
  function addEffect(target,effect,source){
    const entry={...clone(effect),sourceUnitId:source?.id||null,remaining:Number(effect.duration||0)||null};
    // Most effects count the casting round as their first turn. Skills that
    // explicitly promise full *future* rounds instead begin expiring AFTER the
    // first subsequent round boundary. No global duration/balance adjustment.
    if(entry.remaining!=null&&entry.durationClock==="FULL_FUTURE_ROUNDS")
      entry.pendingFirstRoundTick=true;
    if(effect.stack!==true&&effect.id)target.effects=state(target).filter(e=>e.id!==effect.id);
    state(target).push(entry);syncModifiers(target);return entry;
  }
  function attributeView(unit){
    const base={...(unit?.character?.attributes||{})};
    for(const e of state(unit)){
      // Once the physical shield becomes a boat/sled/passenger platform it
      // cannot simultaneously provide the full-shield defensive stance buff.
      if(e.id==="FULL_SHIELD_DEFENSE"&&
        globalThis.ColinShieldMobilityEngine?.shieldOccupied?.(unit))continue;
      if(e.type==="ATTRIBUTE_OVERRIDE")Object.assign(base,e.values||{});
      if(e.type==="ATTRIBUTE_MODIFIER")for(const [k,v] of Object.entries(e.values||{}))base[k]=Number(base[k]||0)+Number(v||0);
    }
    return base;
  }
  function grantSkill(target,skillId,{source=null,duration=null,replaceGroup=null}={}){
    if(!skillId||!SkillDatabase.get(skillId))return null;
    if(replaceGroup)target.grantedSkills=(target.grantedSkills||[]).filter(g=>g.replaceGroup!==replaceGroup);
    const grant={skillId,sourceUnitId:source?.id||null,remaining:duration==null?null:Number(duration),replaceGroup};
    (target.grantedSkills||(target.grantedSkills=[])).push(grant);return grant;
  }
  // Weapon enchantments belong to the unit's regular effect state, keyed by
  // the equipped weapon SLOT (not the global equipment template or card).
  function weaponEnchantment(unit,weaponSlot){
    return state(unit).find(effect=>effect.type==="WEAPON_ENCHANT"&&effect.weaponSlot===weaponSlot)||null;
  }
  function consumeWeaponEnchantment(unit,weaponSlot){
    const effect=weaponEnchantment(unit,weaponSlot);
    if(!effect)return null;
    unit.effects=state(unit).filter(entry=>entry!==effect);
    return{...effect};
  }
  function interruptChannel(unit,reason="ACTION"){
    if(!unit?.effects)return[];
    const removed=unit.effects.filter(e=>e.type==="HEALING_CHANNEL");
    if(removed.length)unit.effects=unit.effects.filter(e=>e.type!=="HEALING_CHANNEL");
    return removed.map(effect=>({id:effect.id,reason}));
  }
  function copyableSkills(target,source=null){
    const known=new Set((source?.grantedSkills||[]).filter(g=>g.bloodMemory).map(g=>g.skillId));
    const excludes=new Set(["CARRY_ALLY","CARRY_ENEMY","RELEASE_CARRIED","SET_VERTICAL_MODE","STEAL_CARD","ENCHANT_WEAPON"]);
    return SkillDatabase.list(target?.character?.skills||[]).filter(skill=>{
      if(skill.copyable===false||skill.category==="PASSIVE"||known.has(skill.id))return false;
      if(skill.id?.startsWith("seraphina_")||skill.bloodShadow||skill.bloodBurst)return false;
      if((skill.variants||[]).some(v=>excludes.has(v.utilityAction?.type)))return false;
      if(excludes.has(skill.utilityAction?.type))return false;
      if(globalThis.UnitRuntimeEngine?.bloodMemoryCost?.(skill)>100)return false;
      if(skill.targeting?.requiresObservationNetwork){
        const networks=SkillDatabase.passiveList(source?.character?.passives||[]).flatMap(passive=>passive.observationNetworks||[]);
        if(!networks.some(network=>network.tag===skill.targeting.requiresObservationNetwork))return false;
      }
      return true;
    });
  }
  function rememberBloodSkill(unit,skillId,source){
    if(!unit||!SkillDatabase.get(skillId)||(unit.grantedSkills||[]).some(g=>g.bloodMemory&&g.skillId===skillId))return null;
    const grant={skillId,sourceUnitId:source?.id||null,remaining:null,bloodMemory:true};
    (unit.grantedSkills||(unit.grantedSkills=[])).push(grant);return grant;
  }
  function commandStatusResistance(target,effect){
    if(!target?.alive||effect?.classification!=="NEGATIVE"||
       ["DAMAGE","MAGIC_DAMAGE","DRAIN"].includes(effect.type))return 0;
    const roster=globalThis.UnitRuntimeEngine?.knownUnits?.()||[];
    let best=0;
    for(const commander of roster){
      if(!commander?.alive||commander.team!==target.team)continue;
      const passives=SkillDatabase.passiveList(commander.character?.passives||[]);
      const radius=Math.max(0,...passives.map(passive=>Number(passive.commandRadius||0)));
      const distance=Math.abs(commander.x-target.x)+Math.abs(commander.y-target.y);
      if(distance>radius)continue;
      for(const passive of passives){
        const chance=Number(passive.commandStatusResistance||0);
        if(Number.isFinite(chance))best=Math.max(best,chance);
      }
    }
    return Math.min(100,Math.max(0,best));
  }
  function apply({source,target,effect,chooseSkill}={}){
    if(!target||!effect)return{applied:false,reason:"INVALID_TARGET"};
    if(effect.targetFilter&&!targetMatches(source,target,effect.targetFilter))return{applied:false,reason:"TARGET_FILTER"};
    // One roll per incoming effect, never once per damage component or tick.
    // Resistance is checked before consumable status wards so a successful
    // commander save does not waste a Saint's GRACE charge.
    // A purification is a beneficial cast even when it carries a NEGATIVE
    // classification for the kind of statuses it removes. Ally resistance and
    // one-use debuff wards must never reject or consume a friendly DISPEL.
    const resistance=effect.type==="DISPEL"?0:commandStatusResistance(target,effect);
    if(resistance>0&&random()*100<resistance)return{applied:false,reason:"STATUS_RESISTED",chance:resistance};
    const guardedBy=effect.type==="DISPEL"?null:consumeNegativeEffectGuard(target,effect);
    if(guardedBy)return{applied:false,reason:"NEGATIVE_EFFECT_GUARD",blockedBy:guardedBy.id||guardedBy.name||"GUARD"};
    if(effect.type==="WEAPON_ENCHANT"){
      if(!effect.weaponSlot||!["FIRE","THUNDER"].includes(effect.element)||!Number.isFinite(effect.matkSnapshot)||!Number.isFinite(effect.bonusPower))return{applied:false,reason:"INVALID_WEAPON_ENCHANT"};
      return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    }
    if(effect.type==="HEAL"){
      if(effect.saintHealing){
        const critical=!!source?.character?.passives?.includes("STIGMATA")&&
          random()*100<BattleEngine.critChance(source.character,SkillDatabase.get("saint_hero_heal"));
        return saintHealing({source,target,amount:effect.amount,overflowShield:effect.overflowShield,critical});
      }
      return{applied:true,type:effect.type,amount:heal(target,effect.amount)};
    }
    if(effect.type==="STUN"){
      return {applied:true,type:"STUN",effect:addEffect(target,{
        ...effect,id:effect.id||"STUN",name:effect.name||"暈眩",
        classification:"NEGATIVE",duration:0
      },source)};
    }
    if(effect.type==="HEALING_CHANNEL"){
      if(!isSupportedChannelRule(effect))return{applied:false,reason:"INVALID_CHANNEL"};
      return{applied:true,type:effect.type,effect:addEffect(target,{...effect,classification:"POSITIVE"},source)};
    }
    if(effect.type==="HEAL_OVER_TIME"||effect.type==="DAMAGE_OVER_TIME")return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    if(effect.type==="SHIELD"){
      const amount=Math.max(0,Math.round(Number(effect.amount||0))),entry=addEffect(target,{...effect,shieldHp:amount,maxShieldHp:amount},source);
      return{applied:true,type:effect.type,amount,shieldHp:shieldHp(target),effect:entry};
    }
    if(effect.type==="RESTORE_MANA"){const amount=globalThis.UnitRuntimeEngine?.restoreMana?.(target,effect.amount)||0;return{applied:true,type:effect.type,amount,mana:target.mana,maxMana:target.maxMana};}
    if(effect.type==="MAGIC_DAMAGE"||effect.type==="DAMAGE"){let m=1;for(const [trait,value] of Object.entries(effect.traitMultipliers||{}))if(hasTrait(target,trait))m*=Number(value||1);const amount=damage(target,Number(effect.amount||0)*m,{source,charge:"DIRECT",damageType:effect.type==="MAGIC_DAMAGE"?"MAGIC":"PHYSICAL"});if(amount>0)globalThis.UnitAnimationEngine?.emitResolvedHit?.(target,{damage:amount,components:{physical:effect.type==="MAGIC_DAMAGE"?0:amount},element:effect.element||null});return{applied:true,type:effect.type,amount,multiplier:m};}
    if(effect.type==="DISPEL_POSITIVE")return dispelPositive(source,target,effect.buffId);
    if(effect.type==="DISPEL"){
      const removed=removeNegative(target);
      if(removed)syncModifiers(target);
      const recovery=effect.restoreResource;
      const restoredResource=recovery?.key?
        {key:recovery.key,amount:globalThis.UnitRuntimeEngine?.changeResource?.(
          target,recovery.key,Number(recovery.amount||0))||0}:null;
      return{applied:true,type:effect.type,removed,restoredResource};
    }
    if(effect.type==="HP_LINK")return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    if(effect.type==="VENGEANCE_SEAL")return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    if(effect.type==="BUFF"||effect.type==="ATTRIBUTE_OVERRIDE"||effect.type==="ATTRIBUTE_MODIFIER"){
      if(effect.cleanseNegative)removeNegative(target);
      return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    }
    if(effect.type==="DRAIN"){
      const dealt=damage(target,effect.amount,{source,charge:"DIRECT"}),restored=heal(source,dealt*Number(effect.healRatio??1));
      return{applied:true,type:effect.type,damage:dealt,healed:restored};
    }
    if(effect.type==="COPY_SKILL"){
      const options=copyableSkills(target),skill=chooseSkill?.(options)||options[0];
      if(!skill)return{applied:false,reason:"NO_COPYABLE_SKILL"};
      return{applied:true,type:effect.type,skillId:skill.id,grant:grantSkill(source,skill.id,{source:target,duration:effect.duration,replaceGroup:effect.replaceGroup||"COPIED_SKILL"})};
    }
    return{applied:false,reason:"UNSUPPORTED_EFFECT"};
  }
  function resolveRelationEffects({source,target,effects=[]}={}){
    const rel=relation(source,target),selected=effects.filter(e=>!e.relation||e.relation===rel);
    return selected.map(effect=>apply({source,target,effect}));
  }
  function tick(unit,{units=[]}={}){
    const events=[];
    for(const effect of [...state(unit)]){
      if(effect.type==="HEALING_CHANNEL"){
        const radius=Math.max(0,Number(effect.radius||0));
        const healed=[];
        for(const ally of units){
          if(!ally?.alive||ally.team!==unit.team)continue;
          if(Math.abs(ally.x-unit.x)+Math.abs(ally.y-unit.y)>radius)continue;
          const amount=heal(ally,effect.amount);
          if(amount>0)globalThis.UnitAnimationEngine?.emitHealingOverTime?.(ally,amount);
          healed.push({unitId:ally.id,amount});
        }
        events.push({type:"HEALING_CHANNEL",effectId:effect.id,healed});
      }
      if(effect.type==="HEAL_OVER_TIME"){const amount=heal(unit,effect.amount);globalThis.UnitAnimationEngine?.emitHealingOverTime?.(unit,amount);events.push({type:"HEAL_OVER_TIME",effectId:effect.id,amount});}
      if(effect.type==="DAMAGE_OVER_TIME"){const source=units.find(u=>u.id===effect.sourceUnitId)||null;const internal=effect.id==="BLEEDING"||/POISON|TOXIN|SUFFOCAT|DROWN/.test(String(effect.id||""));const amount=damage(unit,effect.amount,{source,kind:internal?"INTERNAL":"EXTERNAL",charge:effect.id==="BLEEDING"?"BLEED":"NONE"});globalThis.UnitAnimationEngine?.emitDamageOverTime?.(unit,amount,effect);events.push({type:"DAMAGE_OVER_TIME",effectId:effect.id,amount});}
      if(effect.remaining!=null){
        if(effect.pendingFirstRoundTick===true)effect.pendingFirstRoundTick=false;
        else effect.remaining--;
      }
    }
    unit.effects=unit.effects.filter(e=>e.remaining==null||e.remaining>0);
    syncModifiers(unit);
    (unit.grantedSkills||[]).forEach(g=>{if(g.remaining!=null)g.remaining--;});
    unit.grantedSkills=(unit.grantedSkills||[]).filter(g=>g.remaining==null||g.remaining>0);
    return events;
  }
  // Synchronize time-conditional passive statuses through the normal effect list.
  // _nightStealthArmed only tracks whether this night has already granted its
  // one automatic activation; breaking stealth never instantly re-applies it.
  function syncConditionalPassives(units,environmentState,{rearmTeam=null}={}){
    const night=environmentState?.timeOfDay==="NIGHT";
    let changed=0;
    for(const unit of units||[]){
      if(!unit?.alive)continue;
      for(const passive of SkillDatabase.passiveList(unit.character?.passives||[])){
        const rule=passive?.nightStealth;if(!rule)continue;
        const statusId=rule.id||passive.id;
        if(!night){
          unit._nightStealthArmed=false;
          if(state(unit).some(effect=>effect.id===statusId&&effect.type==="STEALTH")){
            unit.effects=state(unit).filter(effect=>effect.id!==statusId||effect.type!=="STEALTH");
            syncModifiers(unit);changed++;
          }
          continue;
        }
        const rearm=rearmTeam!=null&&unit.team===rearmTeam;
        if(!unit._nightStealthArmed||rearm){
          unit._nightStealthArmed=true;
          // Do not stack with a pre-existing stealth status.
          if(!state(unit).some(effect=>effect.type==="STEALTH")){
            applyStealth(unit,{id:statusId,detectionRange:Math.max(0,Number(rule.detectionRange??1))});
            changed++;
          }
        }
      }
    }
    return changed;
  }
  function isStealthed(unit){return state(unit).some(e=>e.type==="STEALTH");}
  function applyStealth(unit,{id="STEALTH",detectionRange=1,source=null}={}){return addEffect(unit,{id,type:"STEALTH",classification:"POSITIVE",detectionRange},source);}
  function breakStealth(unit,reason="ACTION"){
    if(!unit?.effects)return false;const before=unit.effects.length;unit.effects=unit.effects.filter(e=>e.type!=="STEALTH");if(before!==unit.effects.length){syncModifiers(unit);return true}return false;
  }
  // Stealth is a persistent effect. A spotted contact is scoped to one
  // observer, never broadcast to that observer's team or converted into an
  // effect removal. The existing effect list owns encounter checks and spots.
  function stealthDistance(a,b){return Math.abs(Number(a?.x)-Number(b?.x))+Math.abs(Number(a?.y)-Number(b?.y));}
  function detectionRange(observer,stealth){
    const senseRange=state(observer).reduce((n,e)=>Math.max(n,Math.max(0,Number(e?.revealStealthRange||0))),0);
    return Math.max(Math.max(0,Number(stealth?.detectionRange??1)),senseRange);
  }
  function stealthDetectionChance(observer,target,stealth){
    const see=observer?.character?.attributes||{},hide=target?.character?.attributes||{};
    // Tuneable per STEALTH effect; perception (WIL/LUK) versus agility (AGI/LUK).
    const base=Number(stealth?.detectionChance??30);
    const chance=base+(Number(see.wil||0)-Number(hide.agi||0))*1.5+(Number(see.luk||0)-Number(hide.luk||0))*.5;
    return Math.max(5,Math.min(85,Number.isFinite(chance)?chance:30));
  }
  function directTargetAllowed(observer,target){
    if(!isStealthed(target)||observer?.team===target?.team)return true;
    if(!observer?.id||!observer.alive||!target?.alive)return false;
    const stealth=state(target).find(e=>e.type==="STEALTH");
    if(stealthDistance(observer,target)>detectionRange(observer,stealth))return false;
    return (stealth?.detectedBy||[]).includes(observer.id);
  }
  function checkStealthContact(observer,target){
    if(!observer?.alive||!target?.alive||observer.id===target.id||observer.team===target.team||!isStealthed(target))return false;
    const stealth=state(target).find(e=>e.type==="STEALTH"),id=observer.id;
    stealth.checkedBy??=[];stealth.detectedBy??=[];
    if(stealthDistance(observer,target)>detectionRange(observer,stealth)){
      stealth.checkedBy=stealth.checkedBy.filter(value=>value!==id);
      stealth.detectedBy=stealth.detectedBy.filter(value=>value!==id);
      return false;
    }
    // Roll once upon first contact, not every frame / UI render / attack query.
    if(stealth.checkedBy.includes(id))return false;
    stealth.checkedBy.push(id);
    if(random()*100>=stealthDetectionChance(observer,target,stealth))return false;
    stealth.detectedBy.push(id);
    return true;
  }
  function resolveProximityReveal(mover,units=[]){
    if(!mover?.alive)return[];
    const discovered=[];
    for(const observer of units||[]){
      if(!observer?.alive||observer.id===mover.id||observer.team===mover.team)continue;
      if(checkStealthContact(observer,mover))discovered.push({observer,target:mover});
      if(checkStealthContact(mover,observer))discovered.push({observer:mover,target:observer});
    }
    return discovered;
  }
  function skillIds(unit){return [...(unit?.character?.skills||[]),...(unit?.grantedSkills||[]).filter(g=>!g.bloodMemory||unit?._bloodAwakened).map(g=>g.skillId)];}
  function bloodMemorySkills(unit){return (unit?.grantedSkills||[]).filter(g=>g.bloodMemory).map(g=>SkillDatabase.get(g.skillId));}
  return{commandStatusResistance,isStandaloneDirectEffectType,isSupportedChannelRule,isInvulnerable,linkedGuardian,markVengeance,vengeanceMultiplier,consumeVengeance,saintHealing,applyDamage,bloodBurstCenters,rememberBloodSkill,bloodMemorySkills,interruptChannel,weaponEnchantment,consumeWeaponEnchantment,relation,traits,hasTrait,state,targetMatches,heal,damage,hasEffect,shieldHp,positiveBuffChoices,dispelPositive,rewardDispel,resolveIncomingDamage,consumeActionSkip,removeEffectById,exchangeWaterBurn,removeNegative,consumeNegativeEffectGuard,addEffect,syncModifiers,attributeView,grantSkill,copyableSkills,apply,resolveRelationEffects,tick,syncConditionalPassives,isStealthed,applyStealth,breakStealth,directTargetAllowed,resolveProximityReveal,skillIds};
}
export const EffectEngine=createEffectEngine();
globalThis.EffectEngine=EffectEngine;
