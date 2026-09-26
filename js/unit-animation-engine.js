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
  let sequence=0;

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

  function emitDeath(unit,detail={}){
    if(!unit?.id)return null;
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
        const lost=Math.max(0,Number(previous.hp||0)-Number(unit.hp||0));
        if(lost>0&&!queued(unit.id,STATE.HURT,STATE.DEATH)){
          emitHit(unit,{damage:lost,source:"STATE_DELTA"});
        }
      }
    }
    previousUnits.clear();
    for(const[id,unit]of current)previousUnits.set(id,unit);
    return snapshot;
  }

  function drain(){
    if(!queue.length)return[];
    return queue.splice(0,queue.length);
  }

  function clear(){queue.length=0;previousUnits.clear();}

  return Object.freeze({
    STATE,DEFAULTS,normalizeState,normalizeFacing,visualDefinition,skillState,
    emit,emitAction,emitHit,emitDeath,emitMove,observe,drain,clear
  });
})();

globalThis.UnitAnimationEngine=UnitAnimationEngine;
