export const FallEngine=(()=>{
  const FALL_THRESHOLD=2,FALL_DAMAGE_PER_LEVEL=10;
  function tileElevation(map,x,y){
    return TacticalEngine.elevation(TacticalEngine.tile(map,x,y));
  }
  function groundZ(map,unit){
    return Number.isFinite(Number(unit?.z))?Number(unit.z):tileElevation(map,unit?.x,unit?.y);
  }
  function syncGroundZ(map,unit){
    if(unit)unit.z=tileElevation(map,unit.x,unit.y);
    return unit?.z;
  }
  function fallDamage(drop){
    return drop>=FALL_THRESHOLD?(drop-FALL_THRESHOLD+1)*FALL_DAMAGE_PER_LEVEL:0;
  }
  function resolveLanding({map,target,fromZ,applyDamage}){
    const landingZ=tileElevation(map,target.x,target.y);
    const drop=Math.max(0,Number(fromZ)-landingZ);
    const damage=fallDamage(drop);
    if(damage>0)applyDamage?.(target,damage);
    target.z=landingZ;
    return {fromZ:Number(fromZ),toZ:landingZ,drop,damage,damaging:damage>0};
  }
  return Object.freeze({
    FALL_THRESHOLD,FALL_DAMAGE_PER_LEVEL,
    tileElevation,groundZ,syncGroundZ,fallDamage,resolveLanding
  });
})();
globalThis.FallEngine=FallEngine;
