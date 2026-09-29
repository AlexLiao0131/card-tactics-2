export const FallEngine=(()=>{
  const FALL_THRESHOLD=2,FALL_DAMAGE_PER_LEVEL=10;
  function tileElevation(map,x,y){
    return TacticalEngine.elevation(TacticalEngine.tile(map,x,y));
  }
  function groundZ(map,unit){
    return Number.isFinite(Number(unit?.z))?Number(unit.z):tileElevation(map,unit?.x,unit?.y);
  }
  function syncGroundZ(map,unit){
    if(!unit)return unit?.z;
    const tile=TacticalEngine.tile(map,unit.x,unit.y);
    if(globalThis.VerticalMobilityEngine&&tile)VerticalMobilityEngine.syncUnit(unit,tile);
    else unit.z=tileElevation(map,unit.x,unit.y);
    return unit.z;
  }
  function fallDamage(drop){
    return drop>=FALL_THRESHOLD?(drop-FALL_THRESHOLD+1)*FALL_DAMAGE_PER_LEVEL:0;
  }
  function fallDamageFor(target,drop){
    let safe=FALL_THRESHOLD-1,multiplier=1;
    for(const passive of globalThis.SkillDatabase?.passiveList?.(target?.character?.passives)||[]){const rule=passive?.fallRules;if(!rule)continue;if(Number.isFinite(Number(rule.safeDrop)))safe=Math.max(safe,Number(rule.safeDrop));if(Number.isFinite(Number(rule.damageMultiplier)))multiplier*=Number(rule.damageMultiplier);}
    if(drop<=safe)return 0;return Math.max(0,Math.round(fallDamage(drop)*multiplier));
  }
  function resolveLanding({map,target,fromZ,applyDamage}){
    const tile=TacticalEngine.tile(map,target.x,target.y);
    const vertical=globalThis.VerticalMobilityEngine&&tile?VerticalMobilityEngine.describe(target,tile):null;
    const landingZ=vertical?vertical.physicalZ:tileElevation(map,target.x,target.y);
    const drop=globalThis.VerticalMobilityEngine?.ignoresFall?.(target)?0:Math.max(0,Number(fromZ)-landingZ);
    const rawDamage=fallDamageFor(target,drop);
    const protection=rawDamage>0?globalThis.ItemRuntimeEngine?.resolveTrigger?.(target,"FALL_DAMAGE",{damage:rawDamage,drop,fromZ,landingZ}):null;
    const damage=protection?.preventDamage?0:rawDamage;
    if(damage>0)applyDamage?.(target,damage);
    target.z=landingZ;
    if(vertical)VerticalMobilityEngine.syncUnit(target,tile);
    return {fromZ:Number(fromZ),toZ:Number(target.z),drop,damage,rawDamage,damaging:damage>0,preventedByItem:protection?.preventDamage?protection.item?.id||null:null,verticalMode:target.verticalState?.mode||null};
  }
  return Object.freeze({
    FALL_THRESHOLD,FALL_DAMAGE_PER_LEVEL,
    tileElevation,groundZ,syncGroundZ,fallDamage,fallDamageFor,resolveLanding
  });
})();
globalThis.FallEngine=FallEngine;
