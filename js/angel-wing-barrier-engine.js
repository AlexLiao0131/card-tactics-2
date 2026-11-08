/**
 * Canonical four-cell Holy Wing Wall, shared by solo/Gemini and the PvP worker.
 * This is battlefield state, NEVER Babylon collision or an independent combat system.
 * A shield is a permanent-in-place, invulnerable obstruction while its caster
 * remains alive, grounded, and at its chosen landing tile. Movement or takeoff
 * releases the wall. No unapproved mana cost or round counter is fabricated.
 */
export const AngelWingBarrierEngine=(()=>{
  const TYPE='HOLY_WING_BARRIER';
  const ACTION='LAND_WING_BARRIER';
  const FACING=Object.freeze({N:[0,-1],S:[0,1],E:[1,0],W:[-1,0]});
  const side=team=>team==='PLAYER'||team==='P'?'P':team==='ENEMY'||team==='E'?'E':team;
  function isSegment(object){return object?.type===TYPE&&object.destroyed!==true;}
  function wallTiles(landing,facing){
    const [dx,dy]=FACING[facing]||FACING.N;
    // One transverse row directly ahead, four contiguous tiles.
    const lateral=[-dy,dx];
    return [-1,0,1,2].map((offset,index)=>({
      x:landing.x+dx+lateral[0]*offset,
      y:landing.y+dy+lateral[1]*offset,index
    }));
  }
  function ownerStillHolding(object,units){
    const actor=(units||[]).find(unit=>unit.id===object.ownerUnitId&&unit.alive);
    return !!actor&&side(actor.team)===side(object.ownerTeam)&&
      actor.x===object.anchorX&&actor.y===object.anchorY&&
      actor.verticalState?.mode!=='FLYING'&&actor.verticalState?.mode!=='DIVING'&&
      actor.verticalState?.mode!=='BURROWED';
  }
  function reconcile(map,units){
    if(!Array.isArray(map?.objects)||!Array.isArray(units))return false;
    const invalid=map.objects.some(o=>isSegment(o)&&!ownerStillHolding(o,units));
    if(invalid)map.objects=map.objects.filter(o=>!isSegment(o)||ownerStillHolding(o,units));
    return invalid;
  }
  function segments(map){return(map?.objects||[]).filter(isSegment);}
  function isCanonicalSkill(skill){
    return !!skill&&skill.category==='MAGIC'&&skill.target==='TILE'&&
      skill.targetType==='AOE'&&Number(skill.radius)===0&&
      skill.utilityAction?.type===ACTION&&skill.requirements?.flying===true&&
      Number(skill.power||0)===0&&!skill.effects&&!skill.variants?.length;
  }
  function candidate(map,units,actor,landing,{cores=[]}={}){
    if(!map?.tiles||!actor?.alive||actor.acted||actor.waited||
       actor.verticalState?.mode!=='FLYING'||!landing)return null;
    const tactical=globalThis.TacticalEngine,vertical=globalThis.VerticalMobilityEngine;
    if(!tactical||!vertical?.capabilities?.(actor)?.canFly)return null;
    const tile=tactical.tile(map,landing.x,landing.y);
    if(!tile||!tactical.canOccupyTerrain(actor,tile)||
       tactical.isBlockedByObject(map,tile.x,tile.y,actor)||
       units.some(u=>u.alive&&u.occupiesTile!==false&&u.id!==actor.id&&u.x===tile.x&&u.y===tile.y)||
       cores.some(c=>c.hp>0&&c.x===tile.x&&c.y===tile.y))return null;
    // The angel must actually land on ground, not stand at the surface of water.
    const grounded=vertical.describe(actor,tile,{mode:'GROUND'});
    if(grounded.mode!=='GROUND')return null;
    let path=[];
    if(landing.x!==actor.x||landing.y!==actor.y){
      if(actor.moved)return null;
      const probe={...actor,verticalState:{...actor.verticalState}};
      path=tactical.pathTo(map,units,probe,tile.x,tile.y);
      if(!path.length||path.at(-1)?.x!==tile.x||path.at(-1)?.y!==tile.y)return null;
    }
    // The caster's CHOSEN facing, never her movement direction, owns the wall.
    const facing=tactical.ensureFacing({...actor});
    const cells=wallTiles(tile,facing);
    if(cells.some(c=>{
      const t=tactical.tile(map,c.x,c.y);
      if(!t||!globalThis.TERRAINS?.[t.terrain]?.passable)return true;
      if((map.objects||[]).some(o=>!o.destroyed&&o.type!==TYPE&&o.blocksMovement&&o.x===c.x&&o.y===c.y))return true;
      if(units.some(u=>u.alive&&side(u.team)!==side(actor.team)&&u.x===c.x&&u.y===c.y))return true;
      if(cores.some(core=>core.hp>0&&core.x===c.x&&core.y===c.y))return true;
      return false;
    }))return null;
    return {landing:tile,path,facing,cells};
  }
  function legalTiles(map,units,actor,options={}){
    reconcile(map,units);
    if(!actor?.alive||actor.acted||actor.waited||actor.verticalState?.mode!=='FLYING')return[];
    const range=actor.moved?[]:[...globalThis.TacticalEngine.reachable(map,units,actor)].map(([position])=>{
      const [x,y]=position.split(',').map(Number);return{x,y};
    });
    return [{x:actor.x,y:actor.y},...range]
      .map(p=>globalThis.TacticalEngine.tile(map,p.x,p.y))
      .filter(t=>t&&candidate(map,units,actor,t,options));
  }
  function cast({map,units,actor,landing,skill,cores=[],traverse,consumeSkill}={}){
    if(!isCanonicalSkill(skill))return {ok:false,reason:'INVALID_WING_SKILL'};
    reconcile(map,units);
    const plan=candidate(map,units,actor,landing,{cores});
    if(!plan)return {ok:false,reason:'ILLEGAL_LANDING_OR_WALL'};
    // No second movement algorithm. Both hosts use their environment
    // controllers; currents, traps and mid-path interruptions remain official.
    if(plan.path.length){
      if(typeof traverse!=='function')return{ok:false,reason:'ENVIRONMENT_TRAVERSAL_REQUIRED'};
      const traveled=traverse(actor,plan.path,{kind:'UNIT'});
      actor.moved=true;
      if(traveled?.completed!==true||!actor.alive||
         actor.x!==plan.landing.x||actor.y!==plan.landing.y)
        return{ok:false,interrupted:true,reason:'LANDING_INTERRUPTED',movement:traveled};
    }
    // The movement may have changed the actor's physical ground state.
    const tile=globalThis.TacticalEngine.tile(map,actor.x,actor.y);
    if(!tile||globalThis.VerticalMobilityEngine.describe(actor,tile,{mode:'GROUND'}).mode!=='GROUND')
      return {ok:false,reason:'GROUND_UNAVAILABLE'};
    if(typeof consumeSkill!=='function'||!consumeSkill(actor,skill))
      return {ok:false,reason:'RESOURCE_OR_REQUIREMENT'};
    const ground=globalThis.VerticalMobilityEngine.setMode(actor,tile,'GROUND');
    if(!ground.ok)return{ok:false,reason:ground.reason||'GROUND_UNAVAILABLE'};
    // An existing wall from the same angel is replaced as one atomic field.
    map.objects??=[];
    map.objects=map.objects.filter(o=>!isSegment(o)||o.ownerUnitId!==actor.id);
    actor.facing=plan.facing;
    const id=`${TYPE}:${actor.id}:${actor.x},${actor.y}`;
    map.objects.push(...plan.cells.map(cell=>({
      id:`${id}:${cell.index}`,name:'聖翼壁障',type:TYPE,
      x:cell.x,y:cell.y,ownerUnitId:actor.id,ownerTeam:actor.team,
      anchorX:actor.x,anchorY:actor.y,facing:plan.facing,
      barrierIndex:cell.index,destructible:false,blocksMovement:true
    })));
    return{ok:true,landing:tile,facing:plan.facing,cells:plan.cells};
  }
  function blocksMovement(map,x,y,unit){
    return segments(map).some(segment=>segment.x===x&&segment.y===y&&
      (!unit?.team||side(unit.team)!==side(segment.ownerTeam)));
  }
  // Ranged arrows and MAGIC from outside cannot cross inward through a
  // friendly's wall. Outgoing friendly attacks (including counters) bypass it.
  function blocksIncoming(map,from,target,skill){
    if(!from||!target||!skill)return false;
    const delivery=globalThis.TacticalEngine?.attackDelivery?.(from,skill);
    if(delivery!=='RANGED'&&skill.category!=='MAGIC'&&skill.attackType!=='MAGIC')return false;
    const steps=Math.max(Math.abs(target.x-from.x),Math.abs(target.y-from.y));
    if(!steps)return false;
    for(const segment of segments(map)){
      if(side(from.team)===side(segment.ownerTeam)||target.team&&side(target.team)!==side(segment.ownerTeam))continue;
      const normal=FACING[segment.facing]||FACING.N;
      const a=(from.x-segment.x)*normal[0]+(from.y-segment.y)*normal[1];
      const b=(target.x-segment.x)*normal[0]+(target.y-segment.y)*normal[1];
      if(a<=0||b>=0)continue;
      for(let i=1;i<steps;i++){
        const t=i/steps;
        if(Math.round(from.x+(target.x-from.x)*t)===segment.x&&
           Math.round(from.y+(target.y-from.y)*t)===segment.y)return true;
      }
    }
    return false;
  }
  return Object.freeze({TYPE,ACTION,isCanonicalSkill,wallTiles,candidate,legalTiles,cast,
    blocksMovement,blocksIncoming,reconcile,segments});
})();
globalThis.AngelWingBarrierEngine=AngelWingBarrierEngine;
