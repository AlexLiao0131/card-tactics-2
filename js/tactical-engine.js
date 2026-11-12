import {ColinShieldMobilityEngine} from "./colin-shield-mobility-engine.js";
export const TacticalEngine=(()=>{
  const K=(x,y)=>x+","+y,D=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const MAX_NORMAL_CLIMB=1,MAX_NORMAL_DROP=1;
  const BASE_VISION_RANGE=6,LOCAL_AWARENESS_RANGE=1;
  const FACINGS=["N","E","S","W"];
  // Read-only spatial index: references authoritative Grid tiles, never copies tile state.
  // Grid tiles keep their x/y coordinates; climate, height and water mutate on the same objects.
  const tileIndices=new WeakMap();
  function tile(m,x,y){
    if(!m?.tiles)return null;
    let index=tileIndices.get(m);
    if(!index||index.tiles!==m.tiles||index.length!==m.tiles.length){
      index={tiles:m.tiles,length:m.tiles.length,byKey:new Map(m.tiles.map(t=>[K(t.x,t.y),t]))};
      tileIndices.set(m,index);
    }
    return index.byKey.get(K(x,y))||null;
  }
  // Authored LINE movement geometry is shared by the original browser
  // TacticalActionController and the server headless authority.
  // Crossed occupants are valid hit targets; they must not block transit.
  function lineTiles(m,attacker,end){
    const dx=Math.sign(end.x-attacker.x),dy=Math.sign(end.y-attacker.y);
    if(dx&&dy||!dx&&!dy)return[];
    const out=[];let x=attacker.x+dx,y=attacker.y+dy;
    while(x!==end.x||y!==end.y){out.push(tile(m,x,y));x+=dx;y+=dy;}
    out.push(tile(m,end.x,end.y));return out.filter(Boolean);
  }
  function canTraverseMoveLine(m,attacker,end){
    const path=lineTiles(m,attacker,end);
    if(!path.length)return false;
    let previous=tile(m,attacker.x,attacker.y);
    for(const step of path){
      if(!step||!canOccupyTerrain(attacker,step)||
         isBlockedByObject(m,step.x,step.y,attacker)||
         !canTraverseElevation(previous,step,attacker))return false;
      previous=step;
    }
    return true;
  }
  function objectAt(m,x,y){return (m?.objects||[]).find(o=>!o.destroyed&&o.type!=="HOLY_WING_BARRIER"&&o.x===x&&o.y===y)||null}
  function occupied(us,x,y,id){return us.some(u=>u.alive&&u.id!==id&&u.occupiesTile!==false&&u.x===x&&u.y===y)}
  function elevation(t){return Number(t?.elevation||0)}
  function terrainTraits(u){
    const set=new Set(u?.character?.terrainTraits||[]);
    for(const passive of globalThis.SkillDatabase?.passiveList?.(u?.character?.passives)||[])for(const trait of passive?.terrainTraits||[])set.add(trait);
    // Temporary movement traits from canonical effects belong to the same
    // terrain evaluator as permanent character and passive traits.
    for(const effect of globalThis.EffectEngine?.state?.(u)||[])for(const trait of effect?.terrainTraits||[])set.add(trait);
    return [...set];
  }
  function terrainPassiveModifiers(character,t){
    const out={accuracy:0,evasion:0,crit:0,speed:0};
    if(!character||!t)return out;
    for(const passive of globalThis.SkillDatabase?.passiveList?.(character.passives)||[]){
      if(passive?.terrain&&passive.terrain!==t.terrain)continue;
      for(const key of Object.keys(out))out[key]+=Number(passive?.modifiers?.[key]||0);
    }
    return out;
  }
  function effectMovementRules(u){
    const out={};
    for(const effect of globalThis.EffectEngine?.state?.(u)||[]){
      if(effect?.id==="FULL_SHIELD_DEFENSE"&&ColinShieldMobilityEngine.shieldOccupied(u))continue;
      const rules=effect?.movementRules;if(!rules)continue;for(const[k,v]of Object.entries(rules))if(v!=null)out[k]=v;}
    return out;
  }
  function effectVisionBonus(u){return(globalThis.EffectEngine?.state?.(u)||[]).reduce((sum,effect)=>sum+Number(effect?.visionBonus||0),0)}
  function isAquatic(u){const traits=terrainTraits(u);return traits.includes("AQUATIC")&&!traits.includes("AMPHIBIOUS")}
  function isLiveWater(t){return !!globalThis.HydrologyEngine?.isWater?.(t)}
  function canOccupyTerrain(u,t){
    if(globalThis.VerticalMobilityEngine?.canOccupyTerrain)return VerticalMobilityEngine.canOccupyTerrain(u,t);
    if(!t||!TERRAINS[t.terrain]?.passable)return false;
    if(isAquatic(u))return isLiveWater(t);
    return true;
  }
  function traversalElevation(t,u=null){
    if(u&&globalThis.VerticalMobilityEngine?.traversalZ)return Number(VerticalMobilityEngine.traversalZ(u,t));
    if(isLiveWater(t)||globalThis.ClimateEngine?.isSolidIce?.(t)){const surface=globalThis.HydrologyEngine?.waterSurfaceZ?.(t);if(surface!=null)return Number(surface);}
    return elevation(t)
  }
  function elevationDelta(fromTile,toTile){return elevation(toTile)-elevation(fromTile)}
  function isMountainTile(t){return t?.terrain==="HIGH_GROUND"||Number(t?.elevation||0)>0}
  function isBlockedByObject(m,x,y,u=null){
    if(globalThis.AngelWingBarrierEngine?.blocksMovement?.(m,x,y,u))return true;
    const object=objectAt(m,x,y);
    if(!object?.blocksMovement)return false;
    if(u&&globalThis.VerticalMobilityEngine?.objectBlocks)return VerticalMobilityEngine.objectBlocks(u,tile(m,x,y),object);
    return true;
  }
  function defaultFacing(u){return u?.team==="E"?"S":"N"}
  function ensureFacing(u){if(u&&!FACINGS.includes(u.facing))u.facing=defaultFacing(u);return u?.facing||null}
  function setFacing(u,facing){const next=String(facing||"").toUpperCase();if(!u||!FACINGS.includes(next))return null;u.facing=next;return next}
  function rotateFacing(u,steps=1){if(!u)return null;const current=ensureFacing(u),index=FACINGS.indexOf(current),offset=Math.trunc(Number(steps)||0),next=FACINGS[(index+offset%FACINGS.length+FACINGS.length)%FACINGS.length];u.facing=next;return next}
  function facingToward(from,to,fallback=null){if(!from||!to)return fallback;const dx=Number(to.x)-Number(from.x),dy=Number(to.y)-Number(from.y);if(!dx&&!dy)return fallback;if(Math.abs(dx)>Math.abs(dy))return dx>0?"E":"W";if(Math.abs(dy)>Math.abs(dx))return dy>0?"S":"N";if(fallback&&FACINGS.includes(fallback)){if((fallback==="E"&&dx>0)||(fallback==="W"&&dx<0)||(fallback==="S"&&dy>0)||(fallback==="N"&&dy<0))return fallback;}return dy>0?"S":"N";}
  function faceToward(u,target){if(!u)return null;u.facing=facingToward(u,target,ensureFacing(u));return u.facing}
  function relativeArc(defender,source){const facing=ensureFacing(defender),incoming=facingToward(defender,source,facing);if(incoming===facing)return"FRONT";const opposite={N:"S",S:"N",E:"W",W:"E"};return incoming===opposite[facing]?"BACK":"SIDE";}
  function movementLimit(u,key,fallback){
    let value=Number(u?.character?.movementProfile?.[key]??fallback);
    for(const passive of globalThis.SkillDatabase?.passiveList?.(u?.character?.passives)||[]){const candidate=Number(passive?.movementRules?.[key]);if(Number.isFinite(candidate))value=Math.max(value,candidate);}
    const effect=Number(effectMovementRules(u)?.[key]);if(Number.isFinite(effect))value=Math.max(value,effect);
    return value;
  }
  // Swimming crosses connected water volume, not a land-style step measured
  // from the diver's current visual pose. The authoritative hydrology ground
  // and free surface must overlap vertically on BOTH adjacent wet tiles.
  // This is a general AQUATIC movement rule, shared by monsters and heroes;
  // dry banks, solid ice, collision objects and occupied cells remain blocked.
  function hasConnectedSwimColumn(fromTile,toTile,traits){
    if(!traits.includes("AQUATIC")||!isLiveWater(fromTile)||!isLiveWater(toTile))return false;
    if(globalThis.ClimateEngine?.isSolidIce?.(fromTile)||globalThis.ClimateEngine?.isSolidIce?.(toTile))return false;
    const surfaceA=globalThis.HydrologyEngine?.waterSurfaceZ?.(fromTile);
    const surfaceB=globalThis.HydrologyEngine?.waterSurfaceZ?.(toTile);
    if(surfaceA==null||surfaceB==null)return false;
    const sharedBottom=Math.max(elevation(fromTile),elevation(toTile));
    const sharedTop=Math.min(Number(surfaceA),Number(surfaceB));
    return Number.isFinite(sharedTop)&&sharedTop>sharedBottom+1e-4;
  }
  function canTraverseElevation(fromTile,toTile,u=null){
    if(!fromTile||!toTile)return false;
    if(u&&globalThis.VerticalMobilityEngine?.ignoresElevation?.(u))return true;
    const traits=terrainTraits(u);
    if(hasConnectedSwimColumn(fromTile,toTile,traits))return true;
    if(ColinShieldMobilityEngine.hasShield(u)&&
       ColinShieldMobilityEngine.modeAt(u,fromTile)==="BOAT"&&
       ColinShieldMobilityEngine.modeAt(u,toTile)==="BOAT"&&
       hasConnectedSwimColumn(fromTile,toTile,["AQUATIC"]))return true;
    const mountainWalk=traits.includes("MOUNTAIN_WALK")&&(isMountainTile(fromTile)||isMountainTile(toTile));
    // Boarding / leaving deep water is a shoreline transition, not climbing
    // a column of water as if it were a cliff. Use whichever legal support
    // route (bank elevation or adjacent free surface) is closer vertically.
    const fromBoat=ColinShieldMobilityEngine.modeAt(u,fromTile)==="BOAT";
    const toBoat=ColinShieldMobilityEngine.modeAt(u,toTile)==="BOAT";
    const freeSurfaceDelta=traversalElevation(toTile,u)-traversalElevation(fromTile,u);
    const terrainDelta=elevation(toTile)-elevation(fromTile);
    const delta=ColinShieldMobilityEngine.hasShield(u)&&fromBoat!==toBoat&&
      !globalThis.ClimateEngine?.isSolidIce?.(fromTile)&&!globalThis.ClimateEngine?.isSolidIce?.(toTile)&&
      Math.abs(terrainDelta)<Math.abs(freeSurfaceDelta)?terrainDelta:freeSurfaceDelta;
    const baseClimb=movementLimit(u,"maxClimb",MAX_NORMAL_CLIMB),baseDrop=movementLimit(u,"maxDrop",MAX_NORMAL_DROP),maxClimb=baseClimb+(mountainWalk?1:0),maxDrop=baseDrop+(mountainWalk?1:0);
    const mayJumpDown=traits.includes("UNRESTRICTED_DESCENT");
    return delta<=maxClimb&&(delta>=-maxDrop||delta<0&&mayJumpDown);
  }
  function canActiveMove(m,us,u,x,y,{ignoreElevation=false}={}){if(u?.shieldRidingOn)return false;if(globalThis.BurialEngine?.canMove&&!BurialEngine.canMove(u))return false;if(effectMovementRules(u).immobilized===true)return false;const from=tile(m,u.x,u.y),to=tile(m,x,y);if(!to||!canOccupyTerrain(u,to)||isBlockedByObject(m,x,y,u)||occupied(us,x,y,u.id))return false;return ignoreElevation||canTraverseElevation(from,to,u);}
  // One atomic adjacency/terrain predicate for ally exchanges. Each participant
  // independently inherits their own real terrain and elevation restrictions.
  function canSwapAllies(m,units,actor,ally){
    if(actor?.shieldRidingOn||ally?.shieldRidingOn)return false;
    if(!actor?.alive||!ally?.alive||actor.id===ally.id||actor.team!==ally.team||
       actor.occupiesTile===false||ally.occupiesTile===false||
       actor.carriedByUnitId||ally.carriedByUnitId||actor.carryingUnitId||ally.carryingUnitId||
       Math.abs(actor.x-ally.x)+Math.abs(actor.y-ally.y)!==1)return false;
    if(effectMovementRules(actor).immobilized===true||effectMovementRules(ally).immobilized===true||
       globalThis.BurialEngine?.canMove?.(actor)===false||
       globalThis.BurialEngine?.canMove?.(ally)===false)return false;
    const from=tile(m,actor.x,actor.y),to=tile(m,ally.x,ally.y);
    if(!from||!to||!canOccupyTerrain(actor,to)||!canOccupyTerrain(ally,from)||
       isBlockedByObject(m,to.x,to.y,actor)||isBlockedByObject(m,from.x,from.y,ally)||
       !canTraverseElevation(from,to,actor)||!canTraverseElevation(to,from,ally))return false;
    // No third party may share either destination; the paired occupants are
    // exempt only from one another, never from real terrain or collisions.
    return !(units||[]).some(u=>u?.alive&&u.occupiesTile!==false&&
      u.id!==actor.id&&u.id!==ally.id&&
      (u.x===from.x&&u.y===from.y||u.x===to.x&&u.y===to.y));
  }
  function cost(u,t){
    const tr=terrainTraits(u),profile=u?.character?.movementProfile||{},effectRules=effectMovementRules(u);
    if(globalThis.ClimateEngine?.isSolidIce?.(t))return 1;
    if(isLiveWater(t)&&Number.isFinite(Number(effectRules.waterCost)))return Math.max(.1,Number(effectRules.waterCost));
    if(isLiveWater(t)&&Number.isFinite(Number(profile.waterCost)))return Math.max(.1,Number(profile.waterCost));
    if(globalThis.VerticalMobilityEngine?.movementIgnoresTerrainCost?.(u))return 1;
    if(isAquatic(u)&&isLiveWater(t)||tr.includes("IGNORE_GROUND_TERRAIN")||t.terrain==="FOREST"&&tr.includes("FOREST_WALK")||t.terrain==="WATER"&&tr.includes("WATER_WALK")||isMountainTile(t)&&tr.includes("MOUNTAIN_WALK"))return 1;
    const base=Number(TERRAINS[t.terrain].moveCost||1),snow=Number(t?.snowDepth||0);return base+(snow>=1.5?2:snow>=.5?1:0);
  }
  // Both the preview and the actual execution use this exact same set of
  // canonical edges. A shield transit is TWO paid steps with no stop on the
  // occupied intermediary; the actual movement event retains its real waypoint.
  function movementEdges(map,units,unit,from){
    const edges=[];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=from.x+dx,y=from.y+dy,to=tile(map,x,y);
      if(!to||!canOccupyTerrain(unit,to)||isBlockedByObject(map,x,y,unit)||
        occupied(units,x,y,unit.id)||!canTraverseElevation(from,to,unit))continue;
      const regular=cost(unit,to);
      edges.push({to,spent:ColinShieldMobilityEngine.moveCost(unit,from,to,regular),shieldTransit:null});
    }
    for(const edge of ColinShieldMobilityEngine.transitions(map,units,unit,from)){
      const middle=tile(map,edge.shieldTransit.via.x,edge.shieldTransit.via.y);
      const spent=cost(unit,middle)+cost(unit,edge.tile);
      edges.push({to:edge.tile,spent,shieldTransit:edge.shieldTransit});
    }
    return edges;
  }
  function reachable(m,us,u){
    if(!u?.alive||u.shieldRidingOn||effectMovementRules(u).immobilized===true)return new Map();
    const max=globalThis.BurialEngine?.movementAllowance
      ?BurialEngine.movementAllowance(u,u.character.combat.move):u.character.combat.move;
    const best=new Map([[K(u.x,u.y),0]]),queue=[{x:u.x,y:u.y,spent:0}];
    while(queue.length){
      queue.sort((a,b)=>a.spent-b.spent);
      const step=queue.shift(),key=K(step.x,step.y);
      if(step.spent!==best.get(key))continue;
      const from=tile(m,step.x,step.y);
      for(const edge of movementEdges(m,us,u,from)){
        const next=step.spent+edge.spent,k=K(edge.to.x,edge.to.y);
        if(next<=max+1e-9&&(!best.has(k)||next<best.get(k))){
          best.set(k,next);queue.push({x:edge.to.x,y:edge.to.y,spent:next});
        }
      }
    }
    best.delete(K(u.x,u.y));return best;
  }
  function pathTo(m,us,u,endX,endY){
    if(!u?.alive||u.shieldRidingOn||effectMovementRules(u).immobilized===true)return [];
    const start=K(u.x,u.y),goal=K(endX,endY),max=globalThis.BurialEngine?.movementAllowance
      ?BurialEngine.movementAllowance(u,u.character.combat.move):u.character.combat.move;
    const best=new Map([[start,0]]),previous=new Map(),queue=[{x:u.x,y:u.y,spent:0}];
    while(queue.length){
      queue.sort((a,b)=>a.spent-b.spent);
      const n=queue.shift(),nk=K(n.x,n.y);
      if(n.spent!==best.get(nk))continue;
      if(nk===goal)break;
      for(const edge of movementEdges(m,us,u,tile(m,n.x,n.y))){
        const next=n.spent+edge.spent,k=K(edge.to.x,edge.to.y);
        if(next<=max+1e-9&&(!best.has(k)||next<best.get(k))){
          best.set(k,next);previous.set(k,{prior:nk,shieldTransit:edge.shieldTransit});
          queue.push({x:edge.to.x,y:edge.to.y,spent:next});
        }
      }
    }
    if(!best.has(goal)||goal===start)return[];
    const result=[];let k=goal;
    while(k!==start){
      const transition=previous.get(k);if(!transition)return[];
      const [x,y]=k.split(',').map(Number),ground=tile(m,x,y);
      result.push(transition.shieldTransit?{...ground,shieldTransit:transition.shieldTransit}:ground);
      k=transition.prior;
    }
    result.reverse();
    if(result.length){const from=result.length>1?result.at(-2):u;
      u.facing=facingToward(from,result.at(-1),ensureFacing(u));}
    return result;
  }
  // Shared targeting geometry. Previously owned by tactical-game.js alone;
  // the authoritative server and browser now use exactly the same footprint.
  function aoeTiles(map,center,radius){
    const r=Number(radius||0);
    return map.tiles.filter(tile=>Math.abs(tile.x-center.x)+Math.abs(tile.y-center.y)<=r);
  }
  // A real wedge pointing toward the chosen aiming tile. These are ground
  // cells, not a circular AOE centered on the cursor; each cell is hit once.
  function fanTiles(map,archer,aim,{length=4}={}){
    const dx=Number(aim.x)-Number(archer.x),dy=Number(aim.y)-Number(archer.y);
    if(!dx&&!dy)return[];
    const norm=Math.hypot(dx,dy),reach=Math.max(1,Math.floor(length));
    return(map?.tiles||[]).filter(tile=>{
      const rx=tile.x-archer.x,ry=tile.y-archer.y;
      const ahead=(rx*dx+ry*dy)/norm;
      const across=Math.abs(rx*dy-ry*dx)/norm;
      // Wedge rotates with the true aim vector, including diagonals.
      // Grid cells are tested once, without fabricating additional terrain.
      return ahead>=.75&&ahead<=reach+1e-8&&across<=ahead*.50+1e-8;
    });
  }
  function range(s){return s.range}
  function attackType(u,s){const w=u?.character?.weapons?.[s?.weapon];return s?.attackType==="INHERIT"?w?.attackType:s?.attackType;}
  function attackDelivery(u,s){
    const type=String(attackType(u,s)||"").toUpperCase();
    if(String(s?.attackClass||"").toUpperCase()==="RANGED")return"RANGED";
    if(String(s?.trajectory||"").toUpperCase()==="ARC"||type==="SHOT"||type==="MAGIC")return"RANGED";
    return"MELEE";
  }
  function attackVerticalReach(u,s){
    const weapon=u?.character?.weapons?.[s?.weapon],explicit=Number(s?.verticalReach??weapon?.verticalReach);
    if(Number.isFinite(explicit))return Math.max(0,explicit);
    if(attackDelivery(u,s)==="RANGED")return Infinity;
    const horizontal=Math.max(1,Number(s?.range?.max||1));
    return Math.min(1.5,Math.max(.75,horizontal*.75));
  }
  function verticalTargetAllowed(m,u,target,s){
    if(!target?.character||s?.target==="SELF"||attackDelivery(u,s)==="RANGED")return true;
    if(s?.affixes?.includes("SPACE_RIFT"))return true;
    if(!globalThis.VerticalMobilityEngine?.verticalSpan)return true;
    const from=tile(m,u.x,u.y),to=tile(m,target.x,target.y);if(!from||!to)return false;
    const a=VerticalMobilityEngine.verticalSpan(u,from),b=VerticalMobilityEngine.verticalSpan(target,to);
    const gap=b.bottom>a.top?b.bottom-a.top:a.bottom>b.top?a.bottom-b.top:0;
    return gap<=attackVerticalReach(u,s)+1e-9;
  }
  function lineCells(from,to){const cells=[],dx=to.x-from.x,dy=to.y-from.y,steps=Math.max(Math.abs(dx),Math.abs(dy));if(steps<=1)return cells;const seen=new Set();for(let i=1;i<steps;i++){const x=Math.round(from.x+dx*i/steps),y=Math.round(from.y+dy*i/steps),k=K(x,y);if(k!==K(from.x,from.y)&&k!==K(to.x,to.y)&&!seen.has(k)){seen.add(k);cells.push({x,y,t:i/steps})}}return cells;}
  function visionBlocked(environmentState,x,y){return !!(environmentState&&globalThis.EnvironmentEngine?.visionModifier?.(environmentState,x,y)?.blocked)}
  function observationRules(observer){return SkillDatabase.passiveList(observer?.character?.passives||[]).flatMap(passive=>passive?.observationNetworks||[])}
  function observationModifier(observer,tag){
    const out={anchorRangeBonus:0,nodeVisionRangeBonus:0};
    for(const effect of globalThis.EffectEngine?.state?.(observer)||[]){const modifier=effect?.observationNetworkModifiers;if(!modifier||modifier.tag!==tag)continue;out.anchorRangeBonus+=Number(modifier.anchorRangeBonus||0);out.nodeVisionRangeBonus+=Number(modifier.nodeVisionRangeBonus||0);}
    return out;
  }
  const observationNodeCache=new WeakMap();
  function observationNodes(m,rule){
    if(!m)return[];
    const allowedKey=(rule?.objectTypes||[]).map(type=>String(type).toUpperCase()).sort().join("|");
    const revision=Number(m.plantObservationRevision||0),prior=observationNodeCache.get(m);
    if(prior&&prior.revision===revision&&prior.objects===m.objects&&prior.allowedKey===allowedKey)return prior.nodes;
    const allowed=new Set((rule?.objectTypes||[]).map(type=>String(type).toUpperCase())),seen=new Set(),out=[];
    for(const object of m?.objects||[]){if(object?.destroyed||object?.carriedBy)continue;const type=String(globalThis.EnvironmentObjectEngine?.normalizeType?.(object.type)||object.type||"").toUpperCase();if(allowed.size&&!allowed.has(type))continue;const key=K(object.x,object.y);if(seen.has(key))continue;seen.add(key);out.push({x:Number(object.x),y:Number(object.y),type});}
    observationNodeCache.set(m,{revision,objects:m.objects,allowedKey,nodes:out});
    return out;
  }
  function connectedObservationNodes(m,observer,rule){
    if(String(rule.connectivity||"").toUpperCase()==="INDEPENDENT")return{nodes:observationNodes(m,rule),nodeVisionRange:Math.max(0,Number(rule.nodeVisionRange||0)+observationModifier(observer,rule.tag).nodeVisionRangeBonus)};
    const modifier=observationModifier(observer,rule.tag),anchorRange=Math.max(0,Number(rule.anchorRange||0)+modifier.anchorRangeBonus),nodes=observationNodes(m,rule),byKey=new Map(nodes.map(node=>[K(node.x,node.y),node])),queue=nodes.filter(node=>D(observer,node)<=anchorRange),visited=new Set(queue.map(node=>K(node.x,node.y))),out=[];
    const dirs=String(rule.connectivity||"CARDINAL").toUpperCase()==="EIGHT"?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:[[1,0],[-1,0],[0,1],[0,-1]];
    while(queue.length){const node=queue.shift();out.push(node);for(const[dx,dy]of dirs){const key=K(node.x+dx,node.y+dy),next=byKey.get(key);if(next&&!visited.has(key)){visited.add(key);queue.push(next);}}}
    return{nodes:out,nodeVisionRange:Math.max(0,Number(rule.nodeVisionRange||0)+modifier.nodeVisionRangeBonus)};
  }
  function observationNetworkCanObserve(m,observer,target,{revealStealth=false,tag=null}={}){
    if(!m||!observer||!target)return false;
    for(const rule of observationRules(observer)){if(tag&&String(rule?.tag||"")!==String(tag))continue;if(revealStealth&&rule.revealStealth!==true)continue;const network=connectedObservationNodes(m,observer,rule);if(network.nodes.some(node=>(rule.nodeDistance==="CHEBYSHEV"?Math.max(Math.abs(node.x-target.x),Math.abs(node.y-target.y)):D(node,target))<=network.nodeVisionRange))return true;}
    return false;
  }
  // Night sight is a data-driven passive property, never a character-name check.
  function nightVisionProfile(observer){
    return SkillDatabase.passiveList(observer?.character?.passives||[]).reduce((result,passive)=>{
      const rule=passive?.nightVision;
      return rule?{rangeBonus:Math.max(result.rangeBonus,Number(rule.rangeBonus||0)),maxRange:Math.max(result.maxRange,Number(rule.maxRange||0))}:result;
    },{rangeBonus:0,maxRange:0});
  }
  function effectiveVisionRange(observer,environmentState=null){
    const explicit=Number(observer?.character?.visionRange),base=Number.isFinite(explicit)?explicit:BASE_VISION_RANGE,bonus=effectVisionBonus(observer),equipmentBonus=Number(globalThis.EquipmentDatabase?.visionBonus?.(observer?.character)||0);
    const altitude=Math.max(0,Number(observer?.verticalState?.altitude||0)),perAltitude=Math.max(0,Number(observer?.character?.verticalMobility?.visionRangePerAltitude||0));
    const nightBonus=environmentState?.timeOfDay==="NIGHT"?nightVisionProfile(observer).rangeBonus:0;
    return Math.max(LOCAL_AWARENESS_RANGE,base+altitude*perAltitude+bonus+equipmentBonus+nightBonus);
  }
  function environmentVisionLimit(environmentState,target=null,observer=null){
    if(!environmentState||!globalThis.EnvironmentEngine?.visionRange)return Infinity;
    const maxRange=environmentState?.timeOfDay==="NIGHT"?nightVisionProfile(observer).maxRange:0;
    const raw=Number(EnvironmentEngine.visionRange(environmentState,{nightVisionRange:maxRange}));
    if(!Number.isFinite(raw))return Infinity;
    const lightBonus=target?Number(EnvironmentEngine.illuminationBonus?.(environmentState,target.x,target.y)||0):0;
    return Math.max(LOCAL_AWARENESS_RANGE,raw+lightBonus);
  }
  // The EnvironmentEngine is the sole source for climate/night sight caps.
  // This optical limitation is shared by scene clarity and identity discovery;
  // FULL_VISIBILITY only suppresses tactical FoW, not physical sight limits.
  function environmentSightLimited(state){
    return !!state&&!!globalThis.EnvironmentEngine?.visionRange&&
      Number.isFinite(Number(EnvironmentEngine.visionRange(state)));
  }
  // Seeing a luminous source through mist does not reveal occupants around it.
  function lightTransmission(m,observer,source,environmentState){
    if(!m||!observer||!source)return 0;
    const radius=Math.max(0,Number(source.radius||0)),distance=D(observer,source);
    const fog=Number(globalThis.EnvironmentEngine?.fogAt?.(environmentState)?.intensity||0);
    const reach=Math.max(4,Number(effectiveVisionRange(observer,environmentState)||BASE_VISION_RANGE))+radius*3;
    if(distance>reach)return 0;
    const start=elevation(tile(m,observer.x,observer.y))+1,end=elevation(tile(m,source.x,source.y))+.8;
    let opticalDepth=distance*(fog>0?.10+.07*fog:.035);
    for(const cell of [{x:observer.x,y:observer.y,t:0},...lineCells(observer,source),{x:source.x,y:source.y,t:1}]){
      const ground=tile(m,cell.x,cell.y);
      if(!ground||ground.terrain==="WALL"||(cell.t>0&&cell.t<1&&elevation(ground)>=start+(end-start)*cell.t))return 0;
      for(const effect of globalThis.EnvironmentEngine?.effectAt?.(environmentState,cell.x,cell.y)||[]){
        if(effect.type==="SMOKE")opticalDepth+=Math.max(0,Number(effect.intensity||0))*.65;
        if(effect.type==="STEAM")opticalDepth+=.45;
      }
    }
    const transmission=Math.exp(-opticalDepth)*Math.min(1,(reach-distance+1)/2);
    return transmission<.025?0:transmission;
  }
  function canSeeLight(m,observer,source,environmentState){
    if(!m||!observer||!source)return false;
    const distance=D(observer,source);if(distance<=LOCAL_AWARENESS_RANGE)return true;
    const radius=Math.max(0,Number(source.radius||0)),personal=effectiveVisionRange(observer,environmentState),weatherLimit=environmentVisionLimit(environmentState,null,observer),limit=Math.min(personal,weatherLimit)+radius;
    if(Number.isFinite(limit)&&distance>limit)return false;
    if(visionBlocked(environmentState,observer.x,observer.y))return false;
    const start=elevation(tile(m,observer.x,observer.y))+1,end=elevation(tile(m,source.x,source.y))+.8;
    return lineCells(observer,source).every(p=>{
      const ground=tile(m,p.x,p.y);
      return ground&&ground.terrain!=="WALL"&&elevation(ground)<start+(end-start)*p.t&&!visionBlocked(environmentState,p.x,p.y);
    });
  }
  function underwaterTargetVisibleTo(observer,target){
    if(!target?.character||observer?.team===target?.team)return true;
    if(String(target?.verticalState?.mode||"")!=="DIVING")return true;
    // Two submerged actors can perceive each other normally inside the water;
    // observers above the water line cannot directly lock a diver.
    return String(observer?.verticalState?.mode||"")==="DIVING";
  }
  function canSee(m,observer,target,environmentState=null){
    if(!m||!observer||!target||!underwaterTargetVisibleTo(observer,target))return false;
    if(target?.character&&observer?.team!==target?.team&&globalThis.EffectEngine?.isStealthed?.(target)){
      const proximityVisible=globalThis.EffectEngine?.directTargetAllowed?.(observer,target)===true;
      const networkVisible=observationNetworkCanObserve(m,observer,target,{revealStealth:true});
      if(!proximityVisible&&!networkVisible)return false;
    }
    if(observer.x===target.x&&observer.y===target.y)return true;
    if(observationNetworkCanObserve(m,observer,target))return true;
    const distance=D(observer,target);if(distance<=LOCAL_AWARENESS_RANGE)return true;
    const senseRules=(globalThis.EffectEngine?.state?.(observer)||[]).map(effect=>effect?.visionRules).filter(Boolean),senseRange=senseRules.reduce((max,rule)=>rule.ignoreEnvironmentBlockers?Math.max(max,Number(rule.maxRange||0)):max,0);
    if(senseRange>0&&distance<=senseRange)return true;
    const personalLimit=effectiveVisionRange(observer,environmentState),environmentLimit=environmentVisionLimit(environmentState,target,observer),limit=Math.min(personalLimit,environmentLimit);if(Number.isFinite(limit)&&distance>limit)return false;
    if(visionBlocked(environmentState,observer.x,observer.y)||visionBlocked(environmentState,target.x,target.y))return false;
    const start=elevation(tile(m,observer.x,observer.y))+1,end=elevation(tile(m,target.x,target.y))+1;
    return lineCells(observer,target).every(p=>{
      const ground=tile(m,p.x,p.y);
      return ground&&ground.terrain!=="WALL"&&elevation(ground)<start+(end-start)*p.t&&!visionBlocked(environmentState,p.x,p.y);
    });
  }
  // Core and defended capture points share the same canSee() LOS as units;
  // they are not extra units, a second vision state, or permanent intel.
  function teamVisionSources(world,team){
    if(!world)return[];
    const owner=team==="P"||team==="PLAYER"?"PLAYER":team==="E"||team==="ENEMY"?"ENEMY":null;
    if(!owner)return[];
    const rules=world.stage?.intelRules||{},sources=[];
    const make=(id,x,y,range)=>({id,team,x,y,alive:true,character:{visionRange:range,passives:[]}});
    for(const core of world.cores||[]){
      if(core.owner!==owner||Number(core.hp||0)<=0)continue;
      sources.push(make(`VISION:CORE:${core.id}`,core.x,core.y,Math.max(1,Number(rules.coreVisionRange??5))));
    }
    for(const point of globalThis.DeploymentEngine?.points?.(world.stage)||[]){
      if(point.owner!==owner||point.capturable===false)continue;
      if(!globalThis.DeploymentEngine?.defenders?.(world.stage,world.units,point,owner)?.length)continue;
      for(const cell of point.captureTiles||[])sources.push(make(`VISION:POINT:${point.id}`,cell.x,cell.y,Math.max(1,Number(rules.captureVisionRange??3))));
    }
    return sources;
  }
  // Team visibility is checked only against current positions. No LAST_SEEN data.
  function teamCanSee(m,units,team,target,environmentState=null,world=null){
    if(!m||!target)return false;
    const observers=[...(units||[]).filter(unit=>unit?.alive&&unit.team===team),...teamVisionSources(world,team)];
    return observers.some(observer=>{
      // Buildings never grant passive stealth revelation.
      if(String(observer.id||"").startsWith("VISION:")&&target?.character&&globalThis.EffectEngine?.isStealthed?.(target))return false;
      return canSee(m,observer,target,environmentState);
    });
  }
  // A viewer's battlefield-intel mode and physical LOS are different rules.
  // This is the only enemy-identity visibility decision used by presentation:
  // FULL_VISIBILITY reveals an unobscured chessboard, but never bypasses
  // stealth detection, weather-limited sight, or a smoke/steam optical barrier.
  function teamCanIdentifyUnit(world,team,target,environmentState=world?.environmentState){
    if(!target?.alive)return false;
    if(target?.character&&target.team!==team&&String(target?.verticalState?.mode||"")==="DIVING")
      return (world?.units||[]).some(observer=>observer?.alive&&observer.team===team&&underwaterTargetVisibleTo(observer,target)&&canSee(world.map,observer,target,environmentState));
    if(target.team===team)return true;
    const map=world?.map;if(!map)return false;
    const mode=world?.stage?.intelMode||(world?.stage?.mode==="VERSUS"?"DYNAMIC_INTEL":"FULL_VISIBILITY");
    if(mode!=="FULL_VISIBILITY"||globalThis.EffectEngine?.isStealthed?.(target))
      return teamCanSee(map,world.units,team,target,environmentState,world);
    // All climate and night visibility limits share the one EnvironmentEngine
    // range rule. Full tactical intel never reveals a unit beyond physical LOS.
    if(environmentSightLimited(environmentState))
      return teamCanSee(map,world.units,team,target,environmentState,world);
    const observers=[...(world.units||[]).filter(unit=>unit?.alive&&unit.team===team),...teamVisionSources(world,team)];
    // Tactical terrain blocking is not a permanent fog-of-war in a fully
    // revealed stage. Only actual atmospheric blockers conceal a contact.
    const opticallyBlocked=observer=>{
      if(D(observer,target)<=LOCAL_AWARENESS_RANGE)return false;
      if(visionBlocked(environmentState,observer.x,observer.y)||visionBlocked(environmentState,target.x,target.y))return true;
      return lineCells(observer,target).some(p=>visionBlocked(environmentState,p.x,p.y));
    };
    return !observers.length||observers.some(observer=>!opticallyBlocked(observer));
  }
  // AI perception is actor-scoped for STEALTH. An ally spotting a thief does
  // not make every other unit able to pursue the thief. Non-stealth units keep
  // the established team observation network.
  function actorCanTrackTarget(map,units,actor,target,environmentState=null,world=null){
    if(!actor?.alive||!target?.alive)return false;
    if(globalThis.EffectEngine?.isStealthed?.(target))return canSee(map,actor,target,environmentState);
    return teamCanSee(map,units,actor.team,target,environmentState,world);
  }
  // Positional card spells need an actual living allied observation source and a
  // finite projection range even on fully revealed chess boards. "Cast range" is
  // independent from the spell's damage / environment-effect radius.
  function teamCanCastSpell(m,units,team,target,environmentState=null,world=null,card=null){
    if(!m||!target||!card?.effect)return false;
    const stageLimit=world?.stage?.spellRules?.maxCastDistance??6;
    const rawLimit=Number(card.effect.castRange??stageLimit);
    if(!Number.isFinite(rawLimit)||rawLimit<0)return false;
    const maxDistance=Math.min(32,rawLimit);
    const observers=[...(units||[]).filter(unit=>unit?.alive&&unit.team===team),...teamVisionSources(world,team)];
    return observers.some(observer=>{
      if(Math.abs(observer.x-target.x)+Math.abs(observer.y-target.y)>maxDistance)return false;
      if(globalThis.AngelWingBarrierEngine?.blocksIncoming?.(m,observer,target,
          {category:"MAGIC",attackType:"MAGIC"}))return false;
      return canSee(m,observer,target,environmentState);
    });
  }
  function companionVisionSource(u,s){const companionId=s?.requiresCompanionVision||s?.targeting?.companionId;if(!companionId)return null;return globalThis.CompanionDatabase?.targetingUnit?.(u,s.id,companionId)||null}
  function hasCompanionVision(m,u,target,s,environmentState=null){const companion=companionVisionSource(u,s);if(!companion?.alive)return false;const visionRange=effectiveVisionRange(companion);if(Number.isFinite(visionRange)&&D(companion,target)>visionRange)return false;return canSee(m,companion,target,environmentState)}
  function indirectObservationSource(m,u,target,s,environmentState=null){
    const targeting=s?.targeting;if(targeting?.mode!=="INDIRECT_OBSERVED")return null;
    const distance=D(u,target);
    const within=(spec)=>spec&&distance>=Number(spec.min??0)&&distance<=Number(spec.max??Infinity);
    if(within(targeting.directRange)&&canSee(m,u,target,environmentState))return"SELF";
    if(!within(targeting.remoteRange))return null;
    if(targeting.observationNetwork===true&&observationNetworkCanObserve(m,u,target))return"NETWORK";
    if(targeting.companionId&&hasCompanionVision(m,u,target,s,environmentState))return"COMPANION";
    return null;
  }
  function hasLineOfSight(m,u,target,s,environmentState=null){
    if(!m||!u||!target)return false;
    if(globalThis.AngelWingBarrierEngine?.blocksIncoming?.(m,u,target,s))return false;
    // W-axis spatial cuts do not travel through intervening terrain.
    // Encounter discovery remains with the team visibility/stealth systems.
    if(s?.affixes?.includes("SPACE_RIFT"))return true;
    if(s?.targeting?.mode==="INDIRECT_OBSERVED")return !!indirectObservationSource(m,u,target,s,environmentState);
    const companionVision=hasCompanionVision(m,u,target,s,environmentState);
    if(s?.requiresCompanionVision&&!companionVision)return false;
    if(!companionVision&&s?.ignoreVision!==true&&!canSee(m,u,target,environmentState))return false;
    if(companionVision&&s?.trajectory==="ARC")return true;
    const ranged=attackDelivery(u,s)==="RANGED";
    if(!ranged||s?.trajectory==="ARC")return true;
    const from=tile(m,u.x,u.y),to=tile(m,target.x,target.y);if(!from||!to)return false;
    const fromEye=globalThis.VerticalMobilityEngine?.eyeZ?VerticalMobilityEngine.eyeZ(u,from):elevation(from)+.5;
    const toEye=target?.character&&globalThis.VerticalMobilityEngine?.eyeZ?VerticalMobilityEngine.eyeZ(target,to):elevation(to)+.5;
    return lineCells(u,target).every(p=>{const middle=tile(m,p.x,p.y);if(!middle)return false;const rayHeight=fromEye+(toEye-fromEye)*p.t;return elevation(middle)<rayHeight;});
  }
  function targetNearNaturalObject(m,target,rule){
    if(!rule)return true;
    const types=new Set((rule.objectTypes||["TREE"]).map(type=>String(type).toUpperCase()));
    const radius=Math.max(0,Number(rule.radius||0));
    return (m?.objects||[]).some(object=>{
      if(object?.destroyed)return false;
      const type=String(globalThis.EnvironmentObjectEngine?.normalizeType?.(object.type)||object.type||"").toUpperCase();
      if(!types.has(type))return false;
      const dx=Math.abs(Number(target.x)-Number(object.x)),dy=Math.abs(Number(target.y)-Number(object.y));
      return rule.diagonals===true?Math.max(dx,dy)<=radius:dx+dy<=radius;
    });
  }
  function canTarget(m,u,target,s,environmentState=null){if(!u?.alive||!target?.alive)return false;if(!underwaterTargetVisibleTo(u,target)&&(s?.targetType||"SINGLE")==="SINGLE")return false;if(globalThis.BurialEngine?.canAct&&!BurialEngine.canAct(u))return false;const r=range(s)||{min:0,max:0},d=D(u,target);if(d<r.min||d>r.max)return false;if(s.target==="SELF")return target.id===u.id;if(s.target==="ALLY"&&target.team!==u.team)return false;if(s.target==="ENEMY"&&target.team===u.team)return false;if(!targetNearNaturalObject(m,target,s?.targeting?.treeProximity))return false;const requiredNetwork=s?.targeting?.requiresObservationNetwork;if(requiredNetwork&&!observationNetworkCanObserve(m,u,target,{tag:requiredNetwork}))return false;if(!verticalTargetAllowed(m,u,target,s))return false;if((s?.targetType||"SINGLE")==="SINGLE"&&target?.character&&globalThis.EffectEngine?.directTargetAllowed&&!EffectEngine.directTargetAllowed(u,target)&&!observationNetworkCanObserve(m,u,target,{revealStealth:true}))return false;return hasLineOfSight(m,u,target,s,environmentState);}
  function targets(m,us,u,s,environmentState=null){if(s.target==="SELF")return[u];return us.filter(v=>canTarget(m,u,v,s,environmentState));}
  function resolve(m,a,d,s,opt={}){ensureFacing(a);ensureFacing(d);let at=tile(m,a.x,a.y),dt=tile(m,d.x,d.y),w=a.character.weapons[s.weapon],type=s.attackType==="INHERIT"?w?.attackType:s.attackType,acc=0,eva=TERRAINS[dt.terrain].evasion||0;if(at.terrain==="HIGH_GROUND"&&(type==="SHOT"||type==="MAGIC")&&at.elevation>dt.elevation)acc=TERRAINS[at.terrain].rangedAccuracy||0;const am=terrainPassiveModifiers(a.character,at),dm=terrainPassiveModifiers(d.character,dt),apply=(character,mods,extra={})=>({...character,modifiers:{...(character.modifiers||{}),accuracy:Number(character.modifiers?.accuracy||0)+Number(mods.accuracy||0)+Number(extra.accuracy||0),evasion:Number(character.modifiers?.evasion||0)+Number(mods.evasion||0)+Number(extra.evasion||0),crit:Number(character.modifiers?.crit||0)+Number(mods.crit||0),speed:Number(character.modifiers?.speed||0)+Number(mods.speed||0)}}),ac=apply(a.character,am,{accuracy:acc}),dc=apply(d.character,dm,{evasion:eva}),distance=D(a,d),arc=relativeArc(d,a);let result=BattleEngine.calculate(ac,dc,s,{...opt,distance,forceCrit:opt.forceCrit===true||arc==="BACK"&&Number(s?.backstabMultiplier||0)>0});if(result.hit&&arc==="BACK"&&Number(s?.backstabMultiplier||0)>0){const mult=Number(s.backstabMultiplier),damage=Math.round(result.damage*mult);result={...result,damage,hpAfter:Math.max(0,d.character.combat.hp-damage),backstab:true,backstabMultiplier:mult};}if(result.hit&&Number(s?.onHitBonusDamage?.amount||0)>0){const bonus=Math.max(0,Math.round(Number(s.onHitBonusDamage.amount||0))),damage=result.damage+bonus;result={...result,damage,hpAfter:Math.max(0,d.character.combat.hp-damage),onHitBonusDamage:{...s.onHitBonusDamage,amount:bonus}};}return{result,terrain:{acc,eva,at,dt,attackerPassive:am,defenderPassive:dm},facing:{attacker:a.facing,defender:d.facing,arc}}}
  return{BASE_VISION_RANGE,LOCAL_AWARENESS_RANGE,tile,objectAt,isBlockedByObject,elevation,elevationDelta,fanTiles,isAquatic,canOccupyTerrain,canTraverseElevation,canActiveMove,canSwapAllies,reachable,pathTo,lineTiles,canTraverseMoveLine,range,aoeTiles,attackType,attackDelivery,attackVerticalReach,verticalTargetAllowed,terrainTraits,terrainPassiveModifiers,effectMovementRules,effectVisionBonus,nightVisionProfile,visionBlocked,observationRules,observationNodes,connectedObservationNodes,observationNetworkCanObserve,effectiveVisionRange,environmentSightLimited,lightTransmission,canSeeLight,canSee,teamVisionSources,teamCanSee,teamCanIdentifyUnit,actorCanTrackTarget,teamCanCastSpell,companionVisionSource,hasCompanionVision,indirectObservationSource,hasLineOfSight,canTarget,targets,resolve,ensureFacing,setFacing,rotateFacing,facingToward,faceToward,relativeArc}
})();
globalThis.TacticalEngine=TacticalEngine;
