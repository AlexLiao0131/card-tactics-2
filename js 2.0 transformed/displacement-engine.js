export const DisplacementEngine=(()=>{
  const WEIGHT={LIGHT:0,MEDIUM:1,HEAVY:2,IMMOVABLE:99};
  const normalizeWeight=value=>String(value||"").toUpperCase();
  function weightClass(target){
    const character=target?.character||target||{};
    const explicit=normalizeWeight(character.displacement?.weightClass||character.weightClass);
    if(Object.prototype.hasOwnProperty.call(WEIGHT,explicit))return explicit;
    const armor=window.EquipmentDatabase?.get?.(character.armorId)||character.armor;
    const armorType=normalizeWeight(armor?.type);
    if(armorType==="HEAVY")return "HEAVY";
    if(armorType==="MEDIUM")return "MEDIUM";
    return "LIGHT";
  }
  function resistance(target){
    const cls=weightClass(target),character=target?.character||target||{};
    const bonus=Math.max(0,Number(character.displacement?.resistance||0));
    return {weightClass:cls,value:Math.max(0,Number(WEIGHT[cls]??0)+bonus)};
  }
  function axis(base,resist,enabled=true,min=0){
    base=Math.max(0,Number(base||0));
    if(!enabled||base<=0)return base;
    return Math.max(Math.max(0,Number(min||0)),base-resist);
  }
  function resolve(effect={},target){
    const r=resistance(target),force=effect.force||{},resistAxes=effect.resistAxes||{};
    const baseDistance=Math.max(0,Number(force.horizontal??effect.distance??0));
    const baseLift=Math.max(0,Number(force.vertical??effect.lift??effect.launchHeight??0));
    const distance=axis(baseDistance,r.value,resistAxes.horizontal!==false,force.minHorizontal??effect.minDistance??0);
    const lift=axis(baseLift,r.value,resistAxes.vertical!==false,force.minVertical??effect.minLift??0);
    return {weightClass:r.weightClass,resistance:r.value,baseDistance,baseLift,distance,lift};
  }
  return Object.freeze({WEIGHT,weightClass,resistance,resolve});
})();
globalThis.DisplacementEngine=DisplacementEngine;
