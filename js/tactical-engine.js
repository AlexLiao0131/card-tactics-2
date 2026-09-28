export const TacticalEngine=(()=>{
  const K=(x,y)=>x+","+y,D=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const MAX_NORMAL_CLIMB=1,MAX_NORMAL_DROP=1;
  const FACINGS=["N","E","S","W"];
  function tile(m,x,y){return m.tiles.find(t=>t.x===x&&t.y===y)}
  function objectAt(m,x,y){return (m?.objects||[]).find(o=>!o.destroyed&&o.x===x&&o.y===y)||null}
  function occupied(us,x,y,id){return us.some(u=>u.alive&&u.id!==id&&u.x===x&&u.y===y)}
  function elevation(t){return Number(t?.elevation||0)}
  function terrainTraits(u){
    const set=new Set(u?.character?.terrainTraits||[]);
    for(const passive of globalThis.SkillDatabase?.passiveList?.(u?.character?.passives)||[])for(const trait of passive?.terrainTraits||[])set.add(trait);
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
  function isAquatic(u){const traits=terrainTraits(u);return traits.includes("AQUATIC")&&!traits.includes("AMPHIBIOUS")}
  function isLiveWater(t){return !!window.HydrologyEngine?.isWater?.(t)}
  function canOccupyTerrain(u,t){
    if(window.VerticalMobilityEngine?.canOccupyTerrain)return VerticalMobilityEngine.canOccupyTerrain(u,t);
    if(!t||!TERRAINS[t.terrain]?.passable)return false;
    if(isAquatic(u))return isLiveWater(t);
    return true;
  }
  function traversalElevation(t,u=null){
    if(u&&window.VerticalMobilityEngine?.traversalZ)return Number(VerticalMobilityEngine.traversalZ(u,t));
    if(isLiveWater(t)||window.ClimateEngine?.isSolidIce?.(t)){const surface=window.HydrologyEngine?.waterSurfaceZ?.(t);if(surface!=null)return Number(surface);}
    return elevation(t)
  }
  function elevationDelta(fromTile,toTile){return elevation(toTile)-elevation(fromTile)}
  function isMountainTile(t){return t?.terrain==="HIGH_GROUND"||Number(t?.elevation||0)>0}
  function isBlockedByObject(m,x,y,u=null){
    const object=objectAt(m,x,y);
    if(!object?.blocksMovement)return false;
    if(u&&window.VerticalMobilityEngine?.objectBlocks)return VerticalMobilityEngine.objectBlocks(u,tile(m,x,y),object);
    return true;
  }
  function defaultFacing(u){return u?.team==="E"?"S":"N"}
  function ensureFacing(u){if(u&&!FACINGS.includes(u.facing))u.facing=defaultFacing(u);return u?.facing||null}
  function facingToward(from,to,fallback=null){if(!from||!to)return fallback;const dx=Number(to.x)-Number(from.x),dy=Number(to.y)-Number(from.y);if(!dx&&!dy)return fallback;if(Math.abs(dx)>Math.abs(dy))return dx>0?"E":"W";if(Math.abs(dy)>Math.abs(dx))return dy>0?"S":"N";if(fallback&&FACINGS.includes(fallback)){if((fallback==="E"&&dx>0)||(fallback==="W"&&dx<0)||(fallback==="S"&&dy>0)||(fallback==="N"&&dy<0))return fallback;}return dy>0?"S":"N";}
  function faceToward(u,target){if(!u)return null;u.facing=facingToward(u,target,ensureFacing(u));return u.facing}
  function relativeArc(defender,source){const facing=ensureFacing(defender),incoming=facingToward(defender,source,facing);if(incoming===facing)return"FRONT";const opposite={N:"S",S:"N",E:"W",W:"E"};return incoming===opposite[facing]?"BACK":"SIDE";}
  function movementLimit(u,key,fallback){
    let value=Number(u?.character?.movementProfile?.[key]??fallback);
    for(const passive of globalThis.SkillDatabase?.passiveList?.(u?.character?.passives)||[]){const candidate=Number(passive?.movementRules?.[key]);if(Number.isFinite(candidate))value=Math.max(value,candidate);}
    return value;
  }
  function canTraverseElevation(fromTile,toTile,u=null){
    if(!fromTile||!toTile)return false;
    if(u&&window.VerticalMobilityEngine?.ignoresElevation?.(u))return true;
    const traits=terrainTraits(u);
    if(traits.includes("MOUNTAIN_WALK")&&(isMountainTile(fromTile)||isMountainTile(toTile)))return true;
    const delta=traversalElevation(toTile,u)-traversalElevation(fromTile,u),maxClimb=movementLimit(u,"maxClimb",MAX_NORMAL_CLIMB),maxDrop=movementLimit(u,"maxDrop",MAX_NORMAL_DROP);
    return delta<=maxClimb&&delta>=-maxDrop;
  }
  function canActiveMove(m,us,u,x,y,{ignoreElevation=false}={}){const from=tile(m,u.x,u.y),to=tile(m,x,y);if(!to||!canOccupyTerrain(u,to)||isBlockedByObject(m,x,y,u)||occupied(us,x,y,u.id))return false;return ignoreElevation||canTraverseElevation(from,to,u);}
  function cost(u,t){
    const tr=terrainTraits(u),profile=u?.character?.movementProfile||{};
    if(window.ClimateEngine?.isSolidIce?.(t))return 1;
    if(isLiveWater(t)&&Number.isFinite(Number(profile.waterCost)))return Math.max(.1,Number(profile.waterCost));
    if(window.VerticalMobilityEngine?.movementIgnoresTerrainCost?.(u))return 1;
    if(isAquatic(u)&&isLiveWater(t)||tr.includes("IGNORE_GROUND_TERRAIN")||t.terrain==="FOREST"&&tr.includes("FOREST_WALK")||t.terrain==="WATER"&&tr.includes("WATER_WALK")||isMountainTile(t)&&tr.includes("MOUNTAIN_WALK"))return 1;
    const base=Number(TERRAINS[t.terrain].moveCost||1),snow=Number(t?.snowDepth||0);return base+(snow>=1.5?2:snow>=.5?1:0);
  }
  function reachable(m,us,u){ensureFacing(u);let max=u.character.combat.move,b=new Map([[K(u.x,u.y),0]]),q=[{x:u.x,y:u.y,c:0}];while(q.length){q.sort((a,b)=>a.c-b.c);let n=q.shift(),from=tile(m,n.x,n.y);for(let [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){let x=n.x+dx,y=n.y+dy,t=tile(m,x,y);if(!t||!canOccupyTerrain(u,t)||isBlockedByObject(m,x,y,u)||occupied(us,x,y,u.id)||!canTraverseElevation(from,t,u))continue;let c=n.c+cost(u,t),k=K(x,y);if(c<=max+1e-9&&(!b.has(k)||c<b.get(k))){b.set(k,c);q.push({x,y,c})}}}b.delete(K(u.x,u.y));return b}
  function pathTo(m,us,u,endX,endY){ensureFacing(u);const start=K(u.x,u.y),goal=K(endX,endY),max=u.character.combat.move;const best=new Map([[start,0]]),prev=new Map(),q=[{x:u.x,y:u.y,c:0}];while(q.length){q.sort((a,b)=>a.c-b.c);const n=q.shift(),nk=K(n.x,n.y);if(n.c!==best.get(nk))continue;if(nk===goal)break;const from=tile(m,n.x,n.y);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=n.x+dx,y=n.y+dy,t=tile(m,x,y),k=K(x,y);if(!t||!canOccupyTerrain(u,t)||isBlockedByObject(m,x,y,u)||occupied(us,x,y,u.id)||!canTraverseElevation(from,t,u))continue;const c=n.c+cost(u,t);if(c<=max+1e-9&&(!best.has(k)||c<best.get(k))){best.set(k,c);prev.set(k,nk);q.push({x,y,c})}}}if(!best.has(goal))return[];const path=[];let k=goal;while(k!==start){const [x,y]=k.split(",").map(Number);path.push(tile(m,x,y));k=prev.get(k);if(!k)return[]}path.reverse();if(path.length){const from=path.length>1?path[path.length-2]:{x:u.x,y:u.y};u.facing=facingToward(from,path[path.length-1],ensureFacing(u));}return path}
  function range(s){return s.range}
  function attackType(u,s){const w=u?.character?.weapons?.[s?.weapon];return s?.attackType==="INHERIT"?w?.attackType:s?.attackType;}
  function lineCells(from,to){const cells=[],dx=to.x-from.x,dy=to.y-from.y,steps=Math.max(Math.abs(dx),Math.abs(dy));if(steps<=1)return cells;const seen=new Set();for(let i=1;i<steps;i++){const x=Math.round(from.x+dx*i/steps),y=Math.round(from.y+dy*i/steps),k=K(x,y);if(k!==K(from.x,from.y)&&k!==K(to.x,to.y)&&!seen.has(k)){seen.add(k);cells.push({x,y,t:i/steps})}}return cells;}
  function visionBlocked(environmentState,x,y){return !!(environmentState&&window.EnvironmentEngine?.visionModifier?.(environmentState,x,y)?.blocked)}
  function canSee(m,observer,target,environmentState=null){if(!m||!observer||!target)return false;if(observer.x===target.x&&observer.y===target.y)return true;const senseRules=(globalThis.EffectEngine?.state?.(observer)||[]).map(effect=>effect?.visionRules).filter(Boolean),senseRange=senseRules.reduce((max,rule)=>rule.ignoreEnvironmentBlockers?Math.max(max,Number(rule.maxRange||0)):max,0);if(senseRange>0&&D(observer,target)<=senseRange)return true;if(!environmentState||!window.EnvironmentEngine?.visionModifier)return true;const limit=Number(window.EnvironmentEngine?.visionRange?.(environmentState));if(Number.isFinite(limit)&&D(observer,target)>limit)return false;if(visionBlocked(environmentState,observer.x,observer.y)||visionBlocked(environmentState,target.x,target.y))return false;return lineCells(observer,target).every(p=>!visionBlocked(environmentState,p.x,p.y));}
  function hasCompanionVision(u,s){const companionId=s?.requiresCompanionVision;if(!companionId)return false;return !!globalThis.CompanionDatabase?.providesTargeting?.(u,s.id,companionId)}
  function hasLineOfSight(m,u,target,s,environmentState=null){
    if(!m||!u||!target)return false;
    const companionVision=hasCompanionVision(u,s);
    if(s?.requiresCompanionVision&&!companionVision)return false;
    if(!companionVision&&s?.ignoreVision!==true&&!canSee(m,u,target,environmentState))return false;
    if(companionVision&&s?.trajectory==="ARC")return true;
    if(attackType(u,s)!=="SHOT"||s?.trajectory==="ARC")return true;
    const from=tile(m,u.x,u.y),to=tile(m,target.x,target.y);if(!from||!to)return false;
    const fromEye=window.VerticalMobilityEngine?.eyeZ?VerticalMobilityEngine.eyeZ(u,from):elevation(from)+.5;
    const toEye=target?.character&&window.VerticalMobilityEngine?.eyeZ?VerticalMobilityEngine.eyeZ(target,to):elevation(to)+.5;
    return lineCells(u,target).every(p=>{const middle=tile(m,p.x,p.y);if(!middle)return false;const rayHeight=fromEye+(toEye-fromEye)*p.t;return elevation(middle)<rayHeight;});
  }
  function canTarget(m,u,target,s,environmentState=null){if(!u?.alive||!target?.alive)return false;const r=range(s)||{min:0,max:0},d=D(u,target);if(d<r.min||d>r.max)return false;if(s.target==="SELF")return target.id===u.id;if(s.target==="ALLY"&&target.team!==u.team)return false;if(s.target==="ENEMY"&&target.team===u.team)return false;if((s?.targetType||"SINGLE")==="SINGLE"&&target?.character&&globalThis.EffectEngine?.directTargetAllowed&&!EffectEngine.directTargetAllowed(u,target))return false;return hasLineOfSight(m,u,target,s,environmentState);}
  function targets(m,us,u,s,environmentState=null){if(s.target==="SELF")return[u];return us.filter(v=>canTarget(m,u,v,s,environmentState));}
  function resolve(m,a,d,s,opt={}){ensureFacing(a);ensureFacing(d);let at=tile(m,a.x,a.y),dt=tile(m,d.x,d.y),w=a.character.weapons[s.weapon],type=s.attackType==="INHERIT"?w?.attackType:s.attackType,acc=0,eva=TERRAINS[dt.terrain].evasion||0;if(at.terrain==="HIGH_GROUND"&&(type==="SHOT"||type==="MAGIC")&&at.elevation>dt.elevation)acc=TERRAINS[at.terrain].rangedAccuracy||0;const am=terrainPassiveModifiers(a.character,at),dm=terrainPassiveModifiers(d.character,dt),apply=(character,mods,extra={})=>({ ...character,modifiers:{...(character.modifiers||{}),accuracy:Number(character.modifiers?.accuracy||0)+Number(mods.accuracy||0)+Number(extra.accuracy||0),evasion:Number(character.modifiers?.evasion||0)+Number(mods.evasion||0)+Number(extra.evasion||0),crit:Number(character.modifiers?.crit||0)+Number(mods.crit||0),speed:Number(character.modifiers?.speed||0)+Number(mods.speed||0)}}),ac=apply(a.character,am,{accuracy:acc}),dc=apply(d.character,dm,{evasion:eva}),distance=D(a,d),arc=relativeArc(d,a),result=BattleEngine.calculate(ac,dc,s,{...opt,distance});if(result.hit&&arc==="BACK"&&Number(s?.backstabMultiplier||0)>0){const mult=Number(s.backstabMultiplier),damage=Math.round(result.damage*mult);result={...result,damage,hpAfter:Math.max(0,d.character.combat.hp-damage),backstab:true,backstabMultiplier:mult};}if(result.hit&&Number(s?.onHitBonusDamage?.amount||0)>0){const bonus=Math.max(0,Math.round(Number(s.onHitBonusDamage.amount||0))),damage=result.damage+bonus;result={...result,damage,hpAfter:Math.max(0,d.character.combat.hp-damage),onHitBonusDamage:{...s.onHitBonusDamage,amount:bonus}};}return{result,terrain:{acc,eva,at,dt,attackerPassive:am,defenderPassive:dm},facing:{attacker:a.facing,defender:d.facing,arc}}}
  return{tile,objectAt,isBlockedByObject,elevation,elevationDelta,isAquatic,canOccupyTerrain,canTraverseElevation,canActiveMove,reachable,pathTo,range,attackType,terrainTraits,terrainPassiveModifiers,visionBlocked,canSee,hasCompanionVision,hasLineOfSight,canTarget,targets,resolve,ensureFacing,facingToward,faceToward,relativeArc}
})();
globalThis.TacticalEngine=TacticalEngine;
