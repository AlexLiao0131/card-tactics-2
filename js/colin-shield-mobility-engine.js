/**
 * Colin's tower shield as a real, team-private mobility tool.
 * Source of truth is the canonical unit roster and terrain. This module never
 * owns a parallel map, skill cooldown, movement points or renderer state.
 */
export const ColinShieldMobilityEngine=(()=>{
  const PASSIVE="COLIN_SHIELD_MASTERY",SHIELD="colin_full_body_shield";
  const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
  // Index immutable tile coordinates once; never scan the whole map inside
  // Dijkstra's repeated neighbor expansions on mobile Safari.
  const tileIndexes=new WeakMap();
  const at=(map,x,y)=>{
    if(!map||!Array.isArray(map.tiles))return null;
    let index=tileIndexes.get(map);
    if(!index){index=new Map(map.tiles.map(t=>[`${t.x},${t.y}`,t]));tileIndexes.set(map,index);}
    return index.get(`${x},${y}`)||null;
  };
  const depth=t=>Math.max(0,Number(globalThis.HydrologyEngine?.waterDepth?.(t)??t?.waterDepth??0));
  const icy=t=>!!t&&!!globalThis.ClimateEngine?.isSolidIce?.(t);
  const bodyHeight=u=>Math.max(.25,Number(u?.character?.collision?.height??2));
  const hasShield=u=>!!u?.alive&&u.character?.id==="colin"&&
    (u.character.passives||[]).includes(PASSIVE)&&
    (u.character.equipmentIds||[]).includes(SHIELD);
  function active(u){
    if(!hasShield(u)||shieldOccupied(u)||u.shieldRidingOn||u.transportHidden||u.carryingUnitId)return false;
    if((u.effects||[]).some(e=>e?.id==="STUN"||e?.id==="FULL_SHIELD_DEFENSE"||e?.movementRules?.immobilized===true))return false;
    return true;
  }
  function modeAt(u,t,from=null){
    if(!hasShield(u)||!t)return null;
    if(icy(t))return "ICE_SLED";
    if(depth(t)>=bodyHeight(u))return "BOAT";
    if(from&&Number(from.snowDepth||0)>0&&Number(t.snowDepth||0)>0&&Number(t.elevation)<Number(from.elevation))return "SNOW_SLED";
    if(u.shieldPassengerId)return "BOARD_READY";
    return null;
  }
  const shieldOccupied=u=>!!hasShield(u)&&["BOAT","SNOW_SLED","ICE_SLED","BOARD_READY"].includes(
    String(u.shieldMobilityMode||modeAt(u,at(u._runtimeMap,u.x,u.y))||
      (u.verticalState?.mode==="SHIELD_BOAT"?"BOAT":"")));
  const capablePassenger=u=>!!u?.alive&&!u.shieldRidingOn&&!u.carryingUnitId&&!u.transportHidden&&
    (u.character?.armor?.type==="LIGHT"||u.character?.armorType==="LIGHT"||
     (u.character?.armorTypes||[]).includes("LIGHT")||
     globalThis.EquipmentDatabase?.get?.(u.character?.armorId)?.type==="LIGHT");
  function canBoard(map,units,carrier,passenger){
    return hasShield(carrier)&&!carrier.shieldPassengerId&&!carrier.shieldRidingOn&&
      passenger?.team===carrier.team&&passenger?.id!==carrier.id&&capablePassenger(passenger)&&
      Math.abs(carrier.x-passenger.x)+Math.abs(carrier.y-passenger.y)===1&&
      !carrier.carryingUnitId&&
      (globalThis.TacticalEngine?.canTraverseElevation?.(at(map,passenger.x,passenger.y),at(map,carrier.x,carrier.y),passenger)??true)&&
      !(carrier.effects||[]).some(e=>e?.movementRules?.immobilized===true);
  }
  function board(map,units,carrier,passenger){
    if(!canBoard(map,units,carrier,passenger))return false;
    carrier.shieldPassengerId=passenger.id;
    passenger.shieldRidingOn=carrier.id;
    passenger.shieldRideMoved=false;
    passenger.shieldRideSurfaceMode=modeAt(carrier,at(map,carrier.x,carrier.y));
    passenger.occupiesTile=false;
    passenger.x=carrier.x;passenger.y=carrier.y;passenger.z=carrier.z;
    passenger.facing=carrier.facing;
    carrier.shieldMobilityMode=modeAt(carrier,at(map,carrier.x,carrier.y));
    return true;
  }
  function canDismount(map,units,carrier,x,y){
    if(!carrier?.shieldPassengerId)return false;
    const rider=(units||[]).find(u=>u.id===carrier.shieldPassengerId&&u.alive&&u.shieldRidingOn===carrier.id);
    const t=at(map,x,y),ct=at(map,carrier.x,carrier.y);
    return !!rider&&!!t&&Math.abs(x-carrier.x)+Math.abs(y-carrier.y)===1&&
      !((units||[]).some(u=>u.alive&&u.occupiesTile!==false&&u.x===x&&u.y===y))&&
      (globalThis.TacticalEngine?.canOccupyTerrain?.(rider,t)??true)&&
      (globalThis.TacticalEngine?.canTraverseElevation?.(ct,t,rider)??true)&&
      !globalThis.TacticalEngine?.isBlockedByObject?.(map,x,y,rider);
  }
  function dismount(map,units,carrier,x,y){
    if(!canDismount(map,units,carrier,x,y))return false;
    const rider=units.find(u=>u.id===carrier.shieldPassengerId);
    delete rider.shieldRidingOn;delete rider.shieldRideMoved;delete rider.shieldRideSurfaceMode;
    rider.moved=true; // Disembarking may never grant a second independent move.
    rider.occupiesTile=true;rider.x=x;rider.y=y;
    globalThis.VerticalMobilityEngine?.syncUnit?.(rider,at(map,x,y));
    carrier.shieldPassengerId=null;
    carrier.shieldMobilityMode=modeAt(carrier,at(map,carrier.x,carrier.y));
    return true;
  }
  function syncPassenger(units,carrier,{movement=false}={}){
    if(!carrier?.shieldPassengerId)return null;
    const rider=(units||[]).find(u=>u?.id===carrier.shieldPassengerId);
    if(!rider||!rider.alive||!carrier.alive){
      if(rider){delete rider.shieldRidingOn;delete rider.shieldRideSurfaceMode;rider.occupiesTile=true;}
      carrier.shieldPassengerId=null;return null;
    }
    rider.x=carrier.x;rider.y=carrier.y;rider.z=carrier.z;rider.facing=carrier.facing;
    rider.occupiesTile=false;
    rider.shieldRideSurfaceMode=carrier.shieldMobilityMode||null;
    if(movement){rider.shieldRideMoved=true;rider.moved=true;}
    return rider;
  }
  function stepSupport(map,units,unit,from,to){
    if(!unit?.alive||unit.shieldRidingOn||unit.occupiesTile===false||!from||!to)return null;
    const dx=to.x-from.x,dy=to.y-from.y;
    if(Math.abs(dx)+Math.abs(dy)!==2||dx&&dy)return null;
    const middle=at(map,from.x+dx/2,from.y+dy/2);
    if(!middle)return null;
    const guardian=(units||[]).find(g=>g?.alive&&g.x===middle.x&&g.y===middle.y&&g.team===unit.team&&active(g));
    if(!guardian||guardian.id===unit.id)return null;
    if((units||[]).some(g=>g?.alive&&g.occupiesTile!==false&&g.id!==unit.id&&g.x===to.x&&g.y===to.y))return null;
    const tactical=globalThis.TacticalEngine;
    if(!tactical?.canOccupyTerrain?.(unit,to)||tactical?.isBlockedByObject?.(map,to.x,to.y,unit))return null;
    // A shield is exactly ONE elevation step above Colin's occupied tile.
    // The two supported legs must each obey the traveler's own actual limits.
    const support={...middle,elevation:Number(middle.elevation||0)+1};
    const total=Math.abs(Number(to.elevation||0)-Number(from.elevation||0));
    if(total<=0||!tactical.canTraverseElevation(from,support,unit)||
       !tactical.canTraverseElevation(support,to,unit))return null;
    // The shield grants exactly one extra H1 of vertical traversal, regardless
    // of Colin's height or of other terrain bonuses owned by the traveler.
    const rise=Number(to.elevation||0)-Number(from.elevation||0);
    const adjusted={...to,elevation:Number(to.elevation||0)-Math.sign(rise)};
    if(!tactical.canTraverseElevation(from,adjusted,unit))return null;
    return {guardianId:guardian.id,via:{x:middle.x,y:middle.y,z:Number(support.elevation)},from:{x:from.x,y:from.y},to:{x:to.x,y:to.y}};
  }
  function transitions(map,units,unit,from){
    const out=[];
    for(const [dx,dy] of dirs){const to=at(map,from.x+2*dx,from.y+2*dy);
      const step=stepSupport(map,units,unit,from,to);
      if(step)out.push({tile:to,shieldTransit:step});
    }
    return out;
  }
  function isSnowDescent(u,from,to){return hasShield(u)&&!u.shieldRidingOn&&
    Number(from?.snowDepth||0)>0&&Number(to?.snowDepth||0)>0&&
    Number(to?.elevation||0)<Number(from?.elevation||0);
  }
  function moveCost(unit,from,to,normal){
    // Gravity drives a valid downhill snow segment. It consumes no extra tile
    // budget, but height must strictly decrease; no zero-cost loop is possible.
    return isSnowDescent(unit,from,to)?0:normal;
  }
  function dismountOptions(map,units,carrier){return dirs.map(([dx,dy])=>({x:carrier.x+dx,y:carrier.y+dy}))
      .filter(t=>canDismount(map,units,carrier,t.x,t.y));}
  return Object.freeze({hasShield,active,modeAt,shieldOccupied,canBoard,board,
    canDismount,dismount,dismountOptions,syncPassenger,stepSupport,transitions,moveCost,isSnowDescent});
})();
globalThis.ColinShieldMobilityEngine=ColinShieldMobilityEngine;
