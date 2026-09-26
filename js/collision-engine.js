export const CollisionEngine=(()=>{
  const MAX_CHAIN_DEPTH=6,IMPACT_PER_FORCE=5;
  const terrainProfile=tile=>{
    if(!tile)return {kind:"BOUNDARY",solid:true,height:99,hardness:3,response:"STOP",impactMultiplier:1.25};
    const data=TERRAINS[tile.terrain]||{};
    if(data.passable!==false)return null;
    return {kind:"TERRAIN",id:tile.terrain,solid:true,height:Number(data.collisionHeight??tile.collisionHeight??99),hardness:Number(data.hardness??2),response:data.collisionResponse||"STOP",impactMultiplier:Number(data.impactMultiplier||1)};
  };
  const objectProfile=object=>{
    if(!object||object.destroyed||object.blocksMovement!==true)return null;
    const maxDurability=Math.max(1,Number(object.maxDurability??object.durability??(object.destructible?40:999999)));
    if(object.destructible&&object.durability==null)object.durability=maxDurability;
    return {kind:"OBJECT",id:object.id,solid:true,height:Number(object.collisionHeight??99),hardness:Number(object.hardness??(object.destructible?2:4)),response:object.collisionResponse||(object.destructible?"BREAK":"STOP"),impactMultiplier:Number(object.impactMultiplier||1),destructible:!!object.destructible,maxDurability,object};
  };
  const activeCollision=unit=>(unit?.effects||[]).map(e=>e?.collision?{...e.collision,effectId:e.id}:null).filter(Boolean).sort((a,b)=>Number(b.priority||0)-Number(a.priority||0))[0]||null;

  function occupantAt(units,x,y,{excludeId=null}={}){
    return (units||[]).find(u=>u?.alive&&u.id!==excludeId&&u.x===x&&u.y===y)||null;
  }
  function canOccupy({units,x,y,excludeId=null}={}){
    return !occupantAt(units,x,y,{excludeId});
  }
  function occupancyConflicts(units){
    const by=new Map(),conflicts=[];
    for(const unit of units||[]){
      if(!unit?.alive)continue;
      const k=`${unit.x},${unit.y}`,other=by.get(k);
      if(other)conflicts.push({x:unit.x,y:unit.y,unitIds:[other.id,unit.id]});
      else by.set(k,unit);
    }
    return conflicts;
  }

  function unitProfile(unit){
    const special=activeCollision(unit);
    if(special)return {kind:special.kind||"SHIELD",id:special.effectId||unit.id,solid:special.solid!==false,height:Number(special.height??3),hardness:Number(special.hardness??3),response:special.response||"STOP",impactMultiplier:Number(special.impactMultiplier||1),unit,special:true};
    const r=DisplacementEngine.resistance(unit);
    return {kind:"UNIT",id:unit.id,solid:true,height:Number(unit.character?.collision?.height??2),hardness:Number(unit.character?.collision?.hardness??Math.max(1,r.value+1)),response:"TRANSFER",impactMultiplier:Number(unit.character?.collision?.impactMultiplier||1),unit,weightClass:r.weightClass,resistance:r.value};
  }
  function surfaceAt({map,units,x,y,z,excludeId}){
    const tile=TacticalEngine.tile(map,x,y);
    if(!tile)return terrainProfile(null);
    const ground=Number(TacticalEngine.elevation(tile));
    const object=(map.objects||[]).find(o=>!o.destroyed&&o.x===x&&o.y===y&&o.blocksMovement===true);
    const op=objectProfile(object);
    if(op&&Number(z)>=ground&&Number(z)<=ground+Number(op.height))return op;
    const unit=occupantAt(units,x,y,{excludeId});
    if(unit){
      const up=unitProfile(unit),bottom=Number.isFinite(Number(unit.z))?Number(unit.z):ground,top=bottom+Number(up.height);
      if(Number(z)>=bottom&&Number(z)<=top)return up;
    }
    const tp=terrainProfile(tile);
    if(tp&&Number(z)>=ground&&Number(z)<=ground+Number(tp.height))return tp;
    return null;
  }
  function impactDamage({remainingForce=0,mover,surface}){
    const movingWeight=Math.max(1,Number(DisplacementEngine.resistance(mover).value)+1);
    const hardness=Math.max(1,Number(surface?.hardness||1));
    return Math.max(0,Math.round(Number(remainingForce||0)*IMPACT_PER_FORCE*(movingWeight+hardness-1)*Number(surface?.impactMultiplier||1)));
  }
  function canTransfer(mover,other,remainingForce){
    if(!other?.alive||remainingForce<=0)return false;
    const mr=DisplacementEngine.resistance(mover),or=DisplacementEngine.resistance(other);
    return remainingForce>or.value&&or.value<=mr.value+1;
  }
  return Object.freeze({MAX_CHAIN_DEPTH,IMPACT_PER_FORCE,terrainProfile,objectProfile,unitProfile,occupantAt,canOccupy,occupancyConflicts,surfaceAt,impactDamage,canTransfer});
})();
globalThis.CollisionEngine=CollisionEngine;
