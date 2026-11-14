/** Shared world-space resource wells and displacement fields; gameplay state only.
 * The actor's identity never determines a field's behavior. A creator uses
 * resourceRules to opt into the authored well, all units use the same tile entry.
 */
import {ResourceEngine} from './resource-engine.js';
const profile=ResourceEngine.RESOURCE_PROFILES.duality;
const D=profile.spatialDistortion;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const tileKey=(x,y)=>`${x},${y}`;
const live=u=>u?.alive!==false;
const sameTeam=(a,b)=>String(a)===String(b);
function accessibleTiles(map,units,unit){
  if(!map?.tiles||!unit?.alive||!globalThis.TacticalEngine)return[];
  // Reachability over multiple future moves; not merely one-turn movement.
  // Use the same elevation, occupancy and block rules as official movement.
  const lookup=new Map(map.tiles.map(tile=>[tileKey(tile.x,tile.y),tile]));
  const start=tileKey(unit.x,unit.y),queue=[lookup.get(start)].filter(Boolean),seen=new Set([start]);
  const candidates=[];
  while(queue.length){
    const from=queue.shift();
    for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){
      const next=lookup.get(tileKey(from.x+dx,from.y+dy));if(!next)continue;
      const k=tileKey(next.x,next.y);if(seen.has(k))continue;
      if(!globalThis.TacticalEngine.canOccupyTerrain(unit,next)||
        globalThis.TacticalEngine.isBlockedByObject(map,next.x,next.y,unit)||
        !globalThis.TacticalEngine.canTraverseElevation(from,next,unit))continue;
      if((units||[]).some(u=>u!==unit&&live(u)&&u.occupiesTile!==false&&u.x===next.x&&u.y===next.y))continue;
      seen.add(k);queue.push(next);candidates.push(next);
    }
  }
  return candidates;
}
function hasManaWellRule(unit){
  if(!live(unit)||['N','NEUTRAL'].includes(String(unit.team||'').toUpperCase()))return false;
  return Object.values(ResourceEngine.resourceRules(unit)).some(rule=>rule?.manaWells);
}
function activeManaWellTeams(units=[]){
  return new Set((units||[]).filter(hasManaWellRule).map(unit=>String(unit.team)));
}
function canSenseManaWells(units,team){
  if(team==null)return false;
  return (units||[]).some(unit=>hasManaWellRule(unit)&&sameTeam(unit.team,team));
}
/** Remove team-private wells as soon as their living Livia source leaves play. */
function pruneManaWells(map,units=[]){
  if(!map)return 0;
  const activeTeams=activeManaWellTeams(units);
  const previous=Array.isArray(map.manaWells)?map.manaWells:[];
  map.manaWells=previous.filter(well=>activeTeams.has(String(well.team)));
  map.manaWellSpawnedRounds??={};
  for(const team of Object.keys(map.manaWellSpawnedRounds))
    if(!activeTeams.has(String(team)))delete map.manaWellSpawnedRounds[team];
  return previous.length-map.manaWells.length;
}
function spawnWells(map,units,round,random=Math.random){
  if(!map?.tiles)return 0;
  map.manaWells??=[];
  pruneManaWells(map,units);
  // A new round cannot create a second copy of an occupied coordinate.
  let spawned=0;
  map.manaWellSpawnedRounds??={};
  for(const source of (units||[]).filter(hasManaWellRule)){
    const W=Object.values(ResourceEngine.resourceRules(source)).find(rule=>rule?.manaWells)?.manaWells;
    if(!W)continue;
    if(map.manaWellSpawnedRounds[source.team]===round)continue;
    const owned=map.manaWells.filter(w=>sameTeam(w.team,source.team));
    if(owned.length>=W.maxPerTeam)continue;
    const occupied=new Set(map.manaWells.map(w=>tileKey(w.x,w.y)));
    const eligible=accessibleTiles(map,units,source).filter(t=>!occupied.has(tileKey(t.x,t.y))&&
      !Number.isNaN(Number(t.elevation)));
    if(!eligible.length)continue;
    const count=Math.min(W.perRound,W.maxPerTeam-owned.length);
    for(let i=0;i<count&&eligible.length;i++){
      const idx=Math.min(eligible.length-1,Math.floor(clamp(random(),0,.999999999)*eligible.length));
      const tile=eligible.splice(idx,1)[0];
      map.manaWells.push({x:tile.x,y:tile.y,team:source.team,amount:W.recovery,spawnRound:round});
      spawned++;map.manaWellSpawnedRounds[source.team]=round;
    }
  }
  return spawned;
}
function createDistortion(map,team,tiles,round,profile=D){
  if(!map?.tiles||!Array.isArray(tiles)||!tiles.length)return 0;
  map.spatialDistortions??=[];
  const normalized=[...new Set(tiles.map(t=>tileKey(t.x,t.y)))].map(k=>{const[x,y]=k.split(',').map(Number);return{x,y};});
  map.spatialDistortions.push({team,cells:normalized,fromRound:round,// Duration counts COMPLETE future battle rounds. A cast on round N
  // remains active through N+1 and N+2; expiration runs at the start of N+3.
  // All clients/Worker/renderer use the same exclusive expireRound boundary.
  expireRound:round+Number(profile.durationFutureRounds||0)+1,
    displaceChance:Number(profile.displaceChance||0)});
  return normalized.length;
}
function eligibleWarpLanding(map,units,unit,from,to){
  if(!from||!to||!globalThis.TacticalEngine?.canOccupyTerrain?.(unit,to)||
      globalThis.TacticalEngine.isBlockedByObject(map,to.x,to.y,unit)||
      !globalThis.TacticalEngine.canTraverseElevation(from,to,unit))return false;
  return !(units||[]).some(other=>other!==unit&&live(other)&&other.occupiesTile!==false&&other.x===to.x&&other.y===to.y);
}
function onEnterTile(map,units,unit,round,{random=Math.random}={}){
  if(!map||!unit?.alive)return{restored:0,distorted:false};
  let restored=0;
  const well=canSenseManaWells(units,unit.team)
    ?(map.manaWells||[]).find(w=>w.x===unit.x&&w.y===unit.y&&sameTeam(w.team,unit.team))
    :null;
  if(well&&Number(unit.mana)<Number(unit.maxMana)){
    restored=globalThis.UnitRuntimeEngine?.restoreMana?.(unit,well.amount)||0;
    if(restored>0)map.manaWells.splice(map.manaWells.indexOf(well),1);
  }
  const active=(map.spatialDistortions||[]).filter(field=>field.expireRound>round&&
    !sameTeam(field.team,unit.team)&&field.cells.some(cell=>cell.x===unit.x&&cell.y===unit.y));
  if(!active.length||unit._fieldWarpActionChecked)return{restored,distorted:false};
  unit._fieldWarpActionChecked=true;
  if(random()>=Number(active[0].displaceChance??D.displaceChance))return{restored,distorted:false};
  const at=globalThis.TacticalEngine.tile(map,unit.x,unit.y);
  const neighbors=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>
    globalThis.TacticalEngine.tile(map,at.x+dx,at.y+dy)).filter(t=>eligibleWarpLanding(map,units,unit,at,t));
  // When no neighboring exit is legal, prefer the move origin (if legal),
  // otherwise interrupt on the current legal tile without a fake teleport.
  if(!neighbors.length){
    const from=unit._fieldEntryFrom;
    const origin=from&&globalThis.TacticalEngine.tile(map,from.x,from.y);
    if(!origin||!eligibleWarpLanding(map,units,unit,at,origin))
      return{restored,distorted:true,stopped:true};
    neighbors.push(origin);
  }
  const chosen=neighbors[Math.floor(clamp(random(),0,.999999)*neighbors.length)];
  const previous={x:unit.x,y:unit.y};unit.x=chosen.x;unit.y=chosen.y;
  globalThis.VerticalMobilityEngine?.syncUnit?.(unit,chosen);
  if(!globalThis.VerticalMobilityEngine?.syncUnit)unit.z=Number(chosen.elevation||0);
  globalThis.UnitAnimationEngine?.emitMove?.(unit,{from:previous,kind:'TELEPORT'});
  return{restored,distorted:true,from:previous,to:{x:unit.x,y:unit.y}};
}
function beginMove(unit){
  if(!unit)return;
  delete unit._fieldWarpActionChecked;
  delete unit._fieldMoveInteracted;
  delete unit._fieldMoveInterrupted;
  unit._fieldMoveActionActive=true;
}
function endMove(unit){
  if(!unit)return;
  delete unit._fieldWarpActionChecked;
  delete unit._fieldMoveActionActive;
  delete unit._fieldEntryFrom;
}
/** The authoritative environment calls stageEvent(ENTER_TILE) for EVERY
 * traversal, shove, current, teleport and landing; this is the sole resolver.
 * A move wrapper marks action start/end, not a parallel entry simulation. */
