export const UnitAnimationEngine=(()=>{
  "use strict";

  const STATE=Object.freeze({
    IDLE:"IDLE",
    WALK:"WALK",
    ATTACK:"ATTACK",
    CAST:"CAST",
    HURT:"HURT",
    DEATH:"DEATH"
  });

  const DEFAULTS=Object.freeze({
    IDLE:Object.freeze({duration:1200,loop:true,procedural:"BREATHE"}),
    WALK:Object.freeze({duration:180,loop:true,procedural:"STEP"}),
    ATTACK:Object.freeze({duration:320,loop:false,procedural:"LUNGE"}),
    CAST:Object.freeze({duration:480,loop:false,procedural:"CAST"}),
    HURT:Object.freeze({duration:240,loop:false,procedural:"RECOIL"}),
    DEATH:Object.freeze({duration:700,loop:false,procedural:"FALL"})
  });

  const FACINGS=new Set(["N","E","S","W"]);
  const queue=[];
  const previousUnits=new Map();
  // Damage resolved by BattleResolution is recorded once at the real result
  // site; the next published HP delta only emits remaining environmental damage.
  const resolvedDamage=new Map();
  const resolvedHealing=new Map();
  let sequence=0;
  const NEGATIVE_STATUS_TYPES=new Set(["DAMAGE_OVER_TIME","STUN","STUNNED","FREEZE","FROZEN","POISON","BURN","BURNING","PARALYSIS","SILENCE","SLOW","BLIND","BLEED","CURSE","FEAR"]);
  const STATUS_NAMES=Object.freeze({DAMAGE_OVER_TIME:"持續傷害",STUN:"暈眩",STUNNED:"暈眩",FREEZE:"凍結",FROZEN:"凍結",POISON:"中毒",BURN:"燃燒",BURNING:"燃燒",PARALYSIS:"麻痺",SILENCE:"沉默",SLOW:"緩速",BLIND:"目盲",BLEED:"流血",CURSE:"詛咒",FEAR:"恐懼"});
  const statusId=effect=>String(effect?.id||effect?.type||"");
  const abnormal=effect=>effect?.classification==="NEGATIVE"||NEGATIVE_STATUS_TYPES.has(String(effect?.id||"").toUpperCase())||NEGATIVE_STATUS_TYPES.has(String(effect?.type||"").toUpperCase());
  const statusLabel=effect=>String(effect?.name||STATUS_NAMES[String(effect?.id||"").toUpperCase()]||STATUS_NAMES[String(effect?.type||"").toUpperCase()]||effect?.id||effect?.type||"異常狀態");
  function abnormalStatuses(unit){
    const statuses=[],seen=new Set();
    for(const effect of unit?.effects||[]){
      if(!abnormal(effect))continue;
      const id=statusId(effect),name=statusLabel(effect);
      if(!id||seen.has(id))continue;
      seen.add(id);
      statuses.push({id,type:effect.type||null,name,remaining:effect.remaining??null});
    }
    // Sinking without aquatic/breathing protection is the existing gameplay
    // condition that inflicts drowning damage, not a synthetic EffectEngine BUFF.
    if(unit?.waterInteractionState==="SINKING"&&unit?.waterBreathing!==true)
      statuses.push({id:"WATER_DROWNING",type:"WATER_DROWNING",name:"溺水",remaining:null});
    return statuses;
  }
  // The active EffectEngine entries are the sole source for HUD buffs and
  // debuffs. Drowning is already derived by abnormalStatuses() from the
  // published WaterInteraction state; do not create another status store.
  function statusIndicators(unit){
    const negative=abnormalStatuses(unit).map(effect=>({...effect,classification:"NEGATIVE"}));
    const seen=new Set(negative.map(effect=>effect.id));
    const positive=[];
    for(const effect of unit?.effects||[]){
      const type=String(effect?.type||"").toUpperCase();
      if(effect?.classification!=="POSITIVE"&&
        !["BUFF","SHIELD","HEAL_OVER_TIME","STEALTH"].includes(type))continue;
      const id=statusId(effect);
      if(!id||seen.has(id))continue;
      seen.add(id);
      positive.push({id,type:effect.type||null,
        name:String(effect?.name||id),remaining:effect.remaining??null,
        classification:"POSITIVE"});
    }
    return[...positive,...negative];
  }
  const floatPosition=unit=>({unitId:unit.id,x:Number(unit.x||0),y:Number(unit.y||0),renderZ:Number(unit.renderZ??unit.z??0)});
  function emitFloat(unit,kind,value,{afterDeath=false}={}){
    if(!unit?.id||!Number.isFinite(Number(value))&&kind!=="STATUS")return null;
    if(kind!=="STATUS"&&Number(value)<=0)return null;
    return emitPresentation("UNIT_FLOAT_TEXT",{...floatPosition(unit),kind,value,afterDeath});
  }

  function normalizeState(value){
    const state=String(value||STATE.IDLE).toUpperCase();
    return STATE[state]||STATE.IDLE;
  }

  function normalizeFacing(value){
    const facing=String(value||"S").toUpperCase();
    return FACINGS.has(facing)?facing:"S";
  }

  function visualDefinition(visualId,state){
    const resolvedState=normalizeState(state);
    const battle=globalThis.VisualDatabase?.characterBattle?.(visualId)||{};
    const raw=battle?.animations?.[resolvedState];
    let definition=null;
    if(typeof raw==="string")definition=globalThis.VisualDatabase?.animation?.(raw)||null;
    else if(raw&&typeof raw==="object")definition=raw;
    return{...DEFAULTS[resolvedState],...(definition||{})};
  }

  function durationFor(unit,state,detail={}){
    if(Number.isFinite(Number(detail.duration)))return Math.max(1,Number(detail.duration));
    const def=visualDefinition(unit?.visualId||unit?.character?.visualId,state);
    return Math.max(1,Number(def?.duration||DEFAULTS[normalizeState(state)]?.duration||300));
  }

  function skillState(skill){
    if(skill?.animationState)return normalizeState(skill.animationState);
    const type=String(skill?.attackType||"").toUpperCase();
    const category=String(skill?.category||"").toUpperCase();
    if(type==="MAGIC"||category==="MAGIC"||category==="BUFF"||category==="HEAL"||category==="SPECIAL")return STATE.CAST;
    return STATE.ATTACK;
  }

  function unitSnapshot(unit){
    return{
      unitId:unit?.id||null,
      visualId:unit?.visualId||unit?.character?.visualId||null,
      characterId:unit?.character?.id||null,
      team:unit?.team||null,
      facing:normalizeFacing(unit?.facing),
      x:Number(unit?.x||0),
      y:Number(unit?.y||0),
      z:Number(unit?.z||0)
    };
  }

  function emit(unit,state,detail={}){
    if(!unit?.id)return null;
    const resolvedState=normalizeState(state);
    const event={
      type:"UNIT_ANIMATION",
      sequence:++sequence,
      state:resolvedState,
      duration:durationFor(unit,resolvedState,detail),
      ...unitSnapshot(unit),
      ...detail
    };
    event.state=resolvedState;
    event.unitId=unit.id;
    event.facing=normalizeFacing(detail.facing??unit.facing);
    queue.push(event);
    if(queue.length>256)queue.splice(0,queue.length-256);
    return event;
  }

  function emitPresentation(type,detail={}){
    const event={type:String(type||"PRESENTATION_EVENT").toUpperCase(),sequence:++sequence,...detail};
    event.type=String(type||event.type||"PRESENTATION_EVENT").toUpperCase();
    queue.push(event);
    if(queue.length>256)queue.splice(0,queue.length-256);
    return event;
  }

  function emitAction(actor,target,skill,detail={}){
    if(!actor)return null;
    return emit(actor,skillState(skill),{
      skillId:skill?.id||null,
      targetId:target?.id||null,
      targetX:Number(target?.x??actor.x??0),
      targetY:Number(target?.y??actor.y??0),
      ...detail
    });
  }

  function emitHit(target,detail={}){
    if(!target?.id||target?.alive===false)return null;
    return emit(target,STATE.HURT,detail);
  }

  function emitResolvedHit(target,{damage=0,critical=false,components=null}={}){
    if(!target?.id)return null;
    const actual=Math.max(0,Math.round(Number(damage)||0));
    if(!actual)return null;
    const id=String(target.id);
    const previouslyVisible=previousUnits.get(id);
    if(!previouslyVisible)return null;
    resolvedDamage.set(id,(resolvedDamage.get(id)||0)+actual);
    if(!components)return emitFloat(previouslyVisible,critical?"CRITICAL":"DAMAGE",actual,{afterDeath:true});
    const physical=Math.max(0,Math.round(Number(components.physical||0)));
    const magic=Math.max(0,actual-physical);
    const out=[];
    if(physical)out.push(emitFloat(previouslyVisible,critical?"PHYSICAL_CRITICAL":"PHYSICAL_DAMAGE",physical,{afterDeath:true}));
    if(magic)out.push(emitFloat(previouslyVisible,critical?"MAGIC_CRITICAL":"MAGIC_DAMAGE",magic,{afterDeath:true}));
    return out;
  }

  // Combat outcomes are reported by BattleResolution, never guessed from HP.
  // Only visible, previously-published units can receive a floating result.
  function emitOutcome(unit,kind){
    const previous=previousUnits.get(String(unit?.id||""));
    if(!previous||!["MISS","DODGE","BLOCK","PARRY","GRAZE"].includes(kind))return null;
    return emitPresentation("UNIT_FLOAT_TEXT",{...floatPosition(previous),kind,value:kind});
  }
  // EffectEngine is authoritative for individual DOT ticks. Claim the actual
  // HP loss here so the generic snapshot observer cannot duplicate its number.
  function emitDamageOverTime(unit,amount,effect={}){
    const actual=Math.max(0,Math.round(Number(amount)||0));
    if(!actual||!unit?.id)return null;
    const id=String(unit.id),prior=previousUnits.get(id);
    if(!prior)return null;
    resolvedDamage.set(id,(resolvedDamage.get(id)||0)+actual);
    const name=String(effect.name||(/POISON|VENOM|TOXIN/i.test(String(effect.id))?"中毒":/BURN|FIRE/i.test(String(effect.id))?"燃燒":/BLEED|BLOOD/i.test(String(effect.id))?"流血":"持續傷害"));
    return emitPresentation("UNIT_FLOAT_TEXT",{...floatPosition(prior),kind:"DOT",value:actual,label:name,afterDeath:true});
  }

  function emitHealingOverTime(unit,amount){
    const actual=Math.max(0,Math.round(Number(amount)||0));
    if(!actual||!unit?.id)return null;
    const id=String(unit.id),prior=previousUnits.get(id);
    if(!prior)return null;
    resolvedHealing.set(id,(resolvedHealing.get(id)||0)+actual);
    return emitFloat(prior,"HEAL",actual);
  }

  function emitDeath(unit,detail={}){
    if(!unit?.id)return null;
    const previous=previousUnits.get(String(unit.id));
    // Any combat hit already has its own result-derived floating number.
    // Only residual, non-combat damage is still represented by the death delta.
    if(previous&&Number(previous.hp)>0){
      const residual=Math.max(0,Number(previous.hp)-Number(unit.hp||0)-
        Number(resolvedDamage.get(String(unit.id))||0)+Number(resolvedHealing.get(String(unit.id))||0));
      if(residual>0)emitFloat(previous,"DAMAGE",Math.round(residual),{afterDeath:true});
    }
    return emit(unit,STATE.DEATH,{duration:durationFor(unit,STATE.DEATH,detail),...detail});
  }

  function emitMove(unit,{from=null,path=[],kind="UNIT",duration=null}={}){
    if(!unit?.id)return null;
    const points=[];
    const push=point=>{
      if(!point)return;
      const next={x:Number(point.x||0),y:Number(point.y||0),z:Number(point.z??point.elevation??0)};
      const last=points[points.length-1];
      if(last&&last.x===next.x&&last.y===next.y&&last.z===next.z)return;
      points.push(next);
    };
    push(from);
    for(const point of path||[])push(point);
    push(unit);
    if(points.length<2)return null;
    const steps=Math.max(1,points.length-1);
    return emit(unit,STATE.WALK,{
      kind,
      path:points,
      duration:duration==null?Math.max(180,steps*160):duration
    });
  }


  function queued(unitId,...states){
    const wanted=new Set(states.map(normalizeState));
    return queue.some(event=>String(event.unitId)===String(unitId)&&wanted.has(event.state));
  }

  function observe(snapshot){
    const current=new Map();
    for(const unit of snapshot?.units||[]){
      current.set(String(unit.id),{...unit});
      const previous=previousUnits.get(String(unit.id));
      if(previous){
        const moved=Number(previous.x)!==Number(unit.x)||Number(previous.y)!==Number(unit.y)||Number(previous.z)!==Number(unit.z);
        if(moved&&!queued(unit.id,STATE.WALK)){
          const moveEvent=emitMove(unit,{from:previous,path:[unit],kind:"STATE_DELTA"});
          if(moveEvent){
            const tail=queue.pop(),before=queue.findIndex(event=>String(event.unitId)===String(unit.id)&&(event.state===STATE.ATTACK||event.state===STATE.CAST));
            if(before>=0)queue.splice(before,0,tail);else queue.push(tail);
          }
        }
        const hpDelta=Number(unit.hp||0)-Number(previous.hp||0);
        const markedDamage=Number(resolvedDamage.get(String(unit.id))||0);
        const markedHealing=Number(resolvedHealing.get(String(unit.id))||0);
        // Per-event DoT/healing can cancel in net HP; preserve both floats.
        const unknownDelta=hpDelta+markedDamage-markedHealing;
        if(unknownDelta<0)emitFloat(unit,"DAMAGE",Math.round(-unknownDelta));
        else if(unknownDelta>0)emitFloat(unit,"HEAL",Math.round(unknownDelta));
        if(hpDelta<0||markedDamage>0){
          if(!queued(unit.id,STATE.HURT,STATE.DEATH))emitHit(unit,{damage:Math.max(0,-hpDelta),source:"STATE_DELTA"});
        }
        const former=new Set(abnormalStatuses(previous).map(effect=>effect.id));
        for(const effect of abnormalStatuses(unit)){
          if(former.has(effect.id))continue;
          emitFloat(unit,"STATUS",effect.name);
          former.add(effect.id);
        }
      }
    }
    previousUnits.clear();
    for(const[id,unit]of current)previousUnits.set(id,unit);
    resolvedDamage.clear();
    resolvedHealing.clear();
    return snapshot;
  }

  function drain(){
    if(!queue.length)return[];
    return queue.splice(0,queue.length);
  }

  function clear(){queue.length=0;previousUnits.clear();resolvedDamage.clear();resolvedHealing.clear();}

  return Object.freeze({
    STATE,DEFAULTS,normalizeState,normalizeFacing,visualDefinition,skillState,
    emit,emitPresentation,emitAction,emitHit,emitResolvedHit,emitOutcome,emitDamageOverTime,emitHealingOverTime,emitDeath,emitMove,abnormalStatuses,statusIndicators,observe,drain,clear
  });
})();

globalThis.UnitAnimationEngine=UnitAnimationEngine;
