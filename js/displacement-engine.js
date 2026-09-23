export const WEIGHT=Object.freeze({LIGHT:0,MEDIUM:1,HEAVY:2,IMMOVABLE:99});
const normalizeWeight=v=>String(v||"").toUpperCase();
export function weightClass(target){
  const c=target?.character||target||{}, explicit=normalizeWeight(c.displacement?.weightClass||c.weightClass);
  if(Object.prototype.hasOwnProperty.call(WEIGHT,explicit))return explicit;
  const armor=c.armor; const type=normalizeWeight(armor?.type);
  if(type==="HEAVY")return"HEAVY"; if(type==="MEDIUM")return"MEDIUM"; return"LIGHT";
}
export function resistance(target){const cls=weightClass(target),c=target?.character||target||{},bonus=Math.max(0,Number(c.displacement?.resistance||0));return{weightClass:cls,value:Math.max(0,Number(WEIGHT[cls]??0)+bonus)}}
function axis(base,resist,enabled=true,min=0){base=Math.max(0,Number(base||0));if(!enabled||base<=0)return base;return Math.max(Math.max(0,Number(min||0)),base-resist)}
export function resolveDisplacement(effect={},target){const r=resistance(target),force=effect.force||{},axes=effect.resistAxes||{},baseDistance=Math.max(0,Number(force.horizontal??effect.distance??0)),baseLift=Math.max(0,Number(force.vertical??effect.lift??effect.launchHeight??0));return{weightClass:r.weightClass,resistance:r.value,baseDistance,baseLift,distance:axis(baseDistance,r.value,axes.horizontal!==false,force.minHorizontal??effect.minDistance??0),lift:axis(baseLift,r.value,axes.vertical!==false,force.minVertical??effect.minLift??0)}}
