export const EffectEngine=(()=>{
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
  function hasEffect(unit,id){return state(unit).some(effect=>effect.id===id||effect.type===id)}
  function shieldHp(unit){return state(unit).filter(effect=>effect.type==="SHIELD").reduce((sum,effect)=>sum+Math.max(0,Number(effect.shieldHp||0)),0)}
  function resolveIncomingDamage(unit,amount){
    let remaining=Math.max(0,Math.round(Number(amount||0))),absorbed=0;
    if(!unit||remaining<=0)return{damage:remaining,absorbed,shieldHp:shieldHp(unit)};
    for(const effect of state(unit)){
      if(effect.type!=="SHIELD"||remaining<=0)continue;
      const available=Math.max(0,Number(effect.shieldHp||0));if(available<=0)continue;
      const blocked=Math.min(available,remaining);effect.shieldHp=available-blocked;remaining-=blocked;absorbed+=blocked;
    }
    unit.effects=state(unit).filter(effect=>effect.type!=="SHIELD"||Number(effect.shieldHp||0)>0);
    return{damage:remaining,absorbed,shieldHp:shieldHp(unit)};
  }
  function damage(unit,amount){const resolved=resolveIncomingDamage(unit,amount),before=unit.hp;unit.hp=Math.max(0,unit.hp-resolved.damage);if(unit.hp<=0)unit.alive=false;return before-unit.hp;}
  function targetMatches(source,target,filter={}){
    if(filter.relation&&filter.relation!==relation(source,target))return false;
    if(filter.faction&&target?.character?.faction!==filter.faction)return false;
    if(filter.trait&&!hasTrait(target,filter.trait))return false;
    if(filter.notTrait&&hasTrait(target,filter.notTrait))return false;
    return true;
  }
  function removeNegative(target){
    const before=state(target).length;
    target.effects=target.effects.filter(e=>e.classification!=="NEGATIVE");
    return before-target.effects.length;
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
      if(e.type==="ATTRIBUTE_OVERRIDE")Object.assign(unit.character.attributes,e.values||{});
      if(e.type==="ATTRIBUTE_MODIFIER")for(const [k,v] of Object.entries(e.values||{}))unit.character.attributes[k]=Number(unit.character.attributes[k]||0)+Number(v||0);
      const m=e.modifiers||{};
      for(const key of ["atk","matk","def","mdef","move"])if(m[key]!=null)unit.character.combat[key]=Number(unit.character.combat[key]||0)+Number(m[key]);
      for(const key of ["accuracy","evasion","crit","speed"])if(m[key]!=null)unit.character.modifiers[key]=Number(unit.character.modifiers[key]||0)+Number(m[key]);
      if(m.damageTakenMultiplier!=null)damageTakenMultiplier*=Number(m.damageTakenMultiplier);
      if(m.guardMultiplier!=null)guardMultiplier*=Number(m.guardMultiplier);
    }
    unit.character.modifiers.damageTakenMultiplier=damageTakenMultiplier;
    unit.character.modifiers.guardMultiplier=guardMultiplier;
    window.UnitRuntimeEngine?.syncMana?.(unit);
  }
  function addEffect(target,effect,source){
    const entry={...clone(effect),sourceUnitId:source?.id||null,remaining:Number(effect.duration||0)||null};
    if(effect.stack!==true&&effect.id)target.effects=state(target).filter(e=>e.id!==effect.id);
    state(target).push(entry);syncModifiers(target);return entry;
  }
  function attributeView(unit){
    const base={...(unit?.character?.attributes||{})};
    for(const e of state(unit)){
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
  function copyableSkills(target){
    return SkillDatabase.list(target?.character?.skills||[]).filter(s=>s.copyable!==false&&s.category!=="PASSIVE");
  }
  function apply({source,target,effect,chooseSkill}={}){
    if(!target||!effect)return{applied:false,reason:"INVALID_TARGET"};
    if(effect.targetFilter&&!targetMatches(source,target,effect.targetFilter))return{applied:false,reason:"TARGET_FILTER"};
    if(effect.type==="HEAL")return{applied:true,type:effect.type,amount:heal(target,effect.amount)};
    if(effect.type==="HEAL_OVER_TIME"||effect.type==="DAMAGE_OVER_TIME")return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    if(effect.type==="SHIELD"){
      const amount=Math.max(0,Math.round(Number(effect.amount||0))),entry=addEffect(target,{...effect,shieldHp:amount,maxShieldHp:amount},source);
      return{applied:true,type:effect.type,amount,shieldHp:shieldHp(target),effect:entry};
    }
    if(effect.type==="RESTORE_MANA"){const amount=window.UnitRuntimeEngine?.restoreMana?.(target,effect.amount)||0;return{applied:true,type:effect.type,amount,mana:target.mana,maxMana:target.maxMana};}
    if(effect.type==="MAGIC_DAMAGE"||effect.type==="DAMAGE"){let m=1;for(const [trait,value] of Object.entries(effect.traitMultipliers||{}))if(hasTrait(target,trait))m*=Number(value||1);const amount=damage(target,Number(effect.amount||0)*m);return{applied:true,type:effect.type,amount,multiplier:m};}
    if(effect.type==="DISPEL")return{applied:true,type:effect.type,removed:removeNegative(target)};
    if(effect.type==="BUFF"||effect.type==="ATTRIBUTE_OVERRIDE"||effect.type==="ATTRIBUTE_MODIFIER")return{applied:true,type:effect.type,effect:addEffect(target,effect,source)};
    if(effect.type==="DRAIN"){
      const dealt=damage(target,effect.amount),restored=heal(source,dealt*Number(effect.healRatio??1));
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
  function tick(unit){
    const events=[];
    for(const effect of [...state(unit)]){
      if(effect.type==="HEAL_OVER_TIME"){const amount=heal(unit,effect.amount);events.push({type:"HEAL_OVER_TIME",effectId:effect.id,amount});}
      if(effect.type==="DAMAGE_OVER_TIME"){const amount=damage(unit,effect.amount);events.push({type:"DAMAGE_OVER_TIME",effectId:effect.id,amount});}
      if(effect.remaining!=null)effect.remaining--;
    }
    unit.effects=unit.effects.filter(e=>e.remaining==null||e.remaining>0);
    syncModifiers(unit);
    (unit.grantedSkills||[]).forEach(g=>{if(g.remaining!=null)g.remaining--;});
    unit.grantedSkills=(unit.grantedSkills||[]).filter(g=>g.remaining==null||g.remaining>0);
    return events;
  }
  function isStealthed(unit){return state(unit).some(e=>e.type==="STEALTH");}
  function applyStealth(unit,{id="STEALTH",detectionRange=1,source=null}={}){return addEffect(unit,{id,type:"STEALTH",classification:"POSITIVE",detectionRange},source);}
  function breakStealth(unit,reason="ACTION"){
    if(!unit?.effects)return false;const before=unit.effects.length;unit.effects=unit.effects.filter(e=>e.type!=="STEALTH");if(before!==unit.effects.length){syncModifiers(unit);return true}return false;
  }
  function directTargetAllowed(observer,target){
    if(!isStealthed(target)||observer?.team===target?.team)return true;
    const stealth=state(target).find(e=>e.type==="STEALTH"),normalRange=Math.max(0,Number(stealth?.detectionRange??1));
    const senseRange=state(observer).reduce((max,effect)=>Math.max(max,Number(effect?.revealStealthRange||0)),0),range=Math.max(normalRange,senseRange);
    return Math.abs(Number(observer?.x)-Number(target?.x))+Math.abs(Number(observer?.y)-Number(target?.y))<=range;
  }
  function resolveProximityReveal(mover,units=[]){
    if(!mover?.alive)return[];const revealed=[];
    if(isStealthed(mover)){
      const stealth=state(mover).find(e=>e.type==="STEALTH"),range=Math.max(0,Number(stealth?.detectionRange??1));
      if((units||[]).some(unit=>unit?.alive&&unit.team!==mover.team&&Math.abs(unit.x-mover.x)+Math.abs(unit.y-mover.y)<=range)&&breakStealth(mover,"PROXIMITY"))revealed.push(mover);
    }
    for(const unit of units){if(!unit?.alive||unit.id===mover.id||unit.team===mover.team||!isStealthed(unit))continue;const stealth=state(unit).find(e=>e.type==="STEALTH"),range=Math.max(0,Number(stealth?.detectionRange??1));if(Math.abs(unit.x-mover.x)+Math.abs(unit.y-mover.y)<=range&&breakStealth(unit,"PROXIMITY"))revealed.push(unit);}
    return revealed;
  }
  function skillIds(unit){return [...(unit?.character?.skills||[]),...(unit?.grantedSkills||[]).map(g=>g.skillId)];}
  return{relation,traits,hasTrait,state,targetMatches,heal,damage,hasEffect,shieldHp,resolveIncomingDamage,removeNegative,addEffect,syncModifiers,attributeView,grantSkill,copyableSkills,apply,resolveRelationEffects,tick,isStealthed,applyStealth,breakStealth,directTargetAllowed,resolveProximityReveal,skillIds};
})();
globalThis.EffectEngine=EffectEngine;