function handleEntry(world,unit,{random=Math.random,log=()=>{},commit=()=>{}}={}){
  if(!unit?.alive)return{restored:0,distorted:false};
  const effect=onEnterTile(world.map,world.units,unit,world.round,{random});
  if(effect.restored>0){unit._fieldMoveInteracted=true;
    log(`${unit.character.name} 回復 ${effect.restored} MP。`);
  }
  if(effect.distorted){unit._fieldMoveInteracted=true;unit._fieldMoveInterrupted=true;
    log(`${unit.character.name} 進入空間扭曲，偏離預定落點。`);
  }
  if(effect.restored>0||effect.distorted)commit(unit);
  // Forced entries are standalone actions; do not silently carry a visited
  // field roll across an unrelated later current, knockback or teleport.
  if(!unit._fieldMoveActionActive)delete unit._fieldWarpActionChecked;
  return effect;
}

function onRoundStart({map,units=[],round,random=Math.random}={}){
  if(map?.spatialDistortions)
    map.spatialDistortions=map.spatialDistortions.filter(f=>Number(f.expireRound)>round);
  return spawnWells(map,units,round,random);
}
export const BattlefieldFieldEngine=Object.freeze({hasManaWellRule,canSenseManaWells,pruneManaWells,
  spawnWells,createDistortion,onEnterTile,handleEntry,beginMove,endMove,onRoundStart});
globalThis.BattlefieldFieldEngine=BattlefieldFieldEngine;
