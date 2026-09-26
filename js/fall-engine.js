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
  function resolveLanding({map,target,fromZ,applyDamage}){
    const tile=TacticalEngine.tile(map,target.x,target.y);
    const vertical=globalThis.VerticalMobilityEngine&&tile?VerticalMobilityEngine.describe(target,tile):null;
    const landingZ=vertical?vertical.physicalZ:tileElevation(map,target.x,target.y);
    const drop=globalThis.VerticalMobilityEngine?.ignoresFall?.(target)?0:Math.max(0,Number(fromZ)-landingZ);
    const damage=fallDamage(drop);
    if(damage>0)applyDamage?.(target,damage);
    target.z=landingZ;
    if(vertical)VerticalMobilityEngine.syncUnit(target,tile);
    return {fromZ:Number(fromZ),toZ:Number(target.z),drop,damage,damaging:damage>0,verticalMode:target.verticalState?.mode||null};
  }
  return Object.freeze({
    FALL_THRESHOLD,FALL_DAMAGE_PER_LEVEL,
    tileElevation,groundZ,syncGroundZ,fallDamage,resolveLanding
  });
})();
globalThis.FallEngine=FallEngine;
