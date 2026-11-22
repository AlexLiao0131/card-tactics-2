/**
 * Canonical AREA_PUSH / AREA_DAMAGE terrain and shockwave reductions shared
 * by card spells and unit skills. The owning action controller pays its own
 * resources and resolves its own primary damage; this layer never duplicates
 * an attack roll or a fixed card base damage.
 */
export const AreaSpellMechanics=Object.freeze({
  resolveAreaPush({map,environmentState,center,affected,effect,name,
    unitAt,applyForcedMovement,logEnvironmentEvent,resolveEnvironmentEvents,pushLog}){
    if(!map||!environmentState||!center||!Array.isArray(affected)||!effect||effect.type!=='AREA_PUSH')
      throw Error('CANONICAL_AREA_PUSH_CONTEXT_REQUIRED');
    for(const key of ['unitAt','applyForcedMovement','logEnvironmentEvent','resolveEnvironmentEvents'])
      if(typeof ({unitAt,applyForcedMovement,logEnvironmentEvent,resolveEnvironmentEvents})[key]!=='function')
        throw Error(`CANONICAL_AREA_PUSH_HOOK_REQUIRED:${key}`);
    // These values come from the official card. Never insert a druid-only
    // damage/lift multiplier or create a fake one-cell Babylon tornado.
    const events=affected.map(tile=>EnvironmentEngine.createTornado(
      environmentState,tile.x,tile.y,{map,duration:2,
        pushDistance:Number(effect.distance||2),lift:Number(effect.lift||3),
        damage:Number(effect.damage||20),fireDamage:Number(effect.fireTornadoDamage||45),
        resistAxes:effect.resistAxes||{horizontal:false,vertical:true}}));
    events.forEach(logEnvironmentEvent);
    resolveEnvironmentEvents(events,{reason:`${name} 捲起實際水量`});
    if(events.some(e=>e.type==='FIRE_TORNADO_CREATED'))pushLog?.('🔥🌪 火焰與龍捲風結合，形成火龍捲！','SYSTEM');
    let contacts=0;
    const contactedUnitIds=new Set();
    for(const tile of affected){
      const unit=unitAt(tile.x,tile.y);
      if(!unit?.alive||contactedUnitIds.has(unit.id))continue;
      // One multi-tile body receives exactly one displacement/damage roll.
      contactedUnitIds.add(unit.id);
      const wind=EnvironmentEngine.effectAt(environmentState,tile.x,tile.y).find(
        e=>e.type===EnvironmentEngine.EFFECT.FIRE_TORNADO)||
        EnvironmentEngine.effectAt(environmentState,tile.x,tile.y).find(
          e=>e.type===EnvironmentEngine.EFFECT.TORNADO);
      const element=String(wind?.element||'AIR').toUpperCase();
      const windName=wind?.type===EnvironmentEngine.EFFECT.FIRE_TORNADO||element==='FIRE'?
        '火龍捲':element==='WATER'?'水龍捲':'龍捲風';
      applyForcedMovement(center,unit,Number(wind?.pushDistance||effect.distance||2),{
        name:windName,lift:Number(wind?.lift||effect.lift||0),
        damage:Number(wind?.damage||effect.damage||0),
        damageType:wind?.damageType||'PHYSICAL',resistAxes:wind?.resistAxes||effect.resistAxes});
      contacts++;
    }
    return{events,contacts,affectedTiles:affected.length};
  },
  resolveShockwave({center,innerRadius,shockwave,aoeTiles,unitAt,applyForcedMovement,name,pushLog}){
    if(!shockwave)return{contacts:0,outerRadius:innerRadius};
    for(const [key,fn] of Object.entries({aoeTiles,unitAt,applyForcedMovement}))
      if(typeof fn!=='function')throw Error(`CANONICAL_SHOCKWAVE_HOOK_REQUIRED:${key}`);
    const core=Math.max(0,Number(innerRadius||0));
    const radius=core+Math.max(0,Number(shockwave.outerRadius||0));
    if(radius<=core)return{contacts:0,outerRadius:radius};
    const targets=[],seen=new Set();
    for(const tile of aoeTiles(center,radius)){
      const distance=Math.abs(Number(tile.x)-Number(center.x))+Math.abs(Number(tile.y)-Number(center.y));
      if(distance<=core)continue;
      const unit=unitAt(tile.x,tile.y);
      if(!unit?.alive||seen.has(unit.id))continue;
      seen.add(unit.id);targets.push(unit);
    }
    if(targets.length)pushLog?.(`${name} 的衝擊波掃過外圈｜${targets.length} 個目標。`,'BATTLE');
    for(const unit of targets){
      if(!unit.alive)continue;
      applyForcedMovement(center,unit,Math.max(0,Number(shockwave.distance||0)),{
        name:`${name}衝擊波`,lift:Math.max(0,Number(shockwave.lift||0)),
        damage:Math.max(0,Number(shockwave.damage||0)),
        damageType:shockwave.damageType||'PHYSICAL',resistAxes:shockwave.resistAxes||null});
    }
    return{contacts:targets.length,outerRadius:radius};
  },
  applyTerrainImpact({map,environmentState,affected,forces,logEnvironmentEvent}){
    if(!map||!environmentState||!Array.isArray(affected)||!Array.isArray(forces))
      throw Error('CANONICAL_TERRAIN_IMPACT_CONTEXT_REQUIRED');
    const events=[];
    for(const tile of affected){
      const next=EnvironmentEngine.apply({map,state:environmentState,x:tile.x,y:tile.y,forces})||[];
      events.push(...next);next.forEach(logEnvironmentEvent);
    }
    return events;
  }
});
globalThis.AreaSpellMechanics=AreaSpellMechanics;
