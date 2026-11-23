/** Generic AI execution policy for resource-driven neutral control effects.
 * Legal attacks, range, visibility, and path validation remain in shared
 * TacticalEngine and UnitRuntimeEngine; no second combat resolution.
 */
import {UnitTraitEngine} from './unit-trait-engine.js';
import {MonsterDatabase} from './monster-database.js';
const isUncontrolled=UnitTraitEngine.isUncontrolled;
// A registered encounter monster can act autonomously on team N; uncontrolled
// heroes retain their separate controlOverride lifecycle and random policy.
const isAutonomousNeutral=unit=>unit?.team==='N'&&
  (isUncontrolled(unit)||!!MonsterDatabase.get(unit.monsterId)||
    !!MonsterDatabase.forCharacter(unit?.character?.id));
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function chooseAttack({map,units,unit,runtime,random=Math.random,environmentState=null}={}){
  if(!isAutonomousNeutral(unit)||!unit.alive)return null;
  const skills=(unit.character?.skills||[]).map(id=>globalThis.SkillDatabase?.get?.(id)).filter(s=>
    s&&s.target==='ENEMY'&&(!s.targetType||s.targetType==='SINGLE')&&
    s.weapon&&!s.utilityAction&&runtime?.canUseSkill?.(unit,s));
  const valid=[];
  for(const skill of skills){
    const active=runtime.skillForUnit(unit,skill);
    for(const target of units||[]){
      if(!target.alive||target.id===unit.id||target.team==='N')continue;
      if(globalThis.TacticalEngine?.canTarget?.(map,unit,target,active,environmentState)&&
        (!globalThis.TacticalEngine.actorCanTrackTarget||
          globalThis.TacticalEngine.actorCanTrackTarget(map,units,unit,target,environmentState,{map,units,environmentState})))
        valid.push({skill:active,target});
    }
  }
  if(!valid.length)return null;
  return valid[Math.min(valid.length-1,Math.floor(clamp(random(),0,.999999)*valid.length))];
}
/** A berserk actor's policy first chooses a RANDOM legal target among both
 * former allies and enemies; when none are in range, use the unchanged
 * TacticalEngine pathfinder for exactly one normal movement allowance. */
function chooseMove({map,units,unit,random=Math.random,environmentState=null}={}){
  if(!map||!unit?.alive||!isAutonomousNeutral(unit))return[];
  const tactical=globalThis.TacticalEngine;
  if(!tactical?.reachable||!tactical?.pathTo)return[];
  const observers=(units||[]).filter(other=>other?.alive&&other.id!==unit.id&&
    other.team!=='N'&&other.occupiesTile!==false&&
    (!tactical.actorCanTrackTarget||tactical.actorCanTrackTarget(map,units,unit,other,environmentState)));
  if(!observers.length)return[];
  const target=observers[Math.floor(clamp(random(),0,.999999)*observers.length)];
  const locations=[...tactical.reachable(map,units,unit)].map(([key,cost])=>{
    const [x,y]=key.split(',').map(Number);
    return{x,y,cost,distance:tactical.distanceBetween?.({...unit,x,y},target)??Math.abs(x-target.x)+Math.abs(y-target.y)};
  }).filter(cell=>cell.distance<(tactical.distanceBetween?.(unit,target)??Math.abs(target.x-unit.x)+Math.abs(target.y-unit.y)));
  if(!locations.length)return[];
  const best=Math.min(...locations.map(v=>v.distance));
  const eligible=locations.filter(v=>v.distance===best);
  const landing=eligible[Math.floor(clamp(random(),0,.999999)*eligible.length)];
  return tactical.pathTo(map,units,unit,landing.x,landing.y)||[];
}

/** The canonical water predator decides its own vertical pose at the start
 * of its neutral turn. It surfaces to strike a visible target within its
 * existing skill range; when idle it submerges only if the ENTIRE 2x2 water
 * footprint has enough depth. Both browser and PvP call this same policy. */
function chooseAquaticStance({map,units,unit,environmentState=null}={}){
  if(!map||!unit?.alive||unit.team!=='N'||
    unit.monsterId!=='water_lurker'&&unit.character?.id!=='water_lurker')return null;
  const vertical=globalThis.VerticalMobilityEngine;
  const tactical=globalThis.TacticalEngine;
  if(!vertical?.describe||!vertical?.setMode||!tactical?.tile)return null;
  const origin=tactical.tile(map,unit.x,unit.y);
  if(!origin)return null;
  const activeSkill=(unit.character?.skills||[]).map(id=>globalThis.SkillDatabase?.get?.(id))
    .find(skill=>skill?.target==='ENEMY'&&skill?.weapon&&
      skill?.range&&Number.isFinite(Number(skill.range.max)));
  const threat=!!activeSkill&&(units||[]).some(other=>{
    if(!other?.alive||other.id===unit.id||other.team==='N')return false;
    const distance=tactical.distanceBetween?.(unit,other);
    if(!Number.isFinite(distance)||distance>Number(activeSkill.range.max))return false;
    return !tactical.actorCanTrackTarget||tactical.actorCanTrackTarget(
      map,units,unit,other,environmentState,{map,units,environmentState});
  });
  const cells=tactical.occupiedCells?.(unit)||[{x:unit.x,y:unit.y}];
  const canSubmerge=vertical.capabilities?.(unit)?.canDive&&cells.every(cell=>{
    const tile=tactical.tile(map,cell.x,cell.y);
    return tile&&vertical.waterDepth(tile)>=vertical.bodyHeight(unit)&&
      !globalThis.ClimateEngine?.isSolidIce?.(tile);
  });
  const desired=threat||!canSubmerge?'SWIMMING':'DIVING';
  const before=vertical.describe(unit,origin).mode;
  if(before===desired)return null;
  const changed=vertical.setMode(unit,origin,desired);
  return changed?.ok&&changed.state?.mode===desired?
    {unitId:unit.id,from:before,to:desired}:null;
}

function availableActors(units,round){
  return(units||[]).filter(u=>u?.alive&&isAutonomousNeutral(u)&&
    (isUncontrolled(u)?u.controlOverride.startedRound<=round&&
      u.controlOverride.actionDoneRound!==round:u.neutralActionRound!==round));
}
function markActed(unit,round){if(!isAutonomousNeutral(unit))return false;
  if(isUncontrolled(unit))unit.controlOverride.actionDoneRound=round;
  else unit.neutralActionRound=round;return true;}
export const NeutralActorEngine=Object.freeze({chooseAttack,chooseMove,chooseAquaticStance,availableActors,markActed,isUncontrolled,isAutonomousNeutral});
globalThis.NeutralActorEngine=NeutralActorEngine;
