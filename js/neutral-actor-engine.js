/** Generic AI execution policy for resource-driven neutral control effects.
 * Legal attacks, range, visibility, and path validation remain in shared
 * TacticalEngine and UnitRuntimeEngine; no second combat resolution.
 */
import {UnitTraitEngine} from './unit-trait-engine.js';
const isUncontrolled=UnitTraitEngine.isUncontrolled;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function chooseAttack({map,units,unit,runtime,random=Math.random,environmentState=null}={}){
  if(!isUncontrolled(unit)||unit.team!=='N'||!unit.alive)return null;
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
  if(!map||!unit?.alive||!isUncontrolled(unit)||unit.team!=='N')return[];
  const tactical=globalThis.TacticalEngine;
  if(!tactical?.reachable||!tactical?.pathTo)return[];
  const observers=(units||[]).filter(other=>other?.alive&&other.id!==unit.id&&
    other.team!=='N'&&other.occupiesTile!==false&&
    (!tactical.actorCanTrackTarget||tactical.actorCanTrackTarget(map,units,unit,other,environmentState)));
  if(!observers.length)return[];
  const target=observers[Math.floor(clamp(random(),0,.999999)*observers.length)];
  const locations=[...tactical.reachable(map,units,unit)].map(([key,cost])=>{
    const [x,y]=key.split(',').map(Number);
    return{x,y,cost,distance:Math.abs(x-target.x)+Math.abs(y-target.y)};
  }).filter(cell=>cell.distance<Math.abs(target.x-unit.x)+Math.abs(target.y-unit.y));
  if(!locations.length)return[];
  const best=Math.min(...locations.map(v=>v.distance));
  const eligible=locations.filter(v=>v.distance===best);
  const landing=eligible[Math.floor(clamp(random(),0,.999999)*eligible.length)];
  return tactical.pathTo(map,units,unit,landing.x,landing.y)||[];
}

function availableActors(units,round){
  return(units||[]).filter(u=>u?.alive&&u.team==='N'&&isUncontrolled(u)&&
    u.controlOverride.startedRound<=round&&u.controlOverride.actionDoneRound!==round);
}
function markActed(unit,round){if(!isUncontrolled(unit))return false;unit.controlOverride.actionDoneRound=round;return true;}
export const NeutralActorEngine=Object.freeze({chooseAttack,chooseMove,availableActors,markActed,isUncontrolled});
globalThis.NeutralActorEngine=NeutralActorEngine;
