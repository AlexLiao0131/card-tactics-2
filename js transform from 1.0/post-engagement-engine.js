export const PostEngagementEngine=(()=>{
  const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
  const tileElevation=(map,x,y)=>FallEngine.tileElevation(map,x,y);
  const groundZ=(map,unit)=>FallEngine.groundZ(map,unit);
  const syncGroundZ=(map,unit)=>FallEngine.syncGroundZ(map,unit);
  function direction(source,target,type){let dx=Math.sign(target.x-source.x),dy=Math.sign(target.y-source.y);if(dx&&dy){if(Math.abs(target.x-source.x)>=Math.abs(target.y-source.y))dy=0;else dx=0;}if(type==="PULL"){dx=-dx;dy=-dy}return{dx,dy}}
  function damageUnit(unit,amount){const d=Math.max(0,Math.round(Number(amount||0)));if(d&&unit?.alive){unit.hp=Math.max(0,unit.hp-d);if(unit.hp===0)unit.alive=false}return d}
  const fallDamage=drop=>FallEngine.fallDamage(drop);
  const resolveLanding=args=>FallEngine.resolveLanding({...args,applyDamage:damageUnit});
  function gridOccupant(units,x,y,target){return CollisionEngine.occupantAt?.(units,x,y,{excludeId:target?.id})||(units||[]).find(u=>u?.alive&&u.id!==target?.id&&u.x===x&&u.y===y)||null}
  function landingSafe(units,x,y,target){return !gridOccupant(units,x,y,target)}
  function fallbackDirection(map,units,target,distance,{z,airborne}={}){
    return DIRS.map((d,index)=>{let x=target.x,y=target.y,space=0;for(let i=0;i<distance;i++){const nx=x+d[0],ny=y+d[1],to=TacticalEngine.tile(map,nx,ny);if(!to)break;const occupied=gridOccupant(units,nx,ny,target);const surface=CollisionEngine.surfaceAt({map,units,x:nx,y:ny,z:Number(z),excludeId:target.id});if(surface||(!airborne&&occupied))break;if(!airborne&&TacticalEngine.elevationDelta(TacticalEngine.tile(map,x,y),to)>1)break;x=nx;y=ny;space++}return{d,index,space}}).sort((a,b)=>b.space-a.space||a.index-b.index)[0]?.d||[0,0];
  }
  function forcedMove({map,units,source,target,effect,_depth=0,_visited=new Set(),onCollision=null}){
    if(!target?.alive)return{type:effect.type,applied:false,reason:"TARGET_DEAD",collisions:[]};
    if(_depth>CollisionEngine.MAX_CHAIN_DEPTH||_visited.has(target.id))return{type:effect.type,applied:false,reason:"CHAIN_LIMIT",collisions:[]};
    const visited=new Set(_visited);visited.add(target.id);
    const displacement=DisplacementEngine.resolve(effect,target),distance=displacement.distance,lift=displacement.lift,startZ=groundZ(map,target),trajectory=TrajectoryEngine.begin(map,target,lift),travelZ=trajectory.z;
    target.z=trajectory.z;
    let dir=direction(source,target,effect.type);
    if(!dir.dx&&!dir.dy){const f=fallbackDirection(map,units,target,distance,{z:trajectory.z,airborne:trajectory.state!=="GROUNDED"});dir={dx:f[0],dy:f[1]}}
    const start={x:target.x,y:target.y,z:startZ},steps=[],collisions=[];
    let lastSafeLanding={...start};

    if(!dir.dx&&!dir.dy){
      const landing=resolveLanding({map,target,fromZ:trajectory.z});
      return{type:effect.type,applied:lift>0,reason:lift>0?null:"BLOCKED",start,end:{x:target.x,y:target.y,z:target.z},steps,collisions,airborne:trajectory.state!=="GROUNDED",trajectoryState:trajectory.state,lift,travelZ,displacement,landing,falls:landing.damaging?[{from:landing.fromZ,to:landing.toZ,drop:landing.drop}]:[],fallDamage:landing.damage,defeated:!target.alive}
    }

    for(let i=0;i<distance;i++){
      const nx=target.x+dir.dx,ny=target.y+dir.dy,to=TacticalEngine.tile(map,nx,ny),remaining=distance-i;
      if(!to){const surface=CollisionEngine.terrainProfile(null),damage=CollisionEngine.impactDamage({remainingForce:remaining,mover:target,surface});damageUnit(target,damage);collisions.push({kind:"BOUNDARY",x:nx,y:ny,surface,damage,stopped:true});break}
      const inspection=TrajectoryEngine.inspectStep(map,trajectory,nx,ny);
      if(inspection.blocked){const surface={kind:"TERRAIN_FACE",solid:true,height:inspection.surface,hardness:2,response:"STOP",impactMultiplier:1},damage=CollisionEngine.impactDamage({remainingForce:remaining,mover:target,surface});damageUnit(target,damage);collisions.push({kind:"TERRAIN",x:nx,y:ny,surface,damage,stopped:true});break}

      const occupant=gridOccupant(units,nx,ny,target);
      const surface=CollisionEngine.surfaceAt({map,units,x:nx,y:ny,z:trajectory.z,excludeId:target.id});
      if(surface){
        const damage=CollisionEngine.impactDamage({remainingForce:remaining,mover:target,surface});damageUnit(target,damage);
        const hit=surface.unit;
        const transfer=effect.type==="KNOCKBACK"&&surface.kind==="UNIT"&&CollisionEngine.canTransfer(target,hit,remaining);
        let chain=null;
        if(transfer){
          const transferred=Math.max(1,remaining-1);
          chain=forcedMove({map,units,source:{x:target.x,y:target.y},target:hit,effect:{type:"KNOCKBACK",distance:transferred,lift:0,force:{horizontal:transferred,vertical:0},resistAxes:{horizontal:true,vertical:true}},_depth:_depth+1,_visited:visited,onCollision});
          if(hit?.alive)damageUnit(hit,Math.max(1,Math.round(damage*.5)));
        }
        let objectDamage=0,objectDestroyed=false;
        if(surface.kind==="OBJECT"&&surface.destructible&&surface.object){objectDamage=Math.max(1,damage);surface.object.durability=Math.max(0,Number(surface.object.durability??surface.maxDurability)-objectDamage);objectDestroyed=surface.object.durability<=0;if(objectDestroyed)surface.object.destroyed=true}
        const collision={kind:surface.kind,x:nx,y:ny,surface,damage,transferred:transfer,chain,objectDamage,objectDestroyed,stopped:!objectDestroyed};
        collisions.push(collision);onCollision?.(collision,{mover:target,source,effect,depth:_depth});
        if(objectDestroyed&&target.alive){
          TrajectoryEngine.advance(trajectory,inspection);target.x=nx;target.y=ny;target.z=trajectory.z;steps.push({x:nx,y:ny,z:trajectory.z,elevation:TacticalEngine.elevation(to),trajectoryState:trajectory.state,brokeObject:surface.object.id});
          if(landingSafe(units,nx,ny,target))lastSafeLanding={x:nx,y:ny,z:trajectory.z};
          continue;
        }
        break;
      }

      // A unit may pass over another unit while airborne, but an occupied grid cell is never a legal landing cell.
      TrajectoryEngine.advance(trajectory,inspection);target.x=nx;target.y=ny;target.z=trajectory.z;
      steps.push({x:nx,y:ny,z:trajectory.z,elevation:TacticalEngine.elevation(to),trajectoryState:trajectory.state,passedOverUnit:occupant?.id||null});
      if(!occupant)lastSafeLanding={x:nx,y:ny,z:trajectory.z};
    }

    const preLandingState=trajectory.state;
    let landingAdjusted=false,blockedBy=null;
    const finalOccupant=gridOccupant(units,target.x,target.y,target);
    if(finalOccupant){
      blockedBy=finalOccupant.id;
      target.x=lastSafeLanding.x;target.y=lastSafeLanding.y;target.z=lastSafeLanding.z;
      landingAdjusted=true;
    }
    const landing=resolveLanding({map,target,fromZ:trajectory.z}),falls=landing.damaging?[{from:landing.fromZ,to:landing.toZ,drop:landing.drop}]:[];
    const occupancyViolation=gridOccupant(units,target.x,target.y,target);
    if(occupancyViolation){
      target.x=start.x;target.y=start.y;target.z=start.z;
      landingAdjusted=true;blockedBy=occupancyViolation.id;
    }
    return{type:effect.type,applied:steps.length>0||lift>0||collisions.length>0,start,end:{x:target.x,y:target.y,z:target.z},steps,collisions,airborne:preLandingState!=="GROUNDED",trajectoryState:preLandingState,lift,travelZ,displacement,landing,falls,fallDamage:landing.damage,defeated:!target.alive,landingAdjusted,blockedBy,occupancySafe:!gridOccupant(units,target.x,target.y,target)};
  }
  function process({map,units,queue=[]},hooks={}){
    const results=[];
    for(const item of queue){
      const{source,target,effect}=item;if(!target?.alive)continue;
      let result={type:effect.type,applied:false,reason:"UNSUPPORTED"};
      if(effect.type==="KNOCKBACK"||effect.type==="PULL")result=forcedMove({map,units,source,target,effect});
      const entry={...item,result};results.push(entry);hooks.onEffect?.(entry);if(result.defeated)hooks.onDefeated?.(target,source,effect);
    }
    return{queue,results}
  }
  return Object.freeze({process,forcedMove,resolveLanding,groundZ,syncGroundZ,fallDamage,FALL_THRESHOLD:FallEngine.FALL_THRESHOLD,FALL_DAMAGE_PER_LEVEL:FallEngine.FALL_DAMAGE_PER_LEVEL});
})();
globalThis.PostEngagementEngine=PostEngagementEngine;
